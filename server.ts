import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { NextFunction, Request, Response } from 'express';
import type {
  BusinessProfile,
  CategoryRecord,
  CODOrder,
  CRMActivityEvent,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMFollowUpTask,
  CRMLead,
  CRMLeadStage,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMPermissions,
  CRMRoleSpecialization,
  CRMSourceChannel,
  CRMSupportTicket,
  Customer,
  DeliveryCityConfig,
  Investor,
  InvestorProductOffering,
  InvestorProductRequest,
  InvestorTransaction,
  MonthlyExpense,
  ProductItem,
  Reseller,
  ReviewRewardSubmission,
  Transaction,
  UserAccount,
  UserRole,
} from './src/types/index.ts';
import {
  defaultBusinessProfile,
} from './src/utils/defaultData.ts';
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
} from './src/utils/locationCategoryHelpers.ts';
import {
  type ActorContext,
  adjustCustomerLoyaltyPoints,
  auditAndRepairOrderHistory,
  bumpCollectionVersion,
  checkDatabaseHealth,
  closeDb,
  createVerifiedBackup,
  type DbExecutor,
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
  getCachedServerSessionSecret,
  getCollectionValue,
  getCollectionVersionInfo,
  getCollectionVersions,
  getCrmLoyaltyConfig,
  getDb,
  getFullSyncState,
  getLastDailyBackupTimestamp,
  getSyncVersion,
  hasCrmAutomationIdempotencyKey,
  hashServerSecret,
  hashSingleSecretString,
  initDb,
  insertAdminAuditLog,
  insertCrmActivityEvent,
  insertCrmAutomationLog,
  listBackups,
  mergeCollectionArrayNonDestructively,
  mergeLocalSnapshotNonDestructively,
  replaceCitiesAndAreasFromList,
  resolveBackupFilePath,
  restoreBackupSnapshotNonDestructively,
  runDailyBackupIfNeeded,
  sanitizeAndValidateCollectionItemDates,
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
  withDbTransaction,
} from './src/server/db.ts';
import {
  hasRecordContentChanges,
  isDateValidationError,
  mergePreservingOmittedFields,
  resolvePreservedCreatedAt,
  resolveUpdatedAt,
  validateAndNormalizeDateOnly,
  validateAndNormalizeDateTime,
} from './src/server/dateUtils.ts';
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
} from './src/utils/crmEngine.ts';
import {
  downloadAndCacheExternalImage,
  IMPORTED_MEDIA_DIR,
  scrapeProductFromUrl,
} from './src/server/productScraper.ts';

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
const rawPort = (cliPort || envPort || process.env.DEFAULT_APP_PORT || '3000').trim();
const numericPort = Number(rawPort);
const isNamedSocket = !Number.isFinite(numericPort) || numericPort <= 0;
const PORT: number | string = isNamedSocket ? rawPort : numericPort;
const HOST = readCliArg('--host') || process.env.npm_config_host || process.env.HOST || '0.0.0.0';
function getSessionSecret(): string {
  return process.env.SESSION_SECRET?.trim() || getCachedServerSessionSecret();
}

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
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token?: string | null): SessionClaims | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  let expected: string;
  try {
    expected = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  } catch {
    return null;
  }
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionClaims;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SESSION_COOKIE_NAME = 'mm_session';

function parseCookieMap(cookieHeader?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        map.set(k, decodeURIComponent(v));
      } catch {
        map.set(k, v);
      }
    }
  }
  return map;
}

function isHttpsRequest(req: Request): boolean {
  const xfProto = req.header('x-forwarded-proto');
  return Boolean(req.secure || (xfProto && xfProto.toLowerCase().includes('https')));
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) {
    attrs.push('Secure', 'Partitioned');
  }
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) {
    attrs.push('Secure', 'Partitioned');
  }
  res.append('Set-Cookie', attrs.join('; '));
}

// Sliding-window brute-force protection for authentication & credential routes
const authAttemptsMap = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 10;

function checkAuthRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = authAttemptsMap.get(key);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= AUTH_MAX_FAILURES) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function recordAuthFailure(key: string): void {
  const now = Date.now();
  const entry = authAttemptsMap.get(key);
  if (!entry || now >= entry.resetAt) {
    authAttemptsMap.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearAuthFailures(key: string): void {
  authAttemptsMap.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authAttemptsMap.entries()) {
    if (now >= v.resetAt) authAttemptsMap.delete(k);
  }
}, 5 * 60 * 1000).unref();

interface ResolvedActor extends ActorContext {
  account?: UserAccount;
  username?: string;
  urduName?: string;
  whatsapp?: string;
  whatsappSameAsPhone?: boolean;
  email?: string;
  branchName?: string;
  managerAuthorities?: UserAccount['managerAuthorities'];
  canAuthorizeCreditSale?: boolean;
  mustChangePassword?: boolean;
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

async function resolveActor(req: Request): Promise<ResolvedActor> {
  const db = await getDb();
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const cookieToken = parseCookieMap(req.headers.cookie).get(SESSION_COOKIE_NAME);
  const token = bearer || req.header('x-session-token') || cookieToken;
  const claims = verifySessionToken(token);
  if (!claims) {
    return { role: undefined };
  }

  const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
  const account =
    accounts.find(
      (u) =>
        u.id === claims.userId ||
        (claims.role === 'customer' &&
          (u.id === `usr_cust_${claims.userId}` || u.linkedCustomerId === claims.userId)) ||
        (claims.role === 'reseller' && u.id === `usr_res_${claims.userId}`)
    ) ||
    (claims.role === 'super_admin'
      ? accounts.find((u) => u.role === 'super_admin' && u.status === 'active')
      : undefined);
  if (account) {
    if (account.status !== 'active') {
      return { role: undefined };
    }
    const role = account.role || claims.role;
    const basePerms = getDefaultCrmPermissionsForRole(role, account.crmRole);
    return {
      id: account.id,
      username: account.username,
      role,
      name: account.fullName || claims.name,
      urduName: account.urduName,
      customerId: account.linkedCustomerId,
      investorId: account.linkedInvestorId,
      resellerCode: account.linkedResellerCode,
      branchId: account.linkedBranchId,
      branchName: account.linkedBranchName,
      managerAuthorities: account.managerAuthorities,
      phone: account.phone,
      whatsapp: account.whatsapp || account.phone,
      whatsappSameAsPhone: account.whatsappSameAsPhone ?? true,
      email: account.email,
      canAuthorizeCreditSale:
        role === 'super_admin' ||
        role === 'admin' ||
        Boolean(account.canAuthorizeCreditSale ?? account.managerAuthorities?.canAuthorizeCreditSale),
      mustChangePassword: Boolean(account.mustChangePassword),
      account,
      crmRole: account.crmRole,
      crmPermissions: account.crmPermissions ? { ...basePerms, ...account.crmPermissions } : basePerms,
    };
  }

  if (
    claims.role === 'super_admin' &&
    claims.userId === 'usr_superadmin' &&
    !accounts.some((u) => u.role === 'super_admin')
  ) {
    return {
      id: 'usr_superadmin',
      username: 'admin',
      role: 'super_admin',
      name: claims.name || 'Shahzad Malik',
      urduName: 'شہزاد ملک (سپر ایڈمن)',
      phone: '03125256266',
      email: 'admin@madinamarket.pk',
      canAuthorizeCreditSale: true,
      crmRole: 'administrator',
      crmPermissions: getDefaultCrmPermissionsForRole('super_admin', 'administrator'),
    };
  }

  if (claims.role === 'customer') {
    const cust = (await getAllCustomersFromDb(db)).find((c) => c.id === claims.userId);
    if (!cust || cust.status === 'archived') return { role: undefined };
    return {
      id: cust.id,
      role: 'customer',
      name: cust.name,
      urduName: cust.urduName,
      customerId: cust.id,
      phone: cust.phone,
      whatsapp: cust.whatsapp || cust.phone,
      whatsappSameAsPhone: cust.whatsappSameAsPhone ?? true,
      email: cust.email,
      canAuthorizeCreditSale: false,
    };
  }

  if (claims.role === 'reseller') {
    const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
    const resAcc = resellers.find((r) => r.id === claims.userId);
    if (!resAcc || resAcc.status !== 'active') return { role: undefined };
    return {
      id: resAcc.id,
      role: 'reseller',
      name: resAcc.name,
      resellerCode: resAcc.referralCode,
      phone: resAcc.phone,
      canAuthorizeCreditSale: false,
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

const asyncRoute =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function sendRouteError(res: Response, err: unknown, fallbackMessage: string) {
  if (isDateValidationError(err) || (err as { statusCode?: number })?.statusCode === 400) {
    res.status(400).json({ error: err instanceof Error ? err.message : fallbackMessage });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : fallbackMessage });
}

async function startServer() {
  // Resilient startup: initialize database when available, but NEVER crash-loop Hostinger Node if MySQL warms up slowly
  let dbStartupError: string | null = null;
  let dailyBackupSchedulerStarted = false;

  const startDailyBackupScheduler = () => {
    if (dailyBackupSchedulerStarted) return;
    dailyBackupSchedulerStarted = true;
    void runDailyBackupIfNeeded();
    setInterval(() => {
      void runDailyBackupIfNeeded();
    }, 60 * 60 * 1000).unref();
  };

  try {
    const activeDb = await initDb();
    console.log(
      `[DB] Initialized driver=${activeDb.driver} env=${process.env.NODE_ENV || 'development'}`
    );
    startDailyBackupScheduler();
  } catch (initErr) {
    dbStartupError = initErr instanceof Error ? initErr.message : 'Database startup initialization failed.';
    console.error('[DB] Startup connection pending; HTTP server will stay online and retry:', dbStartupError);
    const retryTimer = setInterval(async () => {
      try {
        const activeDb = await initDb();
        dbStartupError = null;
        console.log(`[DB] Reconnected driver=${activeDb.driver}`);
        clearInterval(retryTimer);
        startDailyBackupScheduler();
      } catch (retryErr) {
        dbStartupError = retryErr instanceof Error ? retryErr.message : dbStartupError;
      }
    }, 15000);
    retryTimer.unref();
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '25mb' }));

  // Serve downloaded & verified imported product images cleanly from local server storage
  app.use('/api/media/imported', express.static(IMPORTED_MEDIA_DIR, { maxAge: '30d' }));

  // Allow safe cross-origin API requests from primary domain, subdomain, and Vercel previews
  const extraCorsOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const isAllowedCorsOrigin = (originHeader?: string): boolean => {
    if (!originHeader) return false;
    try {
      const parsed = new URL(originHeader);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'madinamarket.pk' ||
        hostname === 'www.madinamarket.pk' ||
        hostname === 'app.madinamarket.pk' ||
        hostname.endsWith('.madinamarket.pk') ||
        hostname.endsWith('.vercel.app') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
      ) {
        return true;
      }
      return extraCorsOrigins.has(originHeader.toLowerCase());
    } catch {
      return false;
    }
  };

  app.use('/api', (req, res, next) => {
    const reqOrigin = req.header('origin');
    if (reqOrigin && isAllowedCorsOrigin(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, x-session-token, x-client-id, x-requested-with'
      );
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }

    // CSRF mitigation for cookie-authenticated mutations
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
    if (isMutation) {
      const hasCookieSession = parseCookieMap(req.headers.cookie).has(SESSION_COOKIE_NAME);
      const hasCustomHeader = Boolean(
        req.header('x-client-id') ||
          req.header('x-requested-with') ||
          req.header('authorization') ||
          req.header('x-session-token')
      );
      if (hasCookieSession && !hasCustomHeader) {
        const originToCheck = reqOrigin || req.header('referer');
        let originAllowed = false;
        if (originToCheck) {
          try {
            const parsedOrigin = new URL(originToCheck);
            const host = (req.header('x-forwarded-host') || req.header('host') || '').toLowerCase();
            originAllowed =
              parsedOrigin.host.toLowerCase() === host || isAllowedCorsOrigin(parsedOrigin.origin);
          } catch {
            originAllowed = false;
          }
        }
        if (!originAllowed) {
          res.status(403).json({ error: 'Cross-site request rejected. Refresh the page and retry.' });
          return;
        }
      }
    }

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
  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      const health = await checkDatabaseHealth(dbStartupError);
      res.status(health.status === 'ok' ? 200 : 503).json(health);
    })
  );

  app.get(
    '/api/admin/backups',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can inspect database backups.' });
        return;
      }
      res.json({
        backups: listBackups(),
        schedule: {
          intervalHours: 24,
          lastDailyBackupAt: getLastDailyBackupTimestamp(),
        },
      });
    })
  );

  app.post(
    '/api/admin/backup',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can trigger database backups.' });
        return;
      }
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual_admin';
      const meta = await createVerifiedBackup(reason);
      res.json({ ok: true, backup: { ...meta, file: meta.jsonFile }, backups: listBackups() });
    })
  );

  app.get(
    '/api/admin/backups/:file/download',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can download server backups.' });
        return;
      }
      const resolved = resolveBackupFilePath(req.params.file);
      if (!resolved) {
        res.status(404).json({ error: 'Requested backup file was not found.' });
        return;
      }
      res.download(resolved, path.basename(resolved));
    })
  );

  app.get(
    '/api/admin/backup/export-live',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can export live database backups.' });
        return;
      }
      const meta = await createVerifiedBackup('manual_export');
      const resolved = resolveBackupFilePath(meta.jsonFile);
      if (!resolved) {
        res.status(500).json({ error: 'Failed to prepare verified live export.' });
        return;
      }
      res.download(resolved, `100DAGAR_Live_Backup_${new Date().toISOString().split('T')[0]}.json`);
    })
  );

  app.post(
    '/api/admin/backups/restore',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can restore database backups.' });
        return;
      }
      const { payload, dryRun = true } = (req.body || {}) as {
        payload?: Record<string, unknown>;
        dryRun?: boolean;
      };
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Backup JSON payload is required.' });
        return;
      }
      if (!dryRun) {
        await createVerifiedBackup('pre_manual_restore');
      }
      const summary = await restoreBackupSnapshotNonDestructively(payload, { dryRun: Boolean(dryRun) });
      if (!dryRun) {
        const db = await getDb();
        await insertAdminAuditLog(db, {
          action: 'restore_backup_non_destructive',
          entityType: 'database',
          entityId: 'snapshot_restore',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: summary.appliedCounts,
        });
        broadcastSyncEvent('all', req.header('x-client-id'));
      }
      res.json({ ok: true, summary, syncVersion: getSyncVersion() });
    })
  );

  // 2. REAL-TIME SSE STREAM FOR CROSS-DEVICE SYNC
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(
      `event: connected\ndata: ${JSON.stringify({ syncVersion: getSyncVersion(), collectionVersions: getCollectionVersions() })}\n\n`
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
  app.get(
    '/api/sync/state',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      const state = await getFullSyncState(actor);
      res.json({
        ...state,
        authenticatedActor: actor.id
          ? {
              id: actor.id,
              username: actor.username,
              role: actor.role,
              name: actor.name,
              urduName: actor.urduName,
              phone: actor.phone,
              whatsapp: actor.whatsapp,
              whatsappSameAsPhone: actor.whatsappSameAsPhone,
              email: actor.email,
              customerId: actor.customerId,
              investorId: actor.investorId,
              resellerCode: actor.resellerCode,
              branchId: actor.branchId,
              branchName: actor.branchName,
              managerAuthorities: actor.managerAuthorities,
              crmRole: actor.crmRole,
              crmPermissions: actor.crmPermissions,
              canAuthorizeCreditSale: actor.canAuthorizeCreditSale,
              mustChangePassword: actor.mustChangePassword,
              isAuthenticated: true,
            }
          : null,
      });
    })
  );

  app.post(
    '/api/sync/migrate-local',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can execute local database migrations.' });
        return;
      }
      const collections = (req.body?.collections || {}) as Record<string, unknown>;
      const { mergedCounts } = await mergeLocalSnapshotNonDestructively(collections);
      if (Object.keys(mergedCounts).length > 0) {
        broadcastSyncEvent('all', req.header('x-client-id'));
      }
      res.json({ ok: true, mergedCounts, syncVersion: getSyncVersion() });
    })
  );

  // 4. AUTHENTICATION & ACCOUNT SECURITY ENDPOINTS
  const TEMP_PASSWORD_TTL_MS = 30 * 60 * 1000;

  const generateTemporaryPassword = (length = 10): string => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;
    const chars: string[] = [
      upper[crypto.randomInt(0, upper.length)],
      lower[crypto.randomInt(0, lower.length)],
      digits[crypto.randomInt(0, digits.length)],
    ];
    while (chars.length < Math.max(8, length)) {
      chars.push(all[crypto.randomInt(0, all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  };

  const isTempPasswordExpired = (expiresAt?: string | null): boolean => {
    if (!expiresAt) return false;
    const ms = Date.parse(expiresAt);
    return Number.isFinite(ms) && Date.now() > ms;
  };

  const recordLoginAudit = async (
    db: DbExecutor,
    entry: {
      userId: string;
      userName: string;
      role: string;
      identifier: string;
      status: 'success' | 'failed' | 'locked';
      note?: string;
    }
  ) => {
    try {
      const list = await getCollectionValue<Array<Record<string, unknown>>>(db, 'login_audits', []);
      const next = [
        {
          id: `aud_lgn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...entry,
          timestamp: new Date().toISOString(),
        },
        ...list,
      ].slice(0, 300);
      await saveCollectionValue(db, 'login_audits', next);
    } catch {
      // ignore audit logging failure
    }
  };

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const { identifier, pin } = (req.body || {}) as { identifier?: string; pin?: string };
      const cleanId = normalizePhoneOrId(identifier || '');
      const cleanIdLower = (identifier || '').trim().toLowerCase();
      const cleanUsernameLookup = cleanIdLower.replace(/^@+/, '');
      const cleanPin = (pin || '').trim();

      if (!cleanId || !cleanPin) {
        res.status(400).json({ error: 'Identifier and PIN / password are required.' });
        return;
      }

      const rateKey = `login:${req.ip || 'unknown'}:${cleanUsernameLookup || cleanId}`;
      const rateIpKey = `login_ip:${req.ip || 'unknown'}`;
      const rl = checkAuthRateLimit(rateKey);
      const rlIp = checkAuthRateLimit(rateIpKey);
      if (!rl.allowed || !rlIp.allowed) {
        const retrySec = Math.max(rl.retryAfterSec, rlIp.retryAfterSec);
        res.setHeader('Retry-After', String(retrySec));
        res.status(429).json({
          error: `Too many failed sign-in attempts. Please wait ${Math.ceil(retrySec / 60)} minute(s) and try again.`,
        });
        return;
      }

      const db = await getDb();
      const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
      const superAdminAcc = accounts.find((u) => u.id === 'usr_superadmin' || u.role === 'super_admin');
      const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();

      const isSuperId =
        cleanId === '03125256266' ||
        cleanUsernameLookup === 'admin' ||
        cleanIdLower === 'admin@madinamarket.pk';
      if (isSuperId) {
        const matchesEnvMaster = Boolean(envMasterPin) && cleanPin === envMasterPin;
        const matchesStoredSuper = superAdminAcc
          ? verifyServerSecret(cleanPin, superAdminAcc.passwordHash, superAdminAcc.passwordSalt)
          : false;
        if (matchesEnvMaster || matchesStoredSuper) {
          clearAuthFailures(rateKey);
          clearAuthFailures(rateIpKey);
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
            await saveCollectionValue(db, 'user_accounts', nextAccounts);
          } else if (!superAdminAcc && matchesEnvMaster) {
            const hashed = hashServerSecret(cleanPin);
            const nowIso = new Date().toISOString();
            const bootstrappedAdmin: UserAccount = {
              id: 'usr_superadmin',
              username: 'admin',
              fullName: 'Shahzad Malik',
              urduName: 'شہزاد ملک (سپر ایڈمن)',
              phone: '03125256266',
              email: 'admin@madinamarket.pk',
              role: 'super_admin',
              crmRole: 'administrator',
              passwordHash: hashed.hash,
              passwordSalt: hashed.salt,
              status: 'active',
              canAuthorizeCreditSale: true,
              createdAt: nowIso,
              lastLoginAt: nowIso,
            };
            await saveCollectionValue(db, 'user_accounts', [bootstrappedAdmin, ...accounts]);
          }
          const perms = getDefaultCrmPermissionsForRole('super_admin', 'administrator');
          const userObj = {
            id: superAdminAcc?.id || 'usr_superadmin',
            username: superAdminAcc?.username || 'admin',
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
          setSessionCookie(req, res, sessionToken);
          await recordLoginAudit(db, {
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
          (u.username && u.username.toLowerCase() === cleanUsernameLookup) ||
          (u.email && u.email.toLowerCase() === cleanIdLower)
      );

      for (const acc of matchingAccounts) {
        const validHash = verifyServerSecret(cleanPin, acc.passwordHash, acc.passwordSalt);
        if (validHash) {
          if (acc.status !== 'active') {
            await recordLoginAudit(db, {
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
          if (acc.isTemporaryPassword && isTempPasswordExpired(acc.temporaryPasswordExpiresAt)) {
            await recordLoginAudit(db, {
              userId: acc.id,
              userName: acc.fullName,
              role: acc.role,
              identifier: cleanId,
              status: 'failed',
              note: 'Expired 30-minute temporary password attempt',
            });
            res.status(401).json({
              error:
                'This temporary password has expired (valid for 30 minutes). Please request a new temporary password from Store Admin or Support.',
            });
            return;
          }
          clearAuthFailures(rateKey);
          clearAuthFailures(rateIpKey);
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
            await saveCollectionValue(db, 'user_accounts', nextAccounts);
          }
          const crmPerms = acc.crmPermissions
            ? { ...getDefaultCrmPermissionsForRole(acc.role, acc.crmRole), ...acc.crmPermissions }
            : getDefaultCrmPermissionsForRole(acc.role, acc.crmRole);
          const userObj = {
            id: acc.id,
            username: acc.username,
            name: acc.fullName,
            urduName: acc.urduName,
            phone: acc.phone,
            whatsapp: acc.whatsapp || acc.phone,
            whatsappSameAsPhone: acc.whatsappSameAsPhone ?? true,
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
            temporaryPasswordExpiresAt: acc.temporaryPasswordExpiresAt,
            isAuthenticated: true,
          };
          const sessionToken = signSessionToken({ userId: acc.id, role: acc.role, name: acc.fullName });
          setSessionCookie(req, res, sessionToken);
          await recordLoginAudit(db, {
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

      const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
      const matchedReseller = resellers.find(
        (r) => normalizePhoneOrId(r.phone) === cleanId || r.referralCode.toLowerCase() === cleanIdLower
      );
      if (matchedReseller && matchedReseller.pin) {
        const validPin = verifyServerSecret(cleanPin, matchedReseller.pin);
        if (validPin) {
          if (matchedReseller.status !== 'active') {
            res.status(403).json({ error: 'Reseller account is inactive.' });
            return;
          }
          clearAuthFailures(rateKey);
          clearAuthFailures(rateIpKey);
          if (!matchedReseller.pin?.startsWith('scrypt:')) {
            const hashedPin = hashSingleSecretString(cleanPin);
            const nextResellers = resellers.map((r) =>
              r.id === matchedReseller.id ? { ...r, pin: hashedPin } : r
            );
            await saveCollectionValue(db, 'resellers', nextResellers);
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
          setSessionCookie(req, res, sessionToken);
          await recordLoginAudit(db, {
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

      const customers = await getAllCustomersFromDb(db);
      const matchedCustomer = customers.find(
        (c) =>
          normalizePhoneOrId(c.phone) === cleanId ||
          c.id === cleanId ||
          (c.email && c.email.toLowerCase() === cleanIdLower)
      );
      if (matchedCustomer && matchedCustomer.pin) {
        const validPin = verifyServerSecret(cleanPin, matchedCustomer.pin);
        if (validPin) {
          if (matchedCustomer.status === 'archived') {
            res.status(403).json({ error: 'Customer account is archived.' });
            return;
          }
          clearAuthFailures(rateKey);
          clearAuthFailures(rateIpKey);
          if (!matchedCustomer.pin?.startsWith('scrypt:')) {
            const hashedPin = hashSingleSecretString(cleanPin);
            await upsertCustomerRow(db, { ...matchedCustomer, pin: hashedPin });
          }
          const userObj = {
            id: matchedCustomer.id,
            name: matchedCustomer.name,
            urduName: matchedCustomer.urduName,
            phone: matchedCustomer.phone,
            whatsapp: matchedCustomer.whatsapp || matchedCustomer.phone,
            whatsappSameAsPhone: matchedCustomer.whatsappSameAsPhone ?? true,
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
          setSessionCookie(req, res, sessionToken);
          await recordLoginAudit(db, {
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

      recordAuthFailure(rateKey);
      recordAuthFailure(rateIpKey);
      await recordLoginAudit(db, {
        userId: 'unknown',
        userName: cleanId,
        role: 'unknown',
        identifier: cleanId,
        status: 'failed',
        note: 'Invalid PIN/password attempt',
      });
      res.status(401).json({ error: 'Invalid phone/ID or PIN.' });
    })
  );

  app.post(
    '/api/auth/logout',
    asyncRoute(async (req, res) => {
      clearSessionCookie(req, res);
      res.json({ ok: true });
    })
  );

  const handleCustomerRegistration = async (req: Request, res: Response) => {
    const regRlKey = `reg:${req.ip || 'unknown'}`;
    const regRl = checkAuthRateLimit(regRlKey);
    if (!regRl.allowed) {
      res.setHeader('Retry-After', String(regRl.retryAfterSec));
      res.status(429).json({
        error: `Too many registration requests. Please try again in ${Math.ceil(regRl.retryAfterSec / 60)} minute(s).`,
      });
      return;
    }

    const db = await getDb();
    const bp = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (bp.loginFormConfig?.allowSelfRegistration === false) {
      res.status(403).json({ error: 'Self-registration is currently disabled. Please contact store admin.' });
      return;
    }

    const {
      name,
      fullName,
      username,
      phone,
      email,
      city,
      address,
      whatsappSameAsPhone,
      whatsapp,
      pin,
      generateTempPassword,
    } = (req.body || {}) as {
      name?: string;
      fullName?: string;
      username?: string;
      phone?: string;
      email?: string;
      city?: string;
      address?: string;
      whatsappSameAsPhone?: boolean;
      whatsapp?: string;
      pin?: string;
      generateTempPassword?: boolean;
    };

    const cleanName = (name || fullName || '').trim();
    const cleanUsernameInput = (username || '').trim().replace(/^@+/, '').toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const sameAsPhone = whatsappSameAsPhone !== false;
    const cleanWhatsappInput = (whatsapp || '').trim();
    const resolvedWhatsapp = sameAsPhone ? cleanPhone : cleanWhatsappInput;
    const cleanPin = (pin || '').trim();

    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
      return;
    }
    if (cleanUsernameInput && !/^[a-z0-9_.-]{3,32}$/.test(cleanUsernameInput)) {
      res.status(400).json({
        error: 'Username must be 3 to 32 characters using only letters, numbers, underscores, dots, or hyphens.',
      });
      return;
    }
    if (cleanPhone.replace(/\D/g, '').length < 10) {
      res.status(400).json({ error: 'Please enter a valid mobile number (at least 10 digits).' });
      return;
    }
    if (!sameAsPhone && resolvedWhatsapp.replace(/\D/g, '').length < 10) {
      res.status(400).json({
        error: 'Please enter a valid WhatsApp number (at least 10 digits) for notifications.',
      });
      return;
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const shouldGenerateTemp = generateTempPassword !== false || !cleanPin;
    if (!shouldGenerateTemp && cleanPin.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      return;
    }

    const normPhone = normalizePhoneDigits(cleanPhone);
    const existingCustomers = await getAllCustomersFromDb(db);
    const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);

    const dupCust = existingCustomers.find((c) => normalizePhoneDigits(c.phone) === normPhone);
    const dupAccPhone = accounts.find((u) => normalizePhoneDigits(u.phone) === normPhone);
    if (dupCust || dupAccPhone) {
      res.status(409).json({
        error: 'An account with this mobile number already exists. Please sign in or contact support.',
      });
      return;
    }

    if (cleanUsernameInput) {
      const dupUsername = accounts.find((u) => u.username?.toLowerCase() === cleanUsernameInput);
      if (dupUsername) {
        res.status(409).json({
          error: `Username "@${cleanUsernameInput}" is already taken. Please choose another username.`,
        });
        return;
      }
    }

    if (cleanEmail) {
      const dupEmailCust = existingCustomers.find(
        (c) => c.email && c.email.trim().toLowerCase() === cleanEmail
      );
      const dupEmailAcc = accounts.find((u) => u.email && u.email.trim().toLowerCase() === cleanEmail);
      if (dupEmailCust || dupEmailAcc) {
        res.status(409).json({
          error: 'An account with this email address already exists. Please sign in or contact support.',
        });
        return;
      }
    }

    const resolvedUsername = cleanUsernameInput || normPhone || cleanPhone;
    const effectiveSecret = shouldGenerateTemp ? generateTemporaryPassword(10) : cleanPin;
    const tempPasswordExpiresAt = shouldGenerateTemp
      ? new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString()
      : undefined;
    const now = new Date().toISOString();
    const custId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newCust: Customer = {
      id: custId,
      name: cleanName,
      phone: cleanPhone,
      whatsapp: resolvedWhatsapp,
      whatsappSameAsPhone: sameAsPhone,
      whatsappConsent: true,
      email: cleanEmail || undefined,
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

    const hashed = hashServerSecret(effectiveSecret);
    const accId = `usr_cust_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const newAccount: UserAccount = {
      id: accId,
      fullName: cleanName,
      username: resolvedUsername,
      phone: cleanPhone,
      whatsapp: resolvedWhatsapp,
      whatsappSameAsPhone: sameAsPhone,
      email: cleanEmail || undefined,
      role: 'customer',
      status: 'active',
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      mustChangePassword: shouldGenerateTemp,
      isTemporaryPassword: shouldGenerateTemp,
      temporaryPasswordExpiresAt: tempPasswordExpiresAt,
      linkedCustomerId: custId,
      createdAt: now,
      createdBy: 'self_registration',
    };

    await upsertCustomerRow(db, newCust);
    await saveCollectionValue(db, 'user_accounts', [...accounts, newAccount]);
    await insertCrmActivityEvent(db, {
      customerId: custId,
      phone: cleanPhone,
      eventType: 'note_added',
      notes: `Customer self-registered via portal (@${resolvedUsername}). Notification WhatsApp: ${resolvedWhatsapp}${
        cleanEmail ? ` | Email: ${cleanEmail}` : ''
      }${shouldGenerateTemp ? ' (30-min random temporary password issued)' : ''}`,
    });

    const userObj = {
      id: accId,
      username: resolvedUsername,
      name: cleanName,
      phone: cleanPhone,
      whatsapp: resolvedWhatsapp,
      whatsappSameAsPhone: sameAsPhone,
      email: cleanEmail || undefined,
      role: 'customer',
      customerId: custId,
      canAuthorizeCreditSale: false,
      mustChangePassword: shouldGenerateTemp,
      temporaryPasswordExpiresAt: tempPasswordExpiresAt,
      isAuthenticated: true,
    };
    const sessionToken = signSessionToken({ userId: accId, role: 'customer', name: cleanName });
    setSessionCookie(req, res, sessionToken);
    recordAuthFailure(`reg:${req.ip || 'unknown'}`);
    broadcastSyncEvent('customers', req.header('x-client-id'));
    res.json({
      ok: true,
      user: userObj,
      customer: newCust,
      username: resolvedUsername,
      sessionToken,
      temporaryPassword: shouldGenerateTemp ? effectiveSecret : undefined,
      temporaryPasswordExpiresAt: tempPasswordExpiresAt,
      whatsappNumber: resolvedWhatsapp,
      email: cleanEmail || undefined,
    });
  };

  app.post('/api/auth/register-customer', asyncRoute(handleCustomerRegistration));
  app.post('/api/account/register', asyncRoute(handleCustomerRegistration));

  const validateAndNormalizeUsername = (raw: string): string | null => {
    const clean = raw.trim().replace(/^@+/, '').toLowerCase();
    if (!clean || !/^[a-z0-9_.-]{3,32}$/.test(clean)) return null;
    return clean;
  };

  const handleChangeOwnPassword = async (req: Request, res: Response) => {
    const actor = await resolveActor(req);
    if (!actor.id) {
      res.status(401).json({ error: 'Authentication required. Please sign in again.' });
      return;
    }
    const body = (req.body || {}) as {
      currentPin?: string;
      newPin?: string;
      currentCode?: string;
      newCode?: string;
      username?: string;
    };
    const cur = String(body.currentPin ?? body.currentCode ?? '').trim();
    const next = String(body.newPin ?? body.newCode ?? '').trim();
    const requestedUsernameRaw = typeof body.username === 'string' ? body.username.trim() : '';

    if (!cur || next.length < 4) {
      res.status(400).json({ error: 'Current password/PIN and a new password/PIN (at least 4 characters) are required.' });
      return;
    }

    let nextUsername: string | undefined;
    if (requestedUsernameRaw) {
      const normalized = validateAndNormalizeUsername(requestedUsernameRaw);
      if (!normalized) {
        res.status(400).json({
          error: 'Username must be 3 to 32 characters (letters, numbers, underscore, dot, or hyphen).',
        });
        return;
      }
      nextUsername = normalized;
    }

    const db = await getDb();
    const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    if (nextUsername) {
      const conflictAcc = accounts.find(
        (u) => u.id !== actor.id && u.username?.toLowerCase() === nextUsername
      );
      if (conflictAcc) {
        res.status(409).json({ error: `Username "@${nextUsername}" is already in use.` });
        return;
      }
    }

    const acc = accounts.find(
      (u) =>
        u.id === actor.id ||
        (actor.role === 'customer' &&
          (u.id === `usr_cust_${actor.id}` ||
            (actor.customerId && u.linkedCustomerId === actor.customerId))) ||
        (actor.role === 'reseller' && u.id === `usr_res_${actor.id}`)
    );
    if (acc) {
      const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();
      const verified =
        verifyServerSecret(cur, acc.passwordHash, acc.passwordSalt) ||
        (acc.role === 'super_admin' && Boolean(envMasterPin) && cur === envMasterPin);
      if (!verified) {
        res.status(403).json({ error: 'Current PIN / password is incorrect.' });
        return;
      }
      if (acc.isTemporaryPassword && isTempPasswordExpired(acc.temporaryPasswordExpiresAt)) {
        res.status(403).json({
          error:
            'Your temporary password has expired (valid for 30 minutes). Please ask an administrator to issue a new temporary password.',
        });
        return;
      }
      const hashed = hashServerSecret(next);
      const nextAccounts = accounts.map((u) =>
        u.id === acc.id
          ? {
              ...u,
              username: nextUsername || u.username,
              passwordHash: hashed.hash,
              passwordSalt: hashed.salt,
              isTemporaryPassword: false,
              mustChangePassword: false,
              temporaryPasswordExpiresAt: undefined,
            }
          : u
      );
      await saveCollectionValue(db, 'user_accounts', nextAccounts);
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      res.json({ ok: true, username: nextUsername || acc.username });
      return;
    }

    if (actor.role === 'customer' && actor.customerId) {
      const cust = (await getAllCustomersFromDb(db)).find((c) => c.id === actor.customerId);
      if (!cust) {
        res.status(404).json({ error: 'Customer profile not found.' });
        return;
      }
      const digits = cust.phone.replace(/\D/g, '');
      const fallback = digits.length >= 6 ? digits.slice(-6) : '123456';
      const okCur = cust.pin ? verifyServerSecret(cur, cust.pin) || cur === cust.pin : cur === fallback;
      if (!okCur) {
        res.status(403).json({ error: 'Current PIN / password is incorrect.' });
        return;
      }
      const hashed = hashServerSecret(next);
      const resolvedUsername = nextUsername || normalizePhoneDigits(cust.phone) || cust.id;
      const newAcc: UserAccount = {
        id: `usr_cust_${cust.id}`,
        fullName: cust.name,
        username: resolvedUsername,
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
      await upsertCustomerRow(db, cleanCust);
      await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      res.json({ ok: true, username: resolvedUsername });
      return;
    }

    if (actor.role === 'reseller') {
      const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
      const resAcc = resellers.find((r) => r.id === actor.id);
      if (!resAcc) {
        res.status(404).json({ error: 'Reseller profile not found.' });
        return;
      }
      const digits = resAcc.phone.replace(/\D/g, '');
      const fallback = digits.length >= 6 ? digits.slice(-6) : '123456';
      const okCur = resAcc.pin ? verifyServerSecret(cur, resAcc.pin) || cur === resAcc.pin : cur === fallback;
      if (!okCur) {
        res.status(403).json({ error: 'Current PIN / password is incorrect.' });
        return;
      }
      const hashedSingle = hashSingleSecretString(next);
      const updatedResellers = resellers.map((r) => (r.id === resAcc.id ? { ...r, pin: hashedSingle } : r));
      await saveCollectionValue(db, 'resellers', updatedResellers);
      if (nextUsername) {
        const hashed = hashServerSecret(next);
        const newAcc: UserAccount = {
          id: `usr_res_${resAcc.id}`,
          fullName: resAcc.name,
          username: nextUsername,
          phone: resAcc.phone,
          role: 'reseller',
          status: 'active',
          passwordHash: hashed.hash,
          passwordSalt: hashed.salt,
          linkedResellerCode: resAcc.referralCode,
          createdAt: new Date().toISOString(),
          createdBy: resAcc.id,
        };
        await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
      }
      broadcastSyncEvent('resellers', req.header('x-client-id'));
      res.json({ ok: true, username: nextUsername });
      return;
    }

    res.status(404).json({ error: 'User account not found.' });
  };

  app.post('/api/auth/change-password', asyncRoute(handleChangeOwnPassword));
  app.post('/api/account/pin-update', asyncRoute(handleChangeOwnPassword));

  const handleChangeMasterPin = async (req: Request, res: Response) => {
    const actor = await resolveActor(req);
    if (actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only the Super Admin can update the Master PIN.' });
      return;
    }
    const body = (req.body || {}) as {
      currentPin?: string;
      newPin?: string;
      currentCode?: string;
      newCode?: string;
    };
    const cur = String(body.currentPin ?? body.currentCode ?? '').trim();
    const next = String(body.newPin ?? body.newCode ?? '').trim();
    if (!cur || next.length < 4) {
      res.status(400).json({ error: 'Current Master PIN and new Master PIN (min 4 characters) are required.' });
      return;
    }

    const db = await getDb();
    const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
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
      await saveCollectionValue(db, 'user_accounts', updated);
    }
    await insertAdminAuditLog(db, {
      action: 'change_master_pin',
      entityType: 'security',
      entityId: 'usr_superadmin',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
    });
    broadcastSyncEvent('user_accounts', req.header('x-client-id'));
    res.json({ ok: true });
  };

  app.post('/api/auth/change-master-pin', asyncRoute(handleChangeMasterPin));
  app.post('/api/account/master-update', asyncRoute(handleChangeMasterPin));

  const handleAdminResetPassword = async (req: Request, res: Response) => {
    const actor = await resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can reset user credentials.' });
      return;
    }
    const body = (req.body || {}) as {
      targetId?: string;
      id?: string;
      username?: string;
      newPin?: string;
      tempPin?: string;
      code?: string;
      mode?: 'temporary' | 'custom_permanent';
    };
    const lookupKey = String(req.params.id || body.targetId || body.id || body.username || '').trim();
    const lookupLower = lookupKey.replace(/^@+/, '').toLowerCase();
    const lookupNormPhone = normalizePhoneOrId(lookupKey);
    const rawPin = String(body.newPin || body.tempPin || body.code || '').trim();
    const isCustomPermanent = body.mode === 'custom_permanent' && rawPin.length >= 4;
    const isTemporary = !isCustomPermanent;
    const effectivePin = isCustomPermanent ? rawPin : rawPin || generateTemporaryPassword(10);
    const expiresAt = isTemporary ? new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString() : undefined;

    if (!lookupKey) {
      res.status(400).json({ error: 'Target user ID or username is required.' });
      return;
    }
    if (effectivePin.length < 4) {
      res.status(400).json({ error: 'Password / PIN must be at least 4 characters.' });
      return;
    }

    const db = await getDb();
    const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    const target = accounts.find(
      (u) =>
        u.id === lookupKey ||
        u.linkedCustomerId === lookupKey ||
        u.id === `usr_cust_${lookupKey}` ||
        u.id === `usr_res_${lookupKey}` ||
        u.username?.toLowerCase() === lookupLower ||
        normalizePhoneOrId(u.phone) === lookupNormPhone
    );
    if (target) {
      if (target.role === 'super_admin' && actor.role !== 'super_admin') {
        res.status(403).json({ error: 'Only Super Admin can reset the Super Admin PIN.' });
        return;
      }
      const hashed = hashServerSecret(effectivePin);
      const updated = accounts.map((u) =>
        u.id === target.id
          ? {
              ...u,
              passwordHash: hashed.hash,
              passwordSalt: hashed.salt,
              isTemporaryPassword: isTemporary,
              mustChangePassword: isTemporary,
              temporaryPasswordExpiresAt: expiresAt,
              suggestedDefaultPin: undefined,
            }
          : u
      );
      await saveCollectionValue(db, 'user_accounts', updated);

      if (target.linkedCustomerId) {
        const linkedCust = (await getAllCustomersFromDb(db)).find((c) => c.id === target.linkedCustomerId);
        if (linkedCust && linkedCust.pin) {
          const cleanCust = { ...linkedCust };
          delete cleanCust.pin;
          await upsertCustomerRow(db, cleanCust);
        }
      }

      await insertAdminAuditLog(db, {
        action: isTemporary ? 'admin_issue_temp_password' : 'admin_set_custom_pin',
        entityType: 'user_account',
        entityId: target.id,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        details: { targetUsername: target.username, targetRole: target.role, expiresAt },
      });
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      res.json({
        ok: true,
        tempPin: effectivePin,
        isTemporary,
        expiresAt,
        username: target.username,
      });
      return;
    }

    // Create/link authoritative UserAccount when resetting a Customer or Reseller who did not have one yet
    const customers = await getAllCustomersFromDb(db);
    const cust = customers.find(
      (c) => c.id === lookupKey || normalizePhoneOrId(c.phone) === lookupNormPhone
    );
    if (cust) {
      const hashed = hashServerSecret(effectivePin);
      const resolvedUsername = normalizePhoneDigits(cust.phone) || cust.id;
      const newAcc: UserAccount = {
        id: `usr_cust_${cust.id}`,
        fullName: cust.name,
        urduName: cust.urduName,
        username: resolvedUsername,
        phone: cust.phone,
        whatsapp: cust.whatsapp || cust.phone,
        whatsappSameAsPhone: cust.whatsappSameAsPhone ?? true,
        email: cust.email,
        role: 'customer',
        status: 'active',
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        isTemporaryPassword: isTemporary,
        mustChangePassword: isTemporary,
        temporaryPasswordExpiresAt: expiresAt,
        linkedCustomerId: cust.id,
        createdAt: new Date().toISOString(),
        createdBy: actor.id || 'admin',
      };
      const cleanCust = { ...cust };
      delete cleanCust.pin;
      await upsertCustomerRow(db, cleanCust);
      await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
      await insertAdminAuditLog(db, {
        action: isTemporary ? 'admin_issue_customer_temp_password' : 'admin_set_customer_pin',
        entityType: 'customer',
        entityId: cust.id,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        details: { expiresAt },
      });
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({
        ok: true,
        tempPin: effectivePin,
        isTemporary,
        expiresAt,
        username: resolvedUsername,
      });
      return;
    }

    const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
    const resAcc = resellers.find(
      (r) =>
        r.id === lookupKey ||
        r.referralCode.toLowerCase() === lookupLower ||
        normalizePhoneOrId(r.phone) === lookupNormPhone
    );
    if (resAcc) {
      const hashed = hashServerSecret(effectivePin);
      const resolvedUsername = resAcc.referralCode.toLowerCase() || normalizePhoneDigits(resAcc.phone) || resAcc.id;
      const newAcc: UserAccount = {
        id: `usr_res_${resAcc.id}`,
        fullName: resAcc.name,
        urduName: resAcc.urduName,
        username: resolvedUsername,
        phone: resAcc.phone,
        role: 'reseller',
        status: resAcc.status === 'active' ? 'active' : 'inactive',
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        isTemporaryPassword: isTemporary,
        mustChangePassword: isTemporary,
        temporaryPasswordExpiresAt: expiresAt,
        linkedResellerCode: resAcc.referralCode,
        createdAt: new Date().toISOString(),
        createdBy: actor.id || 'admin',
      };
      const hashedSingle = hashSingleSecretString(effectivePin);
      const updatedResellers = resellers.map((r) => (r.id === resAcc.id ? { ...r, pin: hashedSingle } : r));
      await saveCollectionValue(db, 'resellers', updatedResellers);
      await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
      await insertAdminAuditLog(db, {
        action: isTemporary ? 'admin_issue_reseller_temp_password' : 'admin_set_reseller_pin',
        entityType: 'reseller',
        entityId: resAcc.id,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        details: { expiresAt },
      });
      broadcastSyncEvent('user_accounts', req.header('x-client-id'));
      broadcastSyncEvent('resellers', req.header('x-client-id'));
      res.json({
        ok: true,
        tempPin: effectivePin,
        isTemporary,
        expiresAt,
        username: resolvedUsername,
      });
      return;
    }

    res.status(404).json({ error: 'User account not found.' });
  };

  app.post('/api/admin/users/:id/reset-password', asyncRoute(handleAdminResetPassword));
  app.post('/api/account/admin-pin-update', asyncRoute(handleAdminResetPassword));

  const handleAdminCreateUser = async (req: Request, res: Response) => {
    const actor = await resolveActor(req);
    if (actor.role !== 'super_admin' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can create user accounts.' });
      return;
    }
    const body = (req.body || {}) as {
      fullName?: string;
      username?: string;
      phone?: string;
      email?: string;
      role?: UserRole;
      canAuthorizeCreditSale?: boolean;
      crmRole?: CRMRoleSpecialization;
      crmPermissions?: CRMPermissions;
      customPin?: string;
      customPassword?: string;
      autoGenerateTemp?: boolean;
    };
    const cleanFullName = String(body.fullName || '').trim();
    const cleanPhone = String(body.phone || '').trim().replace(/[\s-]/g, '');
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const normalizedUsername = validateAndNormalizeUsername(String(body.username || ''));
    const requestedRole = body.role || 'customer';

    if (!cleanPhone || !normalizedUsername) {
      res.status(400).json({
        error: 'Phone number and a valid username (3–32 letters, numbers, _, ., or -) are required.',
      });
      return;
    }
    if (requestedRole === 'super_admin') {
      res.status(403).json({ error: 'Cannot create additional Super Admin accounts.' });
      return;
    }

    const customPin = String(body.customPassword || body.customPin || '').trim();
    const useRandomTemp = body.autoGenerateTemp === true || !customPin;
    if (!useRandomTemp && customPin.length < 4) {
      res.status(400).json({ error: 'Custom password / PIN must be at least 4 characters.' });
      return;
    }

    const db = await getDb();
    const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
    if (accounts.some((u) => u.username?.toLowerCase() === normalizedUsername)) {
      res.status(409).json({ error: `Username "@${normalizedUsername}" is already taken.` });
      return;
    }

    const effectivePin = useRandomTemp ? generateTemporaryPassword(10) : customPin;
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
    const hashed = hashServerSecret(effectivePin);
    const isSellerRole = requestedRole === 'admin' || requestedRole === 'manager' || requestedRole === 'staff';
    const allowCredit = requestedRole === 'admin' || (isSellerRole && Boolean(body.canAuthorizeCreditSale));
    const now = new Date().toISOString();

    const newAcc: UserAccount = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username: normalizedUsername,
      fullName: cleanFullName || `User ${normalizedUsername}`,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      role: requestedRole,
      status: 'active',
      canAuthorizeCreditSale: allowCredit,
      crmRole: isSellerRole ? body.crmRole : undefined,
      crmPermissions: isSellerRole ? body.crmPermissions : undefined,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      mustChangePassword: true,
      isTemporaryPassword: true,
      temporaryPasswordExpiresAt: expiresAt,
      createdAt: now,
      createdBy: actor.id || 'admin',
      loginCount: 0,
    };

    await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
    await insertAdminAuditLog(db, {
      action: 'admin_create_user',
      entityType: 'user_account',
      entityId: newAcc.id,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      details: { username: newAcc.username, role: newAcc.role, expiresAt },
    });
    broadcastSyncEvent('user_accounts', req.header('x-client-id'));

    const { passwordHash: _ph, passwordSalt: _ps, ...safeUser } = newAcc;
    res.json({
      ok: true,
      user: safeUser,
      tempPin: effectivePin,
      temporaryPassword: effectivePin,
      isTemporary: true,
      expiresAt,
      temporaryPasswordExpiresAt: expiresAt,
    });
  };

  app.post('/api/admin/users', asyncRoute(handleAdminCreateUser));
  app.post('/api/account/admin-user-create', asyncRoute(handleAdminCreateUser));

  app.post(
    '/api/account/username-update',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const nextUsername = validateAndNormalizeUsername(String(req.body?.username || ''));
      if (!nextUsername) {
        res.status(400).json({
          error: 'Username must be 3 to 32 characters (letters, numbers, underscore, dot, or hyphen).',
        });
        return;
      }

      const db = await getDb();
      const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
      const existingAcc = accounts.find(
        (u) =>
          u.id === actor.id ||
          (actor.role === 'customer' &&
            (u.id === `usr_cust_${actor.id}` ||
              (actor.customerId && u.linkedCustomerId === actor.customerId))) ||
          (actor.role === 'reseller' && u.id === `usr_res_${actor.id}`)
      );
      const conflict = accounts.find(
        (u) => u.id !== (existingAcc?.id || actor.id) && u.username?.toLowerCase() === nextUsername
      );
      if (conflict) {
        res.status(409).json({ error: `Username "@${nextUsername}" is already taken.` });
        return;
      }

      if (existingAcc) {
        const updated = accounts.map((u) =>
          u.id === existingAcc.id ? { ...u, username: nextUsername } : u
        );
        await saveCollectionValue(db, 'user_accounts', updated);
        broadcastSyncEvent('user_accounts', req.header('x-client-id'));
        res.json({ ok: true, username: nextUsername });
        return;
      }

      if (actor.role === 'customer' && actor.customerId) {
        const cust = (await getAllCustomersFromDb(db)).find((c) => c.id === actor.customerId);
        if (cust) {
          const digits = cust.phone.replace(/\D/g, '');
          const fallback = digits.length >= 6 ? digits.slice(-6) : '123456';
          const newAcc: UserAccount = {
            id: `usr_cust_${cust.id}`,
            fullName: cust.name,
            username: nextUsername,
            phone: cust.phone,
            email: cust.email,
            role: 'customer',
            status: 'active',
            linkedCustomerId: cust.id,
            createdAt: new Date().toISOString(),
            createdBy: cust.id,
            ...(cust.pin?.startsWith('scrypt:') ? {} : hashServerSecret(cust.pin || fallback)),
          };
          if (!newAcc.passwordHash) {
            const h = hashServerSecret(fallback);
            newAcc.passwordHash = h.hash;
            newAcc.passwordSalt = h.salt;
          }
          await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
          broadcastSyncEvent('user_accounts', req.header('x-client-id'));
          res.json({ ok: true, username: nextUsername });
          return;
        }
      }

      if (actor.role === 'reseller') {
        const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
        const resAcc = resellers.find((r) => r.id === actor.id);
        if (resAcc) {
          const digits = resAcc.phone.replace(/\D/g, '');
          const fallback = digits.length >= 6 ? digits.slice(-6) : '123456';
          const h = hashServerSecret(fallback);
          const newAcc: UserAccount = {
            id: `usr_res_${resAcc.id}`,
            fullName: resAcc.name,
            username: nextUsername,
            phone: resAcc.phone,
            role: 'reseller',
            status: 'active',
            passwordHash: h.hash,
            passwordSalt: h.salt,
            linkedResellerCode: resAcc.referralCode,
            createdAt: new Date().toISOString(),
            createdBy: resAcc.id,
          };
          await saveCollectionValue(db, 'user_accounts', [...accounts, newAcc]);
          broadcastSyncEvent('user_accounts', req.header('x-client-id'));
          res.json({ ok: true, username: nextUsername });
          return;
        }
      }

      res.status(404).json({ error: 'Account record not found.' });
    })
  );

  app.post(
    '/api/account/recovery-request',
    asyncRoute(async (req, res) => {
      const identifier = String(req.body?.identifier || '').trim();
      if (!identifier) {
        res.status(400).json({ error: 'Please enter your mobile number, email, or username.' });
        return;
      }
      const rlKey = `recover:${req.ip || 'unknown'}`;
      const rl = checkAuthRateLimit(rlKey);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        res.status(429).json({
          error: `Too many recovery requests. Please wait ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
        });
        return;
      }
      recordAuthFailure(rlKey);

      const db = await getDb();
      const cleanNorm = normalizePhoneOrId(identifier);
      const cleanLower = identifier.replace(/^@+/, '').toLowerCase();
      const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
      const matchedAcc = accounts.find(
        (u) =>
          u.username?.toLowerCase() === cleanLower ||
          normalizePhoneOrId(u.phone) === cleanNorm ||
          (u.email && u.email.toLowerCase() === cleanLower)
      );

      await recordLoginAudit(db, {
        userId: matchedAcc?.id || 'recovery_lookup',
        userName: matchedAcc?.fullName || identifier,
        role: matchedAcc?.role || 'customer',
        identifier,
        status: 'failed',
        note: matchedAcc
          ? `Password recovery requested for @${matchedAcc.username} (${matchedAcc.phone})`
          : `Password recovery requested for "${identifier}"`,
      });
      res.json({
        ok: true,
        matched: Boolean(matchedAcc),
        username: matchedAcc?.username,
      });
    })
  );

  // 5. PRODUCTS & UPCOMING -> ARRIVED TRANSFER
  app.get(
    '/api/products',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      const isPriv =
        actor.role === 'super_admin' ||
        actor.role === 'admin' ||
        actor.role === 'manager' ||
        actor.role === 'investor';
      const prods = (await getAllProductsFromDb()).map((p) =>
        isPriv ? p : { ...p, costPrice: 0, totalProfit: 0, totalRevenue: 0 }
      );
      res.json({ products: prods });
    })
  );

  app.post(
    '/api/products',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Session expired or missing authentication token. Please sign in again.' });
        return;
      }
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Only admins or store managers can create products.' });
        return;
      }
      const db = await getDb();
      const product = req.body as ProductItem;
      if (!product?.id || !product?.name) {
        res.status(400).json({ error: 'Product ID and name are required.' });
        return;
      }
      const saved = await upsertProductRow(db, product);
      broadcastSyncEvent('products', req.header('x-client-id'));
      res.json({ ok: true, product: saved, syncVersion: getSyncVersion() });
    })
  );

  app.put(
    '/api/products/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Session expired or missing authentication token. Please sign in again.' });
        return;
      }
      if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager' &&
        actor.role !== 'staff'
      ) {
        res.status(403).json({ error: 'Unauthorized to update products.' });
        return;
      }
      const db = await getDb();
      const id = req.params.id;
      const existing = (await getAllProductsFromDb(db)).find((p) => p.id === id);
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

      const saved = await upsertProductRow(db, merged);
      broadcastSyncEvent('products', req.header('x-client-id'));
      res.json({ ok: true, product: saved, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/products/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!isUserAuthorizedForStockTransfer(actor)) {
        res.status(403).json({ error: 'Unauthorized to delete products.' });
        return;
      }
      const db = await getDb();
      await db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
      broadcastSyncEvent('products', req.header('x-client-id'));
      res.json({ ok: true, syncVersion: getSyncVersion() });
    })
  );

  app.post(
    '/api/products/:id/activate-arrival',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!isUserAuthorizedForStockTransfer(actor)) {
        res.status(403).json({
          error:
            'Only administrators or authorized stock managers can confirm physical arrival and activate Coming Soon products.',
        });
        return;
      }

      const db = await getDb();
      const existing = (await getAllProductsFromDb(db)).find((p) => p.id === req.params.id);
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

      const allCats = await getAllCategoriesFromDb(db);
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
      const incomingActivatedAt = validateAndNormalizeDateTime(
        (req.body as { activatedAt?: unknown })?.activatedAt,
        'activatedAt'
      );

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
        deliveryType:
          deliveryType === 'express'
            ? 'express'
            : deliveryType === 'standard'
            ? 'standard'
            : existing.deliveryType || 'standard',
        deliveryFeeType: resolvedFeeType,
        customDeliveryCharge:
          resolvedFeeType === 'custom'
            ? customDeliveryCharge ?? existing.customDeliveryCharge ?? 0
            : undefined,
        badgeText:
          badgeText !== undefined
            ? badgeText
            : existing.badgeText === 'COMING SOON'
            ? 'NEW ARRIVAL'
            : existing.badgeText,
        isUpcoming: false,
        upcomingStatus: 'available',
        status: 'published',
        createdAt: existing.createdAt,
        activatedAt: incomingActivatedAt || now,
        activatedBy: actor.name || actor.role || 'Admin',
        updatedAt: now,
      };

      const saved = await upsertProductRow(db, activatedProduct);
      await insertAdminAuditLog(db, {
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
    })
  );

  // 5B. REAL URL PRODUCT SCRAPER ENDPOINT (+ WAF-SAFE BASE64 ALIAS)
  const decodeUtf8Base64 = (b64?: string): string | undefined => {
    if (!b64 || typeof b64 !== 'string') return undefined;
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  };

  const handleProductLinkPreview = async (req: Request, res: Response) => {
    try {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({
          error:
            'Session expired or missing authentication token. Please sign in again as Super Admin, Admin, or Manager.',
        });
        return;
      }
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({
          error: 'Only administrators or store managers can extract external product links.',
        });
        return;
      }

      const body = (req.body || {}) as {
        url?: string;
        encodedUrl?: string;
        htmlOverride?: string;
        encodedHtml?: string;
      };
      const resolvedUrl = (body.url || decodeUtf8Base64(body.encodedUrl) || '').trim();
      const resolvedHtml = body.htmlOverride || decodeUtf8Base64(body.encodedHtml);

      if (!resolvedUrl) {
        res.status(400).json({ error: 'Product URL is required.' });
        return;
      }

      const db = await getDb();
      const categories = await getAllCategoriesFromDb(db);
      const result = await scrapeProductFromUrl(resolvedUrl, categories, resolvedHtml);
      res.json({
        ok: true,
        product: result.product,
        diagnostics: result.diagnostics,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to fetch or parse product page.';
      res.status(422).json({ error: message });
    }
  };

  app.post('/api/products/scrape-url', handleProductLinkPreview);
  app.post('/api/catalog/link-preview', handleProductLinkPreview);

  // 5B-2. CACHE EXTERNAL IMAGE LOCALLY ON SERVER
  app.post('/api/media/cache', async (req, res) => {
    try {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Session expired or missing authentication token. Please sign in again.' });
        return;
      }
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
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
  app.get(
    '/api/expenses',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to view monthly expenses.' });
        return;
      }
      const db = await getDb();
      res.json({
        expenses: await getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []),
      });
    })
  );

  app.post(
    '/api/expenses',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to record expenses.' });
        return;
      }
      const incoming = req.body as Partial<MonthlyExpense>;
      if (!incoming?.title?.trim() || !Number.isFinite(Number(incoming.amount))) {
        res.status(400).json({ error: 'Expense title and valid amount are required.' });
        return;
      }
      const db = await getDb();
      const list = await getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
      const now = new Date().toISOString();
      const expenseId = incoming.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const existing = list.find((e) => e.id === expenseId);
      const merged = mergePreservingOmittedFields(
        existing as Record<string, unknown> | undefined,
        incoming as Record<string, unknown>
      ) as unknown as Partial<MonthlyExpense>;
      const dateStr = validateAndNormalizeDateOnly(merged.date, 'date') || now.split('T')[0];
      const preservedCreatedAt = resolvePreservedCreatedAt({
        existingCreatedAt: existing?.createdAt,
        incomingCreatedAt: incoming.createdAt,
        fallbackIso: now,
        fieldName: 'createdAt',
      });
      const candidateExpense: MonthlyExpense = {
        id: expenseId,
        title: String(merged.title || incoming.title).trim(),
        urduTitle: merged.urduTitle?.trim() || undefined,
        category: merged.category || 'other',
        amount: Math.max(0, Math.round(Number(merged.amount ?? incoming.amount))),
        month: merged.month || dateStr.slice(0, 7),
        date: dateStr,
        paymentStatus: merged.paymentStatus || 'paid',
        paymentMode: merged.paymentMode || 'cash',
        isRecurringMonthly: Boolean(merged.isRecurringMonthly),
        notes: merged.notes?.trim() || undefined,
        recordedBy: merged.recordedBy || actor.name || 'Admin',
        createdAt: preservedCreatedAt,
      };
      const hasChanges = hasRecordContentChanges(
        existing as Record<string, unknown> | undefined,
        candidateExpense as unknown as Record<string, unknown>
      );
      const resolvedUpdatedAt = resolveUpdatedAt({
        isNew: !existing,
        hasChanges,
        existingUpdatedAt: existing?.updatedAt,
        incomingUpdatedAt: incoming.updatedAt,
        createdAtValue: preservedCreatedAt,
        nowIso: now,
      });
      const expense: MonthlyExpense = {
        ...candidateExpense,
        createdAt: preservedCreatedAt,
        updatedAt: resolvedUpdatedAt,
      };
      const nextList = existing ? list.map((e) => (e.id === expense.id ? expense : e)) : [expense, ...list];
      await saveCollectionValue(db, 'monthly_expenses', nextList);
      broadcastSyncEvent('monthly_expenses', req.header('x-client-id'));
      res.json({ ok: true, expense, expenses: nextList, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/expenses/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can delete monthly expenses.' });
        return;
      }
      const db = await getDb();
      const list = await getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
      const nextList = list.filter((e) => e.id !== req.params.id);
      await saveCollectionValue(db, 'monthly_expenses', nextList);
      broadcastSyncEvent('monthly_expenses', req.header('x-client-id'));
      res.json({ ok: true, expenses: nextList, syncVersion: getSyncVersion() });
    })
  );

  // 5D. INVESTOR PRODUCT OFFERINGS & PENDING INVESTMENT REQUESTS (ADMIN + REGISTERED INVESTORS ONLY)
  app.get(
    '/api/investor-offerings',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required to view investor product offerings.' });
        return;
      }
      const isAllowed =
        actor.role === 'super_admin' ||
        actor.role === 'admin' ||
        actor.role === 'manager' ||
        actor.role === 'investor';
      if (!isAllowed) {
        res.status(403).json({
          error: 'Only registered investors and administrators can access Investor Product Offerings.',
        });
        return;
      }

      const db = await getDb();
      const offerings = await getCollectionValue<InvestorProductOffering[]>(db, 'investor_offerings', []);
      const allRequests = await getCollectionValue<InvestorProductRequest[]>(db, 'investor_requests', []);

      let visibleRequests = allRequests;
      if (actor.role === 'investor') {
        const allInvestors = await getCollectionValue<Investor[]>(db, 'investors', []);
        const normPhone = (v?: string) => (v || '').replace(/\D/g, '');
        const actorDigits = normPhone(actor.phone);
        const ownedIds = new Set(
          allInvestors
            .filter(
              (inv) =>
                (actor.investorId && inv.id === actor.investorId) ||
                (actorDigits && normPhone(inv.phone) === actorDigits)
            )
            .map((inv) => inv.id)
        );
        if (actor.investorId) ownedIds.add(actor.investorId);
        visibleRequests = allRequests.filter(
          (r) =>
            (r.investorId && ownedIds.has(r.investorId)) ||
            (actor.id && r.userId === actor.id)
        );
      }

      res.json({
        ok: true,
        offerings,
        requests: visibleRequests,
        syncVersion: getSyncVersion(),
      });
    })
  );

  app.post(
    '/api/investor-offerings',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only Super Admin or Admin can create investor product offerings.' });
        return;
      }

      const incoming = (req.body || {}) as Partial<InvestorProductOffering>;
      const title = (incoming.title || '').trim();
      const unitPrice = Number(incoming.unitPrice || 0);
      const minInvestQty = Math.max(1, Math.round(Number(incoming.minInvestQty || 1)));
      const maxAvailableQty = Math.max(minInvestQty, Math.round(Number(incoming.maxAvailableQty || minInvestQty)));
      const otherExpenses = Math.max(0, Math.round(Number(incoming.otherExpenses || 0)));

      if (!title || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        res.status(400).json({ error: 'Offering title and valid unit price (> 0) are required.' });
        return;
      }

      const now = new Date().toISOString();
      let savedOffering!: InvestorProductOffering;
      let nextOfferings: InvestorProductOffering[] = [];

      await withDbTransaction(async (txDb) => {
        const list = await getCollectionValue<InvestorProductOffering[]>(txDb, 'investor_offerings', []);
        const existing = incoming.id ? list.find((o) => o.id === incoming.id) : undefined;
        const preservedCreatedAt = resolvePreservedCreatedAt({
          existingCreatedAt: existing?.createdAt,
          incomingCreatedAt: incoming.createdAt,
          fallbackIso: now,
        });

        const reservedQty = Math.max(0, Math.min(maxAvailableQty, Number(existing?.reservedQty ?? incoming.reservedQty ?? 0)));
        const candidate: InvestorProductOffering = {
          id: existing?.id || incoming.id || `inv_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          productId: incoming.productId?.trim() || existing?.productId || undefined,
          title,
          urduTitle: incoming.urduTitle?.trim() || existing?.urduTitle || undefined,
          category: (incoming.category || existing?.category || 'General Wholesale').trim(),
          imageUrl: incoming.imageUrl?.trim() || existing?.imageUrl || undefined,
          description: incoming.description?.trim() || existing?.description || undefined,
          unitPrice: Math.round(unitPrice),
          minInvestQty,
          maxAvailableQty,
          reservedQty,
          otherExpenses,
          otherExpensesNote: incoming.otherExpensesNote?.trim() || existing?.otherExpensesNote || undefined,
          expectedProfitSharePercent:
            incoming.expectedProfitSharePercent !== undefined
              ? Number(incoming.expectedProfitSharePercent)
              : existing?.expectedProfitSharePercent,
          estimatedMonthlyReturnText:
            incoming.estimatedMonthlyReturnText?.trim() || existing?.estimatedMonthlyReturnText || undefined,
          status:
            incoming.status ||
            (reservedQty >= maxAvailableQty ? 'funded' : existing?.status || 'active'),
          createdById: existing?.createdById || actor.id,
          createdAt: preservedCreatedAt,
        };

        const hasChanges = hasRecordContentChanges(
          existing as unknown as Record<string, unknown> | undefined,
          candidate as unknown as Record<string, unknown>
        );
        const resolvedUpdatedAt = resolveUpdatedAt({
          isNew: !existing,
          hasChanges,
          existingUpdatedAt: existing?.updatedAt,
          incomingUpdatedAt: incoming.updatedAt,
          createdAtValue: preservedCreatedAt,
          nowIso: now,
        });

        savedOffering = {
          ...candidate,
          createdAt: preservedCreatedAt,
          updatedAt: resolvedUpdatedAt,
        };

        nextOfferings = existing
          ? list.map((o) => (o.id === savedOffering.id ? savedOffering : o))
          : [savedOffering, ...list];

        await saveCollectionValue(txDb, 'investor_offerings', nextOfferings);
        await insertAdminAuditLog(txDb, {
          action: existing ? 'update_investor_offering' : 'create_investor_offering',
          entityType: 'investor_offerings',
          entityId: savedOffering.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: { title: savedOffering.title, unitPrice: savedOffering.unitPrice, minInvestQty: savedOffering.minInvestQty },
        });
      });

      broadcastSyncEvent('investor_offerings', req.header('x-client-id'));
      res.json({ ok: true, offering: savedOffering, offerings: nextOfferings, syncVersion: getSyncVersion() });
    })
  );

  app.put(
    '/api/investor-offerings/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only Super Admin or Admin can update investor product offerings.' });
        return;
      }

      const offeringId = req.params.id;
      const incoming = (req.body || {}) as Partial<InvestorProductOffering>;
      const now = new Date().toISOString();
      let updatedOffering!: InvestorProductOffering;
      let nextOfferings: InvestorProductOffering[] = [];

      await withDbTransaction(async (txDb) => {
        const list = await getCollectionValue<InvestorProductOffering[]>(txDb, 'investor_offerings', []);
        const existing = list.find((o) => o.id === offeringId);
        if (!existing) {
          throw Object.assign(new Error('Investor offering not found.'), { statusCode: 404 });
        }

        const merged = mergePreservingOmittedFields(
          existing as unknown as Record<string, unknown>,
          incoming as unknown as Partial<Record<string, unknown>>
        ) as unknown as InvestorProductOffering;

        const preservedCreatedAt = resolvePreservedCreatedAt({
          existingCreatedAt: existing.createdAt,
          incomingCreatedAt: incoming.createdAt,
          fallbackIso: now,
        });

        const unitPrice = Math.max(1, Math.round(Number(merged.unitPrice || existing.unitPrice)));
        const minInvestQty = Math.max(1, Math.round(Number(merged.minInvestQty || existing.minInvestQty)));
        const maxAvailableQty = Math.max(minInvestQty, Math.round(Number(merged.maxAvailableQty || existing.maxAvailableQty)));
        const reservedQty = Math.max(0, Math.min(maxAvailableQty, Number(merged.reservedQty ?? existing.reservedQty ?? 0)));

        const candidate: InvestorProductOffering = {
          ...merged,
          id: existing.id,
          unitPrice,
          minInvestQty,
          maxAvailableQty,
          reservedQty,
          otherExpenses: Math.max(0, Math.round(Number(merged.otherExpenses || 0))),
          createdAt: preservedCreatedAt,
        };

        const hasChanges = hasRecordContentChanges(
          existing as unknown as Record<string, unknown>,
          candidate as unknown as Record<string, unknown>
        );
        const resolvedUpdatedAt = resolveUpdatedAt({
          isNew: false,
          hasChanges,
          existingUpdatedAt: existing.updatedAt,
          incomingUpdatedAt: incoming.updatedAt,
          createdAtValue: preservedCreatedAt,
          nowIso: now,
        });

        updatedOffering = {
          ...candidate,
          createdAt: preservedCreatedAt,
          updatedAt: resolvedUpdatedAt,
        };
        nextOfferings = list.map((o) => (o.id === offeringId ? updatedOffering : o));
        await saveCollectionValue(txDb, 'investor_offerings', nextOfferings);
      });

      broadcastSyncEvent('investor_offerings', req.header('x-client-id'));
      res.json({ ok: true, offering: updatedOffering, offerings: nextOfferings, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/investor-offerings/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only Super Admin or Admin can delete investor offerings.' });
        return;
      }

      let nextOfferings: InvestorProductOffering[] = [];
      await withDbTransaction(async (txDb) => {
        const list = await getCollectionValue<InvestorProductOffering[]>(txDb, 'investor_offerings', []);
        nextOfferings = list.filter((o) => o.id !== req.params.id);
        if (nextOfferings.length !== list.length) {
          await saveCollectionValue(txDb, 'investor_offerings', nextOfferings);
          await insertAdminAuditLog(txDb, {
            action: 'delete_investor_offering',
            entityType: 'investor_offerings',
            entityId: req.params.id,
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
          });
        }
      });

      broadcastSyncEvent('investor_offerings', req.header('x-client-id'));
      res.json({ ok: true, offerings: nextOfferings, syncVersion: getSyncVersion() });
    })
  );

  app.post(
    '/api/investor-requests',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Please sign in as a registered investor to submit an investment request.' });
        return;
      }
      if (actor.role !== 'investor' && actor.role !== 'admin' && actor.role !== 'super_admin') {
        res.status(403).json({
          error: 'Only registered investors can invest in investor product offerings.',
        });
        return;
      }

      const { offeringId, requestedQty: rawQty, notes, investorId: overrideInvestorId } = (req.body || {}) as {
        offeringId?: string;
        requestedQty?: number;
        notes?: string;
        investorId?: string;
      };

      if (!offeringId) {
        res.status(400).json({ error: 'Offering ID is required.' });
        return;
      }

      const requestedQty = Math.round(Number(rawQty || 0));
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        res.status(400).json({ error: 'Please select a valid quantity to invest.' });
        return;
      }

      const now = new Date().toISOString();
      let createdRequest!: InvestorProductRequest;

      await withDbTransaction(async (txDb) => {
        const offerings = await getCollectionValue<InvestorProductOffering[]>(txDb, 'investor_offerings', []);
        const offering = offerings.find((o) => o.id === offeringId);
        if (!offering) {
          throw Object.assign(new Error('Selected investor product offering was not found.'), { statusCode: 404 });
        }
        if (offering.status !== 'active') {
          throw Object.assign(new Error('This offering is no longer open for new investment requests.'), { statusCode: 400 });
        }

        const remainingQty = Math.max(0, offering.maxAvailableQty - (offering.reservedQty || 0));
        if (requestedQty < offering.minInvestQty) {
          throw Object.assign(
            new Error(`Minimum quantity required for "${offering.title}" is ${offering.minInvestQty} units.`),
            { statusCode: 400 }
          );
        }
        if (requestedQty > remainingQty) {
          throw Object.assign(
            new Error(`Only ${remainingQty} units remain available in this offering.`),
            { statusCode: 400 }
          );
        }

        const allInvestors = await getCollectionValue<Investor[]>(txDb, 'investors', []);
        const normPhone = (v?: string) => (v || '').replace(/\D/g, '');
        const actorDigits = normPhone(actor.phone);
        const targetInvestorId =
          actor.role === 'investor' ? actor.investorId : overrideInvestorId || actor.investorId;
        const matchedInv = allInvestors.find(
          (inv) =>
            (targetInvestorId && inv.id === targetInvestorId) ||
            (actorDigits && normPhone(inv.phone) === actorDigits)
        );

        const subtotalAmount = Math.round(requestedQty * offering.unitPrice);
        const otherExpensesShare =
          offering.otherExpenses > 0 && offering.maxAvailableQty > 0
            ? Math.round((offering.otherExpenses * requestedQty) / offering.maxAvailableQty)
            : 0;
        const totalInvestment = subtotalAmount + otherExpensesShare;

        createdRequest = {
          id: `inv_req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          offeringId: offering.id,
          offeringTitle: offering.title,
          productId: offering.productId,
          investorId: matchedInv?.id || targetInvestorId,
          userId: actor.id,
          investorName: matchedInv?.name || actor.name || 'Registered Investor',
          investorPhone: matchedInv?.phone || actor.phone || '',
          requestedQty,
          unitPrice: offering.unitPrice,
          subtotalAmount,
          otherExpensesShare,
          totalInvestment,
          notes: notes?.trim() || undefined,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };

        const requests = await getCollectionValue<InvestorProductRequest[]>(txDb, 'investor_requests', []);
        await saveCollectionValue(txDb, 'investor_requests', [createdRequest, ...requests]);
        await insertAdminAuditLog(txDb, {
          action: 'create_investor_request',
          entityType: 'investor_requests',
          entityId: createdRequest.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: {
            offeringId: offering.id,
            offeringTitle: offering.title,
            requestedQty,
            totalInvestment,
          },
        });
      });

      broadcastSyncEvent('investor_requests', req.header('x-client-id'));
      res.json({ ok: true, request: createdRequest, syncVersion: getSyncVersion() });
    })
  );

  app.post(
    '/api/investor-requests/:id/review',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only Super Admin or Admin can approve or reject investment requests.' });
        return;
      }

      const requestId = req.params.id;
      const { decision, rejectionReason } = (req.body || {}) as {
        decision?: 'approved' | 'rejected';
        rejectionReason?: string;
      };
      if (decision !== 'approved' && decision !== 'rejected') {
        res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
        return;
      }

      const now = new Date().toISOString();
      const todayStr = now.split('T')[0];
      let updatedRequest!: InvestorProductRequest;

      await withDbTransaction(async (txDb) => {
        const requests = await getCollectionValue<InvestorProductRequest[]>(txDb, 'investor_requests', []);
        const reqItem = requests.find((r) => r.id === requestId);
        if (!reqItem) {
          throw Object.assign(new Error('Investment request not found.'), { statusCode: 404 });
        }
        if (reqItem.status !== 'pending') {
          throw Object.assign(new Error(`Request has already been ${reqItem.status}.`), { statusCode: 400 });
        }

        const offerings = await getCollectionValue<InvestorProductOffering[]>(txDb, 'investor_offerings', []);
        const offeringIdx = offerings.findIndex((o) => o.id === reqItem.offeringId);

        if (decision === 'approved') {
          if (offeringIdx === -1) {
            throw Object.assign(new Error('Linked offering no longer exists.'), { statusCode: 404 });
          }
          const offering = offerings[offeringIdx];
          const remainingQty = Math.max(0, offering.maxAvailableQty - (offering.reservedQty || 0));
          if (reqItem.requestedQty > remainingQty) {
            throw Object.assign(
              new Error(`Insufficient remaining units (${remainingQty}) to approve ${reqItem.requestedQty} units.`),
              { statusCode: 400 }
            );
          }

          const nextReserved = (offering.reservedQty || 0) + reqItem.requestedQty;
          const nextOffering: InvestorProductOffering = {
            ...offering,
            reservedQty: nextReserved,
            status: nextReserved >= offering.maxAvailableQty ? 'funded' : offering.status,
            updatedAt: now,
          };
          const nextOfferings = [...offerings];
          nextOfferings[offeringIdx] = nextOffering;
          await saveCollectionValue(txDb, 'investor_offerings', nextOfferings);

          // Credit investor capital & product allocation + ledger transaction
          const investors = await getCollectionValue<Investor[]>(txDb, 'investors', []);
          const normPhone = (v?: string) => (v || '').replace(/\D/g, '');
          const reqPhoneDigits = normPhone(reqItem.investorPhone);
          const invIdx = investors.findIndex(
            (inv) =>
              (reqItem.investorId && inv.id === reqItem.investorId) ||
              (reqPhoneDigits && normPhone(inv.phone) === reqPhoneDigits)
          );

          let finalInvestorId = reqItem.investorId;
          if (invIdx !== -1) {
            const inv = investors[invIdx];
            finalInvestorId = inv.id;
            const prevAssigned = Array.isArray(inv.assignedProductIds) ? inv.assignedProductIds : [];
            const nextAssigned =
              reqItem.productId && !prevAssigned.includes(reqItem.productId)
                ? [...prevAssigned, reqItem.productId]
                : prevAssigned;

            const allocProductKey = reqItem.productId || reqItem.offeringId;
            const prevAllocs = Array.isArray(inv.productAllocations) ? inv.productAllocations : [];
            const existingAllocIdx = prevAllocs.findIndex((a) => a.productId === allocProductKey);
            const nextAllocs = [...prevAllocs];
            if (existingAllocIdx !== -1) {
              nextAllocs[existingAllocIdx] = {
                ...nextAllocs[existingAllocIdx],
                unitsOwned: (nextAllocs[existingAllocIdx].unitsOwned || 0) + reqItem.requestedQty,
                investedAmount: (nextAllocs[existingAllocIdx].investedAmount || 0) + reqItem.totalInvestment,
              };
            } else {
              nextAllocs.push({
                productId: allocProductKey,
                unitsOwned: reqItem.requestedQty,
                investedAmount: reqItem.totalInvestment,
                notes: `${reqItem.offeringTitle} (Approved Request)`,
              });
            }

            const nextInvestors = [...investors];
            nextInvestors[invIdx] = {
              ...inv,
              totalInvestment: (inv.totalInvestment || 0) + reqItem.totalInvestment,
              assignedProductIds: nextAssigned,
              productAllocations: nextAllocs,
            };
            await saveCollectionValue(txDb, 'investors', nextInvestors);
          }

          if (finalInvestorId) {
            const invTxs = await getCollectionValue<InvestorTransaction[]>(txDb, 'investor_transactions', []);
            const newTx: InvestorTransaction = {
              id: `inv_tx_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
              investorId: finalInvestorId,
              date: todayStr,
              type: 'investment_deposit',
              amount: reqItem.totalInvestment,
              productId: reqItem.productId,
              productName: reqItem.offeringTitle,
              notes: `Approved lot investment: ${reqItem.requestedQty} units @ Rs.${reqItem.unitPrice} + Rs.${reqItem.otherExpensesShare} expenses share`,
              reference: reqItem.id,
              createdAt: now,
            };
            await saveCollectionValue(txDb, 'investor_transactions', [newTx, ...invTxs]);
          }
        }

        updatedRequest = {
          ...reqItem,
          status: decision,
          reviewedById: actor.id,
          reviewedByName: actor.name || 'Admin',
          reviewedAt: now,
          rejectionReason: decision === 'rejected' ? rejectionReason?.trim() || 'Declined by Admin' : undefined,
          updatedAt: now,
        };

        const nextRequests = requests.map((r) => (r.id === requestId ? updatedRequest : r));
        await saveCollectionValue(txDb, 'investor_requests', nextRequests);

        await insertAdminAuditLog(txDb, {
          action: decision === 'approved' ? 'approve_investor_request' : 'reject_investor_request',
          entityType: 'investor_requests',
          entityId: requestId,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: {
            offeringTitle: reqItem.offeringTitle,
            requestedQty: reqItem.requestedQty,
            totalInvestment: reqItem.totalInvestment,
            decision,
          },
        });
      });

      broadcastSyncEvent('investor_offerings', req.header('x-client-id'));
      broadcastSyncEvent('investor_requests', req.header('x-client-id'));
      broadcastSyncEvent('investors', req.header('x-client-id'));
      broadcastSyncEvent('investor_transactions', req.header('x-client-id'));

      res.json({ ok: true, request: updatedRequest, syncVersion: getSyncVersion() });
    })
  );

  // 6. MULTI-LEVEL CATEGORIES (3 LEVELS)
  app.get(
    '/api/categories',
    asyncRoute(async (_req, res) => {
      res.json({ categories: await getAllCategoriesFromDb() });
    })
  );

  app.post(
    '/api/categories',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
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

      const db = await getDb();
      const allCats = await getAllCategoriesFromDb(db);
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

      const saved = await upsertCategoryRow(db, newCat);
      broadcastSyncEvent('categories', req.header('x-client-id'));
      res.json({
        ok: true,
        category: saved,
        categories: await getAllCategoriesFromDb(db),
        syncVersion: getSyncVersion(),
      });
    })
  );

  app.put(
    '/api/categories/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Only admins/managers can update categories.' });
        return;
      }

      const db = await getDb();
      const id = req.params.id;
      const allCats = await getAllCategoriesFromDb(db);
      const existing = allCats.find((c) => c.id === id);
      if (!existing) {
        res.status(404).json({ error: 'Category not found.' });
        return;
      }

      const body = req.body as Partial<CategoryRecord>;
      if (existing.id === UPCOMING_CATEGORY_ID || existing.isUpcoming) {
        // Keep canonical Upcoming category active & intact
        const saved = await upsertCategoryRow(db, {
          ...existing,
          urduName: body.urduName ?? existing.urduName,
          description: body.description ?? existing.description,
          isActive: true,
          isUpcoming: true,
          name: UPCOMING_CATEGORY_NAME,
          parentCategoryId: undefined,
        });
        broadcastSyncEvent('categories', req.header('x-client-id'));
        res.json({
          ok: true,
          category: saved,
          categories: await getAllCategoriesFromDb(db),
          syncVersion: getSyncVersion(),
        });
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
        res.status(409).json({
          error: `Another category named "${nextName}" already exists under the selected parent.`,
        });
        return;
      }

      const saved = await upsertCategoryRow(db, {
        ...existing,
        ...body,
        id,
        name: nextName,
        parentCategoryId: nextParentId,
      });

      // Recompute child levels & product category breadcrumbs referencing this category
      const refreshedCats = await getAllCategoriesFromDb(db);
      for (const child of refreshedCats) {
        if (child.parentCategoryId === id) {
          await upsertCategoryRow(db, child);
        }
      }
      const finalCats = await getAllCategoriesFromDb(db);
      const prods = await getAllProductsFromDb(db);
      for (const p of prods) {
        if (p.parentCategoryId === id || p.subcategoryId === id || p.childSubcategoryId === id) {
          await upsertProductRow(db, {
            ...p,
            category: getCategoryBreadcrumb(
              finalCats,
              p.parentCategoryId,
              p.subcategoryId,
              p.childSubcategoryId,
              p.category
            ),
          });
        }
      }

      broadcastSyncEvent('categories', req.header('x-client-id'));
      res.json({ ok: true, category: saved, categories: finalCats, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/categories/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can delete categories.' });
        return;
      }

      const db = await getDb();
      const id = req.params.id;
      const allCats = await getAllCategoriesFromDb(db);
      const target = allCats.find((c) => c.id === id);
      if (!target) {
        res.status(404).json({ error: 'Category not found.' });
        return;
      }
      if (target.id === UPCOMING_CATEGORY_ID || target.isUpcoming) {
        res.status(400).json({
          error: 'The Upcoming Viral Products | Coming Soon category is protected and cannot be deleted.',
        });
        return;
      }

      const hasChildren = allCats.some((c) => c.parentCategoryId === id);
      if (hasChildren) {
        res.status(400).json({
          error: 'Cannot delete category while it has subcategories. Reassign or remove subcategories first.',
        });
        return;
      }

      const products = await getAllProductsFromDb(db);
      const inUse = products.some(
        (p) =>
          p.parentCategoryId === id ||
          p.subcategoryId === id ||
          p.childSubcategoryId === id ||
          normalizeTextKey(p.category) === normalizeTextKey(target.name)
      );
      if (inUse) {
        res.status(400).json({
          error: 'Cannot delete category with assigned products. Reassign products or deactivate instead.',
        });
        return;
      }

      await db.run('DELETE FROM categories WHERE id = ?', [id]);
      broadcastSyncEvent('categories', req.header('x-client-id'));
      res.json({
        ok: true,
        categories: await getAllCategoriesFromDb(db),
        syncVersion: getSyncVersion(),
      });
    })
  );

  // 7. CITIES & AREAS LOCATION MANAGEMENT
  const parseOptionalDeliveryCharge = (raw: unknown): number | null | 'invalid' | undefined => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return 'invalid';
    return Math.round(num);
  };

  app.get(
    '/api/locations',
    asyncRoute(async (_req, res) => {
      res.json({ cities: await getAllCitiesFromDb() });
    })
  );

  app.post(
    '/api/cities',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
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

      const db = await getDb();
      const existing = await getAllCitiesFromDb(db);
      if (existing.some((c) => normalizeTextKey(c.name) === normalizeTextKey(name))) {
        res.status(409).json({ error: `City "${name}" already exists.` });
        return;
      }

      const id = slugifyId('city', name) + '_' + Date.now().toString(36).slice(-4);
      const now = db.formatTimestamp();
      const chargeToSave = parsedCharge !== undefined ? parsedCharge : isMuzaffarabadCity(name) ? 50 : null;
      const province = inferProvinceForCity(name, typeof req.body?.province === 'string' ? req.body.province : undefined);
      await db.run(
        'INSERT INTO cities (id, name, province, allowed, delivery_charge, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, province, allowed ? 1 : 0, chargeToSave, existing.length + 1, now, now]
      );
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  // Bulk toggle ON/OFF for all cities except Muzaffarabad
  app.put(
    '/api/cities/toggle-other-cities',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to manage delivery cities.' });
        return;
      }
      const allowOtherCities = Boolean(req.body?.allowOtherCities);
      const db = await getDb();
      const now = db.formatTimestamp();
      await db.run(
        "UPDATE cities SET allowed = ?, updated_at = ? WHERE LOWER(TRIM(name)) != 'muzaffarabad'",
        [allowOtherCities ? 1 : 0, now]
      );
      await db.run(
        "UPDATE cities SET allowed = 1, updated_at = ? WHERE LOWER(TRIM(name)) = 'muzaffarabad'",
        [now]
      );
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  app.put(
    '/api/cities/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to manage cities.' });
        return;
      }
      const db = await getDb();
      const id = req.params.id;
      const cities = await getAllCitiesFromDb(db);
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
      const now = db.formatTimestamp();
      await db.run(
        'UPDATE cities SET name = ?, province = ?, allowed = ?, delivery_charge = ?, updated_at = ? WHERE id = ?',
        [nextName, nextProvince, nextAllowed ? 1 : 0, nextCharge, now, target.id]
      );
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/cities/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to remove cities.' });
        return;
      }
      const db = await getDb();
      const id = req.params.id;
      const cities = await getAllCitiesFromDb(db);
      const target = cities.find((c) => c.id === id || normalizeTextKey(c.name) === normalizeTextKey(id));
      if (!target || !target.id) {
        res.status(404).json({ error: 'City not found.' });
        return;
      }
      if (isMuzaffarabadCity(target.name)) {
        res.status(400).json({ error: 'Muzaffarabad is the default active delivery city and cannot be removed.' });
        return;
      }
      await db.run('DELETE FROM city_areas WHERE city_id = ?', [target.id]);
      await db.run('DELETE FROM cities WHERE id = ?', [target.id]);
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  app.post(
    '/api/cities/:cityId/areas',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to manage areas.' });
        return;
      }
      const db = await getDb();
      const cities = await getAllCitiesFromDb(db);
      const city = cities.find(
        (c) => c.id === req.params.cityId || normalizeTextKey(c.name) === normalizeTextKey(req.params.cityId)
      );
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
      const now = db.formatTimestamp();
      await db.run(
        'INSERT INTO city_areas (id, city_id, name, allowed, delivery_charge, area_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          areaId,
          city.id,
          areaName,
          req.body?.allowed !== false ? 1 : 0,
          parsedCharge !== undefined ? parsedCharge : null,
          areaType,
          now,
          now,
        ]
      );
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  app.put(
    '/api/areas/:areaId',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res.status(403).json({ error: 'Unauthorized to manage areas.' });
        return;
      }
      const db = await getDb();
      const areaRow = await db.get<Record<string, unknown>>('SELECT * FROM city_areas WHERE id = ?', [
        req.params.areaId,
      ]);
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

      const dup = await db.get<{ id: string }>(
        'SELECT id FROM city_areas WHERE city_id = ? AND id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))',
        [String(areaRow.city_id), String(areaRow.id), nextName]
      );
      if (dup) {
        res.status(409).json({ error: `Area "${nextName}" already exists in this city.` });
        return;
      }

      await db.run(
        'UPDATE city_areas SET name = ?, allowed = ?, delivery_charge = ?, updated_at = ? WHERE id = ?',
        [nextName, nextAllowed ? 1 : 0, nextCharge, db.formatTimestamp(), String(areaRow.id)]
      );
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/areas/:areaId',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can remove areas.' });
        return;
      }
      const db = await getDb();
      await db.run('DELETE FROM city_areas WHERE id = ?', [req.params.areaId]);
      const profile = await syncDeliveryCitiesIntoBusinessProfile(db);
      broadcastSyncEvent('locations', req.header('x-client-id'));
      res.json({ ok: true, cities: profile.deliveryCities, syncVersion: getSyncVersion() });
    })
  );

  // 8. CUSTOMERS CRUD (AUTHENTICATED + ROLE SCOPED + OPTIONAL PAGINATION)
  app.get(
    '/api/customers',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const db = await getDb();
      let list = (await getAllCustomersFromDb(db)).map((c) => {
        const clean = { ...c };
        delete clean.pin;
        return clean;
      });
      if (actor.role === 'customer') {
        list = list.filter(
          (c) =>
            c.id === actor.customerId ||
            (actor.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(actor.phone))
        );
      } else if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager' &&
        actor.role !== 'staff'
      ) {
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
    })
  );

  app.post(
    '/api/customers',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager' &&
        actor.role !== 'staff'
      ) {
        res.status(403).json({ error: 'Unauthorized to create customer records.' });
        return;
      }
      const db = await getDb();
      const customer = req.body as Customer;
      if (!customer?.id || !customer?.name) {
        res.status(400).json({ error: 'Customer ID and name are required.' });
        return;
      }
      const saved = await upsertCustomerRow(db, customer);
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
    })
  );

  app.put(
    '/api/customers/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const db = await getDb();
      const existing = (await getAllCustomersFromDb(db)).find((c) => c.id === req.params.id);
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
        const saved = await upsertCustomerRow(db, {
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
      const saved = await upsertCustomerRow(db, { ...existing, ...incoming, id: existing.id, createdAt: existing.createdAt });
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({ ok: true, customer: saved, syncVersion: getSyncVersion() });
    })
  );

  app.delete(
    '/api/customers/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin') {
        res.status(403).json({ error: 'Only administrators can delete customer records.' });
        return;
      }
      const db = await getDb();
      const existing = (await getAllCustomersFromDb(db)).find((c) => c.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }
      await db.run('DELETE FROM customers WHERE id = ?', [req.params.id]);
      await insertAdminAuditLog(db, {
        action: 'delete_customer',
        entityType: 'customer',
        entityId: req.params.id,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        details: { customerName: existing.name, phone: existing.phone },
      });
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({ ok: true, syncVersion: getSyncVersion() });
    })
  );

  // 9. AUTHORITATIVE ORDER CHECKOUT WITH UPCOMING, EXPRESS-ONLY DELIVERY, PRICING & LOYALTY
  app.post(
    '/api/orders/checkout',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      const db = await getDb();
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

      const allProducts = await getAllProductsFromDb(db);
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
        const cities = await getAllCitiesFromDb(db);
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
        const coupons = await getAllCrmCoupons(db);
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

      try {
        await withDbTransaction(async (txDb) => {
          let savedCustomer: Customer | undefined;
          if (customer) {
            const existingCust = (await getAllCustomersFromDb(txDb)).find((c) => c.id === customer.id);
            savedCustomer = await upsertCustomerRow(txDb, {
              ...customer,
              balance:
                existingCust && !isPrivilegedSeller
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

          const nowCheckoutIso = new Date().toISOString();

          if (transaction) {
            const currentTxs = await getCollectionValue<Transaction[]>(txDb, 'transactions', []);
            const existingTx = currentTxs.find((t) => t.id === transaction.id);
            const finalTxAmount =
              !isPrivilegedSeller && computedCatalogSubtotal > 0
                ? authoritativeTotal
                : Math.max(0, Number(transaction.amount || 0));
            const txCreatedAt = resolvePreservedCreatedAt({
              existingCreatedAt: existingTx?.createdAt,
              incomingCreatedAt: transaction.createdAt,
              fallbackIso: nowCheckoutIso,
              fieldName: 'transaction.createdAt',
            });
            const txDate =
              validateAndNormalizeDateOnly(transaction.date, 'transaction.date') ||
              existingTx?.date ||
              txCreatedAt.slice(0, 10);
            const txDueDate =
              validateAndNormalizeDateOnly(transaction.dueDate, 'transaction.dueDate') || existingTx?.dueDate;
            const cleanTx: Transaction = {
              ...transaction,
              customerId: transaction.customerId || savedCustomer?.id || '',
              amount: finalTxAmount,
              paidAmount: Math.min(finalTxAmount, Math.max(0, Number(transaction.paidAmount || 0))),
              dueBalance: Math.max(0, Number(transaction.dueBalance ?? 0)),
              date: txDate,
              dueDate: txDueDate,
              createdAt: txCreatedAt,
              notes: appliedCoupon
                ? `${transaction.notes || ''} [Coupon ${appliedCoupon.code}: -Rs.${couponDiscount}]`.trim()
                : transaction.notes,
              auditTrail: Array.isArray(transaction.auditTrail) ? transaction.auditTrail : [],
            };
            await saveCollectionValue(txDb, 'transactions', [
              cleanTx,
              ...currentTxs.filter((t) => t.id !== cleanTx.id),
            ]);
          }

          let persistedOrderNumber = transaction?.invoiceNumber;
          if (codOrder) {
            const currentOrders = await getCollectionValue<CODOrder[]>(txDb, 'cod_orders', []);
            const existingCod = currentOrders.find((o) => o.id === codOrder.id);
            const orderCreatedAt = resolvePreservedCreatedAt({
              existingCreatedAt: existingCod?.createdAt,
              incomingCreatedAt: codOrder.createdAt,
              fallbackIso: nowCheckoutIso,
              fieldName: 'codOrder.createdAt',
            });
            const dispatchedAt = validateAndNormalizeDateTime(codOrder.dispatchedAt, 'codOrder.dispatchedAt');
            const deliveredAt = validateAndNormalizeDateTime(codOrder.deliveredAt, 'codOrder.deliveredAt');
            const returnedAt = validateAndNormalizeDateTime(codOrder.returnedAt, 'codOrder.returnedAt');
            const safeItems = Array.isArray(codOrder.items) ? codOrder.items : [];
            const cleanOrder: CODOrder = {
              ...codOrder,
              customerId: codOrder.customerId || savedCustomer?.id || transaction?.customerId,
              items: safeItems,
              subtotal: authoritativeSubtotal,
              deliveryFee: safeDeliveryFee,
              totalAmount:
                isPrivilegedSeller && codOrder.totalAmount > 0 && !appliedCoupon
                  ? Math.max(0, Number(codOrder.totalAmount))
                  : authoritativeTotal,
              dispatchedAt: dispatchedAt ?? existingCod?.dispatchedAt,
              deliveredAt: deliveredAt ?? existingCod?.deliveredAt,
              returnedAt: returnedAt ?? existingCod?.returnedAt,
              createdAt: orderCreatedAt,
            };
            persistedOrderNumber = cleanOrder.orderNumber;
            await saveCollectionValue(txDb, 'cod_orders', [
              cleanOrder,
              ...currentOrders.filter((o) => o.id !== cleanOrder.id),
            ]);
          }

          const latestProducts = await getAllProductsFromDb(txDb);
          for (const item of requestedItems) {
            const prod = latestProducts.find((p) => p.id === item.productId);
            if (prod && !isProductPurchaseBlocked(prod)) {
              const qty = Math.max(0, Number(item.quantity || 0));
              await upsertProductRow(txDb, {
                ...prod,
                stockQty: Math.max(0, prod.stockQty - qty),
                salesCount: (prod.salesCount || 0) + qty,
                totalRevenue: (prod.totalRevenue || 0) + qty * prod.ourPrice,
                totalProfit: (prod.totalProfit || 0) + qty * Math.max(0, prod.ourPrice - prod.costPrice),
              });
            }
          }

          if (resellerId && transaction) {
            const resellers = await getCollectionValue<Reseller[]>(txDb, 'resellers', []);
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
            await saveCollectionValue(txDb, 'resellers', updatedResellers);
          }

          if (appliedCoupon) {
            await upsertCrmCoupon(txDb, {
              ...appliedCoupon,
              status: 'redeemed',
              redeemedAt: new Date().toISOString(),
            });
          }

          // Award CRM Loyalty points & record timeline event
          const targetCustomerId = savedCustomer?.id || codOrder?.customerId || transaction?.customerId;
          if (targetCustomerId) {
            const loyaltyCfg = await getCrmLoyaltyConfig(txDb);
            const orderAmt = authoritativeTotal || Number(transaction?.amount || 0);
            const pts = Math.floor(orderAmt / 1000) * Math.max(1, loyaltyCfg.pointsPerThousandPkr);
            if (pts > 0) {
              await adjustCustomerLoyaltyPoints(txDb, {
                customerId: targetCustomerId,
                pointsDelta: pts,
                type: 'earned',
                orderNumber: persistedOrderNumber,
                notes: `Points earned from order #${persistedOrderNumber || 'checkout'}`,
              });
            }
            await insertCrmActivityEvent(txDb, {
              customerId: targetCustomerId,
              phone: savedCustomer?.phone || codOrder?.phone,
              eventType: 'order_placed',
              orderNumber: persistedOrderNumber,
              amount: orderAmt,
              notes: `Order placed via ${codOrder ? 'COD Storefront' : 'POS'}`,
            });
          }
        });
      } catch (err) {
        sendRouteError(res, err, 'Checkout persistence failed.');
        return;
      }

      broadcastSyncEvent('orders', req.header('x-client-id'));
      res.json({ ok: true, syncVersion: getSyncVersion() });
    })
  );

  // 9B. COD ORDER STATUS TRANSITION (DISPATCH / DELIVER / RETURN) WITH ATOMIC LEDGER & STOCK SYNC
  app.post(
    '/api/orders/:orderId/status',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
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

      const db = await getDb();
      const orders = await getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
      const existingOrder = orders.find((o) => o.id === orderId);
      if (!existingOrder) {
        res.status(404).json({ error: 'COD order not found.' });
        return;
      }

      const now = new Date().toISOString();
      const todayStr = now.split('T')[0];
      const normalizeDigits = (v?: string) => (v || '').replace(/\D/g, '');
      let updatedOrder: CODOrder = existingOrder;

      try {
        await withDbTransaction(async (txDb) => {
          const currentOrders = await getCollectionValue<CODOrder[]>(txDb, 'cod_orders', []);
          const currentOrder = currentOrders.find((o) => o.id === orderId) || existingOrder;
          const wasDelivered = currentOrder.status === 'delivered';
          const wasReturned = currentOrder.status === 'returned';

          updatedOrder = {
            ...currentOrder,
            status,
            courierPartner: courierPartner || currentOrder.courierPartner,
            trackingNumber: trackingNumber !== undefined ? trackingNumber : currentOrder.trackingNumber,
            dispatchedAt: status === 'dispatched' ? currentOrder.dispatchedAt || now : currentOrder.dispatchedAt,
            deliveredAt: status === 'delivered' ? currentOrder.deliveredAt || now : currentOrder.deliveredAt,
            returnedAt: status === 'returned' ? currentOrder.returnedAt || now : currentOrder.returnedAt,
          };

          const nextOrders = currentOrders.map((o) => (o.id === orderId ? updatedOrder : o));
          await saveCollectionValue(txDb, 'cod_orders', nextOrders);

          if (status === 'returned' && !wasReturned) {
            const allProds = await getAllProductsFromDb(txDb);
            for (const item of currentOrder.items || []) {
              const prod = allProds.find((p) => p.id === item.productId);
              if (prod) {
                await upsertProductRow(txDb, {
                  ...prod,
                  stockQty: prod.stockQty + Math.max(0, Number(item.quantity || 0)),
                });
              }
            }
          }

          if (status === 'delivered' && !wasDelivered) {
            const allCustomers = await getAllCustomersFromDb(txDb);
            const ordDigits = normalizeDigits(currentOrder.phone);
            let cust =
              (currentOrder.customerId && allCustomers.find((c) => c.id === currentOrder.customerId)) ||
              (ordDigits ? allCustomers.find((c) => normalizeDigits(c.phone) === ordDigits) : undefined);

            if (!cust) {
              const digits = ordDigits || '03000000000';
              cust = {
                id: `cust_ord_${currentOrder.id.replace(/[^a-zA-Z0-9]/g, '')}`,
                name: currentOrder.customerName || 'COD Customer',
                phone: currentOrder.phone || digits,
                city: currentOrder.city || 'Muzaffarabad',
                area: currentOrder.area,
                mohalla: currentOrder.mohalla,
                landmark: currentOrder.landmark,
                address: currentOrder.address || currentOrder.city || 'Pakistan',
                customerType: 'individual',
                balance: 0,
                totalPurchases: 0,
                creditLimit: 5000,
                paymentTermsDays: 7,
                status: 'active',
                pin: digits.length >= 6 ? digits.slice(-6) : '123456',
                createdAt: (currentOrder.createdAt || now).split('T')[0],
              };
              await upsertCustomerRow(txDb, cust);
            }

            if (!updatedOrder.customerId) {
              updatedOrder = { ...updatedOrder, customerId: cust.id };
              await saveCollectionValue(
                txDb,
                'cod_orders',
                nextOrders.map((o) => (o.id === orderId ? updatedOrder : o))
              );
            }

            const currentTxs = await getCollectionValue<Transaction[]>(txDb, 'transactions', []);
            const orderNum = currentOrder.orderNumber;
            const hasCreditTx = currentTxs.some(
              (t) =>
                t.type === 'credit' &&
                ((t.invoiceNumber && t.invoiceNumber === orderNum) || (t.notes && t.notes.includes(orderNum)))
            );

            let workingTxs = [...currentTxs];
            if (!hasCreditTx) {
              const linkedCreditTx: Transaction = {
                id: `tx_link_${currentOrder.id}`,
                customerId: cust.id,
                type: 'credit',
                amount: currentOrder.totalAmount,
                paidAmount: 0,
                dueBalance: currentOrder.totalAmount,
                saleType: 'cod',
                date: (currentOrder.createdAt || now).split('T')[0],
                dueDate: todayStr,
                paymentTermsDays: 0,
                invoiceNumber: orderNum,
                notes: `COD Order #${orderNum} (${currentOrder.city})`,
                paymentMode: 'cod',
                items: currentOrder.items || [],
                totalSavings: (currentOrder.items || []).reduce((acc, it) => acc + Number(it.customerSavings || 0), 0),
                status: 'pending',
                responsibleStaff: actor.name || 'Order Desk',
                auditTrail: [
                  {
                    id: `aud_link_${Date.now()}`,
                    timestamp: now,
                    action: 'created',
                    newStatus: 'pending',
                    newAmount: currentOrder.totalAmount,
                    changedBy: actor.name || 'Order Desk',
                    notes: `Auto-linked COD order #${orderNum} before delivery settlement`,
                  },
                ],
                createdAt: currentOrder.createdAt || now,
              };
              workingTxs = [linkedCreditTx, ...workingTxs];
            }

            const netCash = currentOrder.totalAmount - currentOrder.deliveryFee;
            const debitTx: Transaction = {
              id: `tx_cod_deliv_${currentOrder.id}_${Date.now()}`,
              customerId: cust.id,
              type: 'debit',
              amount: currentOrder.totalAmount,
              paidAmount: currentOrder.totalAmount,
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
            workingTxs = [
              debitTx,
              ...workingTxs.map((t) =>
                t.type === 'credit' &&
                ((t.invoiceNumber && t.invoiceNumber === orderNum) || (t.notes && t.notes.includes(orderNum)))
                  ? {
                      ...t,
                      paidAmount: t.amount,
                      dueBalance: 0,
                      status: 'completed' as const,
                    }
                  : t
              ),
            ];
            await saveCollectionValue(txDb, 'transactions', workingTxs);

            if (currentOrder.resellerCode) {
              const earned = Math.floor(currentOrder.subtotal / 1000) * 30;
              const resellers = await getCollectionValue<Reseller[]>(txDb, 'resellers', []);
              const nextResellers = resellers.map((r) =>
                r.referralCode === currentOrder.resellerCode
                  ? {
                      ...r,
                      totalReferredOrders: r.totalReferredOrders + 1,
                      totalSales: r.totalSales + currentOrder.subtotal,
                      totalPaidSales: r.totalPaidSales + currentOrder.subtotal,
                      earnedCommission: r.earnedCommission + earned,
                    }
                  : r
              );
              await saveCollectionValue(txDb, 'resellers', nextResellers);
            }
          }

          if (status === 'returned' && !wasReturned) {
            await insertCrmActivityEvent(txDb, {
              customerId: updatedOrder.customerId,
              phone: updatedOrder.phone,
              eventType: 'order_returned',
              orderNumber: updatedOrder.orderNumber,
              amount: updatedOrder.totalAmount,
              notes: `COD order marked returned (${updatedOrder.courierPartner})`,
            });
          }
          if (status === 'delivered' && !wasDelivered) {
            await insertCrmActivityEvent(txDb, {
              customerId: updatedOrder.customerId,
              phone: updatedOrder.phone,
              eventType: 'order_delivered',
              orderNumber: updatedOrder.orderNumber,
              amount: updatedOrder.totalAmount,
              notes: `COD parcel delivered via ${updatedOrder.courierPartner}`,
            });
          }
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update order status.' });
        return;
      }

      broadcastSyncEvent('orders', req.header('x-client-id'));
      res.json({ ok: true, order: updatedOrder, syncVersion: getSyncVersion() });
    })
  );

  // 9C. BACKEND ORDER HISTORY AUDIT & REPAIR ENDPOINT (ADMIN / MANAGER)
  app.post(
    '/api/orders/audit-repair',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
        res
          .status(403)
          .json({ error: 'Only administrators or store managers can audit and repair backend order history.' });
        return;
      }
      try {
        const result = await auditAndRepairOrderHistory();
        const db = await getDb();
        await insertAdminAuditLog(db, {
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
    })
  );

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

  app.put(
    '/api/collections/:collectionKey',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
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
      const expectedVersion =
        typeof req.body?.expectedVersion === 'number' && Number.isFinite(req.body.expectedVersion)
          ? req.body.expectedVersion
          : undefined;
      const sourceClientId = req.header('x-client-id') || undefined;

      if (data === undefined) {
        res.status(400).json({ error: 'Request body must contain { data }.' });
        return;
      }

      // Guardrail: never allow an empty array sync/import payload to wipe out any existing collection.
      if (Array.isArray(data) && data.length === 0) {
        res.json({
          ok: true,
          skippedEmptyOverwrite: true,
          syncVersion: getSyncVersion(),
          collectionVersion: getCollectionVersionInfo(key).version,
        });
        return;
      }

      if (expectedVersion !== undefined) {
        const currentVerInfo = getCollectionVersionInfo(key);
        if (
          currentVerInfo.version > expectedVersion &&
          currentVerInfo.clientId &&
          sourceClientId &&
          currentVerInfo.clientId !== sourceClientId
        ) {
          const fullState = await getFullSyncState(actor);
          res.status(409).json({
            conflict: true,
            error: `Newer changes for "${key}" exist on the server from another device.`,
            collectionKey: key,
            latestVersion: currentVerInfo.version,
            latestData: fullState[key],
            syncVersion: getSyncVersion(),
          });
          return;
        }
      }

      try {
        await withDbTransaction(async (txDb) => {
          if (key === 'products' && Array.isArray(data)) {
            // Non-destructive upsert only: never delete existing products omitted from sync/import payload
            const incomingList = data as ProductItem[];
            for (const item of incomingList) {
              if (item?.id) {
                await upsertProductRow(txDb, item);
              }
            }
            bumpCollectionVersion('products', sourceClientId);
          } else if (key === 'categories' && Array.isArray(data)) {
            // Non-destructive upsert only: never delete existing categories omitted from sync/import payload
            const incoming = (data as CategoryRecord[]).map(normalizeUpcomingCategoryRecord);
            const hasUpcoming = incoming.some((c) => c.id === UPCOMING_CATEGORY_ID || c.isUpcoming);
            if (!hasUpcoming) {
              const existingUp = (await getAllCategoriesFromDb(txDb)).find(
                (c) => c.id === UPCOMING_CATEGORY_ID || c.isUpcoming
              );
              if (existingUp) incoming.push(existingUp);
            }
            for (const cat of incoming) {
              if (cat?.id && cat?.name) {
                await upsertCategoryRow(txDb, cat);
              }
            }
            bumpCollectionVersion('categories', sourceClientId);
          } else if (key === 'customers' && Array.isArray(data)) {
            // Non-destructive upsert only: preserve existing PINs, createdAt, and omitted fields; never delete missing customers
            const incoming = data as Customer[];
            const existing = await getAllCustomersFromDb(txDb);
            const existingById = new Map(existing.map((c) => [c.id, c]));
            for (const c of incoming) {
              if (c?.id) {
                const prev = existingById.get(c.id);
                await upsertCustomerRow(txDb, {
                  ...c,
                  pin: c.pin || prev?.pin,
                });
              }
            }
            bumpCollectionVersion('customers', sourceClientId);
          } else if (key === 'cities' && Array.isArray(data)) {
            await replaceCitiesAndAreasFromList(txDb, data as DeliveryCityConfig[]);
            await syncDeliveryCitiesIntoBusinessProfile(txDb);
            bumpCollectionVersion('cities', sourceClientId);
          } else if (key === 'business_profile' && typeof data === 'object' && data !== null) {
            const incomingBp = data as BusinessProfile;
            const currentBp = await getCollectionValue<BusinessProfile>(txDb, 'business_profile', defaultBusinessProfile);
            const mergedBp = mergePreservingOmittedFields(
              currentBp as unknown as Record<string, unknown>,
              incomingBp as unknown as Partial<Record<string, unknown>>
            ) as unknown as BusinessProfile;
            mergedBp.shippingPartner = {
              ...(currentBp.shippingPartner || {}),
              ...(incomingBp.shippingPartner || {}),
              apiKey: incomingBp.shippingPartner?.apiKey || currentBp.shippingPartner?.apiKey || '',
            } as BusinessProfile['shippingPartner'];
            delete mergedBp.adminPin;
            if (Array.isArray(mergedBp.deliveryCities)) {
              await replaceCitiesAndAreasFromList(txDb, mergedBp.deliveryCities);
            }
            await saveCollectionValue(
              txDb,
              'business_profile',
              {
                ...mergedBp,
                deliveryCities: await getAllCitiesFromDb(txDb),
              },
              sourceClientId
            );
          } else if (key === 'user_accounts' && Array.isArray(data)) {
            const existingAccounts = await getCollectionValue<UserAccount[]>(txDb, 'user_accounts', []);
            const byId = new Map(existingAccounts.map((u) => [u.id, u]));
            const working = [...existingAccounts];
            const workingIndex = new Map(working.map((u, idx) => [u.id, idx]));
            const nowIso = new Date().toISOString();

            for (const u of data as UserAccount[]) {
              if (!u?.id) continue;
              const prev = byId.get(u.id);
              const clean = sanitizeAndValidateCollectionItemDates(
                u as unknown as Record<string, unknown>,
                prev as unknown as Record<string, unknown> | undefined,
                nowIso
              ) as unknown as UserAccount;
              delete clean.suggestedDefaultPin;
              delete clean.resetToken;
              delete clean.resetTokenExpiresAt;
              if (!prev) {
                if (clean.passwordHash && !clean.passwordHash.startsWith('scrypt:') && !clean.passwordSalt) {
                  const h = hashServerSecret(clean.passwordHash);
                  clean.passwordHash = h.hash;
                  clean.passwordSalt = h.salt;
                }
                working.push(clean);
                workingIndex.set(clean.id, working.length - 1);
              } else {
                const idx = workingIndex.get(clean.id)!;
                working[idx] = {
                  ...clean,
                  passwordHash: clean.passwordHash || prev.passwordHash,
                  passwordSalt: clean.passwordSalt || prev.passwordSalt,
                };
              }
            }
            await saveCollectionValue(txDb, 'user_accounts', working, sourceClientId);
          } else if (key === 'review_rewards' && Array.isArray(data) && !isAdmin && !isManager && !isStaff) {
            // Non-admin customers may only add their own pending review submissions non-destructively
            const currentReviews = await getCollectionValue<ReviewRewardSubmission[]>(txDb, 'review_rewards', []);
            const currentMap = new Map(currentReviews.map((r) => [r.id, r]));
            const nowIso = new Date().toISOString();
            for (const rawRev of data as ReviewRewardSubmission[]) {
              if (
                rawRev?.id &&
                !currentMap.has(rawRev.id) &&
                (rawRev.customerId === actor.customerId || !actor.customerId)
              ) {
                const sanitized = sanitizeAndValidateCollectionItemDates(
                  { ...rawRev, status: 'pending', voucherCode: undefined },
                  undefined,
                  nowIso
                ) as unknown as ReviewRewardSubmission;
                currentReviews.unshift(sanitized);
              }
            }
            await saveCollectionValue(txDb, 'review_rewards', currentReviews, sourceClientId);
          } else if (Array.isArray(data)) {
            await mergeCollectionArrayNonDestructively(txDb, key, data as Array<Record<string, unknown>>, {
              sourceClientId,
            });
          } else {
            await saveCollectionValue(txDb, key, data, sourceClientId);
          }
        });
      } catch (err) {
        sendRouteError(res, err, 'Failed to persist collection.');
        return;
      }

      broadcastSyncEvent(key, sourceClientId);
      res.json({
        ok: true,
        syncVersion: getSyncVersion(),
        collectionVersion: getCollectionVersionInfo(key).version,
      });
    })
  );

  // Explicit single-item DELETE endpoint for collection items (e.g., expenses, employees, attendance, notifications, recurring, etc.)
  app.delete(
    '/api/collections/:collectionKey/items/:itemId',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required to delete records.' });
        return;
      }
      const key = req.params.collectionKey;
      const itemId = req.params.itemId;
      const isAdmin = actor.role === 'super_admin' || actor.role === 'admin';
      const isManager = actor.role === 'manager';
      const isStaff = actor.role === 'staff';

      if (ADMIN_ONLY_COLLECTIONS.has(key) && !isAdmin) {
        res.status(403).json({ error: `Only administrators can delete from "${key}".` });
        return;
      }
      if (!isAdmin && !isManager) {
        if (!isStaff || !STAFF_WRITABLE_COLLECTIONS.has(key)) {
          res.status(403).json({ error: `Insufficient permissions to delete from "${key}".` });
          return;
        }
      }

      if (key === 'products' || key === 'categories' || key === 'customers') {
        res.status(400).json({ error: `Use /api/${key}/:id DELETE endpoint to delete ${key} records.` });
        return;
      }

      let removed = false;
      await withDbTransaction(async (txDb) => {
        const current = await getCollectionValue<Array<Record<string, unknown>>>(txDb, key, []);
        if (!Array.isArray(current)) return;
        const filtered = current.filter((item) => String(item?.id || '') !== itemId);
        if (filtered.length !== current.length) {
          removed = true;
          await saveCollectionValue(txDb, key, filtered);
          await insertAdminAuditLog(txDb, {
            action: `delete_collection_item_${key}`,
            entityType: key,
            entityId: itemId,
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
          });
        }
      });

      if (removed) {
        broadcastSyncEvent(key, req.header('x-client-id'));
      }
      res.json({ ok: true, removed, syncVersion: getSyncVersion() });
    })
  );

  // 11. COMPLETE INTEGRATED CRM API ROUTER (/api/crm/*)
  const buildAllCustomer360Profiles = async (db: DbExecutor) => {
    const customers = (await getAllCustomersFromDb(db)).map((c) => {
      const clean = { ...c };
      delete clean.pin;
      return clean;
    });
    const transactions = await getCollectionValue<Transaction[]>(db, 'transactions', []);
    const codOrders = await getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
    const products = await getAllProductsFromDb(db);
    const resellers = await getCollectionValue<Reseller[]>(db, 'resellers', []);
    const loyaltyAccounts = await getAllCrmLoyaltyAccounts(db);
    const loyaltyLedger = await getAllCrmLoyaltyLedger(db);
    const followUps = await getAllCrmFollowUps(db);
    const tickets = await getAllCrmTickets(db);
    const coupons = await getAllCrmCoupons(db);
    const activityEvents = await getAllCrmActivityEvents(db);
    const reviewRewards = await getCollectionValue<ReviewRewardSubmission[]>(db, 'review_rewards', []);
    const customRules = await getAllCrmCustomSegments(db);

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

  const requireCrmActor = async (
    req: Request,
    res: Response,
    requiredPerm?: keyof CRMPermissions
  ): Promise<ResolvedActor | null> => {
    const actor = await resolveActor(req);
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

  app.get(
    '/api/crm/state',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
      const leads = await getAllCrmLeads(db);
      const campaigns = await getAllCrmCampaigns(db);
      const automationRules = await getAllCrmAutomationRules(db);
      const automationLogs = await getAllCrmAutomationLogs(db, 150);
      const loyaltyConfig = await getCrmLoyaltyConfig(db);

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
    })
  );

  app.get(
    '/api/crm/dashboard',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
      const leads = await getAllCrmLeads(db);
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
    })
  );

  app.get(
    '/api/crm/customers',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
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
    })
  );

  app.get(
    '/api/crm/customers/:id/360',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const isOps =
        actor.role === 'super_admin' ||
        actor.role === 'admin' ||
        actor.role === 'manager' ||
        actor.role === 'staff';
      if (!isOps && actor.customerId !== req.params.id) {
        res.status(403).json({ error: 'Access denied to another customer 360 profile.' });
        return;
      }
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
      const profile = bundle.profiles.find((p) => p.customer.id === req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }
      res.json({ ok: true, profile });
    })
  );

  app.put(
    '/api/crm/customers/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canEditCustomers');
      if (!actor) return;
      const db = await getDb();
      const existing = (await getAllCustomersFromDb(db)).find((c) => c.id === req.params.id);
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
      const saved = await upsertCustomerRow(db, updated);
      if (body.notes && body.notes !== existing.notes) {
        await insertCrmActivityEvent(db, {
          customerId: saved.id,
          phone: saved.phone,
          eventType: 'note_added',
          notes: `${actor.name || 'CRM'}: ${body.notes}`,
        });
      }
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({ ok: true, customer: saved });
    })
  );

  // Custom Segments CRUD
  app.get(
    '/api/crm/segments',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      res.json({
        ok: true,
        autoSegments: ALL_AUTO_SEGMENTS,
        customSegments: await getAllCrmCustomSegments(),
      });
    })
  );

  app.post(
    '/api/crm/segments',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageSegments');
      if (!actor) return;
      const body = req.body as Partial<CRMCustomSegmentRule>;
      if (!body?.name?.trim()) {
        res.status(400).json({ error: 'Segment rule name is required.' });
        return;
      }
      const db = await getDb();
      const rule = await upsertCrmCustomSegment(db, {
        id: body.id || `seg_${Date.now()}`,
        name: body.name.trim(),
        description: body.description?.trim(),
        isActive: body.isActive !== false,
        criteria: body.criteria || {},
        createdAt: body.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json({ ok: true, segment: rule, customSegments: await getAllCrmCustomSegments(db) });
    })
  );

  app.delete(
    '/api/crm/segments/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageSegments');
      if (!actor) return;
      const db = await getDb();
      await deleteCrmCustomSegment(db, req.params.id);
      res.json({ ok: true, customSegments: await getAllCrmCustomSegments(db) });
    })
  );

  // Follow-up Tasks CRUD
  app.get(
    '/api/crm/tasks',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      res.json({ ok: true, tasks: await getAllCrmFollowUps() });
    })
  );

  app.post(
    '/api/crm/tasks',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageFollowUps');
      if (!actor) return;
      const body = req.body as Partial<CRMFollowUpTask>;
      if (!body?.title?.trim() || !body?.followUpDate) {
        res.status(400).json({ error: 'Task title and follow-up date are required.' });
        return;
      }
      const db = await getDb();
      const task = await upsertCrmFollowUp(db, {
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
      res.json({ ok: true, task, tasks: await getAllCrmFollowUps(db) });
    })
  );

  app.put(
    '/api/crm/tasks/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageFollowUps');
      if (!actor) return;
      const db = await getDb();
      const existing = (await getAllCrmFollowUps(db)).find((t) => t.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Follow-up task not found.' });
        return;
      }
      const updated = await upsertCrmFollowUp(db, {
        ...existing,
        ...(req.body as Partial<CRMFollowUpTask>),
        id: existing.id,
      });
      res.json({ ok: true, task: updated, tasks: await getAllCrmFollowUps(db) });
    })
  );

  app.delete(
    '/api/crm/tasks/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageFollowUps');
      if (!actor) return;
      const db = await getDb();
      await deleteCrmFollowUp(db, req.params.id);
      res.json({ ok: true, tasks: await getAllCrmFollowUps(db) });
    })
  );

  // Leads Pipeline + Duplicate-Safe Conversion
  app.get(
    '/api/crm/leads',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      res.json({ ok: true, leads: await getAllCrmLeads() });
    })
  );

  app.post(
    '/api/crm/leads',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLeads');
      if (!actor) return;
      const body = req.body as Partial<CRMLead>;
      if (!body?.leadName?.trim() || !body?.phone?.trim()) {
        res.status(400).json({ error: 'Lead name and phone number are required.' });
        return;
      }
      const db = await getDb();
      const lead = await upsertCrmLead(db, {
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
      res.json({ ok: true, lead, leads: await getAllCrmLeads(db) });
    })
  );

  app.post(
    '/api/crm/leads/bulk-import',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLeads');
      if (!actor) return;

      const body = (req.body || {}) as {
        leads?: Array<Partial<CRMLead>>;
        defaultSource?: CRMSourceChannel;
        defaultStage?: CRMLeadStage;
        skipDuplicates?: boolean;
        updateDuplicates?: boolean;
      };

      const rawRows = Array.isArray(body.leads) ? body.leads : [];
      if (rawRows.length === 0) {
        res.status(400).json({ error: 'No leads provided for import.' });
        return;
      }
      if (rawRows.length > 2000) {
        res.status(400).json({ error: 'Batch size exceeds 2,000 leads per upload. Please split into smaller files.' });
        return;
      }

      const ALLOWED_SOURCES = new Set<CRMSourceChannel>([
        'WhatsApp',
        'Website',
        'Facebook',
        'Instagram',
        'Walk-in',
        'Phone',
        'Referral',
        'Reseller Network',
      ]);
      const ALLOWED_STAGES = new Set<CRMLeadStage>([
        'New',
        'Contacted',
        'Interested',
        'Follow-up',
        'Converted',
        'Lost',
      ]);

      const defaultSource: CRMSourceChannel = ALLOWED_SOURCES.has(body.defaultSource as CRMSourceChannel)
        ? (body.defaultSource as CRMSourceChannel)
        : 'WhatsApp';
      const defaultStage: CRMLeadStage = ALLOWED_STAGES.has(body.defaultStage as CRMLeadStage)
        ? (body.defaultStage as CRMLeadStage)
        : 'New';
      const skipDuplicates = body.skipDuplicates !== false;
      const updateDuplicates = body.updateDuplicates === true;

      const result = await withDbTransaction(async (txDb) => {
        const existingLeads = await getAllCrmLeads(txDb);
        const allProducts = await getAllProductsFromDb(txDb);
        const phoneMap = new Map<string, CRMLead>();
        for (const existing of existingLeads) {
          const digits = normalizePhoneDigits(existing.phone);
          if (digits.length >= 7) {
            phoneMap.set(digits, existing);
          }
        }

        let importedCount = 0;
        let updatedCount = 0;
        let skippedDuplicatesCount = 0;
        let invalidCount = 0;
        const nowIso = new Date().toISOString();

        for (let i = 0; i < rawRows.length; i++) {
          const row = rawRows[i];
          const leadName = typeof row?.leadName === 'string' ? row.leadName.trim() : '';
          const phone = typeof row?.phone === 'string' ? row.phone.trim() : '';
          const digits = normalizePhoneDigits(phone);

          if (!leadName || digits.length < 7) {
            invalidCount++;
            continue;
          }

          // Strictly validate all incoming dates on every row (throws HTTP 400 DateValidationError cleanly; never silently replaces with today's date)
          const validIncomingCreatedAt = validateAndNormalizeDateTime(
            row.createdAt,
            `leads[${i}].createdAt`
          );
          const validIncomingUpdatedAt = validateAndNormalizeDateTime(
            row.updatedAt,
            `leads[${i}].updatedAt`
          );
          const validFollowUpDate = validateAndNormalizeDateOnly(
            row.followUpDate,
            `leads[${i}].followUpDate`
          );

          const source: CRMSourceChannel = ALLOWED_SOURCES.has(row.source as CRMSourceChannel)
            ? (row.source as CRMSourceChannel)
            : defaultSource;
          const stage: CRMLeadStage = ALLOWED_STAGES.has(row.stage as CRMLeadStage)
            ? (row.stage as CRMLeadStage)
            : defaultStage;

          const rawProductName =
            typeof row.interestedProductName === 'string' ? row.interestedProductName.trim() : '';
          const matchedProduct =
            (row.interestedProductId && allProducts.find((p) => p.id === row.interestedProductId)) ||
            (rawProductName
              ? allProducts.find((p) => p.name.toLowerCase() === rawProductName.toLowerCase())
              : undefined);

          const existingMatch = phoneMap.get(digits);
          if (existingMatch) {
            if (updateDuplicates) {
              const updated = await upsertCrmLead(txDb, {
                ...existingMatch,
                leadName: leadName || existingMatch.leadName,
                city: (typeof row.city === 'string' && row.city.trim()) || existingMatch.city,
                whatsapp: (typeof row.whatsapp === 'string' && row.whatsapp.trim()) || existingMatch.whatsapp,
                email: (typeof row.email === 'string' && row.email.trim()) || existingMatch.email,
                interestedProductId: matchedProduct?.id || existingMatch.interestedProductId,
                interestedProductName:
                  matchedProduct?.name || rawProductName || existingMatch.interestedProductName,
                estimatedValue:
                  Number(row.estimatedValue || 0) > 0
                    ? Math.round(Number(row.estimatedValue))
                    : existingMatch.estimatedValue,
                followUpDate: validFollowUpDate || existingMatch.followUpDate,
                notes:
                  [existingMatch.notes, typeof row.notes === 'string' ? row.notes.trim() : '']
                    .filter(Boolean)
                    .join(' | ') || undefined,
                createdAt: existingMatch.createdAt,
                updatedAt: validIncomingUpdatedAt,
              });
              phoneMap.set(digits, updated);
              updatedCount++;
              continue;
            }
            if (skipDuplicates) {
              skippedDuplicatesCount++;
              continue;
            }
          }

          const createdAtValue = validIncomingCreatedAt || nowIso;
          const created = await upsertCrmLead(txDb, {
            id: `lead_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            leadName,
            phone,
            whatsapp: typeof row.whatsapp === 'string' ? row.whatsapp.trim() || undefined : undefined,
            email: typeof row.email === 'string' ? row.email.trim() || undefined : undefined,
            city: typeof row.city === 'string' ? row.city.trim() || undefined : undefined,
            source,
            interestedProductId: matchedProduct?.id || row.interestedProductId,
            interestedProductName: matchedProduct?.name || rawProductName || undefined,
            estimatedValue: Math.max(0, Math.round(Number(row.estimatedValue || 0))),
            assignedSalespersonId: row.assignedSalespersonId || actor.id,
            assignedSalespersonName: row.assignedSalespersonName || actor.name || 'Sales',
            notes: typeof row.notes === 'string' ? row.notes.trim() || undefined : undefined,
            followUpDate: validFollowUpDate,
            stage,
            createdAt: createdAtValue,
            updatedAt: validIncomingUpdatedAt || createdAtValue,
          });
          phoneMap.set(digits, created);
          importedCount++;
        }

        await insertAdminAuditLog(txDb, {
          action: 'crm_leads_bulk_import',
          entityType: 'crm_lead',
          entityId: 'bulk_import',
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          details: {
            importedCount,
            updatedCount,
            skippedDuplicatesCount,
            invalidCount,
          },
        });

        return {
          importedCount,
          updatedCount,
          skippedDuplicatesCount,
          invalidCount,
          leads: await getAllCrmLeads(txDb),
        };
      });

      broadcastSyncEvent('crm_leads', req.header('x-client-id'));
      res.json({ ok: true, ...result });
    })
  );

  app.put(
    '/api/crm/leads/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLeads');
      if (!actor) return;
      const db = await getDb();
      const existing = (await getAllCrmLeads(db)).find((l) => l.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Lead not found.' });
        return;
      }
      const updated = await upsertCrmLead(db, {
        ...existing,
        ...(req.body as Partial<CRMLead>),
        id: existing.id,
      });
      res.json({ ok: true, lead: updated, leads: await getAllCrmLeads(db) });
    })
  );

  app.post(
    '/api/crm/leads/:id/convert',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLeads');
      if (!actor) return;
      const db = await getDb();
      const lead = (await getAllCrmLeads(db)).find((l) => l.id === req.params.id);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found.' });
        return;
      }
      const leadDigits = normalizePhoneDigits(lead.phone);
      const existingCustomers = await getAllCustomersFromDb(db);
      let targetCustomer = existingCustomers.find((c) => normalizePhoneDigits(c.phone) === leadDigits);
      let reusedExisting = false;

      if (targetCustomer) {
        reusedExisting = true;
        targetCustomer = await upsertCustomerRow(db, {
          ...targetCustomer,
          customerSource: targetCustomer.customerSource || lead.source,
          notes: [targetCustomer.notes, lead.notes].filter(Boolean).join(' | ') || undefined,
        });
      } else {
        targetCustomer = await upsertCustomerRow(db, {
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

      const updatedLead = await upsertCrmLead(db, {
        ...lead,
        stage: 'Converted',
        convertedCustomerId: targetCustomer.id,
        convertedAt: new Date().toISOString(),
      });
      await insertCrmActivityEvent(db, {
        customerId: targetCustomer.id,
        phone: targetCustomer.phone,
        eventType: 'lead_converted',
        notes: `Lead converted from ${lead.source}${
          reusedExisting ? ' (linked to existing customer — zero duplicate created)' : ''
        }`,
      });
      broadcastSyncEvent('customers', req.header('x-client-id'));
      res.json({
        ok: true,
        lead: updatedLead,
        customer: targetCustomer,
        reusedExisting,
        leads: await getAllCrmLeads(db),
      });
    })
  );

  // Campaigns Management (with opt-out filtering & explicit Admin approval guard)
  app.get(
    '/api/crm/campaigns',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      res.json({ ok: true, campaigns: await getAllCrmCampaigns() });
    })
  );

  app.post(
    '/api/crm/campaigns',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageCampaigns');
      if (!actor) return;
      const body = req.body as Partial<CRMCampaign>;
      if (!body?.name?.trim() || !body?.messageBody?.trim()) {
        res.status(400).json({ error: 'Campaign name and message body are required.' });
        return;
      }
      const db = await getDb();
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

      const bundle = await buildAllCustomer360Profiles(db);
      const hasManualGroup =
        body.campaignMode === 'manual_bundle' &&
        Array.isArray(body.targetRecipientIds) &&
        body.targetRecipientIds.length > 0;
      const manualIdSet = new Set(hasManualGroup ? body.targetRecipientIds : []);
      const recipients = hasManualGroup
        ? bundle.profiles.filter((p) => !p.customer.whatsappOptOut && manualIdSet.has(p.customer.id))
        : bundle.profiles.filter((p) => {
            if (p.customer.whatsappOptOut) return false;
            if (
              body.segmentName &&
              !p.autoSegments.includes(body.segmentName as (typeof p.autoSegments)[number]) &&
              !p.customSegments.includes(body.segmentName)
            ) {
              return false;
            }
            if (body.targetCity && !(p.customer.city || '').toLowerCase().includes(body.targetCity.toLowerCase())) {
              return false;
            }
            return true;
          });

      const campaign = await upsertCrmCampaign(db, {
        id: body.id || `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: body.name.trim(),
        templateType: body.templateType || 'discount_offer',
        campaignMode: body.campaignMode || 'segment',
        bundleTitle: body.bundleTitle?.trim() || undefined,
        bundleProductIds: Array.isArray(body.bundleProductIds) ? body.bundleProductIds : undefined,
        bundleOfferPrice: typeof body.bundleOfferPrice === 'number' ? body.bundleOfferPrice : undefined,
        mediaImageUrl: body.mediaImageUrl?.trim() || undefined,
        mediaVideoUrl: body.mediaVideoUrl?.trim() || undefined,
        ctaLabel: body.ctaLabel?.trim() || undefined,
        ctaUrl: body.ctaUrl?.trim() || undefined,
        targetRecipientIds: Array.isArray(body.targetRecipientIds) ? body.targetRecipientIds : undefined,
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
        recipientsCount:
          body.recipientsCount ??
          (hasManualGroup ? body.targetRecipientIds!.length : recipients.length),
        sentCount: body.sentCount ?? 0,
        conversionsCount: body.conversionsCount ?? 0,
        revenueGenerated: body.revenueGenerated ?? 0,
        createdAt: body.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json({
        ok: true,
        campaign,
        matchedRecipientsCount: recipients.length,
        campaigns: await getAllCrmCampaigns(db),
      });
    })
  );

  app.put(
    '/api/crm/campaigns/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageCampaigns');
      if (!actor) return;
      const db = await getDb();
      const existing = (await getAllCrmCampaigns(db)).find((c) => c.id === req.params.id);
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
      const updated = await upsertCrmCampaign(db, {
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
      res.json({ ok: true, campaign: updated, campaigns: await getAllCrmCampaigns(db) });
    })
  );

  // Loyalty Config, Redemption & Coupons
  app.get(
    '/api/crm/loyalty',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const db = await getDb();
      const config = await getCrmLoyaltyConfig(db);
      if (actor.role === 'customer') {
        const accounts = (await getAllCrmLoyaltyAccounts(db)).filter((a) => a.customerId === actor.customerId);
        const ledger = await getAllCrmLoyaltyLedger(db, actor.customerId);
        const coupons = (await getAllCrmCoupons(db)).filter(
          (cp) => !cp.customerId || cp.customerId === actor.customerId
        );
        res.json({ ok: true, config, accounts, ledger, coupons });
        return;
      }
      if (
        actor.role !== 'super_admin' &&
        actor.role !== 'admin' &&
        actor.role !== 'manager' &&
        actor.role !== 'staff'
      ) {
        res.status(403).json({ error: 'Unauthorized.' });
        return;
      }
      res.json({
        ok: true,
        config,
        accounts: await getAllCrmLoyaltyAccounts(db),
        ledger: await getAllCrmLoyaltyLedger(db),
        coupons: await getAllCrmCoupons(db),
      });
    })
  );

  app.put(
    '/api/crm/loyalty',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLoyalty');
      if (!actor) return;
      const db = await getDb();
      const current = await getCrmLoyaltyConfig(db);
      const next: CRMLoyaltyConfig = { ...current, ...(req.body as Partial<CRMLoyaltyConfig>) };
      await saveCrmLoyaltyConfig(db, next);
      res.json({ ok: true, config: next });
    })
  );

  app.post(
    '/api/crm/loyalty/redeem',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
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

      const db = await getDb();
      const accounts = await getAllCrmLoyaltyAccounts(db);
      const acc = accounts.find((a) => a.customerId === targetCustId);
      if (!acc || acc.pointsBalance < pts) {
        res.status(400).json({ error: `Insufficient loyalty points (available: ${acc?.pointsBalance || 0}).` });
        return;
      }

      const cfg = await getCrmLoyaltyConfig(db);
      const discountValue = Math.max(10, Math.round(pts * (cfg.pkrPerPoint || 1)));
      const code = `100D-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + (cfg.couponValidityDays || 30) * 86400000).toISOString();

      let updatedAccount;
      let coupon;
      try {
        await withDbTransaction(async (txDb) => {
          updatedAccount = await adjustCustomerLoyaltyPoints(txDb, {
            customerId: targetCustId,
            pointsDelta: -pts,
            type: 'redeemed',
            couponCode: code,
            notes: notes || `Redeemed ${pts} pts for Rs. ${discountValue} coupon`,
          });
          coupon = await upsertCrmCoupon(txDb, {
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
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Redemption failed.' });
        return;
      }

      res.json({ ok: true, account: updatedAccount, coupon });
    })
  );

  app.post(
    '/api/crm/coupons',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageLoyalty');
      if (!actor) return;
      const body = req.body as Partial<CRMLoyaltyCoupon>;
      if (!body?.code?.trim() || !Number.isFinite(Number(body.discountValue))) {
        res.status(400).json({ error: 'Coupon code and discount value are required.' });
        return;
      }
      const db = await getDb();
      const normalizedCode = body.code.trim().toUpperCase();
      const existingCode = (await getAllCrmCoupons(db)).find(
        (cp) => cp.code.toUpperCase() === normalizedCode && cp.id !== body.id
      );
      if (existingCode) {
        res.status(409).json({ error: `Coupon code "${normalizedCode}" already exists. Please use a unique code.` });
        return;
      }
      const coupon = await upsertCrmCoupon(db, {
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
      res.json({ ok: true, coupon, coupons: await getAllCrmCoupons(db) });
    })
  );

  // Support & Complaint Tickets (Open to signed-in customers for their own tickets + CRM staff)
  const actorCanManageAllTickets = (actor: ResolvedActor): boolean =>
    actor.role === 'super_admin' ||
    actor.role === 'admin' ||
    Boolean(actor.crmPermissions?.canManageTickets);

  const doesTicketBelongToActor = (ticket: CRMSupportTicket, actor: ResolvedActor): boolean => {
    if (!actor.id) return false;
    if (
      ticket.customerId &&
      (ticket.customerId === actor.customerId || ticket.customerId === actor.id)
    ) {
      return true;
    }
    const actorPhone = normalizePhoneDigits(actor.phone || '');
    const ticketPhone = normalizePhoneDigits(ticket.customerPhone || '');
    return Boolean(actorPhone && ticketPhone && actorPhone === ticketPhone);
  };

  app.get(
    '/api/crm/tickets',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Please sign in to view support tickets.' });
        return;
      }
      const allTickets = await getAllCrmTickets();
      if (actorCanManageAllTickets(actor)) {
        res.json({ ok: true, tickets: allTickets });
        return;
      }
      res.json({
        ok: true,
        tickets: allTickets.filter((t) => doesTicketBelongToActor(t, actor)),
      });
    })
  );

  app.post(
    '/api/crm/tickets',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Please sign in first to create a support ticket.' });
        return;
      }
      const body = req.body as Partial<CRMSupportTicket>;
      if (!body?.subject?.trim()) {
        res.status(400).json({ error: 'Ticket subject is required.' });
        return;
      }
      const isStaffTicketManager = actorCanManageAllTickets(actor);
      const priority = body.priority || 'Medium';
      const slaHours = priority === 'Urgent' ? 4 : priority === 'High' ? 12 : priority === 'Low' ? 48 : 24;
      const nowMs = Date.now();
      const incomingCreatedAt = validateAndNormalizeDateTime(body.createdAt, 'createdAt');
      const incomingDueAt = validateAndNormalizeDateTime(body.dueAt, 'dueAt');
      const nowIso = new Date(nowMs).toISOString();
      const ticketCreatedAt = incomingCreatedAt || nowIso;
      const db = await getDb();
      const ticket = await upsertCrmTicket(db, {
        id: `tkt_${nowMs}_${Math.random().toString(36).slice(2, 5)}`,
        ticketNumber: `TKT-100D-${String(nowMs).slice(-5)}`,
        customerId: isStaffTicketManager ? body.customerId || actor.customerId : actor.customerId || actor.id,
        customerName: isStaffTicketManager
          ? body.customerName || actor.name || 'Customer'
          : actor.name || body.customerName?.trim() || 'Customer',
        customerPhone: isStaffTicketManager
          ? body.customerPhone || actor.phone
          : actor.phone || body.customerPhone?.trim(),
        orderId: body.orderId,
        orderNumber: body.orderNumber?.trim() || undefined,
        category: body.category || 'Product Inquiry',
        priority,
        status: isStaffTicketManager ? body.status || 'Open' : 'Open',
        assignedEmployeeId: isStaffTicketManager ? body.assignedEmployeeId : undefined,
        assignedEmployeeName: isStaffTicketManager ? body.assignedEmployeeName : undefined,
        subject: body.subject.trim(),
        description: body.description?.trim(),
        resolutionNotes: isStaffTicketManager ? body.resolutionNotes?.trim() : undefined,
        dueAt: incomingDueAt || new Date(nowMs + slaHours * 3600000).toISOString(),
        createdAt: ticketCreatedAt,
        updatedAt: validateAndNormalizeDateTime(body.updatedAt, 'updatedAt') || ticketCreatedAt,
      });
      const allTickets = await getAllCrmTickets(db);
      broadcastSyncEvent('crm_tickets', req.header('x-client-id'));
      res.json({
        ok: true,
        ticket,
        tickets: isStaffTicketManager ? allTickets : allTickets.filter((t) => doesTicketBelongToActor(t, actor)),
      });
    })
  );

  app.put(
    '/api/crm/tickets/:id',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      if (!actor.id) {
        res.status(401).json({ error: 'Please sign in to update a support ticket.' });
        return;
      }
      const db = await getDb();
      const existing = (await getAllCrmTickets(db)).find((t) => t.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Support ticket not found.' });
        return;
      }

      const isStaffTicketManager = actorCanManageAllTickets(actor);
      if (!isStaffTicketManager && !doesTicketBelongToActor(existing, actor)) {
        res.status(403).json({ error: 'You can only view or update your own support tickets.' });
        return;
      }

      const incoming = req.body as Partial<CRMSupportTicket> & { customerFollowUpNote?: string };
      let updated: CRMSupportTicket;

      if (isStaffTicketManager) {
        updated = await upsertCrmTicket(db, {
          ...existing,
          ...incoming,
          id: existing.id,
        });
      } else {
        // Signed-in customer can keep/reopen their ticket as Open (or mark Closed) and append follow-up context
        const allowedCustomerStatus =
          incoming.status === 'Open' || incoming.status === 'Closed' ? incoming.status : existing.status;
        const followUpText =
          typeof incoming.customerFollowUpNote === 'string' ? incoming.customerFollowUpNote.trim() : '';
        const mergedDescription = followUpText
          ? [
              existing.description || '',
              `[Customer Update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}]: ${followUpText}`,
            ]
              .filter(Boolean)
              .join('\n')
          : typeof incoming.description === 'string' && incoming.description.trim()
          ? incoming.description.trim()
          : existing.description;

        const nowMs = Date.now();
        const refreshedDueAt =
          allowedCustomerStatus === 'Open' && new Date(existing.dueAt).getTime() < nowMs
            ? new Date(nowMs + 24 * 3600000).toISOString()
            : existing.dueAt;

        updated = await upsertCrmTicket(db, {
          ...existing,
          status: allowedCustomerStatus,
          description: mergedDescription,
          dueAt: refreshedDueAt,
          resolvedAt: allowedCustomerStatus === 'Open' ? undefined : existing.resolvedAt,
          id: existing.id,
        });
      }

      const allTickets = await getAllCrmTickets(db);
      broadcastSyncEvent('crm_tickets', req.header('x-client-id'));
      res.json({
        ok: true,
        ticket: updated,
        tickets: isStaffTicketManager ? allTickets : allTickets.filter((t) => doesTicketBelongToActor(t, actor)),
      });
    })
  );

  // Retention Automation Engine (Dry Run, Idempotency Keys & Consent/Approval Guards)
  app.get(
    '/api/crm/automation/rules',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canViewCrmDashboard');
      if (!actor) return;
      res.json({
        ok: true,
        rules: await getAllCrmAutomationRules(),
        logs: await getAllCrmAutomationLogs(),
      });
    })
  );

  app.put(
    '/api/crm/automation/rules/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageAutomation');
      if (!actor) return;
      const db = await getDb();
      const existing = (await getAllCrmAutomationRules(db)).find((r) => r.id === req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Automation rule not found.' });
        return;
      }
      const updated = await upsertCrmAutomationRule(db, {
        ...existing,
        ...(req.body as Partial<typeof existing>),
        id: existing.id,
      });
      res.json({ ok: true, rule: updated, rules: await getAllCrmAutomationRules(db) });
    })
  );

  app.post(
    '/api/crm/automation/run',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canManageFollowUps');
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
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
      const rules = (await getAllCrmAutomationRules(db)).filter((r) => (ruleId ? r.id === ruleId : r.enabled));
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
          const alreadyExecuted = await hasCrmAutomationIdempotencyKey(db, idempotencyKey);
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
            const fu = await upsertCrmFollowUp(db, {
              id: `fu_auto_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
              customerId: p.customer.id,
              customerName: p.customer.name,
              customerPhone: p.customer.phone,
              taskType: rule.actionMode === 'both' ? 'WhatsApp' : 'Call',
              title: `[Auto] ${rule.name}`,
              followUpDate: todayStr,
              assignedEmployeeId: p.customer.assignedSalespersonId || actor.id,
              assignedEmployeeName: p.customer.assignedSalespersonName || actor.name || 'CRM Team',
              priority:
                rule.triggerType === 'payment_overdue' || rule.triggerType === 'frequent_cod_returns'
                  ? 'High'
                  : 'Medium',
              notes: renderedMessage,
              status: 'Pending',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            createdTaskId = fu.id;
          }

          const inserted = await insertCrmAutomationLog(db, {
            id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            ruleId: rule.id,
            ruleName: rule.name,
            triggerType: rule.triggerType,
            customerId: p.customer.id,
            customerName: p.customer.name,
            idempotencyKey,
            status: 'executed',
            actionSummary: `${
              rule.actionMode === 'queue_whatsapp' ? 'Queued WhatsApp template' : 'Created follow-up task'
            }${createdTaskId ? ` (${createdTaskId})` : ''}`,
            createdTaskId,
            createdAt: new Date().toISOString(),
          });
          if (inserted) {
            executedCount++;
            ruleExecutions++;
          }
        }

        if (!dryRun && ruleExecutions > 0) {
          await upsertCrmAutomationRule(db, {
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
        rules: await getAllCrmAutomationRules(db),
        logs: await getAllCrmAutomationLogs(db, 100),
      });
    })
  );

  // Activity Event Telemetry (real product views, inquiries, cart adds, calls, WhatsApp opens)
  app.post(
    '/api/crm/activity',
    asyncRoute(async (req, res) => {
      const actor = await resolveActor(req);
      const body = (req.body || {}) as Partial<CRMActivityEvent>;
      const allowedPublicTypes = new Set(['product_view', 'product_inquiry', 'cart_add', 'cart_abandon']);
      const eventType = body.eventType || 'product_view';
      if (!allowedPublicTypes.has(eventType) && !actor.id) {
        res.status(401).json({ error: 'Authentication required for internal CRM activity events.' });
        return;
      }
      const db = await getDb();
      const entry = await insertCrmActivityEvent(db, {
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
    })
  );

  // CRM Reports & CSV / Excel (.xls) Exports
  app.get(
    '/api/crm/reports/:reportKey',
    asyncRoute(async (req, res) => {
      const actor = await requireCrmActor(req, res, 'canExportReports');
      if (!actor) return;
      const reportKey = req.params.reportKey as CRMReportKey;
      const meta = CRM_REPORT_CATALOG.find((r) => r.key === reportKey);
      if (!meta) {
        res.status(404).json({ error: `Unknown CRM report key: ${reportKey}` });
        return;
      }
      const db = await getDb();
      const bundle = await buildAllCustomer360Profiles(db);
      const leads = await getAllCrmLeads(db);
      const campaigns = await getAllCrmCampaigns(db);
      const monthlyExpenses = await getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []);
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
    })
  );

  // Ensure unmatched /api/* routes return JSON 404 (never fall through to Vite/SPA index.html)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // /api JSON error handler BEFORE Vite/static middleware so malformed JSON or date validation errors always return JSON
  app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (isDateValidationError(err)) {
      res.status(400).json({ error: err.message });
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
          : errObj?.type === 'entity.parse.failed'
          ? 'Malformed JSON request body.'
          : errObj?.message || 'Unexpected server error.',
    });
  });

  const httpServer = http.createServer(app);
  let viteInstance: { close: () => Promise<void>; middlewares: express.RequestHandler } | null = null;

  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const distDirCandidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(serverDir, 'dist'),
  ];
  const distDir =
    distDirCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || distDirCandidates[0];
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));
  const kService = (process.env.K_SERVICE || '').trim();
  const isAiStudioDev = kService.startsWith('ais-dev-');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' && !isAiStudioDev && (Boolean(kService) || hasBuiltDist));

  // Frontend middleware / static dist serving (production NEVER starts Vite dev middleware)
  if (!isProduction) {
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
  } else if (!hasBuiltDist) {
    app.get('*', (_req, res) => {
      res.status(503);
      res.setHeader('Retry-After', '10');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.type('text/html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MadinaMarket — Build Updating</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
  <div style="max-width:440px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;text-align:center;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#ffd200;">MadinaMarket App Updating</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#cbd5e1;line-height:1.5;">The production frontend bundle is not built yet (<code>dist/index.html</code> missing). Run <code>npm run build</code> and refresh this page. All database records remain safe.</p>
    <button onclick="location.reload()" style="background:#ffd200;color:#0f172a;border:0;border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer;">Reload Page</button>
  </div>
</body>
</html>`);
    });
  } else {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    // Never return index.html for missing JS/CSS/media assets (prevents browser MIME-type crashes)
    app.use((req, res, next) => {
      if (
        req.path.startsWith('/assets/') ||
        /\.(?:js|mjs|css|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|eot|json)$/i.test(req.path)
      ) {
        res.status(404).type('text/plain').send('Asset not found.');
        return;
      }
      next();
    });
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const modeLabel = isProduction
    ? hasBuiltDist
      ? 'production-dist'
      : 'production-build-missing'
    : 'vite-dev';

  if (typeof PORT === 'string') {
    httpServer.listen(PORT, () => {
      console.log(`100DAGAR Full-Stack Server running on socket ${PORT} (${modeLabel})`);
    });
  } else {
    httpServer.listen(PORT, HOST, () => {
      console.log(`100DAGAR Full-Stack Server running on http://${HOST}:${PORT} (${modeLabel})`);
    });
  }

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
    void closeDb().catch(() => {});
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
