import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import {
  BusinessProfile,
  CategoryRecord,
  CODOrder,
  CRMActivityEvent,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMFollowUpTask,
  CRMLead,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMPermissions,
  CRMRoleSpecialization,
  CRMSupportTicket,
  Customer,
  DeliveryCityConfig,
  MonthlyExpense,
  ProductItem,
  Reseller,
  ReviewRewardSubmission,
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
  type ActorContext,
  adjustCustomerLoyaltyPoints,
  auditAndRepairOrderHistory,
  createVerifiedBackup,
  DEFAULT_CRM_LOYALTY_CONFIG,
  deleteCrmCustomSegment,
  deleteCrmFollowUp,
  getAllCategoriesFromDb,
  getAllCitiesFromDb,
  getAllCrmActivityEvents,
  getAllCrmAutomationLogs,
  getAllCrmAutomationRules,
  getAllCrmCampaigns,
  getAllCrmCoupons,
  getAllCrmCustomSegments,
  getAllCrmFollowUps,
  getAllCrmLeads,
  getAllCrmLoyaltyAccounts,
  getAllCrmLoyaltyLedger,
  getAllCrmTickets,
  getAllCustomersFromDb,
  getAllProductsFromDb,
  getCollectionValue,
  getCrmLoyaltyConfig,
  getDatabaseHealthSummary,
  getDb,
  getFullSyncState,
  getSyncVersion,
  hasCrmAutomationIdempotencyKey,
  hashServerSecret,
  insertAdminAuditLog,
  insertCrmActivityEvent,
  insertCrmAutomationLog,
  listBackups,
  mergeLocalSnapshotNonDestructively,
  replaceCitiesAndAreasFromList,
  saveCollectionValue,
  saveCrmLoyaltyConfig,
  syncDeliveryCitiesIntoBusinessProfile,
  touchSyncVersion,
  upsertCategoryRow,
  upsertCrmAutomationRule,
  upsertCrmCampaign,
  upsertCrmCoupon,
  upsertCrmCustomSegment,
  upsertCrmFollowUp,
  upsertCrmLead,
  upsertCrmTicket,
  upsertCustomerRow,
  upsertProductRow,
  verifyServerSecret,
} from './src/server/db';
import {
  ALL_AUTO_SEGMENTS,
  buildCsvContent,
  buildCustomer360Profile,
  buildExcelHtmlContent,
  computeCrmDashboardKPIs,
  computeProductCustomerIntelligence,
  CRM_REPORT_CATALOG,
  CRM_WHATSAPP_TEMPLATES,
  type CRMReportKey,
  generateCrmReportDataset,
  normalizeDigits as normalizePhoneDigits,
  renderCrmWhatsAppTemplate,
} from './src/utils/crmEngine';
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

interface ResolvedActor extends ActorContext {
  account?: UserAccount;
  crmRole?: CRMRoleSpecialization;
  crmPermissions?: CRMPermissions;
}

function getDefaultCrmPermissionsForRole(role?: string, crmRole?: CRMRoleSpecialization): CRMPermissions {
  if (role === 'super_admin' || role === 'admin' || crmRole === 'administrator') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: true,
      canManageSegments: true,
      canManageFollowUps: true,
      canManageLeads: true,
      canSendWhatsAppCrm: true,
      canManageCampaigns: true,
      canApproveBulkMessages: true,
      canManageLoyalty: true,
      canManageTickets: true,
      canManageAutomation: true,
      canExportReports: true,
      canViewFinancialBalances: true,
    };
  }
  if (crmRole === 'store_manager' || role === 'manager') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: true,
      canManageSegments: true,
      canManageFollowUps: true,
      canManageLeads: true,
      canSendWhatsAppCrm: true,
      canManageCampaigns: true,
      canApproveBulkMessages: true,
      canManageLoyalty: true,
      canManageTickets: true,
      canManageAutomation: true,
      canExportReports: true,
      canViewFinancialBalances: true,
    };
  }
  if (crmRole === 'customer_support') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: true,
      canManageSegments: false,
      canManageFollowUps: true,
      canManageLeads: false,
      canSendWhatsAppCrm: true,
      canManageCampaigns: false,
      canApproveBulkMessages: false,
      canManageLoyalty: false,
      canManageTickets: true,
      canManageAutomation: false,
      canExportReports: false,
      canViewFinancialBalances: false,
    };
  }
  if (crmRole === 'marketing') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: false,
      canManageSegments: true,
      canManageFollowUps: false,
      canManageLeads: true,
      canSendWhatsAppCrm: true,
      canManageCampaigns: true,
      canApproveBulkMessages: false,
      canManageLoyalty: true,
      canManageTickets: false,
      canManageAutomation: false,
      canExportReports: true,
      canViewFinancialBalances: false,
    };
  }
  if (crmRole === 'accountant') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: false,
      canManageSegments: false,
      canManageFollowUps: false,
      canManageLeads: false,
      canSendWhatsAppCrm: false,
      canManageCampaigns: false,
      canApproveBulkMessages: false,
      canManageLoyalty: true,
      canManageTickets: false,
      canManageAutomation: false,
      canExportReports: true,
      canViewFinancialBalances: true,
    };
  }
  if (role === 'staff' || crmRole === 'salesperson') {
    return {
      canViewCrmDashboard: true,
      canViewCustomer360: true,
      canEditCustomers: true,
      canManageSegments: false,
      canManageFollowUps: true,
      canManageLeads: true,
      canSendWhatsAppCrm: true,
      canManageCampaigns: false,
      canApproveBulkMessages: false,
      canManageLoyalty: false,
      canManageTickets: true,
      canManageAutomation: false,
      canExportReports: false,
      canViewFinancialBalances: false,
    };
  }
  return {
    canViewCrmDashboard: false,
    canViewCustomer360: false,
    canEditCustomers: false,
    canManageSegments: false,
    canManageFollowUps: false,
    canManageLeads: false,
    canSendWhatsAppCrm: false,
    canManageCampaigns: false,
    canApproveBulkMessages: false,
    canManageLoyalty: false,
    canManageTickets: false,
    canManageAutomation: false,
    canExportReports: false,
    canViewFinancialBalances: false,
  };
}

function normalizePhoneOrId(val: string): string {
  const clean = (val || '').trim().replace(/[\s-]/g, '');
  if (clean.startsWith('+92') && clean.length >= 12) return `0${clean.slice(3)}`;
  if (clean.startsWith('92') && clean.length >= 11 && !clean.startsWith('920')) return `0${clean.slice(2)}`;
  return clean;
}

function resolveActor(req: Request): ResolvedActor {
  const db = getDb();
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const token = bearer || req.header('x-session-token');
  const claims = verifySessionToken(token);
  if (!claims) {
    return { role: undefined };
  }

  const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
  const account = accounts.find((u) => u.id === claims.userId);
  if (account) {
    if (account.status !== 'active') {
      return { role: undefined };
    }
    const role = account.role || claims.role;
    const basePerms = getDefaultCrmPermissionsForRole(role, account.crmRole);
    return {
      id: account.id,
      role,
      name: account.fullName || claims.name,
      customerId: account.linkedCustomerId,
      investorId: account.linkedInvestorId,
      resellerCode: account.linkedResellerCode,
      branchId: account.linkedBranchId,
      phone: account.phone,
      account,
      crmRole: account.crmRole,
      crmPermissions: account.crmPermissions ? { ...basePerms, ...account.crmPermissions } : basePerms,
    };
  }

  // Signed token issued to a direct Customer or Reseller row not yet mirrored in user_accounts
  if (claims.role === 'customer') {
    const cust = getAllCustomersFromDb(db).find((c) => c.id === claims.userId);
    if (!cust || cust.status === 'archived') return { role: undefined };
    return {
      id: cust.id,
      role: 'customer',
      name: cust.name,
      customerId: cust.id,
      phone: cust.phone,
    };
  }

  if (claims.role === 'reseller') {
    const resellers = getCollectionValue<Reseller[]>(db, 'resellers', []);
    const resAcc = resellers.find((r) => r.id === claims.userId);
    if (!resAcc || resAcc.status !== 'active') return { role: undefined };
    return {
      id: resAcc.id,
      role: 'reseller',
      name: resAcc.name,
      resellerCode: resAcc.referralCode,
      phone: resAcc.phone,
    };
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
  app.set('trust proxy', 1);
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
    const state = getFullSyncState(actor);
    res.json(state);
  });

  app.post('/api/sync/migrate-local', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can execute local database migrations.' });
      return;
    }
    const collections = (req.body?.collections || {}) as Record<string, unknown>;
    const { mergedCounts } = mergeLocalSnapshotNonDestructively(collections);
    if (Object.keys(mergedCounts).length > 0) {
      broadcastSyncEvent('all', req.header('x-client-id'));
    }
    res.json({ ok: true, mergedCounts, syncVersion: getSyncVersion() });
  });

  // 4. AUTHENTICATION & ACCOUNT SECURITY ENDPOINTS
  const recordLoginAudit = (db: ReturnType<typeof getDb>, entry: {
    userId: string;
    userName: string;
    role: string;
    identifier: string;
    status: 'success' | 'failed' | 'locked';
    note?: string;
  }) => {
    try {
      const list = getCollectionValue<Array<Record<string, unknown>>>(db, 'login_audits', []);
      const next = [
        {
          id: `aud_lgn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...entry,
          timestamp: new Date().toISOString(),
        },
        ...list,
      ].slice(0, 300);
      saveCollectionValue(db, 'login_audits', next);
    } catch {
      // ignore audit logging failure
    }
  };

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
    const superAdminAcc = accounts.find((u) => u.id === 'usr_superadmin' || u.role === 'super_admin');
    const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();

    const isSuperId =
      cleanId === '03125256266' || cleanIdLower === 'admin' || cleanIdLower === 'admin@madinamarket.pk';
    if (isSuperId) {
      const matchesEnvMaster = Boolean(envMasterPin) && cleanPin === envMasterPin;
      const matchesStoredSuper = superAdminAcc
        ? verifyServerSecret(cleanPin, superAdminAcc.passwordHash, superAdminAcc.passwordSalt)
        : false;
      if (matchesEnvMaster || matchesStoredSuper) {
        // Auto-upgrade legacy hash on successful verification
        if (superAdminAcc && (!superAdminAcc.passwordHash?.startsWith('scrypt:') || matchesEnvMaster)) {
          const hashed = hashServerSecret(cleanPin);
          const nextAccounts = accounts.map((u) =>
            u.id === superAdminAcc.id
              ? {
                  ...u,
                  passwordHash: hashed.hash,
                  passwordSalt: hashed.salt,
                  lastLoginAt: new Date().toISOString(),
                }
              : u
          );
          saveCollectionValue(db, 'user_accounts', nextAccounts);
        }
        const perms = getDefaultCrmPermissionsForRole('super_admin', 'administrator');
        const userObj = {
          id: superAdminAcc?.id || 'usr_superadmin',
          name: superAdminAcc?.fullName || 'Shahzad Malik',
          urduName: superAdminAcc?.urduName || 'شہزاد ملک (سپر ایڈمن)',
          phone: superAdminAcc?.phone || '03125256266',
          email: superAdminAcc?.email || 'admin@madinamarket.pk',
          role: 'super_admin',
          crmRole: 'administrator' as CRMRoleSpecialization,
          crmPermissions: perms,
          canAuthorizeCreditSale: true,
          isAuthenticated: true,
        };
        const sessionToken = signSessionToken({ userId: userObj.id, role: 'super_admin', name: userObj.name });
        recordLoginAudit(db, {
          userId: userObj.id,
          userName: userObj.name,
          role: 'super_admin',
          identifier: cleanId,
          status: 'success',
          note: 'Server authenticated session',
        });
        res.json({ ok: true, user: userObj, sessionToken });
        return;
      }
    }

    const matchingAccounts = accounts.filter(
      (u) =>
        normalizePhoneOrId(u.phone) === cleanId ||
        u.username.toLowerCase() === cleanIdLower ||
        (u.email && u.email.toLowerCase() === cleanIdLower)
    );

    for (const acc of matchingAccounts) {
      const validHash = verifyServerSecret(cleanPin, acc.passwordHash, acc.passwordSalt);
      const digits = acc.phone.replace(/\D/g, '');
      const defaultPin = digits.length >= 6 ? digits.slice(-6) : '123456';
      const validTemp = !acc.passwordHash && cleanPin === defaultPin;
      if (validHash || validTemp) {
        if (acc.status !== 'active') {
          recordLoginAudit(db, {
            userId: acc.id,
            userName: acc.fullName,
            role: acc.role,
            identifier: cleanId,
            status: 'locked',
            note: 'Blocked suspended account',
          });
          res.status(403).json({ error: 'Account is suspended or inactive.' });
          return;
        }
        // Upgrade non-scrypt secret or record lastLoginAt cleanly
        if (!acc.passwordHash?.startsWith('scrypt:')) {
          const hashed = hashServerSecret(cleanPin);
          const nextAccounts = accounts.map((u) =>
            u.id === acc.id
              ? {
                  ...u,
                  passwordHash: hashed.hash,
                  passwordSalt: hashed.salt,
                  lastLoginAt: new Date().toISOString(),
                }
              : u
          );
          saveCollectionValue(db, 'user_accounts', nextAccounts);
        }
        const crmPerms = acc.crmPermissions
          ? { ...getDefaultCrmPermissionsForRole(acc.role, acc.crmRole), ...acc.crmPermissions }
          : getDefaultCrmPermissionsForRole(acc.role, acc.crmRole);
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
          crmRole: acc.crmRole,
          crmPermissions: crmPerms,
          canAuthorizeCreditSale:
            acc.role === 'super_admin' ||
            acc.role === 'admin' ||
            Boolean(acc.canAuthorizeCreditSale ?? acc.managerAuthorities?.canAuthorizeCreditSale),
          mustChangePassword: Boolean(acc.mustChangePassword),
          isAuthenticated: true,
        };
        const sessionToken = signSessionToken({ userId: acc.id, role: acc.role, name: acc.fullName });
        recordLoginAudit(db, {
          userId: acc.id,
          userName: acc.fullName,
          role: acc.role,
          identifier: cleanId,
          status: 'success',
          note: 'Server authenticated session',
        });
        res.json({ ok: true, user: userObj, sessionToken });
        return;
      }
    }

    // Fallback check against resellers table
    const resellers = getCollectionValue<Reseller[]>(db, 'resellers', []);
    const matchedReseller = resellers.find(
      (r) => normalizePhoneOrId(r.phone) === cleanId || r.referralCode.toLowerCase() === cleanIdLower
    );
    if (matchedReseller) {
      const digits = matchedReseller.phone.replace(/\D/g, '');
      const fallbackPin = digits.length >= 6 ? digits.slice(-6) : '123456';
      const validPin = matchedReseller.pin
        ? verifyServerSecret(cleanPin, matchedReseller.pin) || cleanPin === matchedReseller.pin
        : cleanPin === fallbackPin;
      if (validPin) {
        if (matchedReseller.status !== 'active') {
          res.status(403).json({ error: 'Reseller account is inactive.' });
          return;
        }
        const userObj = {
          id: matchedReseller.id,
          name: matchedReseller.name,
          phone: matchedReseller.phone,
          role: 'reseller',
          resellerCode: matchedReseller.referralCode,
          canAuthorizeCreditSale: false,
          isAuthenticated: true,
        };
        const sessionToken = signSessionToken({
          userId: matchedReseller.id,
          role: 'reseller',
          name: matchedReseller.name,
        });
        recordLoginAudit(db, {
          userId: matchedReseller.id,
          userName: matchedReseller.name,
          role: 'reseller',
          identifier: cleanId,
          status: 'success',
          note: 'Reseller portal login',
        });
        res.json({ ok: true, user: userObj, sessionToken });
        return;
      }
    }

    // Fallback check against customers table (for imported/legacy buyers without user_accounts row)
    const customers = getAllCustomersFromDb(db);
    const matchedCustomer = customers.find(
      (c) => normalizePhoneOrId(c.phone) === cleanId || c.id === cleanId
    );
    if (matchedCustomer) {
      const digits = matchedCustomer.phone.replace(/\D/g, '');
      const fallbackPin = digits.length >= 6 ? digits.slice(-6) : '123456';
      const validPin = matchedCustomer.pin
        ? verifyServerSecret(cleanPin, matchedCustomer.pin) || cleanPin === matchedCustomer.pin
        : cleanPin === fallbackPin;
      if (validPin) {
        if (matchedCustomer.status === 'archived') {
          res.status(403).json({ error: 'Customer account is archived.' });
          return;
        }
        const userObj = {
          id: matchedCustomer.id,
          name: matchedCustomer.name,
          urduName: matchedCustomer.urduName,
          phone: matchedCustomer.phone,
          email: matchedCustomer.email,
          role: 'customer',
          customerId: matchedCustomer.id,
          canAuthorizeCreditSale: false,
          isAuthenticated: true,
        };
        const sessionToken = signSessionToken({
          userId: matchedCustomer.id,
          role: 'customer',
          name: matchedCustomer.name,
        });
        recordLoginAudit(db, {
          userId: matchedCustomer.id,
          userName: matchedCustomer.name,
          role: 'customer',
          identifier: cleanId,
          status: 'success',
          note: 'Customer portal login',
        });
        res.json({ ok: true, user: userObj, sessionToken });
        return;
      }
    }

    recordLoginAudit(db, {
      userId: 'unknown',
      userName: cleanId,
      role: 'unknown',
      identifier: cleanId,
      status: 'failed',
      note: 'Invalid PIN/password attempt',
    });
    res.status(401).json({ error: 'Invalid phone/ID or PIN.' });
  });

  app.post('/api/auth/register-customer', (req, res) => {
    const db = getDb();
    const bp = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (bp.loginFormConfig?.allowSelfRegistration === false) {
      res.status(403).json({ error: 'Self-registration is currently disabled. Please contact store admin.' });
      return;
    }

    const { name, phone, city, address, pin } = (req.body || {}) as {
      name?: string;
      phone?: string;
      city?: string;
      address?: string;
      pin?: string;
    };
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanPin = (pin || '').trim();
    if (!cleanName || cleanPhone.replace(/\D/g, '').length < 10 || cleanPin.length < 4) {
      res.status(400).json({ error: 'Valid name, phone number (10+ digits), and PIN (4+ chars) are required.' });
      return;
    }

    const normPhone = normalizePhoneDigits(cleanPhone);
    const existingCustomers = getAllCustomersFromDb(db);
    const dupCust = existingCustomers.find((c) => normalizePhoneDigits(c.phone) === normPhone);
    if (dupCust) {
      res.status(409).json({ error: 'An account with this phone number already exists. Please sign in.' });
      return;
    }

    const now = new Date().toISOString();
    const custId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newCust: Customer = {
      id: custId,
      name: cleanName,
      phone: cleanPhone,
      city: (city || 'Muzaffarabad').trim(),
      address: (address || city || 'Pakistan').trim(),
      customerType: 'individual',
      customerSource: 'Website',
      balance: 0,
      totalPurchases: 0,
      creditLimit: 5000,
      paymentTermsDays: 7,
      status: 'active',
      createdAt: now.split('T')[0],
    };

    const hashed = hashServerSecret(cleanPin);
    const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const accId = `usr_cust_${Date.now()}`;
    const newAccount: UserAccount = {
      id: accId,
      fullName: cleanName,
      username: normPhone || cleanPhone,
      phone: cleanPhone,
      role: 'customer',
      status: 'active',
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      linkedCustomerId: custId,
      createdAt: now,
      createdBy: 'self_registration',
    };

    upsertCustomerRow(db, newCust);
    saveCollectionValue(db, 'user_accounts', [...accounts, newAccount]);
    insertCrmActivityEvent(db, {
      customerId: custId,
      phone: cleanPhone,
      eventType: 'note_added',
      notes: 'Customer registered via Storefront Portal',
    });

    const userObj = {
      id: accId,
      name: cleanName,
      phone: cleanPhone,
      role: 'customer',
      customerId: custId,
      canAuthorizeCreditSale: false,
      isAuthenticated: true,
    };
    const sessionToken = signSessionToken({ userId: accId, role: 'customer', name: cleanName });
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({ ok: true, user: userObj, customer: newCust, sessionToken });
  });

  app.post('/api/auth/change-password', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const { currentPin, newPin } = (req.body || {}) as { currentPin?: string; newPin?: string };
    const cur = (currentPin || '').trim();
    const next = (newPin || '').trim();
    if (!cur || next.length < 4) {
      res.status(400).json({ error: 'Current PIN and a new PIN (at least 4 characters) are required.' });
      return;
    }

    const db = getDb();
    const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const acc = accounts.find((u) => u.id === actor.id);
    if (acc) {
      const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();
      const verified =
        verifyServerSecret(cur, acc.passwordHash, acc.passwordSalt) ||
        (acc.role === 'super_admin' && Boolean(envMasterPin) && cur === envMasterPin);
      if (!verified) {
        res.status(403).json({ error: 'Current PIN / password is incorrect.' });
        return;
      }
      const hashed = hashServerSecret(next);
      const nextAccounts = accounts.map((u) =>
        u.id === acc.id
          ? {
              ...u,
              passwordHash: hashed.hash,
              passwordSalt: hashed.salt,
              isTemporaryPassword: false,
              mustChangePassword: false,
            }
          : u
      );
      saveCollectionValue(db, 'user_accounts', nextAccounts);
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      res.json({ ok: true });
      return;
    }

    if (actor.role === 'customer' && actor.customerId) {
      const cust = getAllCustomersFromDb(db).find((c) => c.id === actor.customerId);
      if (!cust) {
        res.status(404).json({ error: 'Customer profile not found.' });
        return;
      }
      const digits = cust.phone.replace(/\D/g, '');
      const fallback = digits.length >= 6 ? digits.slice(-6) : '123456';
      const okCur = cust.pin
        ? verifyServerSecret(cur, cust.pin) || cur === cust.pin
        : cur === fallback;
      if (!okCur) {
        res.status(403).json({ error: 'Current PIN is incorrect.' });
        return;
      }
      const hashed = hashServerSecret(next);
      const newAcc: UserAccount = {
        id: `usr_cust_${cust.id}`,
        fullName: cust.name,
        username: normalizePhoneDigits(cust.phone) || cust.id,
        phone: cust.phone,
        role: 'customer',
        status: 'active',
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        linkedCustomerId: cust.id,
        createdAt: new Date().toISOString(),
        createdBy: cust.id,
      };
      const cleanCust = { ...cust };
      delete cleanCust.pin;
      upsertCustomerRow(db, cleanCust);
      saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
      res.json({ ok: true });
      return;
    }

    res.status(404).json({ error: 'User account not found.' });
  });

  app.post('/api/auth/change-master-pin', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only the Super Admin can update the Master PIN.' });
      return;
    }
    const { currentPin, newPin } = (req.body || {}) as { currentPin?: string; newPin?: string };
    const cur = (currentPin || '').trim();
    const next = (newPin || '').trim();
    if (!cur || next.length < 4) {
      res.status(400).json({ error: 'Current Master PIN and new Master PIN (min 4 characters) are required.' });
      return;
    }

    const db = getDb();
    const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const superAcc = accounts.find((u) => u.id === 'usr_superadmin' || u.role === 'super_admin');
    const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();
    const validCur =
      (superAcc && verifyServerSecret(cur, superAcc.passwordHash, superAcc.passwordSalt)) ||
      (Boolean(envMasterPin) && cur === envMasterPin);
    if (!validCur) {
      res.status(403).json({ error: 'Current Master PIN is incorrect.' });
      return;
    }

    const hashed = hashServerSecret(next);
    if (superAcc) {
      const updated = accounts.map((u) =>
        u.id === superAcc.id
          ? {
              ...u,
              passwordHash: hashed.hash,
              passwordSalt: hashed.salt,
              isTemporaryPassword: false,
              mustChangePassword: false,
            }
          : u
      );
      saveCollectionValue(db, 'user_accounts', updated);
    }
    insertAdminAuditLog(db, {
      action: 'change_master_pin',
      entityType: 'security',
      entityId: 'usr_superadmin',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
    });
    broadcastSyncEvent('user_accounts', req.header('x-client-id'));
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/reset-password', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can reset user credentials.' });
      return;
    }
    const newPin = String(req.body?.newPin || '').trim();
    if (newPin.length < 4) {
      res.status(400).json({ error: 'New temporary PIN must be at least 4 characters.' });
      return;
    }
    const db = getDb();
    const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const target = accounts.find((u) => u.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only Super Admin can reset the Super Admin PIN.' });
      return;
    }
    const hashed = hashServerSecret(newPin);
    const updated = accounts.map((u) =>
      u.id === target.id
        ? {
            ...u,
            passwordHash: hashed.hash,
            passwordSalt: hashed.salt,
            isTemporaryPassword: true,
            mustChangePassword: true,
          }
        : u
    );
    saveCollectionValue(db, 'user_accounts', updated);
    insertAdminAuditLog(db, {
      action: 'admin_reset_user_pin',
      entityType: 'user_account',
      entityId: target.id,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: { targetUsername: target.username, targetRole: target.role },
    });
    broadcastSyncEvent('user_accounts', req.header('x-client-id'));
    res.json({ ok: true });
  });

  // 5. PRODUCTS & UPCOMING -> ARRIVED TRANSFER
  app.get('/api/products', (req, res) => {
    const actor = resolveActor(req);
    const isPriv = actor.role === 'super_admin' || actor.role === 'admin' || actor.role === 'manager' || actor.role === 'investor';
    const prods = getAllProductsFromDb().map((p) =>
      isPriv ? p : { ...p, costPrice: 0, totalProfit: 0, totalRevenue: 0 }
    );
    res.json({ products: prods });
  });

  app.post('/api/products', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Only admins or store managers can create products.' });
      return;
    }
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
    const actor = resolveActor(req);
    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'admin' &&
      actor.role !== 'manager' &&
      actor.role !== 'staff'
    ) {
      res.status(403).json({ error: 'Unauthorized to update products.' });
      return;
    }
    const db = getDb();
    const id = req.params.id;
    const existing = getAllProductsFromDb(db).find((p) => p.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const incoming = req.body as Partial<ProductItem>;
    const merged: ProductItem = {
      ...existing,
      ...incoming,
      id,
      // Staff cannot tamper with costPrice or selling prices directly
      costPrice: actor.role === 'staff' ? existing.costPrice : Number(incoming.costPrice ?? existing.costPrice),
    };

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
  app.get('/api/expenses', (req, res) => {
    const actor = resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Unauthorized to view monthly expenses.' });
      return;
    }
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

  // 8. CUSTOMERS CRUD (AUTHENTICATED + ROLE SCOPED + OPTIONAL PAGINATION)
  app.get('/api/customers', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const db = getDb();
    let list = getAllCustomersFromDb(db).map((c) => {
      const clean = { ...c };
      delete clean.pin;
      return clean;
    });
    if (actor.role === 'customer') {
      list = list.filter((c) => c.id === actor.customerId || (actor.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(actor.phone)));
    } else if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager' && actor.role !== 'staff') {
      res.status(403).json({ error: 'Unauthorized to access customer directory.' });
      return;
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          (c.city || '').toLowerCase().includes(q)
      );
    }

    const page = Number(req.query.page || 0);
    const limit = Number(req.query.limit || 0);
    if (page > 0 && limit > 0) {
      const start = (page - 1) * limit;
      res.json({
        customers: list.slice(start, start + limit),
        total: list.length,
        page,
        limit,
      });
      return;
    }
    res.json({ customers: list });
  });

  app.post('/api/customers', (req, res) => {
    const actor = resolveActor(req);
    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'admin' &&
      actor.role !== 'manager' &&
      actor.role !== 'staff'
    ) {
      res.status(403).json({ error: 'Unauthorized to create customer records.' });
      return;
    }
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
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const db = getDb();
    const existing = getAllCustomersFromDb(db).find((c) => c.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const incoming = req.body as Partial<Customer>;
    if (actor.role === 'customer') {
      if (actor.customerId !== existing.id) {
        res.status(403).json({ error: 'Customers can only update their own delivery profile.' });
        return;
      }
      const saved = upsertCustomerRow(db, {
        ...existing,
        name: incoming.name ?? existing.name,
        city: incoming.city ?? existing.city,
        area: incoming.area ?? existing.area,
        mohalla: incoming.mohalla ?? existing.mohalla,
        landmark: incoming.landmark ?? existing.landmark,
        address: incoming.address ?? existing.address,
        whatsappOptOut: incoming.whatsappOptOut ?? existing.whatsappOptOut,
        whatsappConsent: incoming.whatsappConsent ?? existing.whatsappConsent,
        birthday: incoming.birthday ?? existing.birthday,
        id: existing.id,
      });
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
      return;
    }

    if (
      actor.role !== 'super_admin' &&
      actor.role !== 'admin' &&
      actor.role !== 'manager' &&
      actor.role !== 'staff'
    ) {
      res.status(403).json({ error: 'Unauthorized to modify customer records.' });
      return;
    }
    const saved = upsertCustomerRow(db, { ...existing, ...incoming, id: existing.id });
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
  });

  // 9. AUTHORITATIVE ORDER CHECKOUT WITH UPCOMING, EXPRESS-ONLY DELIVERY, PRICING & LOYALTY
  app.post('/api/orders/checkout', (req, res) => {
    const actor = resolveActor(req);
    const db = getDb();
    const {
      items,
      customer,
      transaction,
      codOrder,
      resellerId,
      couponCode,
    } = (req.body || {}) as {
      items?: Array<{ productId: string; quantity: number }>;
      customer?: Customer;
      transaction?: Transaction;
      codOrder?: CODOrder;
      resellerId?: string;
      couponCode?: string;
    };

    if (transaction?.saleType === 'time_credit') {
      const canCredit =
        actor.role === 'super_admin' ||
        actor.role === 'admin' ||
        Boolean(actor.account?.canAuthorizeCreditSale ?? actor.account?.managerAuthorities?.canAuthorizeCreditSale);
      if (!canCredit) {
        res.status(403).json({
          error: 'Only Admin or authorized credit sellers can create Time-Credit (Udhar) orders.',
        });
        return;
      }
    }

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
    let computedCatalogSubtotal = 0;
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
        computedCatalogSubtotal += Number(prod.ourPrice || 0) * Math.max(1, Number(item.quantity || 1));
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

    const isPrivilegedSeller =
      actor.role === 'super_admin' || actor.role === 'admin' || actor.role === 'manager' || actor.role === 'staff';

    // Validate optional CRM Coupon
    let appliedCoupon: CRMLoyaltyCoupon | undefined;
    let couponDiscount = 0;
    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCode = couponCode.trim().toUpperCase();
      const coupons = getAllCrmCoupons(db);
      const foundCoupon = coupons.find((cp) => cp.code === cleanCode);
      if (!foundCoupon || foundCoupon.status !== 'active') {
        res.status(400).json({ error: `Coupon code "${cleanCode}" is invalid or no longer active.` });
        return;
      }
      if (foundCoupon.expiresAt && new Date(foundCoupon.expiresAt).getTime() < Date.now()) {
        res.status(400).json({ error: `Coupon code "${cleanCode}" has expired.` });
        return;
      }
      if (
        foundCoupon.customerId &&
        customer?.id &&
        foundCoupon.customerId !== customer.id &&
        actor.customerId !== foundCoupon.customerId
      ) {
        res.status(403).json({ error: `Coupon code "${cleanCode}" belongs to another customer account.` });
        return;
      }
      const baseSubtotal = computedCatalogSubtotal || Number(codOrder?.subtotal || transaction?.amount || 0);
      if (foundCoupon.minOrderAmount && baseSubtotal < foundCoupon.minOrderAmount) {
        res.status(400).json({
          error: `Coupon "${cleanCode}" requires a minimum order of Rs. ${foundCoupon.minOrderAmount.toLocaleString('en-PK')}.`,
        });
        return;
      }
      appliedCoupon = foundCoupon;
      couponDiscount =
        foundCoupon.discountType === 'percent' || foundCoupon.discountType === 'percentage'
          ? Math.round((baseSubtotal * foundCoupon.discountValue) / 100)
          : Math.round(foundCoupon.discountValue);
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      let savedCustomer: Customer | undefined;
      if (customer) {
        const existingCust = getAllCustomersFromDb(db).find((c) => c.id === customer.id);
        savedCustomer = upsertCustomerRow(db, {
          ...customer,
          balance: existingCust && !isPrivilegedSeller
            ? existingCust.balance
            : Number.isFinite(Number(customer.balance))
            ? Number(customer.balance)
            : 0,
          totalPurchases: Number.isFinite(Number(customer.totalPurchases)) ? Number(customer.totalPurchases) : 0,
        });
      }

      const authoritativeSubtotal =
        !isPrivilegedSeller && computedCatalogSubtotal > 0
          ? computedCatalogSubtotal
          : Number(codOrder?.subtotal || transaction?.amount || computedCatalogSubtotal);
      const safeDeliveryFee = Math.max(0, Number(codOrder?.deliveryFee || 0));
      const authoritativeTotal = Math.max(
        0,
        authoritativeSubtotal + safeDeliveryFee - couponDiscount
      );

      if (transaction) {
        const finalTxAmount = !isPrivilegedSeller && computedCatalogSubtotal > 0
          ? authoritativeTotal
          : Math.max(0, Number(transaction.amount || 0));
        const cleanTx: Transaction = {
          ...transaction,
          customerId: transaction.customerId || savedCustomer?.id || '',
          amount: finalTxAmount,
          paidAmount: Math.min(finalTxAmount, Math.max(0, Number(transaction.paidAmount || 0))),
          dueBalance: Math.max(0, Number(transaction.dueBalance ?? 0)),
          notes: appliedCoupon
            ? `${transaction.notes || ''} [Coupon ${appliedCoupon.code}: -Rs.${couponDiscount}]`.trim()
            : transaction.notes,
          auditTrail: Array.isArray(transaction.auditTrail) ? transaction.auditTrail : [],
        };
        const currentTxs = getCollectionValue<Transaction[]>(db, 'transactions', []);
        saveCollectionValue(db, 'transactions', [cleanTx, ...currentTxs.filter((t) => t.id !== cleanTx.id)]);
      }

      let persistedOrderNumber = transaction?.invoiceNumber;
      if (codOrder) {
        const safeItems = Array.isArray(codOrder.items) ? codOrder.items : [];
        const cleanOrder: CODOrder = {
          ...codOrder,
          customerId: codOrder.customerId || savedCustomer?.id || transaction?.customerId,
          items: safeItems,
          subtotal: authoritativeSubtotal,
          deliveryFee: safeDeliveryFee,
          totalAmount: isPrivilegedSeller && codOrder.totalAmount > 0 && !appliedCoupon
            ? Math.max(0, Number(codOrder.totalAmount))
            : authoritativeTotal,
          createdAt: codOrder.createdAt || new Date().toISOString(),
        };
        persistedOrderNumber = cleanOrder.orderNumber;
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

      if (appliedCoupon) {
        upsertCrmCoupon(db, {
          ...appliedCoupon,
          status: 'redeemed',
          redeemedAt: new Date().toISOString(),
        });
      }

      // Award CRM Loyalty points & record timeline event
      const targetCustomerId = savedCustomer?.id || codOrder?.customerId || transaction?.customerId;
      if (targetCustomerId) {
        const loyaltyCfg = getCrmLoyaltyConfig(db);
        const orderAmt = authoritativeTotal || Number(transaction?.amount || 0);
        const pts = Math.floor(orderAmt / 1000) * Math.max(1, loyaltyCfg.pointsPerThousandPkr);
        if (pts > 0) {
          adjustCustomerLoyaltyPoints(db, {
            customerId: targetCustomerId,
            pointsDelta: pts,
            type: 'earned',
            orderNumber: persistedOrderNumber,
            notes: `Points earned from order #${persistedOrderNumber || 'checkout'}`,
          });
        }
        insertCrmActivityEvent(db, {
          customerId: targetCustomerId,
          phone: savedCustomer?.phone || codOrder?.phone,
          eventType: 'order_placed',
          orderNumber: persistedOrderNumber,
          amount: orderAmt,
          notes: `Order placed via ${codOrder ? 'COD Storefront' : 'POS'}`,
        });
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

      if (status === 'returned' && !wasReturned) {
        insertCrmActivityEvent(db, {
          customerId: updatedOrder.customerId,
          phone: updatedOrder.phone,
          eventType: 'order_returned',
          orderNumber: updatedOrder.orderNumber,
          amount: updatedOrder.totalAmount,
          notes: `COD order marked returned (${updatedOrder.courierPartner})`,
        });
      }
      if (status === 'delivered' && !wasDelivered) {
        insertCrmActivityEvent(db, {
          customerId: updatedOrder.customerId,
          phone: updatedOrder.phone,
          eventType: 'order_delivered',
          orderNumber: updatedOrder.orderNumber,
          amount: updatedOrder.totalAmount,
          notes: `COD parcel delivered via ${updatedOrder.courierPartner}`,
        });
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

  // 10. CENTRAL COLLECTION SYNC ROUTE WITH AUTHENTICATED RBAC GUARD
  const ADMIN_ONLY_COLLECTIONS = new Set(['user_accounts', 'investors', 'investor_transactions', 'admin_audit_logs', 'login_audits']);
  const STAFF_WRITABLE_COLLECTIONS = new Set([
    'walkin_customers',
    'walkin_sales',
    'customers',
    'transactions',
    'cod_orders',
    'wasal_settlements',
    'notifications',
    'attendance',
  ]);
  const CUSTOMER_WRITABLE_COLLECTIONS = new Set(['review_rewards', 'notifications']);

  app.put('/api/collections/:collectionKey', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required to modify application collections.' });
      return;
    }

    const key = req.params.collectionKey;
    const isAdmin = actor.role === 'super_admin' || actor.role === 'admin';
    const isManager = actor.role === 'manager';
    const isStaff = actor.role === 'staff';

    if (ADMIN_ONLY_COLLECTIONS.has(key) && !isAdmin) {
      res.status(403).json({ error: `Only administrators can modify "${key}".` });
      return;
    }
    if (!isAdmin && !isManager) {
      if (isStaff && !STAFF_WRITABLE_COLLECTIONS.has(key)) {
        res.status(403).json({ error: `Staff role is not permitted to modify "${key}".` });
        return;
      }
      if (!isStaff && !CUSTOMER_WRITABLE_COLLECTIONS.has(key)) {
        res.status(403).json({ error: `Insufficient permissions to modify "${key}".` });
        return;
      }
    }

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
        const existingById = new Map(existing.map((c) => [c.id, c]));
        for (const ex of existing) {
          if (!incomingIds.has(ex.id)) {
            db.prepare('DELETE FROM customers WHERE id = ?').run(ex.id);
          }
        }
        for (const c of incoming) {
          if (c?.id) {
            const prev = existingById.get(c.id);
            upsertCustomerRow(db, {
              ...c,
              pin: c.pin || prev?.pin,
            });
          }
        }
      } else if (key === 'cities' && Array.isArray(data)) {
        replaceCitiesAndAreasFromList(db, data as DeliveryCityConfig[]);
        syncDeliveryCitiesIntoBusinessProfile(db);
      } else if (key === 'business_profile' && typeof data === 'object' && data !== null) {
        const incomingBp = data as BusinessProfile;
        const currentBp = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
        const mergedBp: BusinessProfile = {
          ...incomingBp,
          shippingPartner: {
            ...incomingBp.shippingPartner,
            apiKey: incomingBp.shippingPartner?.apiKey || currentBp.shippingPartner?.apiKey || '',
          },
        };
        delete mergedBp.adminPin;
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
        const mergedAccounts = (data as UserAccount[]).map((u) => {
          const prev = byId.get(u.id);
          const clean = { ...u };
          delete clean.suggestedDefaultPin;
          delete clean.resetToken;
          delete clean.resetTokenExpiresAt;
          if (!prev) {
            if (clean.passwordHash && !clean.passwordHash.startsWith('scrypt:') && !clean.passwordSalt) {
              const h = hashServerSecret(clean.passwordHash);
              clean.passwordHash = h.hash;
              clean.passwordSalt = h.salt;
            }
            return clean;
          }
          return {
            ...clean,
            passwordHash: clean.passwordHash || prev.passwordHash,
            passwordSalt: clean.passwordSalt || prev.passwordSalt,
          };
        });
        saveCollectionValue(db, 'user_accounts', mergedAccounts);
      } else if (key === 'review_rewards' && Array.isArray(data) && !isAdmin && !isManager && !isStaff) {
        // Non-admin customers may only add/update their own pending review submissions
        const currentReviews = getCollectionValue<ReviewRewardSubmission[]>(db, 'review_rewards', []);
        const currentMap = new Map(currentReviews.map((r) => [r.id, r]));
        for (const rawRev of data as ReviewRewardSubmission[]) {
          if (rawRev?.id && !currentMap.has(rawRev.id) && (rawRev.customerId === actor.customerId || !actor.customerId)) {
            currentReviews.unshift({ ...rawRev, status: 'pending', voucherCode: undefined });
          }
        }
        saveCollectionValue(db, 'review_rewards', currentReviews);
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

  // 11. COMPLETE INTEGRATED CRM API ROUTER (/api/crm/*)
  const buildAllCustomer360Profiles = (db: ReturnType<typeof getDb>) => {
    const customers = getAllCustomersFromDb(db).map((c) => {
      const clean = { ...c };
      delete clean.pin;
      return clean;
    });
    const transactions = getCollectionValue<Transaction[]>(db, 'transactions', []);
    const codOrders = getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
    const products = getAllProductsFromDb(db);
    const resellers = getCollectionValue<Reseller[]>(db, 'resellers', []);
    const loyaltyAccounts = getAllCrmLoyaltyAccounts(db);
    const loyaltyLedger = getAllCrmLoyaltyLedger(db);
    const followUps = getAllCrmFollowUps(db);
    const tickets = getAllCrmTickets(db);
    const coupons = getAllCrmCoupons(db);
    const activityEvents = getAllCrmActivityEvents(db);
    const reviewRewards = getCollectionValue<ReviewRewardSubmission[]>(db, 'review_rewards', []);
    const customRules = getAllCrmCustomSegments(db);

    const profiles = customers.map((customer) =>
      buildCustomer360Profile({
        customer,
        transactions,
        codOrders,
        products,
        resellers,
        loyaltyAccounts,
        loyaltyLedger,
        followUps,
        tickets,
        coupons,
        activityEvents,
        reviewRewards,
        customRules,
      })
    );

    return {
      profiles,
      customers,
      transactions,
      codOrders,
      products,
      resellers,
      loyaltyAccounts,
      loyaltyLedger,
      followUps,
      tickets,
      coupons,
      activityEvents,
      reviewRewards,
      customRules,
    };
  };

  const requireCrmActor = (req: Request, res: Response, requiredPerm?: keyof CRMPermissions): ResolvedActor | null => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required to access CRM.' });
      return null;
    }
    const isOps =
      actor.role === 'super_admin' ||
      actor.role === 'admin' ||
      actor.role === 'manager' ||
      actor.role === 'staff';
    if (!isOps) {
      res.status(403).json({ error: 'CRM workspace is restricted to authorized store team members.' });
      return null;
    }
    if (requiredPerm && actor.role !== 'super_admin' && actor.role !== 'admin') {
      const allowed = actor.crmPermissions?.[requiredPerm];
      if (allowed === false) {
        res.status(403).json({ error: `Your role does not have permission: ${requiredPerm}` });
        return null;
      }
    }
    return actor;
  };

  app.get('/api/crm/state', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const leads = getAllCrmLeads(db);
    const campaigns = getAllCrmCampaigns(db);
    const automationRules = getAllCrmAutomationRules(db);
    const automationLogs = getAllCrmAutomationLogs(db, 150);
    const loyaltyConfig = getCrmLoyaltyConfig(db);

    const kpis = computeCrmDashboardKPIs({
      profiles: bundle.profiles,
      leads,
      followUps: bundle.followUps,
      tickets: bundle.tickets,
    });
    const intelligence = computeProductCustomerIntelligence({
      products: bundle.products,
      transactions: bundle.transactions,
      codOrders: bundle.codOrders,
      tickets: bundle.tickets,
      activityEvents: bundle.activityEvents,
    });

    res.json({
      ok: true,
      kpis,
      profiles: bundle.profiles,
      followUps: bundle.followUps,
      leads,
      campaigns,
      tickets: bundle.tickets,
      loyaltyConfig,
      loyaltyAccounts: bundle.loyaltyAccounts,
      loyaltyLedger: bundle.loyaltyLedger,
      coupons: bundle.coupons,
      customSegments: bundle.customRules,
      automationRules,
      automationLogs,
      intelligence,
      whatsappTemplates: CRM_WHATSAPP_TEMPLATES,
      autoSegmentsCatalog: ALL_AUTO_SEGMENTS,
      reportCatalog: CRM_REPORT_CATALOG,
    });
  });

  app.get('/api/crm/dashboard', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const leads = getAllCrmLeads(db);
    const kpis = computeCrmDashboardKPIs({
      profiles: bundle.profiles,
      leads,
      followUps: bundle.followUps,
      tickets: bundle.tickets,
      filters: {
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        city: typeof req.query.city === 'string' ? req.query.city : undefined,
        customerType: typeof req.query.customerType === 'string' ? req.query.customerType : undefined,
        salesperson: typeof req.query.salesperson === 'string' ? req.query.salesperson : undefined,
      },
    });
    res.json({ ok: true, kpis });
  });

  app.get('/api/crm/customers', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const q = String(req.query.q || '').trim().toLowerCase();
    const segment = String(req.query.segment || '').trim();
    const city = String(req.query.city || '').trim().toLowerCase();
    const cType = String(req.query.customerType || '').trim();

    let filtered = bundle.profiles;
    if (q) {
      filtered = filtered.filter(
        (p) =>
          p.customer.name.toLowerCase().includes(q) ||
          p.customer.phone.toLowerCase().includes(q) ||
          (p.customer.city || '').toLowerCase().includes(q) ||
          (p.customer.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (segment) {
      filtered = filtered.filter(
        (p) =>
          p.autoSegments.includes(segment as (typeof p.autoSegments)[number]) ||
          p.customSegments.includes(segment)
      );
    }
    if (city) {
      filtered = filtered.filter((p) => (p.customer.city || '').toLowerCase().includes(city));
    }
    if (cType) {
      filtered = filtered.filter((p) => p.customer.customerType === cType);
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const start = (page - 1) * limit;
    res.json({
      ok: true,
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
    });
  });

  app.get('/api/crm/customers/:id/360', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const isOps = actor.role === 'super_admin' || actor.role === 'admin' || actor.role === 'manager' || actor.role === 'staff';
    if (!isOps && actor.customerId !== req.params.id) {
      res.status(403).json({ error: 'Access denied to another customer 360 profile.' });
      return;
    }
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const profile = bundle.profiles.find((p) => p.customer.id === req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    res.json({ ok: true, profile });
  });

  app.put('/api/crm/customers/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canEditCustomers');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCustomersFromDb(db).find((c) => c.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const body = (req.body || {}) as Partial<Customer>;
    const updated: Customer = {
      ...existing,
      email: body.email !== undefined ? body.email : existing.email,
      city: body.city !== undefined ? body.city : existing.city,
      area: body.area !== undefined ? body.area : existing.area,
      address: body.address !== undefined ? body.address : existing.address,
      customerSource: body.customerSource !== undefined ? body.customerSource : existing.customerSource,
      referredBy: body.referredBy !== undefined ? body.referredBy : existing.referredBy,
      customerType: body.customerType !== undefined ? body.customerType : existing.customerType,
      tags: Array.isArray(body.tags) ? body.tags : existing.tags,
      assignedSalespersonId:
        body.assignedSalespersonId !== undefined ? body.assignedSalespersonId : existing.assignedSalespersonId,
      assignedSalespersonName:
        body.assignedSalespersonName !== undefined ? body.assignedSalespersonName : existing.assignedSalespersonName,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      interestedCategories: Array.isArray(body.interestedCategories)
        ? body.interestedCategories
        : existing.interestedCategories,
      paymentPreference: body.paymentPreference !== undefined ? body.paymentPreference : existing.paymentPreference,
      whatsappOptOut: body.whatsappOptOut !== undefined ? Boolean(body.whatsappOptOut) : existing.whatsappOptOut,
      whatsappConsent: body.whatsappConsent !== undefined ? Boolean(body.whatsappConsent) : existing.whatsappConsent,
      birthday: body.birthday !== undefined ? body.birthday : existing.birthday,
      isVipManual: body.isVipManual !== undefined ? Boolean(body.isVipManual) : existing.isVipManual,
    };
    const saved = upsertCustomerRow(db, updated);
    if (body.notes && body.notes !== existing.notes) {
      insertCrmActivityEvent(db, {
        customerId: saved.id,
        phone: saved.phone,
        eventType: 'note_added',
        notes: `${actor.name || 'CRM'}: ${body.notes}`,
      });
    }
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({ ok: true, customer: saved });
  });

  // Custom Segments CRUD
  app.get('/api/crm/segments', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    res.json({
      ok: true,
      autoSegments: ALL_AUTO_SEGMENTS,
      customSegments: getAllCrmCustomSegments(),
    });
  });

  app.post('/api/crm/segments', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageSegments');
    if (!actor) return;
    const body = req.body as Partial<CRMCustomSegmentRule>;
    if (!body?.name?.trim()) {
      res.status(400).json({ error: 'Segment rule name is required.' });
      return;
    }
    const db = getDb();
    const rule = upsertCrmCustomSegment(db, {
      id: body.id || `seg_${Date.now()}`,
      name: body.name.trim(),
      description: body.description?.trim(),
      isActive: body.isActive !== false,
      criteria: body.criteria || {},
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, segment: rule, customSegments: getAllCrmCustomSegments(db) });
  });

  app.delete('/api/crm/segments/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageSegments');
    if (!actor) return;
    const db = getDb();
    deleteCrmCustomSegment(db, req.params.id);
    res.json({ ok: true, customSegments: getAllCrmCustomSegments(db) });
  });

  // Follow-up Tasks CRUD
  app.get('/api/crm/tasks', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    res.json({ ok: true, tasks: getAllCrmFollowUps() });
  });

  app.post('/api/crm/tasks', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageFollowUps');
    if (!actor) return;
    const body = req.body as Partial<CRMFollowUpTask>;
    if (!body?.title?.trim() || !body?.followUpDate) {
      res.status(400).json({ error: 'Task title and follow-up date are required.' });
      return;
    }
    const db = getDb();
    const task = upsertCrmFollowUp(db, {
      id: body.id || `fu_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      title: body.title.trim(),
      customerId: body.customerId,
      customerName: body.customerName || 'Customer',
      customerPhone: body.customerPhone,
      leadId: body.leadId,
      taskType: body.taskType || 'Call',
      followUpDate: body.followUpDate,
      assignedEmployeeId: body.assignedEmployeeId || actor.id,
      assignedEmployeeName: body.assignedEmployeeName || actor.name || 'Team',
      priority: body.priority || 'Medium',
      notes: body.notes,
      status: body.status || 'Pending',
      outcome: body.outcome,
      nextFollowUpDate: body.nextFollowUpDate,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, task, tasks: getAllCrmFollowUps(db) });
  });

  app.put('/api/crm/tasks/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageFollowUps');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCrmFollowUps(db).find((t) => t.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Follow-up task not found.' });
      return;
    }
    const updated = upsertCrmFollowUp(db, { ...existing, ...(req.body as Partial<CRMFollowUpTask>), id: existing.id });
    res.json({ ok: true, task: updated, tasks: getAllCrmFollowUps(db) });
  });

  app.delete('/api/crm/tasks/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageFollowUps');
    if (!actor) return;
    const db = getDb();
    deleteCrmFollowUp(db, req.params.id);
    res.json({ ok: true, tasks: getAllCrmFollowUps(db) });
  });

  // Leads Pipeline + Duplicate-Safe Conversion
  app.get('/api/crm/leads', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    res.json({ ok: true, leads: getAllCrmLeads() });
  });

  app.post('/api/crm/leads', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageLeads');
    if (!actor) return;
    const body = req.body as Partial<CRMLead>;
    if (!body?.leadName?.trim() || !body?.phone?.trim()) {
      res.status(400).json({ error: 'Lead name and phone number are required.' });
      return;
    }
    const db = getDb();
    const lead = upsertCrmLead(db, {
      id: body.id || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      leadName: body.leadName.trim(),
      phone: body.phone.trim(),
      city: body.city?.trim(),
      source: body.source || 'WhatsApp',
      interestedProductId: body.interestedProductId,
      interestedProductName: body.interestedProductName,
      estimatedValue: Math.max(0, Number(body.estimatedValue || 0)),
      assignedSalespersonId: body.assignedSalespersonId || actor.id,
      assignedSalespersonName: body.assignedSalespersonName || actor.name || 'Sales',
      notes: body.notes,
      followUpDate: body.followUpDate,
      stage: body.stage || 'New',
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, lead, leads: getAllCrmLeads(db) });
  });

  app.put('/api/crm/leads/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageLeads');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCrmLeads(db).find((l) => l.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }
    const updated = upsertCrmLead(db, { ...existing, ...(req.body as Partial<CRMLead>), id: existing.id });
    res.json({ ok: true, lead: updated, leads: getAllCrmLeads(db) });
  });

  app.post('/api/crm/leads/:id/convert', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageLeads');
    if (!actor) return;
    const db = getDb();
    const lead = getAllCrmLeads(db).find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }
    const leadDigits = normalizePhoneDigits(lead.phone);
    const existingCustomers = getAllCustomersFromDb(db);
    let targetCustomer = existingCustomers.find((c) => normalizePhoneDigits(c.phone) === leadDigits);
    let reusedExisting = false;

    if (targetCustomer) {
      reusedExisting = true;
      targetCustomer = upsertCustomerRow(db, {
        ...targetCustomer,
        customerSource: targetCustomer.customerSource || lead.source,
        notes: [targetCustomer.notes, lead.notes].filter(Boolean).join(' | ') || undefined,
      });
    } else {
      targetCustomer = upsertCustomerRow(db, {
        id: `cust_lead_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: lead.leadName,
        phone: lead.phone,
        city: lead.city || 'Muzaffarabad',
        address: lead.city || 'Pakistan',
        customerType: 'individual',
        customerSource: lead.source,
        assignedSalespersonId: lead.assignedSalespersonId,
        assignedSalespersonName: lead.assignedSalespersonName,
        notes: lead.notes,
        balance: 0,
        totalPurchases: 0,
        creditLimit: 5000,
        paymentTermsDays: 7,
        status: 'active',
        createdAt: new Date().toISOString().split('T')[0],
      });
    }

    const updatedLead = upsertCrmLead(db, {
      ...lead,
      stage: 'Converted',
      convertedCustomerId: targetCustomer.id,
      convertedAt: new Date().toISOString(),
    });
    insertCrmActivityEvent(db, {
      customerId: targetCustomer.id,
      phone: targetCustomer.phone,
      eventType: 'lead_converted',
      notes: `Lead converted from ${lead.source}${reusedExisting ? ' (linked to existing customer — zero duplicate created)' : ''}`,
    });
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({
      ok: true,
      lead: updatedLead,
      customer: targetCustomer,
      reusedExisting,
      leads: getAllCrmLeads(db),
    });
  });

  // Campaigns Management (with opt-out filtering & explicit Admin approval guard)
  app.get('/api/crm/campaigns', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    res.json({ ok: true, campaigns: getAllCrmCampaigns() });
  });

  app.post('/api/crm/campaigns', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageCampaigns');
    if (!actor) return;
    const body = req.body as Partial<CRMCampaign>;
    if (!body?.name?.trim() || !body?.messageBody?.trim()) {
      res.status(400).json({ error: 'Campaign name and message body are required.' });
      return;
    }
    const db = getDb();
    const isAdminOrApprovedRole =
      actor.role === 'super_admin' ||
      actor.role === 'admin' ||
      Boolean(actor.crmPermissions?.canApproveBulkMessages);
    const requestedStatus = body.status || 'Draft';
    if ((requestedStatus === 'Approved' || requestedStatus === 'Launched') && !isAdminOrApprovedRole) {
      res.status(403).json({
        error: 'Bulk campaign approval/launch requires Administrator permission.',
      });
      return;
    }

    const bundle = buildAllCustomer360Profiles(db);
    const recipients = bundle.profiles.filter((p) => {
      if (p.customer.whatsappOptOut) return false;
      if (body.segmentName && !p.autoSegments.includes(body.segmentName as (typeof p.autoSegments)[number]) && !p.customSegments.includes(body.segmentName)) {
        return false;
      }
      if (body.targetCity && !(p.customer.city || '').toLowerCase().includes(body.targetCity.toLowerCase())) {
        return false;
      }
      return true;
    });

    const campaign = upsertCrmCampaign(db, {
      id: body.id || `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: body.name.trim(),
      templateType: body.templateType || 'discount_offer',
      segmentName: body.segmentName,
      targetCity: body.targetCity,
      couponCode: body.couponCode?.trim().toUpperCase(),
      messageBody: body.messageBody.trim(),
      status: requestedStatus,
      adminApprovedBy:
        requestedStatus === 'Approved' || requestedStatus === 'Launched'
          ? actor.name || actor.role
          : body.adminApprovedBy,
      adminApprovedAt:
        requestedStatus === 'Approved' || requestedStatus === 'Launched'
          ? new Date().toISOString()
          : body.adminApprovedAt,
      recipientsCount: body.recipientsCount ?? recipients.length,
      sentCount: body.sentCount ?? 0,
      conversionsCount: body.conversionsCount ?? 0,
      revenueGenerated: body.revenueGenerated ?? 0,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, campaign, matchedRecipientsCount: recipients.length, campaigns: getAllCrmCampaigns(db) });
  });

  app.put('/api/crm/campaigns/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageCampaigns');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCrmCampaigns(db).find((c) => c.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    const incoming = req.body as Partial<CRMCampaign>;
    const isAdminOrApprovedRole =
      actor.role === 'super_admin' ||
      actor.role === 'admin' ||
      Boolean(actor.crmPermissions?.canApproveBulkMessages);
    if ((incoming.status === 'Approved' || incoming.status === 'Launched') && !isAdminOrApprovedRole) {
      res.status(403).json({ error: 'Only Administrators can approve or launch bulk campaigns.' });
      return;
    }
    const updated = upsertCrmCampaign(db, {
      ...existing,
      ...incoming,
      id: existing.id,
      adminApprovedBy:
        incoming.status === 'Approved' || incoming.status === 'Launched'
          ? actor.name || existing.adminApprovedBy
          : existing.adminApprovedBy,
      adminApprovedAt:
        incoming.status === 'Approved' || incoming.status === 'Launched'
          ? new Date().toISOString()
          : existing.adminApprovedAt,
    });
    res.json({ ok: true, campaign: updated, campaigns: getAllCrmCampaigns(db) });
  });

  // Loyalty Config, Redemption & Coupons
  app.get('/api/crm/loyalty', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const db = getDb();
    const config = getCrmLoyaltyConfig(db);
    if (actor.role === 'customer') {
      const accounts = getAllCrmLoyaltyAccounts(db).filter((a) => a.customerId === actor.customerId);
      const ledger = getAllCrmLoyaltyLedger(db, actor.customerId);
      const coupons = getAllCrmCoupons(db).filter((cp) => !cp.customerId || cp.customerId === actor.customerId);
      res.json({ ok: true, config, accounts, ledger, coupons });
      return;
    }
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager' && actor.role !== 'staff') {
      res.status(403).json({ error: 'Unauthorized.' });
      return;
    }
    res.json({
      ok: true,
      config,
      accounts: getAllCrmLoyaltyAccounts(db),
      ledger: getAllCrmLoyaltyLedger(db),
      coupons: getAllCrmCoupons(db),
    });
  });

  app.put('/api/crm/loyalty', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageLoyalty');
    if (!actor) return;
    const db = getDb();
    const current = getCrmLoyaltyConfig(db);
    const next: CRMLoyaltyConfig = { ...current, ...(req.body as Partial<CRMLoyaltyConfig>) };
    saveCrmLoyaltyConfig(db, next);
    res.json({ ok: true, config: next });
  });

  app.post('/api/crm/loyalty/redeem', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const { customerId, points, notes } = (req.body || {}) as {
      customerId?: string;
      points?: number;
      notes?: string;
    };
    const isOps = actor.role === 'super_admin' || actor.role === 'admin' || actor.role === 'manager';
    const targetCustId = customerId || actor.customerId;
    if (!targetCustId || (!isOps && actor.customerId !== targetCustId)) {
      res.status(403).json({ error: 'Unauthorized loyalty redemption target.' });
      return;
    }
    const pts = Math.round(Number(points || 0));
    if (pts <= 0) {
      res.status(400).json({ error: 'Points to redeem must be greater than 0.' });
      return;
    }

    const db = getDb();
    const accounts = getAllCrmLoyaltyAccounts(db);
    const acc = accounts.find((a) => a.customerId === targetCustId);
    if (!acc || acc.pointsBalance < pts) {
      res.status(400).json({ error: `Insufficient loyalty points (available: ${acc?.pointsBalance || 0}).` });
      return;
    }

    const cfg = getCrmLoyaltyConfig(db);
    const discountValue = Math.max(10, Math.round(pts * (cfg.pkrPerPoint || 1)));
    const code = `100D-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + (cfg.couponValidityDays || 30) * 86400000).toISOString();

    let updatedAccount;
    let coupon;
    db.exec('BEGIN IMMEDIATE;');
    try {
      updatedAccount = adjustCustomerLoyaltyPoints(db, {
        customerId: targetCustId,
        pointsDelta: -pts,
        type: 'redeemed',
        couponCode: code,
        notes: notes || `Redeemed ${pts} pts for Rs. ${discountValue} coupon`,
      });
      coupon = upsertCrmCoupon(db, {
        id: `cpn_${Date.now()}`,
        code,
        customerId: targetCustId,
        discountType: 'fixed',
        discountValue,
        reason: 'loyalty_redemption',
        status: 'active',
        expiresAt,
        createdAt: new Date().toISOString(),
      });
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Redemption failed.' });
      return;
    }

    res.json({ ok: true, account: updatedAccount, coupon });
  });

  app.post('/api/crm/coupons', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageLoyalty');
    if (!actor) return;
    const body = req.body as Partial<CRMLoyaltyCoupon>;
    if (!body?.code?.trim() || !Number.isFinite(Number(body.discountValue))) {
      res.status(400).json({ error: 'Coupon code and discount value are required.' });
      return;
    }
    const db = getDb();
    const normalizedCode = body.code.trim().toUpperCase();
    const existingCode = getAllCrmCoupons(db).find(
      (cp) => cp.code.toUpperCase() === normalizedCode && cp.id !== body.id
    );
    if (existingCode) {
      res.status(409).json({ error: `Coupon code "${normalizedCode}" already exists. Please use a unique code.` });
      return;
    }
    const coupon = upsertCrmCoupon(db, {
      id: body.id || `cpn_${Date.now()}`,
      code: normalizedCode,
      customerId: body.customerId,
      discountType: body.discountType || 'fixed',
      discountValue: Math.max(1, Number(body.discountValue)),
      minOrderAmount: body.minOrderAmount,
      reason: body.reason || 'manual_campaign',
      status: body.status || 'active',
      expiresAt: body.expiresAt,
      createdAt: body.createdAt || new Date().toISOString(),
    });
    res.json({ ok: true, coupon, coupons: getAllCrmCoupons(db) });
  });

  // Support & Complaint Tickets (with auto SLA dueAt)
  app.get('/api/crm/tickets', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageTickets');
    if (!actor) return;
    res.json({ ok: true, tickets: getAllCrmTickets() });
  });

  app.post('/api/crm/tickets', (req, res) => {
    const actor = resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const body = req.body as Partial<CRMSupportTicket>;
    if (!body?.subject?.trim()) {
      res.status(400).json({ error: 'Ticket subject is required.' });
      return;
    }
    const priority = body.priority || 'Medium';
    const slaHours = priority === 'Urgent' ? 4 : priority === 'High' ? 12 : priority === 'Low' ? 48 : 24;
    const nowMs = Date.now();
    const db = getDb();
    const ticket = upsertCrmTicket(db, {
      id: body.id || `tkt_${nowMs}_${Math.random().toString(36).slice(2, 5)}`,
      ticketNumber: body.ticketNumber || `TKT-100D-${String(nowMs).slice(-5)}`,
      customerId: body.customerId || actor.customerId,
      customerName: body.customerName || actor.name || 'Customer',
      customerPhone: body.customerPhone || actor.phone,
      orderId: body.orderId,
      orderNumber: body.orderNumber,
      category: body.category || 'Product Inquiry',
      priority,
      status: body.status || 'Open',
      assignedEmployeeId: body.assignedEmployeeId,
      assignedEmployeeName: body.assignedEmployeeName,
      subject: body.subject.trim(),
      description: body.description?.trim(),
      resolutionNotes: body.resolutionNotes?.trim(),
      dueAt: body.dueAt || new Date(nowMs + slaHours * 3600000).toISOString(),
      createdAt: body.createdAt || new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
    });
    res.json({ ok: true, ticket, tickets: getAllCrmTickets(db) });
  });

  app.put('/api/crm/tickets/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageTickets');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCrmTickets(db).find((t) => t.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Support ticket not found.' });
      return;
    }
    const updated = upsertCrmTicket(db, {
      ...existing,
      ...(req.body as Partial<CRMSupportTicket>),
      id: existing.id,
    });
    res.json({ ok: true, ticket: updated, tickets: getAllCrmTickets(db) });
  });

  // Retention Automation Engine (Dry Run, Idempotency Keys & Consent/Approval Guards)
  app.get('/api/crm/automation/rules', (req, res) => {
    const actor = requireCrmActor(req, res, 'canViewCrmDashboard');
    if (!actor) return;
    res.json({
      ok: true,
      rules: getAllCrmAutomationRules(),
      logs: getAllCrmAutomationLogs(),
    });
  });

  app.put('/api/crm/automation/rules/:id', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageAutomation');
    if (!actor) return;
    const db = getDb();
    const existing = getAllCrmAutomationRules(db).find((r) => r.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Automation rule not found.' });
      return;
    }
    const updated = upsertCrmAutomationRule(db, {
      ...existing,
      ...(req.body as Partial<typeof existing>),
      id: existing.id,
    });
    res.json({ ok: true, rule: updated, rules: getAllCrmAutomationRules(db) });
  });

  app.post('/api/crm/automation/run', (req, res) => {
    const actor = requireCrmActor(req, res, 'canManageFollowUps');
    if (!actor) return;
    const { ruleId, dryRun, approveBulk, adminApprovedBulk } = (req.body || {}) as {
      ruleId?: string;
      dryRun?: boolean;
      approveBulk?: boolean;
      adminApprovedBulk?: boolean;
    };
    const approvedBulkFlag = Boolean(approveBulk ?? adminApprovedBulk);
    const isAdmin =
      actor.role === 'super_admin' ||
      actor.role === 'admin' ||
      Boolean(actor.crmPermissions?.canApproveBulkMessages);
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const rules = getAllCrmAutomationRules(db).filter((r) => (ruleId ? r.id === ruleId : r.enabled));
    const todayStr = new Date().toISOString().split('T')[0];
    const monthKey = todayStr.slice(0, 7);
    const todayMmDd = todayStr.slice(5, 10);

    const previewMatches: Array<{
      ruleId: string;
      ruleName: string;
      customerId: string;
      customerName: string;
      customerPhone: string;
      idempotencyKey: string;
      alreadyExecuted: boolean;
      optedOut: boolean;
      renderedMessage: string;
    }> = [];

    let executedCount = 0;
    let skippedDuplicate = 0;
    let skippedOptOut = 0;
    let blockedBulkApproval = 0;

    for (const rule of rules) {
      if (!dryRun && rule.requiresAdminApproval && (!approvedBulkFlag || !isAdmin)) {
        blockedBulkApproval++;
        continue;
      }

      const matchedProfiles = bundle.profiles.filter((p) => {
        switch (rule.triggerType) {
          case 'after_first_order':
            return p.totalOrders === 1;
          case 'after_delivery':
            return p.deliveredCodCount >= 1;
          case 'review_request_after_delivery':
            return p.deliveredCodCount >= 1;
          case 'no_order_30_days':
            return (p.daysSinceLastOrder ?? 0) >= 30 && (p.daysSinceLastOrder ?? 0) < 60;
          case 'no_order_60_days':
            return (p.daysSinceLastOrder ?? 0) >= 60 && (p.daysSinceLastOrder ?? 0) < 90;
          case 'no_order_90_days':
            return (p.daysSinceLastOrder ?? 0) >= 90;
          case 'payment_due_soon':
            return p.outstandingBalance > 0;
          case 'payment_overdue':
            return p.outstandingBalance > 0;
          case 'abandoned_cart':
            return bundle.activityEvents.some(
              (e) =>
                (e.customerId === p.customer.id || (p.customer.phone && e.phone === p.customer.phone)) &&
                (e.eventType === 'cart_add' || e.eventType === 'product_inquiry' || e.eventType === 'cart_abandon')
            );
          case 'vip_threshold_reached':
            return p.totalPurchaseValue >= (rule.thresholdValue || 25000);
          case 'frequent_cod_returns':
            return p.returnedOrdersCount >= (rule.thresholdValue || 2);
          case 'birthday_or_anniversary':
            return Boolean(p.customer.birthday && p.customer.birthday.slice(5, 10) === todayMmDd);
          case 'back_in_stock_for_interested':
            return bundle.activityEvents.some(
              (e) =>
                e.customerId === p.customer.id &&
                e.eventType === 'product_inquiry' &&
                e.productId &&
                bundle.products.some((pr) => pr.id === e.productId && !pr.isUpcoming && pr.stockQty > 0)
            );
          default:
            return false;
        }
      });

      let ruleExecutions = 0;
      for (const p of matchedProfiles) {
        const periodKey = rule.triggerType === 'birthday_or_anniversary' ? todayStr : monthKey;
        const idempotencyKey = `${rule.id}:${p.customer.id}:${periodKey}`;
        const alreadyExecuted = hasCrmAutomationIdempotencyKey(db, idempotencyKey);
        const optedOut = Boolean(p.customer.whatsappOptOut);
        const renderedMessage = renderCrmWhatsAppTemplate(rule.templateType, {
          customerName: p.customer.name,
          productName: p.purchasedProducts[0]?.name || p.recommendedProducts[0]?.name || 'our latest catalog',
          balance: p.outstandingBalance,
          city: p.customer.city,
        });

        previewMatches.push({
          ruleId: rule.id,
          ruleName: rule.name,
          customerId: p.customer.id,
          customerName: p.customer.name,
          customerPhone: p.customer.phone,
          idempotencyKey,
          alreadyExecuted,
          optedOut,
          renderedMessage,
        });

        if (dryRun) continue;
        if (alreadyExecuted) {
          skippedDuplicate++;
          continue;
        }
        if (optedOut && rule.actionMode !== 'create_task') {
          skippedOptOut++;
          continue;
        }

        let createdTaskId: string | undefined;
        if (rule.actionMode === 'create_task' || rule.actionMode === 'both') {
          const fu = upsertCrmFollowUp(db, {
            id: `fu_auto_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            customerId: p.customer.id,
            customerName: p.customer.name,
            customerPhone: p.customer.phone,
            taskType: rule.actionMode === 'both' ? 'WhatsApp' : 'Call',
            title: `[Auto] ${rule.name}`,
            followUpDate: todayStr,
            assignedEmployeeId: p.customer.assignedSalespersonId || actor.id,
            assignedEmployeeName: p.customer.assignedSalespersonName || actor.name || 'CRM Team',
            priority: rule.triggerType === 'payment_overdue' || rule.triggerType === 'frequent_cod_returns' ? 'High' : 'Medium',
            notes: renderedMessage,
            status: 'Pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          createdTaskId = fu.id;
        }

        const inserted = insertCrmAutomationLog(db, {
          id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          triggerType: rule.triggerType,
          customerId: p.customer.id,
          customerName: p.customer.name,
          idempotencyKey,
          status: 'executed',
          actionSummary: `${rule.actionMode === 'queue_whatsapp' ? 'Queued WhatsApp template' : 'Created follow-up task'}${createdTaskId ? ` (${createdTaskId})` : ''}`,
          createdTaskId,
          createdAt: new Date().toISOString(),
        });
        if (inserted) {
          executedCount++;
          ruleExecutions++;
        }
      }

      if (!dryRun && ruleExecutions > 0) {
        upsertCrmAutomationRule(db, {
          ...rule,
          lastRunAt: new Date().toISOString(),
          totalTriggeredCount: (rule.totalTriggeredCount || 0) + ruleExecutions,
        });
      }
    }

    res.json({
      ok: true,
      dryRun: Boolean(dryRun),
      executedCount,
      skippedDuplicate,
      skippedOptOut,
      blockedBulkApproval,
      previewMatches: previewMatches.slice(0, 100),
      rules: getAllCrmAutomationRules(db),
      logs: getAllCrmAutomationLogs(db, 100),
    });
  });

  // Activity Event Telemetry (real product views, inquiries, cart adds, calls, WhatsApp opens)
  app.post('/api/crm/activity', (req, res) => {
    const actor = resolveActor(req);
    const body = (req.body || {}) as Partial<CRMActivityEvent>;
    const allowedPublicTypes = new Set(['product_view', 'product_inquiry', 'cart_add', 'cart_abandon']);
    const eventType = body.eventType || 'product_view';
    if (!allowedPublicTypes.has(eventType) && !actor.id) {
      res.status(401).json({ error: 'Authentication required for internal CRM activity events.' });
      return;
    }
    const db = getDb();
    const entry = insertCrmActivityEvent(db, {
      customerId: body.customerId || actor.customerId,
      phone: body.phone || actor.phone,
      eventType,
      productId: body.productId,
      productName: body.productName,
      category: body.category,
      orderNumber: body.orderNumber,
      amount: body.amount,
      notes: body.notes,
    });
    res.json({ ok: true, event: entry });
  });

  // CRM Reports & CSV / Excel (.xls) Exports
  app.get('/api/crm/reports/:reportKey', (req, res) => {
    const actor = requireCrmActor(req, res, 'canExportReports');
    if (!actor) return;
    const reportKey = req.params.reportKey as CRMReportKey;
    const meta = CRM_REPORT_CATALOG.find((r) => r.key === reportKey);
    if (!meta) {
      res.status(404).json({ error: `Unknown CRM report key: ${reportKey}` });
      return;
    }
    const db = getDb();
    const bundle = buildAllCustomer360Profiles(db);
    const leads = getAllCrmLeads(db);
    const campaigns = getAllCrmCampaigns(db);
    const monthlyExpenses = getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
    const dataset = generateCrmReportDataset({
      reportKey,
      profiles: bundle.profiles,
      leads,
      followUps: bundle.followUps,
      tickets: bundle.tickets,
      campaigns,
      resellers: bundle.resellers,
      transactions: bundle.transactions,
      products: bundle.products,
      monthlyExpenses,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
    });

    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="100dagar-${reportKey}.csv"`);
      res.send(buildCsvContent(dataset.columns, dataset.rows));
      return;
    }
    if (format === 'xls' || format === 'excel') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="100dagar-${reportKey}.xls"`);
      res.send(buildExcelHtmlContent(meta.title, dataset.columns, dataset.rows));
      return;
    }
    res.json({ ok: true, report: meta, ...dataset });
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
  let viteInstance: { close: () => Promise<void>; middlewares: express.RequestHandler } | null = null;

  const distDirCandidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, 'dist'),
  ];
  const distDir =
    distDirCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || distDirCandidates[0];
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.K_SERVICE) ||
    (process.env.NODE_ENV !== 'development' && hasBuiltDist);

  // Frontend middleware / static dist serving
  if (!isProduction || !hasBuiltDist) {
    const { createServer: createViteServer } = await import('vite');
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
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
    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(
      `100DAGAR Full-Stack Server running on http://${HOST}:${PORT} (${isProduction && hasBuiltDist ? 'production-dist' : 'vite-dev'})`
    );
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
