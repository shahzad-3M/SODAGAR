import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  BusinessProfile,
  CategoryRecord,
  CODOrder,
  Customer,
  DeliveryCityConfig,
  MonthlyExpense,
  ProductItem,
  Reseller,
  Transaction,
  UserAccount,
} from './src/types';
import {
  defaultBusinessProfile,
} from './src/utils/defaultData';
import {
  computeCategoryLevel,
  getCategoryBreadcrumb,
  getCategoryDescendantIds,
  getProductDeliveryMeta,
  inferProvinceForCity,
  isMuzaffarabadCity,
  isProductPurchaseBlocked,
  isUpcomingCategoryName,
  isUserAuthorizedForStockTransfer,
  normalizeTextKey,
  normalizeUpcomingCategoryRecord,
  resolveExpressAreaAvailability,
  slugifyId,
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
} from './src/utils/locationCategoryHelpers';
import {
  auditAndRepairOrderHistory,
  createVerifiedBackup,
  getAllCategoriesFromDb,
  getAllCitiesFromDb,
  getAllCustomersFromDb,
  getAllProductsFromDb,
  getCollectionValue,
  getDatabaseHealthSummary,
  getDb,
  getFullSyncState,
  getSyncVersion,
  insertAdminAuditLog,
  listBackups,
  mergeLocalSnapshotNonDestructively,
  replaceCitiesAndAreasFromList,
  saveCollectionValue,
  syncDeliveryCitiesIntoBusinessProfile,
  touchSyncVersion,
  upsertCategoryRow,
  upsertCustomerRow,
  upsertProductRow,
} from './src/server/db';
import {
  downloadAndCacheExternalImage,
  IMPORTED_MEDIA_DIR,
  scrapeProductFromUrl,
} from './src/server/productScraper';

function readCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

const cliPort = readCliArg('--port') || process.env.npm_config_port;
const envPort =
  process.env.PORT && process.env.PORT !== process.env.NGINX_PORT
    ? process.env.PORT
    : undefined;
const PORT = Number(cliPort || envPort || process.env.DEFAULT_APP_PORT || 3000);
const HOST = readCliArg('--host') || process.env.npm_config_host || process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`100dagar_${process.cwd()}`).digest('hex');

interface SessionClaims {
  userId: string;
  role: string;
  name: string;
  exp: number;
}

function signSessionToken(claims: Omit<SessionClaims, 'exp'>): string {
  const payload: SessionClaims = {
    ...claims,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token?: string | null): SessionClaims | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionClaims;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function verifyServerPassword(
  plainPassword: string,
  storedHash?: string,
  storedSalt?: string
): Promise<boolean> {
  if (!storedHash) return false;
  if (!storedSalt) {
    return plainPassword === storedHash;
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${storedSalt}:${plainPassword}`)
    .digest('hex');
  return digest === storedHash;
}

function normalizePhoneOrId(val: string): string {
  const clean = (val || '').trim().replace(/[\s-]/g, '');
  if (clean.startsWith('+92') && clean.length >= 12) return `0${clean.slice(3)}`;
  if (clean.startsWith('92') && clean.length >= 11 && !clean.startsWith('920')) return `0${clean.slice(2)}`;
  return clean;
}

function resolveActor(req: Request): {
  id?: string;
  role?: string;
  name?: string;
  account?: UserAccount;
} {
  const db = getDb();
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const token = bearer || req.header('x-session-token');
  const claims = verifySessionToken(token);
  const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);

  if (claims) {
    const account = accounts.find((u) => u.id === claims.userId);
    return {
      id: claims.userId,
      role: account?.role || claims.role,
      name: account?.fullName || claims.name,
      account,
    };
  }

  // Fallback verified against user_accounts for same-origin UI requests with actor headers
  const safeDecode = (val?: string | null) => {
    if (!val) return '';
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  };
  const actorId = safeDecode(req.header('x-actor-id'));
  const actorRole = safeDecode(req.header('x-actor-role'));
  const actorName = safeDecode(req.header('x-actor-name'));
  if (actorId) {
    const account = accounts.find((u) => u.id === actorId);
    if (account && account.status === 'active') {
      return {
        id: account.id,
        role: account.role,
        name: account.fullName,
        account,
      };
    }
    if (
      (actorRole === 'super_admin' || actorRole === 'admin' || actorRole === 'manager') &&
      actorId !== 'user_cust_default'
    ) {
      return { id: actorId, role: actorRole, name: actorName || 'Shahzad Malik' };
    }
  }
  return { role: undefined };
}

// Connected SSE clients for instant cross-device synchronization
const sseClients = new Set<Response>();

function broadcastSyncEvent(resource: string, sourceClientId?: string) {
  const updatedAt = touchSyncVersion();
  const payload = JSON.stringify({
    type: 'sync',
    resource,
    updatedAt,
    sourceClientId: sourceClientId || null,
  });
  for (const client of sseClients) {
    try {
      client.write(`event: sync\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  // Initialize SQLite DB, backups, and migrations before accepting requests
  getDb();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Serve downloaded & verified imported product images cleanly from local server storage
  app.use('/api/media/imported', express.static(IMPORTED_MEDIA_DIR, { maxAge: '30d' }));

  // Disable caching on all JSON API routes so all devices always see fresh state
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/media/imported')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // 1. HEALTH & BACKUP ENDPOINTS
  app.get('/api/health', (_req, res) => {
    res.json(getDatabaseHealthSummary());
  });

  app.get('/api/admin/backups', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can inspect database backups.' });
      return;
    }
    res.json({ backups: listBackups() });
  });

  app.post('/api/admin/backup', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can trigger database backups.' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual_admin';
    const meta = createVerifiedBackup(reason);
    res.json({ ok: true, backup: meta });
  });

  // 2. REAL-TIME SSE STREAM FOR CROSS-DEVICE SYNC
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(
      `event: connected\ndata: ${JSON.stringify({ syncVersion: getSyncVersion() })}\n\n`
    );

    const keepAlive = setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // 3. CENTRAL STATE HYDRATION & NON-DESTRUCTIVE LOCAL MIGRATION
  app.get('/api/sync/state', (req, res) => {
    const actor = resolveActor(req);
    const state = getFullSyncState(actor.role);
    res.json(state);
  });

  app.post('/api/sync/migrate-local', (req, res) => {
    const collections = (req.body?.collections || {}) as Record<string, unknown>;
    const { mergedCounts } = mergeLocalSnapshotNonDestructively(collections);
    if (Object.keys(mergedCounts).length > 0) {
      broadcastSyncEvent('all', req.header('x-client-id'));
    }
    res.json({ ok: true, mergedCounts, syncVersion: getSyncVersion() });
  });

  // 4. AUTHENTICATION ENDPOINT
  app.post('/api/auth/login', async (req, res) => {
    const { identifier, pin } = (req.body || {}) as { identifier?: string; pin?: string };
    const cleanId = normalizePhoneOrId(identifier || '');
    const cleanIdLower = (identifier || '').trim().toLowerCase();
    const cleanPin = (pin || '').trim();

    if (!cleanId || !cleanPin) {
      res.status(400).json({ error: 'Identifier and PIN / password are required.' });
      return;
    }

    const db = getDb();
    const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const profile = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    const ownerPin = profile.adminPin || '580987';
    const superAdminAcc = accounts.find((u) => u.id === 'usr_superadmin' || u.role === 'super_admin');

    const isSuperId =
      cleanId === '03125256266' || cleanIdLower === 'admin' || cleanIdLower === 'admin@madinamarket.pk';
    if (
      isSuperId &&
      (cleanPin === ownerPin ||
        (superAdminAcc ? await verifyServerPassword(cleanPin, superAdminAcc.passwordHash, superAdminAcc.passwordSalt) : false))
    ) {
      const userObj = {
        id: superAdminAcc?.id || 'usr_superadmin',
        name: superAdminAcc?.fullName || 'Shahzad Malik',
        urduName: superAdminAcc?.urduName || 'شہزاد ملک (سپر ایڈمن)',
        phone: superAdminAcc?.phone || '03125256266',
        email: superAdminAcc?.email || 'admin@madinamarket.pk',
        role: 'super_admin',
        canAuthorizeCreditSale: true,
        isAuthenticated: true,
      };
      const sessionToken = signSessionToken({ userId: userObj.id, role: 'super_admin', name: userObj.name });
      res.json({ ok: true, user: userObj, sessionToken });
      return;
    }

    const matchingAccounts = accounts.filter(
      (u) =>
        normalizePhoneOrId(u.phone) === cleanId ||
        u.username.toLowerCase() === cleanIdLower ||
        (u.email && u.email.toLowerCase() === cleanIdLower)
    );

    for (const acc of matchingAccounts) {
      const validHash = await verifyServerPassword(cleanPin, acc.passwordHash, acc.passwordSalt);
      const digits = acc.phone.replace(/\D/g, '');
      const defaultPin = digits.length >= 6 ? digits.slice(-6) : '123456';
      const validTemp =
        Boolean(acc.isTemporaryPassword || !acc.passwordHash) &&
        (cleanPin === acc.suggestedDefaultPin || cleanPin === defaultPin);
      if (validHash || validTemp) {
        if (acc.status !== 'active') {
          res.status(403).json({ error: 'Account is suspended or inactive.' });
          return;
        }
        const userObj = {
          id: acc.id,
          name: acc.fullName,
          urduName: acc.urduName,
          phone: acc.phone,
          email: acc.email,
          role: acc.role,
          customerId: acc.linkedCustomerId,
          investorId: acc.linkedInvestorId,
          resellerCode: acc.linkedResellerCode,
          branchId: acc.linkedBranchId,
          branchName: acc.linkedBranchName,
          managerAuthorities: acc.managerAuthorities,
          canAuthorizeCreditSale:
            acc.role === 'super_admin' ||
            acc.role === 'admin' ||
            Boolean(acc.canAuthorizeCreditSale ?? acc.managerAuthorities?.canAuthorizeCreditSale),
          isAuthenticated: true,
        };
        const sessionToken = signSessionToken({ userId: acc.id, role: acc.role, name: acc.fullName });
        res.json({ ok: true, user: userObj, sessionToken });
        return;
      }
    }

    res.status(401).json({ error: 'Invalid credentials.' });
  });

  // 5. PRODUCTS & UPCOMING -> ARRIVED TRANSFER
  app.get('/api/products', (_req, res) => {
    res.json({ products: getAllProductsFromDb() });
  });

  app.post('/api/products', (req, res) => {
    const db = getDb();
    const product = req.body as ProductItem;
    if (!product?.id || !product?.name) {
      res.status(400).json({ error: 'Product ID and name are required.' });
      return;
    }
    const saved = upsertProductRow(db, product);
    broadcastSyncEvent('products', req.header('x-client-id'));
    res.json({ ok: true, product: saved, syncVersion: getSyncVersion() });
  });

  app.put('/api/products/:id', (req, res) => {
    const db = getDb();
    const id = req.params.id;
    const existing = getAllProductsFromDb(db).find((p) => p.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const incoming = req.body as Partial<ProductItem>;
    const merged: ProductItem = { ...existing, ...incoming, id };

    // Prevent bypass via regular edit if product is still marked Upcoming / Coming Soon
    if (isProductPurchaseBlocked(merged)) {
      merged.isUpcoming = true;
      merged.upcomingStatus = 'coming_soon';
      merged.stockQty = 0;
      merged.category = UPCOMING_CATEGORY_NAME;
      merged.parentCategoryId = UPCOMING_CATEGORY_ID;
    }

    const saved = upsertProductRow(db, merged);
    broadcastSyncEvent('products', req.header('x-client-id'));
    res.json({ ok: true, product: saved, syncVersion: getSyncVersion() });
  });

  app.delete('/api/products/:id', (req, res) => {
    const actor = resolveActor(req);
    if (!isUserAuthorizedForStockTransfer(actor)) {
      res.status(403).json({ error: 'Unauthorized to delete products.' });
      return;
    }
    const db = getDb();
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    broadcastSyncEvent('products', req.header('x-client-id'));
    res.json({ ok: true, syncVersion: getSyncVersion() });
  });

  app.post('/api/products/:id/activate-arrival', (req, res) => {
    const actor = resolveActor(req);
    if (!isUserAuthorizedForStockTransfer(actor)) {
      res.status(403).json({
        error: 'Only administrators or authorized stock managers can confirm physical arrival and activate Coming Soon products.',
      });
      return;
    }

    const db = getDb();
    const existing = getAllProductsFromDb(db).find((p) => p.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const {
      parentCategoryId,
      subcategoryId,
      childSubcategoryId,
      ourPrice,
      marketPrice,
      costPrice,
      stockQty,
      variations,
      details,
      badgeText,
      deliveryType,
      deliveryFeeType,
      customDeliveryCharge,
    } = (req.body || {}) as {
      parentCategoryId?: string;
      subcategoryId?: string;
      childSubcategoryId?: string;
      ourPrice?: number;
      marketPrice?: number;
      costPrice?: number;
      stockQty?: number;
      variations?: ProductItem['variations'];
      details?: string;
      badgeText?: string;
      deliveryType?: 'express' | 'standard';
      deliveryFeeType?: 'default' | 'free' | 'custom';
      customDeliveryCharge?: number;
    };

    const allCats = getAllCategoriesFromDb(db);
    const targetMain = allCats.find((c) => c.id === parentCategoryId);
    if (!targetMain || targetMain.isUpcoming || targetMain.id === UPCOMING_CATEGORY_ID) {
      res.status(400).json({ error: 'Please select a valid active Main Category outside Upcoming Viral Products.' });
      return;
    }

    const finalStock = Math.max(0, Number(stockQty ?? existing.stockQty ?? 0));
    if (finalStock <= 0) {
      res.status(400).json({ error: 'Initial arrived stock quantity must be greater than 0.' });
      return;
    }

    const finalOurPrice = Number(ourPrice ?? existing.ourPrice ?? 0);
    if (finalOurPrice <= 0) {
      res.status(400).json({ error: 'Selling price must be greater than 0.' });
      return;
    }

    const categoryBreadcrumb = getCategoryBreadcrumb(allCats, parentCategoryId, subcategoryId, childSubcategoryId);
    const now = new Date().toISOString();

    const resolvedFeeType = deliveryFeeType || existing.deliveryFeeType || 'default';
    const activatedProduct: ProductItem = {
      ...existing,
      category: categoryBreadcrumb,
      parentCategoryId,
      subcategoryId: subcategoryId || undefined,
      childSubcategoryId: childSubcategoryId || undefined,
      ourPrice: finalOurPrice,
      marketPrice: Number(marketPrice ?? existing.marketPrice ?? finalOurPrice),
      costPrice: Number(costPrice ?? existing.costPrice ?? 0),
      stockQty: finalStock,
      variations: Array.isArray(variations) ? variations : existing.variations,
      details: typeof details === 'string' ? details : existing.details,
      deliveryType: deliveryType === 'express' ? 'express' : deliveryType === 'standard' ? 'standard' : (existing.deliveryType || 'standard'),
      deliveryFeeType: resolvedFeeType,
      customDeliveryCharge:
        resolvedFeeType === 'custom'
          ? customDeliveryCharge ?? existing.customDeliveryCharge ?? 0
          : undefined,
      badgeText: badgeText !== undefined ? badgeText : existing.badgeText === 'COMING SOON' ? 'NEW ARRIVAL' : existing.badgeText,
      isUpcoming: false,
      upcomingStatus: 'available',
      status: 'published',
      activatedAt: now,
      activatedBy: actor.name || actor.role || 'Admin',
      updatedAt: now,
    };

    const saved = upsertProductRow(db, activatedProduct);
    insertAdminAuditLog(db, {
      action: 'activate_upcoming_arrival',
      entityType: 'product',
      entityId: saved.id,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: {
        productName: saved.name,
        targetCategory: saved.category,
        stockQty: saved.stockQty,
        ourPrice: saved.ourPrice,
      },
    });

    broadcastSyncEvent('products', req.header('x-client-id'));
    res.json({ ok: true, product: saved, syncVersion: getSyncVersion() });
  });

  // 5B. REAL URL PRODUCT SCRAPER ENDPOINT
  app.post('/api/products/scrape-url', async (req, res) => {
    try {
      const actor = resolveActor(req);
      if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager'
      ) {
        res.status(403).json({
          error: 'Only administrators or store managers can scrape external product links.',
        });
        return;
      }

      const { url, htmlOverride } = (req.body || {}) as {
        url?: string;
        htmlOverride?: string;
      };
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'Product URL is required.' });
        return;
      }

      const db = getDb();
      const categories = getAllCategoriesFromDb(db);
      const result = await scrapeProductFromUrl(url.trim(), categories, htmlOverride);
      res.json({
        ok: true,
        product: result.product,
        diagnostics: result.diagnostics,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to fetch or parse product page.';
      res.status(422).json({ error: message });
    }
  });

  // 5B-2. CACHE EXTERNAL IMAGE LOCALLY ON SERVER
  app.post('/api/media/cache', async (req, res) => {
    try {
      const actor = resolveActor(req);
      if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager'
      ) {
        res.status(403).json({ error: 'Only admins or managers can download external media.' });
        return;
      }
      const { url, referer } = (req.body || {}) as { url?: string; referer?: string };
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'Image URL is required.' });
        return;
      }
      const cached = await downloadAndCacheExternalImage(url.trim(), referer);
      res.json({ ok: true, localUrl: cached.localUrl, downloaded: cached.downloaded });
    } catch (err) {
      res.status(422).json({
        error: err instanceof Error ? err.message : 'Unable to download external image.',
      });
    }
  });

  // 5C. MONTHLY EXPENSES ENDPOINTS (PRESERVES ALL EXISTING DATA)
  app.get('/api/expenses', (_req, res) => {
    const db = getDb();
    res.json({
      expenses: getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []),
    });
  });

  app.post('/api/expenses', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to record expenses.' });
      return;
    }
    const incoming = req.body as Partial<MonthlyExpense>;
    if (!incoming?.title?.trim() || !Number.isFinite(Number(incoming.amount))) {
      res.status(400).json({ error: 'Expense title and valid amount are required.' });
      return;
    }
    const db = getDb();
    const list = getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
    const now = new Date().toISOString();
    const dateStr = incoming.date || now.split('T')[0];
    const expense: MonthlyExpense = {
      id: incoming.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: incoming.title.trim(),
      urduTitle: incoming.urduTitle?.trim() || undefined,
      category: incoming.category || 'other',
      amount: Math.max(0, Math.round(Number(incoming.amount))),
      month: incoming.month || dateStr.slice(0, 7),
      date: dateStr,
      paymentStatus: incoming.paymentStatus || 'paid',
      paymentMode: incoming.paymentMode || 'cash',
      isRecurringMonthly: Boolean(incoming.isRecurringMonthly),
      notes: incoming.notes?.trim() || undefined,
      recordedBy: incoming.recordedBy || actor.name || 'Admin',
      createdAt: incoming.createdAt || now,
      updatedAt: now,
    };
    const exists = list.some((e) => e.id === expense.id);
    const nextList = exists ? list.map((e) => (e.id === expense.id ? expense : e)) : [expense, ...list];
    saveCollectionValue(db, 'monthly_expenses', nextList);
    broadcastSyncEvent('monthly_expenses', req.header('x-client-id'));
    res.json({ ok: true, expense, expenses: nextList, syncVersion: getSyncVersion() });
  });

  app.delete('/api/expenses/:id', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete monthly expenses.' });
      return;
    }
    const db = getDb();
    const list = getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
    const nextList = list.filter((e) => e.id !== req.params.id);
    saveCollectionValue(db, 'monthly_expenses', nextList);
    broadcastSyncEvent('monthly_expenses', req.header('x-client-id'));
    res.json({ ok: true, expenses: nextList, syncVersion: getSyncVersion() });
  });

  // 6. MULTI-LEVEL CATEGORIES (3 LEVELS)
  app.get('/api/categories', (_req, res) => {
    res.json({ categories: getAllCategoriesFromDb() });
  });

  app.post('/api/categories', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Only admins/managers can create categories.' });
      return;
    }

    const body = req.body as Partial<CategoryRecord>;
    const cleanName = (body.name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }

    const db = getDb();
    const allCats = getAllCategoriesFromDb(db);
    const parentId = body.parentCategoryId?.trim() || undefined;

    if (parentId) {
      const parent = allCats.find((c) => c.id === parentId);
      if (!parent) {
        res.status(400).json({ error: 'Parent category not found.' });
        return;
      }
      if (parent.isUpcoming || parent.id === UPCOMING_CATEGORY_ID) {
        res.status(400).json({ error: 'Subcategories cannot be nested under Upcoming Viral Products.' });
        return;
      }
      const parentLevel = computeCategoryLevel(parent, allCats);
      if (parentLevel >= 3) {
        res.status(400).json({ error: 'Maximum 3 levels allowed (Main Category → Subcategory → Child Subcategory).' });
        return;
      }
    }

    const duplicate = allCats.find(
      (c) =>
        normalizeTextKey(c.name) === normalizeTextKey(cleanName) &&
        (c.parentCategoryId || '') === (parentId || '')
    );
    if (duplicate) {
      res.status(409).json({ error: `Category "${cleanName}" already exists under the same parent.` });
      return;
    }

    const newCat: CategoryRecord = {
      id: body.id || `${slugifyId('cat', cleanName)}_${Date.now().toString(36).slice(-4)}`,
      name: cleanName,
      urduName: body.urduName?.trim() || undefined,
      parentCategoryId: parentId,
      description: body.description?.trim() || undefined,
      isActive: body.isActive !== false,
      displayOrder: body.displayOrder ?? allCats.length + 1,
    };

    const saved = upsertCategoryRow(db, newCat);
    broadcastSyncEvent('categories', req.header('x-client-id'));
    res.json({ ok: true, category: saved, categories: getAllCategoriesFromDb(db), syncVersion: getSyncVersion() });
  });

  app.put('/api/categories/:id', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Only admins/managers can update categories.' });
      return;
    }

    const db = getDb();
    const id = req.params.id;
    const allCats = getAllCategoriesFromDb(db);
    const existing = allCats.find((c) => c.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const body = req.body as Partial<CategoryRecord>;
    if (existing.id === UPCOMING_CATEGORY_ID || existing.isUpcoming) {
      // Keep canonical Upcoming category active & intact
      const saved = upsertCategoryRow(db, {
        ...existing,
        urduName: body.urduName ?? existing.urduName,
        description: body.description ?? existing.description,
        isActive: true,
        isUpcoming: true,
        name: UPCOMING_CATEGORY_NAME,
        parentCategoryId: undefined,
      });
      broadcastSyncEvent('categories', req.header('x-client-id'));
      res.json({ ok: true, category: saved, categories: getAllCategoriesFromDb(db), syncVersion: getSyncVersion() });
      return;
    }

    const nextName = (body.name ?? existing.name).trim();
    if (!nextName) {
      res.status(400).json({ error: 'Category name cannot be empty.' });
      return;
    }

    const nextParentId =
      body.parentCategoryId !== undefined
        ? body.parentCategoryId?.trim() || undefined
        : existing.parentCategoryId;

    if (nextParentId) {
      if (nextParentId === id) {
        res.status(400).json({ error: 'A category cannot be its own parent.' });
        return;
      }
      const descendants = getCategoryDescendantIds(allCats, id);
      if (descendants.has(nextParentId)) {
        res.status(400).json({ error: 'Circular parent hierarchy detected. Choose a valid parent category.' });
        return;
      }
      const parent = allCats.find((c) => c.id === nextParentId);
      if (!parent || parent.isUpcoming || parent.id === UPCOMING_CATEGORY_ID) {
        res.status(400).json({ error: 'Invalid parent category selected.' });
        return;
      }
      const parentLevel = computeCategoryLevel(parent, allCats);
      if (parentLevel >= 3) {
        res.status(400).json({ error: 'Maximum hierarchy depth is 3 levels.' });
        return;
      }
    }

    const duplicate = allCats.find(
      (c) =>
        c.id !== id &&
        normalizeTextKey(c.name) === normalizeTextKey(nextName) &&
        (c.parentCategoryId || '') === (nextParentId || '')
    );
    if (duplicate) {
      res.status(409).json({ error: `Another category named "${nextName}" already exists under the selected parent.` });
      return;
    }

    const saved = upsertCategoryRow(db, {
      ...existing,
      ...body,
      id,
      name: nextName,
      parentCategoryId: nextParentId,
    });

    // Recompute child levels & product category breadcrumbs referencing this category
    const refreshedCats = getAllCategoriesFromDb(db);
    for (const child of refreshedCats) {
      if (child.parentCategoryId === id) {
        upsertCategoryRow(db, child);
      }
    }
    const finalCats = getAllCategoriesFromDb(db);
    const prods = getAllProductsFromDb(db);
    for (const p of prods) {
      if (p.parentCategoryId === id || p.subcategoryId === id || p.childSubcategoryId === id) {
        upsertProductRow(db, {
          ...p,
          category: getCategoryBreadcrumb(finalCats, p.parentCategoryId, p.subcategoryId, p.childSubcategoryId, p.category),
        });
      }
    }

    broadcastSyncEvent('categories', req.header('x-client-id'));
    res.json({ ok: true, category: saved, categories: finalCats, syncVersion: getSyncVersion() });
  });

  app.delete('/api/categories/:id', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can delete categories.' });
      return;
    }

    const db = getDb();
    const id = req.params.id;
    const allCats = getAllCategoriesFromDb(db);
    const target = allCats.find((c) => c.id === id);
    if (!target) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    if (target.id === UPCOMING_CATEGORY_ID || target.isUpcoming) {
      res.status(400).json({ error: 'The Upcoming Viral Products | Coming Soon category is protected and cannot be deleted.' });
      return;
    }

    const hasChildren = allCats.some((c) => c.parentCategoryId === id);
    if (hasChildren) {
      res.status(400).json({ error: 'Cannot delete category while it has subcategories. Reassign or remove subcategories first.' });
      return;
    }

    const products = getAllProductsFromDb(db);
    const inUse = products.some(
      (p) =>
        p.parentCategoryId === id ||
        p.subcategoryId === id ||
        p.childSubcategoryId === id ||
        normalizeTextKey(p.category) === normalizeTextKey(target.name)
    );
    if (inUse) {
      res.status(400).json({ error: 'Cannot delete category with assigned products. Reassign products or deactivate instead.' });
      return;
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    broadcastSyncEvent('categories', req.header('x-client-id'));
    res.json({ ok: true, categories: getAllCategoriesFromDb(db), syncVersion: getSyncVersion() });
  });

  // 7. CITIES & AREAS LOCATION MANAGEMENT
  const parseOptionalDeliveryCharge = (raw: unknown): number | null | 'invalid' | undefined => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return 'invalid';
    return Math.round(num);
  };

  app.get('/api/locations', (_req, res) => {
    res.json({ cities: getAllCitiesFromDb() });
  });

  app.post('/api/cities', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to manage cities.' });
      return;
    }
    const name = String(req.body?.name || '').trim();
    const allowed = isMuzaffarabadCity(name) ? true : req.body?.allowed !== false;
    const parsedCharge = parseOptionalDeliveryCharge(req.body?.deliveryCharge);
    if (parsedCharge === 'invalid') {
      res.status(400).json({ error: 'Delivery charge must be 0 or greater.' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'City name is required.' });
      return;
    }

    const db = getDb();
    const existing = getAllCitiesFromDb(db);
    if (existing.some((c) => normalizeTextKey(c.name) === normalizeTextKey(name))) {
      res.status(409).json({ error: `City "${name}" already exists.` });
      return;
    }

    const id = slugifyId('city', name) + '_' + Date.now().toString(36).slice(-4);
    const now = new Date().toISOString();
    const chargeToSave = parsedCharge !== undefined ? parsedCharge : isMuzaffarabadCity(name) ? 50 : null;
    const province = inferProvinceForCity(name, typeof req.body?.province === 'string' ? req.body.province : undefined);
    db.prepare(
      'INSERT INTO cities (id, name, province, allowed, delivery_charge, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, province, allowed ? 1 : 0, chargeToSave, existing.length + 1, now, now);
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  // Bulk toggle ON/OFF for all cities except Muzaffarabad
  app.put('/api/cities/toggle-other-cities', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to manage delivery cities.' });
      return;
    }
    const allowOtherCities = Boolean(req.body?.allowOtherCities);
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE cities SET allowed = ?, updated_at = ? WHERE LOWER(TRIM(name)) != 'muzaffarabad'"
    ).run(allowOtherCities ? 1 : 0, now);
    db.prepare(
      "UPDATE cities SET allowed = 1, updated_at = ? WHERE LOWER(TRIM(name)) = 'muzaffarabad'"
    ).run(now);
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  app.put('/api/cities/:id', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to manage cities.' });
      return;
    }
    const db = getDb();
    const id = req.params.id;
    const cities = getAllCitiesFromDb(db);
    const target = cities.find((c) => c.id === id || normalizeTextKey(c.name) === normalizeTextKey(id));
    if (!target || !target.id) {
      res.status(404).json({ error: 'City not found.' });
      return;
    }

    const nextName = typeof req.body?.name === 'string' ? req.body.name.trim() : target.name;
    if (isMuzaffarabadCity(target.name) && req.body?.allowed === false) {
      res.status(400).json({ error: 'Muzaffarabad is the default active delivery city and cannot be turned off.' });
      return;
    }
    const nextAllowed = isMuzaffarabadCity(nextName)
      ? true
      : req.body?.allowed !== undefined
      ? Boolean(req.body.allowed)
      : target.allowed;
    const parsedCharge = parseOptionalDeliveryCharge(req.body?.deliveryCharge);
    if (parsedCharge === 'invalid') {
      res.status(400).json({ error: 'Delivery charge must be 0 or greater.' });
      return;
    }
    const nextCharge =
      parsedCharge !== undefined
        ? parsedCharge
        : target.deliveryCharge !== undefined
        ? target.deliveryCharge
        : null;

    if (!nextName) {
      res.status(400).json({ error: 'City name cannot be empty.' });
      return;
    }
    if (cities.some((c) => c.id !== target.id && normalizeTextKey(c.name) === normalizeTextKey(nextName))) {
      res.status(409).json({ error: `City "${nextName}" already exists.` });
      return;
    }

    const nextProvince = inferProvinceForCity(
      nextName,
      typeof req.body?.province === 'string' ? req.body.province : target.province
    );
    const now = new Date().toISOString();
    db.prepare('UPDATE cities SET name = ?, province = ?, allowed = ?, delivery_charge = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextProvince,
      nextAllowed ? 1 : 0,
      nextCharge,
      now,
      target.id
    );
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  app.delete('/api/cities/:id', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to remove cities.' });
      return;
    }
    const db = getDb();
    const id = req.params.id;
    const cities = getAllCitiesFromDb(db);
    const target = cities.find((c) => c.id === id || normalizeTextKey(c.name) === normalizeTextKey(id));
    if (!target || !target.id) {
      res.status(404).json({ error: 'City not found.' });
      return;
    }
    if (isMuzaffarabadCity(target.name)) {
      res.status(400).json({ error: 'Muzaffarabad is the default active delivery city and cannot be removed.' });
      return;
    }
    db.prepare('DELETE FROM city_areas WHERE city_id = ?').run(target.id);
    db.prepare('DELETE FROM cities WHERE id = ?').run(target.id);
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  app.post('/api/cities/:cityId/areas', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to manage areas.' });
      return;
    }
    const db = getDb();
    const cities = getAllCitiesFromDb(db);
    const city = cities.find((c) => c.id === req.params.cityId || normalizeTextKey(c.name) === normalizeTextKey(req.params.cityId));
    if (!city || !city.id) {
      res.status(404).json({ error: 'Parent city not found.' });
      return;
    }
    const areaName = String(req.body?.name || '').trim();
    if (!areaName) {
      res.status(400).json({ error: 'Area name is required.' });
      return;
    }
    if ((city.areas || []).some((a) => normalizeTextKey(a.name) === normalizeTextKey(areaName))) {
      res.status(409).json({ error: `Area "${areaName}" already exists under ${city.name}.` });
      return;
    }
    const parsedCharge = parseOptionalDeliveryCharge(req.body?.deliveryCharge);
    if (parsedCharge === 'invalid') {
      res.status(400).json({ error: 'Delivery charge must be 0 or greater.' });
      return;
    }

    const areaType = typeof req.body?.areaType === 'string' && req.body.areaType.trim() ? req.body.areaType.trim() : null;
    const areaId = slugifyId('area', `${city.name}_${areaName}`) + '_' + Date.now().toString(36).slice(-4);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO city_areas (id, city_id, name, allowed, delivery_charge, area_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      areaId,
      city.id,
      areaName,
      req.body?.allowed !== false ? 1 : 0,
      parsedCharge !== undefined ? parsedCharge : null,
      areaType,
      now,
      now
    );
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  app.put('/api/areas/:areaId', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to manage areas.' });
      return;
    }
    const db = getDb();
    const areaRow = db.prepare('SELECT * FROM city_areas WHERE id = ?').get(req.params.areaId) as Record<string, unknown> | undefined;
    if (!areaRow) {
      res.status(404).json({ error: 'Area not found.' });
      return;
    }
    const nextName = typeof req.body?.name === 'string' ? req.body.name.trim() : String(areaRow.name);
    const nextAllowed = req.body?.allowed !== undefined ? Boolean(req.body.allowed) : Boolean(areaRow.allowed);
    const parsedCharge = parseOptionalDeliveryCharge(req.body?.deliveryCharge);
    if (parsedCharge === 'invalid') {
      res.status(400).json({ error: 'Delivery charge must be 0 or greater.' });
      return;
    }
    const nextCharge =
      parsedCharge !== undefined
        ? parsedCharge
        : areaRow.delivery_charge !== null && areaRow.delivery_charge !== undefined
        ? Number(areaRow.delivery_charge)
        : null;

    if (!nextName) {
      res.status(400).json({ error: 'Area name cannot be empty.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM city_areas WHERE city_id = ? AND id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))')
      .get(String(areaRow.city_id), String(areaRow.id), nextName);
    if (dup) {
      res.status(409).json({ error: `Area "${nextName}" already exists in this city.` });
      return;
    }

    db.prepare('UPDATE city_areas SET name = ?, allowed = ?, delivery_charge = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextAllowed ? 1 : 0,
      nextCharge,
      new Date().toISOString(),
      String(areaRow.id)
    );
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  app.delete('/api/areas/:areaId', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can remove areas.' });
      return;
    }
    const db = getDb();
    db.prepare('DELETE FROM city_areas WHERE id = ?').run(req.params.areaId);
    const profile = syncDeliveryCitiesIntoBusinessProfile(db);
    broadcastSyncEvent('locations', req.header('x-client-id'));
    res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
  });

  // 8. CUSTOMERS CRUD
  app.get('/api/customers', (_req, res) => {
    res.json({ customers: getAllCustomersFromDb() });
  });

  app.post('/api/customers', (req, res) => {
    const db = getDb();
    const customer = req.body as Customer;
    if (!customer?.id || !customer?.name) {
      res.status(400).json({ error: 'Customer ID and name are required.' });
      return;
    }
    const saved = upsertCustomerRow(db, customer);
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
  });

  app.put('/api/customers/:id', (req, res) => {
    const db = getDb();
    const existing = getAllCustomersFromDb(db).find((c) => c.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const saved = upsertCustomerRow(db, { ...existing, ...(req.body as Partial<Customer>), id: existing.id });
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
  });

  // 9. AUTHORITATIVE ORDER CHECKOUT WITH UPCOMING & EXPRESS-ONLY DELIVERY VALIDATION
  app.post('/api/orders/checkout', (req, res) => {
    const db = getDb();
    const {
      items,
      customer,
      transaction,
      codOrder,
      resellerId,
    } = (req.body || {}) as {
      items?: Array<{ productId: string; quantity: number }>;
      customer?: Customer;
      transaction?: Transaction;
      codOrder?: CODOrder;
      resellerId?: string;
    };

    const allProducts = getAllProductsFromDb(db);
    const requestedItems = (
      items ||
      (transaction?.items || []).map((i) => ({ productId: i.productId || '', quantity: i.quantity }))
    ).filter((it) => it && Number(it.quantity) > 0);

    if (requestedItems.length === 0) {
      res.status(400).json({ error: 'Cart cannot be empty. Please add at least one product before placing an order.' });
      return;
    }

    let hasExpressItem = false;
    for (const item of requestedItems) {
      const prod = allProducts.find((p) => p.id === item.productId);
      if (prod) {
        if (isProductPurchaseBlocked(prod)) {
          res.status(400).json({
            error: `"${prod.name}" is in "${UPCOMING_CATEGORY_NAME}" (Coming Soon) and cannot be purchased or ordered until an authorized Admin/Stock Manager confirms physical arrival.`,
          });
          return;
        }
        if (getProductDeliveryMeta(prod).isExpress) {
          hasExpressItem = true;
        }
      }
    }

    // Standard (3–6 working days) items are open nationwide across all provinces & Azad Kashmir.
    // Enforce city/sub-city unlock restriction ONLY when the order contains Express items.
    if (codOrder?.city && hasExpressItem) {
      const cities = getAllCitiesFromDb(db);
      const expressAvail = resolveExpressAreaAvailability(
        cities,
        codOrder.city,
        codOrder.area,
        true
      );
      if (!expressAvail.allowed) {
        res.status(400).json({
          error:
            expressAvail.reason ||
            `Express delivery to "${codOrder.city}${codOrder.area ? ` (${codOrder.area})` : ''}" is currently locked. Please choose an unlocked Express city & sub-city or order Standard items.`,
        });
        return;
      }
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      let savedCustomer: Customer | undefined;
      if (customer) {
        savedCustomer = upsertCustomerRow(db, {
          ...customer,
          balance: Number.isFinite(Number(customer.balance)) ? Number(customer.balance) : 0,
          totalPurchases: Number.isFinite(Number(customer.totalPurchases)) ? Number(customer.totalPurchases) : 0,
        });
      }
      if (transaction) {
        const cleanTx: Transaction = {
          ...transaction,
          customerId: transaction.customerId || savedCustomer?.id || '',
          amount: Math.max(0, Number(transaction.amount || 0)),
          paidAmount: Math.max(0, Number(transaction.paidAmount || 0)),
          dueBalance: Math.max(0, Number(transaction.dueBalance ?? 0)),
          auditTrail: Array.isArray(transaction.auditTrail) ? transaction.auditTrail : [],
        };
        const currentTxs = getCollectionValue<Transaction[]>(db, 'transactions', []);
        saveCollectionValue(db, 'transactions', [cleanTx, ...currentTxs.filter((t) => t.id !== cleanTx.id)]);
      }
      if (codOrder) {
        const safeItems = Array.isArray(codOrder.items) ? codOrder.items : [];
        const cleanOrder: CODOrder = {
          ...codOrder,
          customerId: codOrder.customerId || savedCustomer?.id || transaction?.customerId,
          items: safeItems,
          subtotal: Math.max(0, Number(codOrder.subtotal || 0)),
          deliveryFee: Math.max(0, Number(codOrder.deliveryFee || 0)),
          totalAmount: Math.max(0, Number(codOrder.totalAmount || 0)),
          createdAt: codOrder.createdAt || new Date().toISOString(),
        };
        const currentOrders = getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
        saveCollectionValue(db, 'cod_orders', [cleanOrder, ...currentOrders.filter((o) => o.id !== cleanOrder.id)]);
      }
      for (const item of requestedItems) {
        const prod = allProducts.find((p) => p.id === item.productId);
        if (prod && !isProductPurchaseBlocked(prod)) {
          const qty = Math.max(0, Number(item.quantity || 0));
          upsertProductRow(db, {
            ...prod,
            stockQty: Math.max(0, prod.stockQty - qty),
            salesCount: (prod.salesCount || 0) + qty,
            totalRevenue: (prod.totalRevenue || 0) + qty * prod.ourPrice,
            totalProfit: (prod.totalProfit || 0) + qty * Math.max(0, prod.ourPrice - prod.costPrice),
          });
        }
      }
      if (resellerId && transaction) {
        const resellers = getCollectionValue<Reseller[]>(db, 'resellers', []);
        const comm = Math.floor((transaction.paidAmount || 0) / 1000) * 30;
        const updatedResellers = resellers.map((r) =>
          r.id === resellerId
            ? {
                ...r,
                totalReferredOrders: r.totalReferredOrders + 1,
                totalSales: r.totalSales + transaction.amount,
                totalPaidSales: r.totalPaidSales + (transaction.paidAmount || 0),
                earnedCommission: r.earnedCommission + comm,
              }
            : r
        );
        saveCollectionValue(db, 'resellers', updatedResellers);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Checkout persistence failed.' });
      return;
    }

    broadcastSyncEvent('orders', req.header('x-client-id'));
    res.json({ ok: true, syncVersion: getSyncVersion() });
  });

  // 9B. COD ORDER STATUS TRANSITION (DISPATCH / DELIVER / RETURN) WITH ATOMIC LEDGER & STOCK SYNC
  app.post('/api/orders/:orderId/status', (req, res) => {
    const actor = resolveActor(req);
    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'admin' &&
      actor.role !== 'manager' &&
      actor.role !== 'staff'
    ) {
      res.status(403).json({ error: 'Only store staff or administrators can update COD order statuses.' });
      return;
    }

    const orderId = req.params.orderId;
    const { status, courierPartner, trackingNumber } = (req.body || {}) as {
      status?: CODOrder['status'];
      courierPartner?: CODOrder['courierPartner'];
      trackingNumber?: string;
    };
    if (!status || !['pending', 'dispatched', 'delivered', 'returned'].includes(status)) {
      res.status(400).json({ error: 'Valid order status is required (pending, dispatched, delivered, returned).' });
      return;
    }

    const db = getDb();
    const orders = getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
    const existingOrder = orders.find((o) => o.id === orderId);
    if (!existingOrder) {
      res.status(404).json({ error: 'COD order not found.' });
      return;
    }

    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];
    const normalizeDigits = (v?: string) => (v || '').replace(/\D/g, '');
    let updatedOrder: CODOrder = existingOrder;

    db.exec('BEGIN IMMEDIATE;');
    try {
      const wasDelivered = existingOrder.status === 'delivered';
      const wasReturned = existingOrder.status === 'returned';

      updatedOrder = {
        ...existingOrder,
        status,
        courierPartner: courierPartner || existingOrder.courierPartner,
        trackingNumber: trackingNumber !== undefined ? trackingNumber : existingOrder.trackingNumber,
        dispatchedAt: status === 'dispatched' ? existingOrder.dispatchedAt || now : existingOrder.dispatchedAt,
        deliveredAt: status === 'delivered' ? existingOrder.deliveredAt || now : existingOrder.deliveredAt,
        returnedAt: status === 'returned' ? existingOrder.returnedAt || now : existingOrder.returnedAt,
      };

      const nextOrders = orders.map((o) => (o.id === orderId ? updatedOrder : o));
      saveCollectionValue(db, 'cod_orders', nextOrders);

      if (status === 'returned' && !wasReturned) {
        const allProds = getAllProductsFromDb(db);
        for (const item of existingOrder.items || []) {
          const prod = allProds.find((p) => p.id === item.productId);
          if (prod) {
            upsertProductRow(db, {
              ...prod,
              stockQty: prod.stockQty + Math.max(0, Number(item.quantity || 0)),
            });
          }
        }
      }

      if (status === 'delivered' && !wasDelivered) {
        const allCustomers = getAllCustomersFromDb(db);
        const ordDigits = normalizeDigits(existingOrder.phone);
        let cust =
          (existingOrder.customerId && allCustomers.find((c) => c.id === existingOrder.customerId)) ||
          (ordDigits ? allCustomers.find((c) => normalizeDigits(c.phone) === ordDigits) : undefined);

        if (!cust) {
          const digits = ordDigits || '03000000000';
          cust = {
            id: `cust_ord_${existingOrder.id.replace(/[^a-zA-Z0-9]/g, '')}`,
            name: existingOrder.customerName || 'COD Customer',
            phone: existingOrder.phone || digits,
            city: existingOrder.city || 'Muzaffarabad',
            area: existingOrder.area,
            mohalla: existingOrder.mohalla,
            landmark: existingOrder.landmark,
            address: existingOrder.address || existingOrder.city || 'Pakistan',
            customerType: 'individual',
            balance: 0,
            totalPurchases: 0,
            creditLimit: 5000,
            paymentTermsDays: 7,
            status: 'active',
            pin: digits.length >= 6 ? digits.slice(-6) : '123456',
            createdAt: (existingOrder.createdAt || now).split('T')[0],
          };
          upsertCustomerRow(db, cust);
        }

        if (!updatedOrder.customerId) {
          updatedOrder = { ...updatedOrder, customerId: cust.id };
          saveCollectionValue(
            db,
            'cod_orders',
            nextOrders.map((o) => (o.id === orderId ? updatedOrder : o))
          );
        }

        const currentTxs = getCollectionValue<Transaction[]>(db, 'transactions', []);
        const orderNum = existingOrder.orderNumber;
        const hasCreditTx = currentTxs.some(
          (t) =>
            t.type === 'credit' &&
            ((t.invoiceNumber && t.invoiceNumber === orderNum) || (t.notes && t.notes.includes(orderNum)))
        );

        let workingTxs = [...currentTxs];
        if (!hasCreditTx) {
          const linkedCreditTx: Transaction = {
            id: `tx_link_${existingOrder.id}`,
            customerId: cust.id,
            type: 'credit',
            amount: existingOrder.totalAmount,
            paidAmount: 0,
            dueBalance: existingOrder.totalAmount,
            saleType: 'cod',
            date: (existingOrder.createdAt || now).split('T')[0],
            dueDate: todayStr,
            paymentTermsDays: 0,
            invoiceNumber: orderNum,
            notes: `COD Order #${orderNum} (${existingOrder.city})`,
            paymentMode: 'cod',
            items: existingOrder.items || [],
            totalSavings: (existingOrder.items || []).reduce((acc, it) => acc + Number(it.customerSavings || 0), 0),
            status: 'pending',
            responsibleStaff: actor.name || 'Order Desk',
            auditTrail: [
              {
                id: `aud_link_${Date.now()}`,
                timestamp: now,
                action: 'created',
                newStatus: 'pending',
                newAmount: existingOrder.totalAmount,
                changedBy: actor.name || 'Order Desk',
                notes: `Auto-linked COD order #${orderNum} before delivery settlement`,
              },
            ],
            createdAt: existingOrder.createdAt || now,
          };
          workingTxs = [linkedCreditTx, ...workingTxs];
        }

        const netCash = existingOrder.totalAmount - existingOrder.deliveryFee;
        const debitTx: Transaction = {
          id: `tx_cod_deliv_${existingOrder.id}_${Date.now()}`,
          customerId: cust.id,
          type: 'debit',
          amount: existingOrder.totalAmount,
          paidAmount: existingOrder.totalAmount,
          dueBalance: 0,
          date: todayStr,
          paymentMode: 'cod',
          invoiceNumber: orderNum,
          notes: `COD Settlement #${orderNum} (${updatedOrder.courierPartner}) - Net Cash Rs. ${netCash.toLocaleString('en-PK')}`,
          status: 'completed',
          responsibleStaff: actor.name || 'Order Desk',
          auditTrail: [
            {
              id: `aud_deliv_${Date.now()}`,
              timestamp: now,
              action: 'status_updated',
              previousStatus: 'pending',
              newStatus: 'completed',
              changedBy: actor.name || 'Order Desk',
              notes: `COD parcel delivered via ${updatedOrder.courierPartner}`,
            },
          ],
          createdAt: now,
        };
        workingTxs = [debitTx, ...workingTxs.map((t) =>
          t.type === 'credit' &&
          ((t.invoiceNumber && t.invoiceNumber === orderNum) || (t.notes && t.notes.includes(orderNum)))
            ? {
                ...t,
                paidAmount: t.amount,
                dueBalance: 0,
                status: 'completed' as const,
              }
            : t
        )];
        saveCollectionValue(db, 'transactions', workingTxs);

        if (existingOrder.resellerCode) {
          const earned = Math.floor(existingOrder.subtotal / 1000) * 30;
          const resellers = getCollectionValue<Reseller[]>(db, 'resellers', []);
          const nextResellers = resellers.map((r) =>
            r.referralCode === existingOrder.resellerCode
              ? {
                  ...r,
                  totalReferredOrders: r.totalReferredOrders + 1,
                  totalSales: r.totalSales + existingOrder.subtotal,
                  totalPaidSales: r.totalPaidSales + existingOrder.subtotal,
                  earnedCommission: r.earnedCommission + earned,
                }
              : r
          );
          saveCollectionValue(db, 'resellers', nextResellers);
        }
      }

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update order status.' });
      return;
    }

    broadcastSyncEvent('orders', req.header('x-client-id'));
    res.json({ ok: true, order: updatedOrder, syncVersion: getSyncVersion() });
  });

  // 9C. BACKEND ORDER HISTORY AUDIT & REPAIR ENDPOINT (ADMIN / MANAGER)
  app.post('/api/orders/audit-repair', (req, res) => {
    const actor = resolveActor(req);
    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'admin' &&
      actor.role !== 'manager'
    ) {
      res.status(403).json({ error: 'Only administrators or store managers can audit and repair backend order history.' });
      return;
    }
    try {
      const db = getDb();
      const result = auditAndRepairOrderHistory(db);
      insertAdminAuditLog(db, {
        action: 'audit_repair_order_history',
        entityType: 'orders',
        entityId: 'backend_order_history',
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        details: {
          repairedOrders: result.repairedOrders,
          linkedCustomersCreated: result.linkedCustomersCreated,
          repairedTransactions: result.repairedTransactions,
          migratedUrlsCount: result.migratedUrlsCount,
        },
      });
      broadcastSyncEvent('all', req.header('x-client-id'));
      res.json({ ok: true, ...result, syncVersion: getSyncVersion() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Backend order audit & repair failed.',
      });
    }
  });

  // 10. CENTRAL COLLECTION SYNC ROUTE (KEEPS ALL EXISTING MODULES MULTI-DEVICE SYNCHRONIZED)
  app.put('/api/collections/:collectionKey', (req, res) => {
    const key = req.params.collectionKey;
    const data = req.body?.data;
    if (data === undefined) {
      res.status(400).json({ error: 'Request body must contain { data }.' });
      return;
    }

    const db = getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (key === 'products' && Array.isArray(data)) {
        const incomingList = data as ProductItem[];
        const incomingIds = new Set(incomingList.map((p) => p.id));
        const existing = getAllProductsFromDb(db);
        for (const ex of existing) {
          if (!incomingIds.has(ex.id)) {
            db.prepare('DELETE FROM products WHERE id = ?').run(ex.id);
          }
        }
        for (const item of incomingList) {
          if (item?.id) {
            upsertProductRow(db, item);
          }
        }
      } else if (key === 'categories' && Array.isArray(data)) {
        const incoming = (data as CategoryRecord[]).map(normalizeUpcomingCategoryRecord);
        const hasUpcoming = incoming.some((c) => c.id === UPCOMING_CATEGORY_ID || c.isUpcoming);
        if (!hasUpcoming) {
          const existingUp = getAllCategoriesFromDb(db).find((c) => c.id === UPCOMING_CATEGORY_ID || c.isUpcoming);
          if (existingUp) incoming.push(existingUp);
        }
        const incomingIds = new Set(incoming.map((c) => c.id));
        const existing = getAllCategoriesFromDb(db);
        for (const ex of existing) {
          if (!incomingIds.has(ex.id) && ex.id !== UPCOMING_CATEGORY_ID && !ex.isUpcoming) {
            db.prepare('DELETE FROM categories WHERE id = ?').run(ex.id);
          }
        }
        for (const cat of incoming) {
          upsertCategoryRow(db, cat);
        }
      } else if (key === 'customers' && Array.isArray(data)) {
        const incoming = data as Customer[];
        const incomingIds = new Set(incoming.map((c) => c.id));
        const existing = getAllCustomersFromDb(db);
        for (const ex of existing) {
          if (!incomingIds.has(ex.id)) {
            db.prepare('DELETE FROM customers WHERE id = ?').run(ex.id);
          }
        }
        for (const c of incoming) {
          if (c?.id) upsertCustomerRow(db, c);
        }
      } else if (key === 'cities' && Array.isArray(data)) {
        replaceCitiesAndAreasFromList(db, data as DeliveryCityConfig[]);
        syncDeliveryCitiesIntoBusinessProfile(db);
      } else if (key === 'business_profile' && typeof data === 'object' && data !== null) {
        const incomingBp = data as BusinessProfile;
        const currentBp = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
        // Never accidentally erase adminPin or apiKey if client sent redacted copy
        const mergedBp: BusinessProfile = {
          ...incomingBp,
          adminPin: incomingBp.adminPin || currentBp.adminPin,
          shippingPartner: {
            ...incomingBp.shippingPartner,
            apiKey: incomingBp.shippingPartner?.apiKey || currentBp.shippingPartner?.apiKey || '',
          },
        };
        if (Array.isArray(mergedBp.deliveryCities)) {
          replaceCitiesAndAreasFromList(db, mergedBp.deliveryCities);
        }
        saveCollectionValue(db, 'business_profile', {
          ...mergedBp,
          deliveryCities: getAllCitiesFromDb(db),
        });
      } else if (key === 'user_accounts' && Array.isArray(data)) {
        const existingAccounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
        const byId = new Map(existingAccounts.map((u) => [u.id, u]));
        // Preserve server-stored passwordHash/salt if a non-admin client saved redacted objects
        const mergedAccounts = (data as UserAccount[]).map((u) => {
          const prev = byId.get(u.id);
          if (!prev) return u;
          return {
            ...u,
            passwordHash: u.passwordHash || prev.passwordHash,
            passwordSalt: u.passwordSalt || prev.passwordSalt,
          };
        });
        saveCollectionValue(db, 'user_accounts', mergedAccounts);
      } else {
        saveCollectionValue(db, key, data);
      }

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to persist collection.' });
      return;
    }

    broadcastSyncEvent(key, req.header('x-client-id'));
    res.json({ ok: true, syncVersion: getSyncVersion() });
  });

  // Ensure unmatched /api/* routes return JSON 404 (never fall through to Vite/SPA index.html)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // /api JSON error handler BEFORE Vite/static middleware so malformed JSON or payload errors always return JSON
  app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const errObj = err as { status?: number; statusCode?: number; type?: string; message?: string };
    const status =
      errObj?.statusCode ||
      errObj?.status ||
      (errObj?.type === 'entity.too.large' ? 413 : 500);
    res.status(status).json({
      error:
        status === 413
          ? 'Submitted payload is too large. Please paste only the product HTML body.'
          : status === 400
          ? 'Malformed JSON request body.'
          : errObj?.message || 'Unexpected server error.',
    });
  });

  const httpServer = http.createServer(app);
  let viteInstance: Awaited<ReturnType<typeof createViteServer>> | null = null;

  // Frontend middleware / static dist serving
  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    }).then((vite) => {
      viteInstance = vite;
      return vite;
    });
    app.use((req, res, next) => {
      vitePromise
        .then((vite) => vite.middlewares(req, res, next))
        .catch(next);
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`100DAGAR Full-Stack Server running on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // ignore close errors
      }
    }
    sseClients.clear();
    void viteInstance?.close().catch(() => {});
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start 100DAGAR server:', err);
  process.exit(1);
});
