import type {
  AdminAuditLog,
  AppUser,
  AttendanceRecord,
  Branch,
  BroadcastContact,
  BusinessProfile,
  CartItem,
  CategoryRecord,
  CODOrder,
  CODOrderStatus,
  CommissionRecord,
  Customer,
  DeliveryCityConfig,
  Employee,
  Investor,
  InvestorProductOffering,
  InvestorProductRequest,
  InvestorTransaction,
  LoginAuditRecord,
  LoginFormConfig,
  LuckyDrawEvent,
  MonthlyExpense,
  ProductBroadcast,
  ProductImportLog,
  ProductItem,
  ProductVariation,
  RecurringInvoice,
  ReminderTemplate,
  Reseller,
  ReviewRewardSubmission,
  SalespersonReferral,
  SavedBroadcastCampaign,
  Transaction,
  UserAccount,
  UserRole,
  WalkInCustomer,
  WalkInSale,
  WasalSettlement,
  WhatsAppNotification,
  CRMActivityEvent,
  CRMAutomationRule,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMDashboardKPIs,
  CRMFollowUpTask,
  CRMLead,
  CRMLoyaltyAccount,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMLoyaltyLedgerEntry,
  CRMProductIntelligence,
  CRMReportKey,
  CRMSupportTicket,
  Customer360Profile,
} from '../types/index.ts';
import {
  defaultAttendance,
  defaultBranches,
  defaultBroadcastContacts,
  defaultBusinessProfile,
  defaultCategoryRecords,
  defaultCODOrders,
  defaultCommissionRecords,
  defaultCustomers,
  defaultDeliveryCities,
  defaultEmployees,
  defaultImportLogs,
  defaultInvestors,
  defaultInvestorTransactions,
  defaultLoginAuditLogs,
  defaultLoginFormConfig,
  defaultLuckyDrawEvents,
  defaultProductBroadcasts,
  defaultProducts,
  defaultRecurringInvoices,
  defaultReminderTemplates,
  defaultResellers,
  defaultReviewRewards,
  defaultSalespersonReferrals,
  defaultSavedBroadcasts,
  defaultTransactions,
  defaultUserAccounts,
  defaultWalkInCustomers,
  defaultWalkInSales,
  defaultWasalSettlements,
  defaultWhatsAppNotifications,
} from './defaultData.ts';
import {
  ensureCityAreasShape,
  isUpcomingCategoryName,
  normalizeTextKey,
  normalizeUpcomingCategoryRecord,
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
} from './locationCategoryHelpers.ts';
import {
  parseProductFromHtmlInBrowser,
  tryFetchProductInBrowserFallback,
} from './clientProductScraper.ts';

const STORAGE_KEYS = {
  PROFILE: '100dagar_business_profile_v5',
  CUSTOMERS: '100dagar_customers_v5',
  TRANSACTIONS: '100dagar_transactions_v5',
  PRODUCTS: '100dagar_products_v5',
  RECURRING: '100dagar_recurring_invoices_v5',
  NOTIFICATIONS: '100dagar_whatsapp_notifications_v5',
  TEMPLATES: '100dagar_reminder_templates_v5',
  BROADCASTS: '100dagar_product_broadcasts_v5',
  LUCKY_DRAWS: '100dagar_lucky_draws_v5',
  BROADCAST_CONTACTS: '100dagar_broadcast_contacts_v5',
  SAVED_BROADCASTS: '100dagar_saved_broadcasts_v5',
  COD_ORDERS: '100dagar_cod_orders_v5',
  EMPLOYEES: '100dagar_employees_v5',
  ATTENDANCE: '100dagar_attendance_v5',
  RESELLERS: '100dagar_resellers_v5',
  REVIEW_REWARDS: '100dagar_review_rewards_v5',
  ACTIVE_ROLE: '100dagar_active_role_v5',
  CURRENT_USER: '100dagar_current_user_v5',
  LOGIN_AUDITS: '100dagar_login_audits_v5',
  CATEGORIES: '100dagar_categories_v5',
  CATEGORY_RECORDS: '100dagar_category_records_v5',
  INVESTORS: '100dagar_investors_v5',
  INVESTOR_TRANSACTIONS: '100dagar_investor_transactions_v5',
  USER_ACCOUNTS: '100dagar_user_accounts_v5',
  LOGIN_CONFIG: '100dagar_login_config_v5',
  BRANCHES: '100dagar_branches_v5',
  SP_REFERRALS: '100dagar_sp_referrals_v5',
  WALK_IN_CUSTOMERS: '100dagar_walkin_customers_v5',
  WALK_IN_SALES: '100dagar_walkin_sales_v5',
  COMMISSIONS: '100dagar_commissions_v5',
  IMPORT_LOGS: '100dagar_import_logs_v5',
  WASAL_SETTLEMENTS: '100dagar_wasal_settlements_v5',
  MONTHLY_EXPENSES: '100dagar_monthly_expenses_v5',
  INVESTOR_OFFERINGS: '100dagar_investor_offerings_v5',
  INVESTOR_REQUESTS: '100dagar_investor_requests_v5',
  CART: '100dagar_cart_v5',
};

const MIGRATION_FLAG_KEY = '100dagar_server_migrated_v1';
const SESSION_TOKEN_KEY = '100dagar_session_token_v1';

// Unique per-tab client ID to suppress redundant self-triggered SSE reloads
const CLIENT_ID = `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Maps localStorage keys <-> Central SQLite collection keys
const STORAGE_TO_COLLECTION: Record<string, string> = {
  [STORAGE_KEYS.PROFILE]: 'business_profile',
  [STORAGE_KEYS.CUSTOMERS]: 'customers',
  [STORAGE_KEYS.TRANSACTIONS]: 'transactions',
  [STORAGE_KEYS.PRODUCTS]: 'products',
  [STORAGE_KEYS.RECURRING]: 'recurring_invoices',
  [STORAGE_KEYS.NOTIFICATIONS]: 'notifications',
  [STORAGE_KEYS.TEMPLATES]: 'templates',
  [STORAGE_KEYS.BROADCASTS]: 'product_broadcasts',
  [STORAGE_KEYS.LUCKY_DRAWS]: 'lucky_draws',
  [STORAGE_KEYS.BROADCAST_CONTACTS]: 'broadcast_contacts',
  [STORAGE_KEYS.SAVED_BROADCASTS]: 'saved_broadcasts',
  [STORAGE_KEYS.COD_ORDERS]: 'cod_orders',
  [STORAGE_KEYS.EMPLOYEES]: 'employees',
  [STORAGE_KEYS.ATTENDANCE]: 'attendance',
  [STORAGE_KEYS.RESELLERS]: 'resellers',
  [STORAGE_KEYS.REVIEW_REWARDS]: 'review_rewards',
  [STORAGE_KEYS.LOGIN_AUDITS]: 'login_audits',
  [STORAGE_KEYS.CATEGORY_RECORDS]: 'categories',
  [STORAGE_KEYS.INVESTORS]: 'investors',
  [STORAGE_KEYS.INVESTOR_TRANSACTIONS]: 'investor_transactions',
  [STORAGE_KEYS.USER_ACCOUNTS]: 'user_accounts',
  [STORAGE_KEYS.BRANCHES]: 'branches',
  [STORAGE_KEYS.SP_REFERRALS]: 'salesperson_referrals',
  [STORAGE_KEYS.WALK_IN_CUSTOMERS]: 'walkin_customers',
  [STORAGE_KEYS.WALK_IN_SALES]: 'walkin_sales',
  [STORAGE_KEYS.COMMISSIONS]: 'commission_records',
  [STORAGE_KEYS.IMPORT_LOGS]: 'import_logs',
  [STORAGE_KEYS.WASAL_SETTLEMENTS]: 'wasal_settlements',
  [STORAGE_KEYS.MONTHLY_EXPENSES]: 'monthly_expenses',
  [STORAGE_KEYS.INVESTOR_OFFERINGS]: 'investor_offerings',
  [STORAGE_KEYS.INVESTOR_REQUESTS]: 'investor_requests',
};

const COLLECTION_TO_STORAGE: Record<string, string> = Object.fromEntries(
  Object.entries(STORAGE_TO_COLLECTION).map(([sKey, cKey]) => [cKey, sKey])
);

// In-memory authoritative state cache hydrated from /api/sync/state
const memoryStore = new Map<string, unknown>();
let adminAuditLogsCache: AdminAuditLog[] = [];
let syncListeners = new Set<() => void>();
let currentSyncVersion = '';
let sseSource: EventSource | null = null;
let initializedPromise: Promise<void> | null = null;
const pendingWriteQueues = new Map<string, Promise<void>>();

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-client-id': CLIENT_ID,
  };
  const token = getSessionToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }
  return headers;
}

async function safeParseJsonResponse<T = Record<string, unknown>>(
  res: Response
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      error: res.ok ? undefined : `Server returned an empty response (HTTP ${res.status}).`,
    };
  }

  const looksLikeHtml =
    trimmed.startsWith('<!') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<') ||
    contentType.includes('text/html');

  if (looksLikeHtml) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Server returned an unexpected HTML page (HTTP ${res.status}). Please refresh or try again; if importing an external site, use the "Paste HTML Source" option below.`,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return { ok: res.ok, status: res.status, data: parsed };
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Invalid response format from server (HTTP ${res.status}).`,
    };
  }
}

function notifyListeners() {
  for (const cb of syncListeners) {
    try {
      cb();
    } catch (e) {
      console.error('Sync listener error:', e);
    }
  }
}

// Safe localStorage + memoryStore getter
function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (memoryStore.has(key)) {
    return memoryStore.get(key) as T;
  }
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    const parsed = JSON.parse(item) as T;
    memoryStore.set(key, parsed);
    return parsed;
  } catch (e) {
    console.error(`Error loading ${key} from localStorage`, e);
    return defaultValue;
  }
}

function queueServerCollectionWrite(collectionKey: string, value: unknown) {
  if (typeof window === 'undefined') return;
  const prev = pendingWriteQueues.get(collectionKey) || Promise.resolve();
  const next = prev
    .then(async () => {
      const res = await fetch(`/api/collections/${encodeURIComponent(collectionKey)}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        cache: 'no-store',
        body: JSON.stringify({ data: value }),
      });
      if (res.ok) {
        const parsed = await safeParseJsonResponse<{ syncVersion?: string }>(res);
        if (parsed.data?.syncVersion) currentSyncVersion = parsed.data.syncVersion;
      }
    })
    .catch((err) => {
      console.warn(`Background sync failed for ${collectionKey}:`, err);
    });
  pendingWriteQueues.set(collectionKey, next);
}

function queueServerEndpointDelete(
  collectionKey: string,
  url: string
): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined') return Promise.resolve({ ok: true });
  const prev = pendingWriteQueues.get(collectionKey) || Promise.resolve();
  let result: { ok: boolean; error?: string } = { ok: true };
  const next = prev
    .then(async () => {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      const parsed = await safeParseJsonResponse<{ ok?: boolean; syncVersion?: string; error?: string }>(res);
      if (!parsed.ok) {
        result = { ok: false, error: parsed.data?.error || parsed.error || `Delete failed (HTTP ${res.status})` };
        console.warn(`Explicit delete failed for ${url}:`, result.error);
        return;
      }
      if (parsed.data?.syncVersion) {
        currentSyncVersion = parsed.data.syncVersion;
      }
      result = { ok: true };
    })
    .catch((err) => {
      result = { ok: false, error: err instanceof Error ? err.message : 'Network error' };
      console.warn(`Explicit delete network failure for ${url}:`, err);
    });
  pendingWriteQueues.set(collectionKey, next);
  return next.then(() => result);
}

export function apiDeleteProduct(id: string): Promise<{ ok: boolean; error?: string }> {
  return queueServerEndpointDelete('products', `/api/products/${encodeURIComponent(id)}`);
}

export function apiDeleteCustomer(id: string): Promise<{ ok: boolean; error?: string }> {
  return queueServerEndpointDelete('customers', `/api/customers/${encodeURIComponent(id)}`);
}

export function apiDeleteExpense(id: string): Promise<{ ok: boolean; error?: string }> {
  return queueServerEndpointDelete('monthly_expenses', `/api/expenses/${encodeURIComponent(id)}`);
}

export function apiDeleteCollectionItem(
  collectionKey: string,
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  return queueServerEndpointDelete(
    collectionKey,
    `/api/collections/${encodeURIComponent(collectionKey)}/items/${encodeURIComponent(itemId)}`
  );
}

// Safe localStorage + central backend setter
function saveToStorage<T>(key: string, value: T, skipRemotePush = false): void {
  memoryStore.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving ${key} to localStorage`, e);
  }
  const collectionKey = STORAGE_TO_COLLECTION[key];
  if (!skipRemotePush && collectionKey) {
    queueServerCollectionWrite(collectionKey, value);
  }
}

function applyServerStateSnapshot(state: Record<string, unknown>) {
  if (!state || typeof state !== 'object') return;
  if ('authenticatedActor' in state && state.authenticatedActor === null) {
    setSessionToken(null);
    memoryStore.set(STORAGE_KEYS.CURRENT_USER, defaultGuestUser);
    memoryStore.set(STORAGE_KEYS.ACTIVE_ROLE, 'customer');
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(defaultGuestUser));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ROLE, JSON.stringify('customer'));
    } catch {
      // ignore storage errors
    }
  }
  if (typeof state.syncVersion === 'string') {
    currentSyncVersion = state.syncVersion;
  }
  if (Array.isArray(state.admin_audit_logs)) {
    adminAuditLogsCache = state.admin_audit_logs as AdminAuditLog[];
  }
  for (const [colKey, sKey] of Object.entries(COLLECTION_TO_STORAGE)) {
    if (state[colKey] !== undefined) {
      let val = state[colKey];
      if (colKey === 'business_profile' && val && typeof val === 'object') {
        const bp = val as BusinessProfile;
        if (!bp.deliveryCities && Array.isArray(state.cities)) {
          val = { ...bp, deliveryCities: state.cities as DeliveryCityConfig[] };
        }
      }
      memoryStore.set(sKey, val);
      try {
        // Never persist unauthenticated redacted profile over local if user isn't logged in,
        // or cleanly mirror safe server copy to localStorage cache
        localStorage.setItem(sKey, JSON.stringify(val));
      } catch {
        // ignore quota errors on large image galleries
      }
    }
  }
}

export async function refreshSyncState(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/sync/state', {
      method: 'GET',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<Record<string, unknown>>(res);
    if (!parsed.ok || !parsed.data) return false;
    applyServerStateSnapshot(parsed.data);
    notifyListeners();
    return true;
  } catch {
    return false;
  }
}

async function migrateLocalStorageIfNeeded(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return;

    const collections: Record<string, unknown> = {};
    let hasAnyLocalData = false;
    for (const [sKey, colKey] of Object.entries(STORAGE_TO_COLLECTION)) {
      const raw = localStorage.getItem(sKey);
      if (raw) {
        try {
          collections[colKey] = JSON.parse(raw);
          hasAnyLocalData = true;
        } catch {
          // skip corrupt JSON
        }
      }
    }

    if (hasAnyLocalData) {
      await fetch('/api/sync/migrate-local', {
        method: 'POST',
        headers: getAuthHeaders(),
        cache: 'no-store',
        body: JSON.stringify({ collections }),
      });
    }
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done');
  } catch (err) {
    console.warn('Non-destructive localStorage migration skipped or deferred:', err);
  }
}

export function initSyncStore(): Promise<void> {
  if (initializedPromise) return initializedPromise;
  initializedPromise = (async () => {
    await migrateLocalStorageIfNeeded();
    await refreshSyncState();
  })();
  return initializedPromise;
}

export function subscribeToServerSync(listener: () => void): () => void {
  syncListeners.add(listener);

  if (typeof window !== 'undefined' && !sseSource) {
    try {
      sseSource = new EventSource('/api/events');
      sseSource.addEventListener('sync', (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as {
            sourceClientId?: string;
            updatedAt?: string;
          };
          if (payload.sourceClientId && payload.sourceClientId === CLIENT_ID) {
            return; // Ignore our own echo
          }
          if (payload.updatedAt && payload.updatedAt === currentSyncVersion) {
            return;
          }
        } catch {
          // refresh anyway
        }
        void refreshSyncState();
      });
    } catch {
      // EventSource not supported or blocked
    }

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshSyncState();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    // Lightweight periodic sync check (15s) as fallback
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshSyncState();
      }
    }, 15000);

    return () => {
      syncListeners.delete(listener);
      if (syncListeners.size === 0) {
        sseSource?.close();
        sseSource = null;
        window.removeEventListener('focus', onFocusOrVisible);
        document.removeEventListener('visibilitychange', onFocusOrVisible);
        window.clearInterval(interval);
      }
    };
  }

  return () => {
    syncListeners.delete(listener);
  };
}

// ==========================================
// SERVER-VALIDATED DOMAIN API ACTIONS
// ==========================================

export async function apiAuthenticateLogin(
  identifier: string,
  pin: string
): Promise<{ ok: boolean; user?: Partial<AppUser>; sessionToken?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': CLIENT_ID },
      cache: 'no-store',
      body: JSON.stringify({ identifier, pin }),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      user?: Partial<AppUser>;
      sessionToken?: string;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error };
    }
    const data = parsed.data;
    if (data.ok && data.sessionToken) {
      setSessionToken(data.sessionToken);
      await refreshSyncState();
    }
    return {
      ok: true,
      user: data.user,
      sessionToken: data.sessionToken,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiActivateProductArrival(
  productId: string,
  payload: {
    parentCategoryId: string;
    subcategoryId?: string;
    childSubcategoryId?: string;
    ourPrice: number;
    marketPrice: number;
    costPrice: number;
    stockQty: number;
    variations?: ProductVariation[];
    details?: string;
    badgeText?: string;
    deliveryType?: 'express' | 'standard';
    deliveryFeeType?: 'default' | 'free' | 'custom';
    customDeliveryCharge?: number;
  }
): Promise<{ ok: boolean; product?: ProductItem; error?: string }> {
  try {
    const res = await fetch(`/api/products/${encodeURIComponent(productId)}/activate-arrival`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; product?: ProductItem; error?: string }>(res);
    if (!parsed.ok || !parsed.data) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to confirm arrival.' };
    }
    await refreshSyncState();
    return { ok: true, product: parsed.data.product };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiScrapeProductUrl(
  url: string,
  htmlOverride?: string
): Promise<{
  ok: boolean;
  product?: ProductItem;
  diagnostics?: {
    strategiesUsed: string[];
    currencyDetected: string;
    originalPriceText?: string;
    imagesFound: number;
    imagesDownloaded?: number;
    specsFound: number;
    featuresFound: number;
    variantsFound: number;
    videoFound: boolean;
  };
  error?: string;
}> {
  const attemptServerScrape = async (): Promise<Response> => {
    return fetch('/api/products/scrape-url', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ url, htmlOverride }),
    });
  };

  try {
    let res = await attemptServerScrape();
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 505) {
      await new Promise((r) => setTimeout(r, 700));
      res = await attemptServerScrape();
    }

    if (res.status === 401) {
      setSessionToken(null);
      memoryStore.set(STORAGE_KEYS.CURRENT_USER, defaultGuestUser);
      memoryStore.set(STORAGE_KEYS.ACTIVE_ROLE, 'customer');
      try {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(defaultGuestUser));
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ROLE, JSON.stringify('customer'));
      } catch {
        // ignore storage errors
      }
      notifyListeners();
      return {
        ok: false,
        error:
          'Your session expired or needs a fresh sign-in after the security upgrade. Please sign in again as Super Admin, Admin, or Manager.',
      };
    }

    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      product?: ProductItem;
      diagnostics?: {
        strategiesUsed: string[];
        currencyDetected: string;
        originalPriceText?: string;
        imagesFound: number;
        imagesDownloaded?: number;
        specsFound: number;
        featuresFound: number;
        variantsFound: number;
        videoFound: boolean;
      };
      error?: string;
    }>(res);

    const data = parsed.data;
    if (parsed.ok && data?.ok && data.product) {
      return { ok: true, product: data.product, diagnostics: data.diagnostics };
    }

    if (res.status === 403 && data?.error?.toLowerCase().includes('only administrators')) {
      return {
        ok: false,
        error:
          'Permission denied (HTTP 403). Please ensure you are signed in as Super Admin, Admin, or Manager before importing products.',
      };
    }

    // For pasted HTML source, never let proxy/WAF/403-HTML/413/500/502/503/504/505 block parsing — parse locally in browser!
    if (htmlOverride && htmlOverride.trim()) {
      try {
        const localParsed = parseProductFromHtmlInBrowser(url, htmlOverride, getCategoryRecords());
        return {
          ok: true,
          product: localParsed.product,
          diagnostics: localParsed.diagnostics,
        };
      } catch (parseErr) {
        return {
          ok: false,
          error:
            (parseErr instanceof Error ? parseErr.message : '') ||
            data?.error ||
            parsed.error ||
            'Could not extract product data from the pasted HTML source.',
        };
      }
    }

    const isBackendOrProxyFailure =
      res.status === 404 ||
      res.status === 405 ||
      res.status === 500 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504 ||
      res.status === 505 ||
      res.status === 422 ||
      (parsed.error?.includes('unexpected HTML page') ?? false);

    if (isBackendOrProxyFailure) {
      const fallbackRes = await tryFetchProductInBrowserFallback(url, getCategoryRecords());
      if (fallbackRes.ok && fallbackRes.product) {
        return {
          ok: true,
          product: fallbackRes.product,
          diagnostics: fallbackRes.diagnostics,
        };
      }
      return {
        ok: false,
        error:
          data?.error ||
          fallbackRes.error ||
          parsed.error ||
          `Server returned HTTP ${res.status}. Open the page in your browser, copy Page Source (Ctrl+U -> Ctrl+A -> Ctrl+C), and use "Paste HTML Source" below.`,
      };
    }

    return {
      ok: false,
      error: data?.error || parsed.error || 'Could not scrape product details from URL.',
    };
  } catch (err) {
    if (htmlOverride && htmlOverride.trim()) {
      try {
        const localParsed = parseProductFromHtmlInBrowser(url, htmlOverride, getCategoryRecords());
        return {
          ok: true,
          product: localParsed.product,
          diagnostics: localParsed.diagnostics,
        };
      } catch (parseErr) {
        return {
          ok: false,
          error: parseErr instanceof Error ? parseErr.message : 'Failed to parse pasted HTML.',
        };
      }
    }
    const fallbackRes = await tryFetchProductInBrowserFallback(url, getCategoryRecords());
    if (fallbackRes.ok && fallbackRes.product) {
      return {
        ok: true,
        product: fallbackRes.product,
        diagnostics: fallbackRes.diagnostics,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error during URL scrape',
    };
  }
}

export async function apiSaveProduct(
  product: ProductItem,
  isUpdate: boolean
): Promise<{ ok: boolean; product?: ProductItem; error?: string }> {
  try {
    const endpoint = isUpdate ? `/api/products/${encodeURIComponent(product.id)}` : '/api/products';
    const res = await fetch(endpoint, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(product),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; product?: ProductItem; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return {
        ok: false,
        error: parsed.data?.error || parsed.error || 'Could not save product to server.',
      };
    }
    return { ok: true, product: parsed.data.product || product };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error saving product' };
  }
}

export async function apiCacheExternalImage(
  url: string,
  referer?: string
): Promise<{ ok: boolean; localUrl: string; downloaded: boolean; error?: string }> {
  const trimmed = (url || '').trim();
  if (!trimmed) return { ok: false, localUrl: '', downloaded: false, error: 'Image URL is required.' };
  try {
    const res = await fetch('/api/media/cache', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ url: trimmed, referer }),
    });
    if (res.status === 404) {
      return { ok: true, localUrl: trimmed, downloaded: false };
    }
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      localUrl?: string;
      downloaded?: boolean;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.localUrl) {
      return {
        ok: true,
        localUrl: trimmed,
        downloaded: false,
      };
    }
    return {
      ok: true,
      localUrl: parsed.data.localUrl,
      downloaded: Boolean(parsed.data.downloaded),
    };
  } catch {
    return {
      ok: true,
      localUrl: trimmed,
      downloaded: false,
    };
  }
}

export async function apiSaveCategoryRecord(
  payload: Partial<CategoryRecord>,
  existingId?: string
): Promise<{ ok: boolean; category?: CategoryRecord; categories?: CategoryRecord[]; error?: string }> {
  try {
    const url = existingId
      ? `/api/categories/${encodeURIComponent(existingId)}`
      : '/api/categories';
    const res = await fetch(url, {
      method: existingId ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      category?: CategoryRecord;
      categories?: CategoryRecord[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data) return { ok: false, error: parsed.data?.error || parsed.error || 'Category operation failed.' };
    await refreshSyncState();
    return { ok: true, category: parsed.data.category, categories: parsed.data.categories };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteCategoryRecord(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Cannot delete category.' };
    await refreshSyncState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiAddCity(
  name: string,
  allowed = true,
  deliveryCharge?: number | null,
  province?: string
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch('/api/cities', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ name, allowed, deliveryCharge, province }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to add city.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiUpdateCity(
  idOrName: string,
  updates: { name?: string; province?: string; allowed?: boolean; deliveryCharge?: number | null }
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(idOrName)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(updates),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to update city.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteCity(
  idOrName: string
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(idOrName)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to remove city.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiToggleOtherCities(
  allowOtherCities: boolean
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch('/api/cities/toggle-other-cities', {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ allowOtherCities }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to toggle other cities.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiAddCityArea(
  cityIdOrName: string,
  name: string,
  allowed = true,
  deliveryCharge?: number | null
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch(`/api/cities/${encodeURIComponent(cityIdOrName)}/areas`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ name, allowed, deliveryCharge }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to add area.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiUpdateCityArea(
  areaId: string,
  updates: { name?: string; allowed?: boolean; deliveryCharge?: number | null }
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch(`/api/areas/${encodeURIComponent(areaId)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(updates),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to update area.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteCityArea(
  areaId: string
): Promise<{ ok: boolean; cities?: DeliveryCityConfig[]; error?: string }> {
  try {
    const res = await fetch(`/api/areas/${encodeURIComponent(areaId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; cities?: DeliveryCityConfig[]; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to remove area.' };
    await refreshSyncState();
    return { ok: true, cities: parsed.data?.cities };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSubmitCheckoutOrder(payload: {
  items: Array<{ productId: string; quantity: number }>;
  customer?: Customer;
  transaction?: Transaction;
  codOrder?: CODOrder;
  resellerId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/orders/checkout', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Checkout blocked by server validation.' };
    await refreshSyncState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiUpdateCODOrderStatus(
  orderId: string,
  status: CODOrderStatus,
  details?: { courierPartner?: CODOrder['courierPartner']; trackingNumber?: string }
): Promise<{ ok: boolean; order?: CODOrder; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({
        status,
        courierPartner: details?.courierPartner,
        trackingNumber: details?.trackingNumber,
      }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; order?: CODOrder; error?: string }>(res);
    if (!parsed.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to update COD order status.' };
    }
    await refreshSyncState();
    return { ok: true, order: parsed.data?.order };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiAuditAndRepairOrders(): Promise<{
  ok: boolean;
  repairedOrders?: number;
  linkedCustomersCreated?: number;
  repairedTransactions?: number;
  migratedUrlsCount?: number;
  summary?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/orders/audit-repair', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({}),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      repairedOrders?: number;
      linkedCustomersCreated?: number;
      repairedTransactions?: number;
      migratedUrlsCount?: number;
      summary?: string;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Order history audit & repair failed.' };
    }
    await refreshSyncState();
    return {
      ok: true,
      repairedOrders: parsed.data.repairedOrders,
      linkedCustomersCreated: parsed.data.linkedCustomersCreated,
      repairedTransactions: parsed.data.repairedTransactions,
      migratedUrlsCount: parsed.data.migratedUrlsCount,
      summary: parsed.data.summary,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiCreateServerBackup(reason = 'manual'): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/admin/backup', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ reason }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok) return { ok: false, error: parsed.data?.error || parsed.error || 'Backup failed.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export function getAdminAuditLogs(): AdminAuditLog[] {
  return adminAuditLogsCache;
}

// ==========================================
// EXISTING STORAGE EXPORTS (BACKWARD COMPATIBLE)
// ==========================================

// Business Profile
export function getBusinessProfile(): BusinessProfile {
  const prof = loadFromStorage<BusinessProfile>(STORAGE_KEYS.PROFILE, defaultBusinessProfile);
  if (!prof.shippingPartner) {
    prof.shippingPartner = defaultBusinessProfile.shippingPartner;
  }
  if (prof.defaultCityCenterDeliveryCharge === undefined) {
    prof.defaultCityCenterDeliveryCharge = 50;
  }
  if (!prof.deliveryCities || prof.deliveryCities.length === 0) {
    prof.deliveryCities = ensureCityAreasShape(defaultDeliveryCities);
  } else {
    prof.deliveryCities = ensureCityAreasShape(prof.deliveryCities);
    if (!prof.deliveryCities.some((c) => c.name.toLowerCase() === 'muzaffarabad')) {
      const defMzd = defaultDeliveryCities.find((c) => c.name.toLowerCase() === 'muzaffarabad')!;
      prof.deliveryCities = [defMzd, ...prof.deliveryCities];
    }
  }
  return prof;
}

export function saveBusinessProfile(profile: BusinessProfile): void {
  const normalized = {
    ...profile,
    deliveryCities: profile.deliveryCities ? ensureCityAreasShape(profile.deliveryCities) : undefined,
  };
  saveToStorage(STORAGE_KEYS.PROFILE, normalized);
}

export function resetDeliveryCities(): DeliveryCityConfig[] {
  const prof = getBusinessProfile();
  const fresh = ensureCityAreasShape(defaultDeliveryCities);
  saveBusinessProfile({ ...prof, deliveryCities: fresh });
  return fresh;
}

// Customers
export function getCustomers(): Customer[] {
  return loadFromStorage<Customer[]>(STORAGE_KEYS.CUSTOMERS, defaultCustomers);
}

export function saveCustomers(customers: Customer[]): void {
  saveToStorage(STORAGE_KEYS.CUSTOMERS, customers);
}

// Products & Inventory
export function getProducts(): ProductItem[] {
  return loadFromStorage<ProductItem[]>(STORAGE_KEYS.PRODUCTS, defaultProducts);
}

export function saveProducts(products: ProductItem[]): void {
  saveToStorage(STORAGE_KEYS.PRODUCTS, products);
}

// Centrally Managed Product Categories (3-level normalized)
export function getCategoryRecords(): CategoryRecord[] {
  const raw = loadFromStorage<CategoryRecord[]>(STORAGE_KEYS.CATEGORY_RECORDS, defaultCategoryRecords);
  const normalized = raw.map(normalizeUpcomingCategoryRecord);
  if (!normalized.some((c) => c.id === UPCOMING_CATEGORY_ID || c.isUpcoming)) {
    const defUpcoming = defaultCategoryRecords.find((c) => c.id === UPCOMING_CATEGORY_ID)!;
    normalized.push(defUpcoming);
  }
  return normalized;
}

export function saveCategoryRecords(records: CategoryRecord[]): void {
  const normalized = records.map(normalizeUpcomingCategoryRecord);
  saveToStorage(STORAGE_KEYS.CATEGORY_RECORDS, normalized);
}

export function getCategories(): string[] {
  const records = getCategoryRecords();
  const recordNames = records.map((r) => r.name.trim()).filter(Boolean);
  const products = getProducts();
  const productCats = products
    .map((p) => (isUpcomingCategoryName(p.category) ? UPCOMING_CATEGORY_NAME : p.category?.trim()))
    .filter(Boolean) as string[];
  const stored = loadFromStorage<string[]>(STORAGE_KEYS.CATEGORIES, []);
  const normalizedStored = stored
    .map((c) => (isUpcomingCategoryName(c) ? UPCOMING_CATEGORY_NAME : c.trim()))
    .filter(Boolean);
  const combined = Array.from(new Set([...recordNames, ...normalizedStored, ...productCats]));
  return combined.sort((a, b) => a.localeCompare(b));
}

export function saveCategories(categories: string[]): void {
  const clean = Array.from(
    new Set(
      categories
        .map((c) => (isUpcomingCategoryName(c) ? UPCOMING_CATEGORY_NAME : c.trim()))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  saveToStorage(STORAGE_KEYS.CATEGORIES, clean);
}

export function addCategory(
  newCategory: string,
  parentCategoryId?: string,
  isUpcoming: boolean = false
): { categories: string[]; added: boolean; record?: CategoryRecord } {
  const trimmed = isUpcoming || isUpcomingCategoryName(newCategory)
    ? UPCOMING_CATEGORY_NAME
    : newCategory.trim();
  if (!trimmed) return { categories: getCategories(), added: false };
  const current = getCategories();
  const exists = current.some((c) => normalizeTextKey(c) === normalizeTextKey(trimmed));

  const records = getCategoryRecords();
  const recordExists = records.some(
    (r) =>
      normalizeTextKey(r.name) === normalizeTextKey(trimmed) &&
      (r.parentCategoryId || '') === (parentCategoryId || '')
  );
  let newRecord: CategoryRecord | undefined = undefined;

  if (!recordExists) {
    const parent = parentCategoryId ? records.find((r) => r.id === parentCategoryId) : undefined;
    const level: 1 | 2 | 3 = !parent ? 1 : parent.parentCategoryId ? 3 : 2;
    newRecord = {
      id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      parentCategoryId,
      level,
      isUpcoming,
      isActive: true,
      displayOrder: records.length + 1,
    };
    saveCategoryRecords([...records, newRecord]);
  }

  if (!exists) {
    const updated = [...current, trimmed].sort((a, b) => a.localeCompare(b));
    saveCategories(updated);
    return { categories: updated, added: true, record: newRecord };
  }
  return { categories: current, added: false, record: newRecord };
}

// Safely delete category if no active products are using it
export function deleteCategory(categoryName: string): { success: boolean; message: string } {
  if (isUpcomingCategoryName(categoryName)) {
    return {
      success: false,
      message: `"${UPCOMING_CATEGORY_NAME}" is a required store category and cannot be deleted.`,
    };
  }
  const products = getProducts();
  const inUse = products.some((p) => normalizeTextKey(p.category) === normalizeTextKey(categoryName));
  if (inUse) {
    return {
      success: false,
      message: `Cannot delete '${categoryName}' because active catalog products belong to it. Reassign or delete products first.`,
    };
  }

  const records = getCategoryRecords();
  const targetRec = records.find((r) => normalizeTextKey(r.name) === normalizeTextKey(categoryName));
  if (targetRec && records.some((r) => r.parentCategoryId === targetRec.id)) {
    return {
      success: false,
      message: `Cannot delete '${categoryName}' because it contains subcategories. Remove or move subcategories first.`,
    };
  }

  const current = getCategories();
  const updated = current.filter((c) => normalizeTextKey(c) !== normalizeTextKey(categoryName));
  saveCategories(updated);

  const updatedRecords = records.filter((r) => normalizeTextKey(r.name) !== normalizeTextKey(categoryName));
  saveCategoryRecords(updatedRecords);

  return { success: true, message: `Category '${categoryName}' removed successfully.` };
}

// Category deduplication & normalization cleanup
export function cleanupDuplicateCategories(): { mergedCount: number; remaining: string[] } {
  const products = getProducts();
  const cats = getCategories();
  const map = new Map<string, string>();
  let mergedCount = 0;

  cats.forEach((cat) => {
    const canonicalName = isUpcomingCategoryName(cat) ? UPCOMING_CATEGORY_NAME : cat.trim();
    const lower = canonicalName.toLowerCase();
    if (!map.has(lower)) {
      map.set(lower, canonicalName);
    } else {
      mergedCount++;
    }
  });

  let productsChanged = false;
  const updatedProducts = products.map((p) => {
    if (p.category) {
      const canonical = map.get(p.category.trim().toLowerCase());
      if (canonical && canonical !== p.category) {
        productsChanged = true;
        return { ...p, category: canonical };
      }
    }
    return p;
  });

  if (productsChanged) {
    saveProducts(updatedProducts);
  }

  const remaining = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  saveCategories(remaining);
  return { mergedCount, remaining };
}

// Transactions
export function getTransactions(): Transaction[] {
  return loadFromStorage<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, defaultTransactions);
}

export function saveTransactions(transactions: Transaction[]): void {
  saveToStorage(STORAGE_KEYS.TRANSACTIONS, transactions);
}

// Recurring Invoices
export function getRecurringInvoices(): RecurringInvoice[] {
  return loadFromStorage<RecurringInvoice[]>(STORAGE_KEYS.RECURRING, defaultRecurringInvoices);
}

export function saveRecurringInvoices(invoices: RecurringInvoice[]): void {
  saveToStorage(STORAGE_KEYS.RECURRING, invoices);
}

// WhatsApp Notifications
export function getWhatsAppNotifications(): WhatsAppNotification[] {
  return loadFromStorage<WhatsAppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, defaultWhatsAppNotifications);
}

export function saveWhatsAppNotifications(notifications: WhatsAppNotification[]): void {
  saveToStorage(STORAGE_KEYS.NOTIFICATIONS, notifications);
}

// Reminder Templates
export function getReminderTemplates(): ReminderTemplate[] {
  return loadFromStorage<ReminderTemplate[]>(STORAGE_KEYS.TEMPLATES, defaultReminderTemplates);
}

export function saveReminderTemplates(templates: ReminderTemplate[]): void {
  saveToStorage(STORAGE_KEYS.TEMPLATES, templates);
}

// Product Broadcasts
export function getProductBroadcasts(): ProductBroadcast[] {
  return loadFromStorage<ProductBroadcast[]>(STORAGE_KEYS.BROADCASTS, defaultProductBroadcasts);
}

export function saveProductBroadcasts(broadcasts: ProductBroadcast[]): void {
  saveToStorage(STORAGE_KEYS.BROADCASTS, broadcasts);
}

// Lucky Draw Events
export function getLuckyDraws(): LuckyDrawEvent[] {
  return loadFromStorage<LuckyDrawEvent[]>(STORAGE_KEYS.LUCKY_DRAWS, defaultLuckyDrawEvents);
}

export function saveLuckyDraws(events: LuckyDrawEvent[]): void {
  saveToStorage(STORAGE_KEYS.LUCKY_DRAWS, events);
}

// Manual Broadcast Contacts
export function getBroadcastContacts(): BroadcastContact[] {
  return loadFromStorage<BroadcastContact[]>(STORAGE_KEYS.BROADCAST_CONTACTS, defaultBroadcastContacts);
}

export function saveBroadcastContacts(contacts: BroadcastContact[]): void {
  saveToStorage(STORAGE_KEYS.BROADCAST_CONTACTS, contacts);
}

// Saved Broadcast Campaigns
export function getSavedBroadcasts(): SavedBroadcastCampaign[] {
  return loadFromStorage<SavedBroadcastCampaign[]>(STORAGE_KEYS.SAVED_BROADCASTS, defaultSavedBroadcasts);
}

export function saveSavedBroadcasts(campaigns: SavedBroadcastCampaign[]): void {
  saveToStorage(STORAGE_KEYS.SAVED_BROADCASTS, campaigns);
}

// COD Orders
export function getCODOrders(): CODOrder[] {
  return loadFromStorage<CODOrder[]>(STORAGE_KEYS.COD_ORDERS, defaultCODOrders);
}

export function saveCODOrders(orders: CODOrder[]): void {
  saveToStorage(STORAGE_KEYS.COD_ORDERS, orders);
}

// WASAL Delivery Settlements (Amount Received from Courier)
export function getWasalSettlements(): WasalSettlement[] {
  return loadFromStorage<WasalSettlement[]>(STORAGE_KEYS.WASAL_SETTLEMENTS, defaultWasalSettlements);
}

export function saveWasalSettlements(settlements: WasalSettlement[]): void {
  saveToStorage(STORAGE_KEYS.WASAL_SETTLEMENTS, settlements);
}

// Monthly Overhead & Manual Expenses
export function getMonthlyExpenses(): MonthlyExpense[] {
  return loadFromStorage<MonthlyExpense[]>(STORAGE_KEYS.MONTHLY_EXPENSES, []);
}

export function saveMonthlyExpenses(expenses: MonthlyExpense[]): void {
  saveToStorage(STORAGE_KEYS.MONTHLY_EXPENSES, expenses);
}

// Persistent Cart Session (local browser cache)
export function getCartItems(): CartItem[] {
  const items = loadFromStorage<CartItem[]>(STORAGE_KEYS.CART, []);
  return Array.isArray(items) ? items.filter((it) => it && it.product && it.quantity > 0) : [];
}

export function saveCartItems(cart: CartItem[]): void {
  saveToStorage(STORAGE_KEYS.CART, cart, true);
}

// HR Employees
export function getEmployees(): Employee[] {
  return loadFromStorage<Employee[]>(STORAGE_KEYS.EMPLOYEES, defaultEmployees);
}

export function saveEmployees(employees: Employee[]): void {
  saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);
}

// HR Attendance
export function getAttendance(): AttendanceRecord[] {
  return loadFromStorage<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, defaultAttendance);
}

export function saveAttendance(records: AttendanceRecord[]): void {
  saveToStorage(STORAGE_KEYS.ATTENDANCE, records);
}

// Resellers
export function getResellers(): Reseller[] {
  return loadFromStorage<Reseller[]>(STORAGE_KEYS.RESELLERS, defaultResellers);
}

export function saveResellers(resellers: Reseller[]): void {
  saveToStorage(STORAGE_KEYS.RESELLERS, resellers);
}

// Review Reward Submissions
export function getReviewRewards(): ReviewRewardSubmission[] {
  return loadFromStorage<ReviewRewardSubmission[]>(STORAGE_KEYS.REVIEW_REWARDS, defaultReviewRewards);
}

export function saveReviewRewards(submissions: ReviewRewardSubmission[]): void {
  saveToStorage(STORAGE_KEYS.REVIEW_REWARDS, submissions);
}

export const defaultGuestUser: AppUser = {
  id: 'guest',
  name: 'Guest Visitor',
  urduName: 'مہمان صارف',
  role: 'customer',
  phone: '',
  isAuthenticated: false,
};

export const defaultCustomerUser: AppUser = defaultGuestUser;

// Active Role & User Session (stays per browser/session)
export function getActiveRole(): UserRole {
  const user = getCurrentUser();
  if (!user || user.isAuthenticated !== true) {
    return 'customer';
  }
  return loadFromStorage<UserRole>(STORAGE_KEYS.ACTIVE_ROLE, user.role || 'customer');
}

export function saveActiveRole(role: UserRole): void {
  saveToStorage(STORAGE_KEYS.ACTIVE_ROLE, role, true);
}

export function getCurrentUser(): AppUser {
  const user = loadFromStorage<AppUser>(STORAGE_KEYS.CURRENT_USER, defaultGuestUser);
  if (!user || user.id === 'user_cust_default' || user.isAuthenticated !== true) {
    return defaultGuestUser;
  }
  return user;
}

export function saveCurrentUser(user: AppUser): void {
  saveToStorage(STORAGE_KEYS.CURRENT_USER, user, true);
}

// Login Audits & History
export function getLoginAudits(): LoginAuditRecord[] {
  return loadFromStorage<LoginAuditRecord[]>(STORAGE_KEYS.LOGIN_AUDITS, defaultLoginAuditLogs);
}

export function logUserLogin(record: Omit<LoginAuditRecord, 'id' | 'timestamp'>): void {
  const newEntry: LoginAuditRecord = {
    ...record,
    id: `login_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  const currentLogs = getLoginAudits();
  saveToStorage(STORAGE_KEYS.LOGIN_AUDITS, [newEntry, ...currentLogs.slice(0, 99)]);
}

export function saveLoginAudits(logs: LoginAuditRecord[]): void {
  saveToStorage(STORAGE_KEYS.LOGIN_AUDITS, logs);
}

// Default PIN extraction from mobile number
export function getDefaultPinForPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return digits.padEnd(6, '0');
}

// User PIN update functions
export function updateCustomerPin(customerId: string, newPin: string): boolean {
  const custs = getCustomers();
  const updated = custs.map((c) => (c.id === customerId ? { ...c, pin: newPin } : c));
  saveCustomers(updated);
  return true;
}

export function updateResellerPin(resellerId: string, newPin: string): boolean {
  const resells = getResellers();
  const updated = resells.map((r) => (r.id === resellerId ? { ...r, pin: newPin } : r));
  saveResellers(updated);
  return true;
}

export function updateOwnerPin(newPin: string): void {
  const prof = getBusinessProfile();
  prof.adminPin = newPin;
  saveBusinessProfile(prof);
}

export function getOwnerPin(): string {
  const prof = getBusinessProfile();
  return prof.adminPin || '';
}

// ==========================================
// AUTHENTICATION & CRM SERVER API HELPERS
// ==========================================

export async function apiRegisterCustomer(payload: {
  fullName: string;
  phone: string;
  email?: string;
  city?: string;
  address?: string;
  whatsappSameAsPhone?: boolean;
  whatsapp?: string;
  pin?: string;
  generateTempPassword?: boolean;
}): Promise<{
  ok: boolean;
  user?: Partial<AppUser>;
  customer?: Customer;
  sessionToken?: string;
  temporaryPassword?: string;
  whatsappNumber?: string;
  email?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/auth/register-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': CLIENT_ID },
      cache: 'no-store',
      body: JSON.stringify({
        ...payload,
        name: payload.fullName,
      }),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      user?: Partial<AppUser>;
      customer?: Customer;
      sessionToken?: string;
      temporaryPassword?: string;
      whatsappNumber?: string;
      email?: string;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Registration failed.' };
    }
    if (parsed.data.sessionToken) {
      setSessionToken(parsed.data.sessionToken);
      await refreshSyncState();
    }
    return {
      ok: true,
      user: parsed.data.user,
      customer: parsed.data.customer,
      sessionToken: parsed.data.sessionToken,
      temporaryPassword: parsed.data.temporaryPassword,
      whatsappNumber: parsed.data.whatsappNumber,
      email: parsed.data.email,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiChangeOwnPassword(
  currentPin: string,
  newPin: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ currentPin, newPin }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Could not update password.' };
    }
    await refreshSyncState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiChangeMasterPin(
  currentPin: string,
  newPin: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/change-master-pin', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ currentPin, newPin }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Could not update master PIN.' };
    }
    await refreshSyncState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiAdminResetPassword(
  userId: string,
  tempPin?: string
): Promise<{ ok: boolean; tempPin?: string; error?: string }> {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ tempPin }),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; tempPin?: string; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Reset failed.' };
    }
    await refreshSyncState();
    return { ok: true, tempPin: parsed.data.tempPin };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export interface CRMStateBundle {
  kpis: CRMDashboardKPIs;
  intelligence: CRMProductIntelligence;
  profiles: Customer360Profile[];
  customSegments: CRMCustomSegmentRule[];
  followUps: CRMFollowUpTask[];
  leads: CRMLead[];
  campaigns: CRMCampaign[];
  loyaltyConfig: CRMLoyaltyConfig;
  loyaltyAccounts: CRMLoyaltyAccount[];
  loyaltyLedger: CRMLoyaltyLedgerEntry[];
  coupons: CRMLoyaltyCoupon[];
  tickets: CRMSupportTicket[];
  automationRules: CRMAutomationRule[];
  automationLogs: Array<{
    id: string;
    ruleId: string;
    ruleName?: string;
    triggerType?: string;
    customerId: string;
    customerName?: string;
    actionSummary: string;
    status: string;
    createdAt: string;
  }>;
  whatsappTemplates?: Array<{ type: string; label: string; urduLabel: string; body: string }>;
  autoSegmentsCatalog?: string[];
  reportCatalog?: Array<{ key: CRMReportKey; title: string; category: string; description: string }>;
}

export async function apiFetchCrmState(): Promise<{ ok: boolean; data?: CRMStateBundle; error?: string }> {
  try {
    const res = await fetch('/api/crm/state', { headers: getAuthHeaders(), cache: 'no-store' });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string } & Partial<CRMStateBundle>>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to load CRM state.' };
    }
    return { ok: true, data: parsed.data as unknown as CRMStateBundle };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiFetchCrmDashboard(filters: {
  dateFrom?: string;
  dateTo?: string;
  city?: string;
  customerType?: string;
  salesperson?: string;
}): Promise<{ ok: boolean; kpis?: CRMDashboardKPIs; error?: string }> {
  try {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v && v !== 'ALL') qs.set(k, v);
    });
    const res = await fetch(`/api/crm/dashboard?${qs.toString()}`, { headers: getAuthHeaders(), cache: 'no-store' });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; kpis?: CRMDashboardKPIs; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Dashboard fetch failed.' };
    }
    return { ok: true, kpis: parsed.data.kpis };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiFetchCrmCustomers(params: {
  page?: number;
  limit?: number;
  q?: string;
  segment?: string;
  city?: string;
  customerType?: string;
}): Promise<{
  ok: boolean;
  items?: Customer360Profile[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
}> {
  try {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.q) qs.set('q', params.q);
    if (params.segment && params.segment !== 'ALL') qs.set('segment', params.segment);
    if (params.city && params.city !== 'ALL') qs.set('city', params.city);
    if (params.customerType && params.customerType !== 'ALL') qs.set('customerType', params.customerType);
    const res = await fetch(`/api/crm/customers?${qs.toString()}`, { headers: getAuthHeaders(), cache: 'no-store' });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      items?: Customer360Profile[];
      total?: number;
      page?: number;
      limit?: number;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to load CRM customers.' };
    }
    return {
      ok: true,
      items: parsed.data.items || [],
      total: parsed.data.total || 0,
      page: parsed.data.page || 1,
      limit: parsed.data.limit || 25,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiFetchCustomer360(
  customerId: string
): Promise<{ ok: boolean; profile360?: Customer360Profile; error?: string }> {
  try {
    const res = await fetch(`/api/crm/customers/${encodeURIComponent(customerId)}/360`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; profile?: Customer360Profile; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok || !parsed.data.profile) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to load 360 profile.' };
    }
    return { ok: true, profile360: parsed.data.profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiUpdateCrmCustomer(
  customerId: string,
  updates: Partial<Customer>
): Promise<{ ok: boolean; customer?: Customer; error?: string }> {
  try {
    const res = await fetch(`/api/crm/customers/${encodeURIComponent(customerId)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(updates),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; customer?: Customer; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Update failed.' };
    }
    await refreshSyncState();
    return { ok: true, customer: parsed.data.customer };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmCustomSegment(
  rule: Partial<CRMCustomSegmentRule> & { name: string }
): Promise<{ ok: boolean; rule?: CRMCustomSegmentRule; error?: string }> {
  try {
    const res = await fetch('/api/crm/segments', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(rule),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; segment?: CRMCustomSegmentRule; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Save segment failed.' };
    }
    return { ok: true, rule: parsed.data.segment };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteCrmCustomSegment(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/crm/segments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Delete segment failed.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmTask(
  task: Partial<CRMFollowUpTask>
): Promise<{ ok: boolean; task?: CRMFollowUpTask; error?: string }> {
  try {
    const isUpdate = Boolean(task.id);
    const res = await fetch(isUpdate ? `/api/crm/tasks/${encodeURIComponent(task.id!)}` : '/api/crm/tasks', {
      method: isUpdate ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(task),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; task?: CRMFollowUpTask; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Task save failed.' };
    }
    return { ok: true, task: parsed.data.task };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteCrmTask(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/crm/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Delete task failed.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmLead(
  lead: Partial<CRMLead>
): Promise<{ ok: boolean; lead?: CRMLead; error?: string }> {
  try {
    const isUpdate = Boolean(lead.id);
    const res = await fetch(isUpdate ? `/api/crm/leads/${encodeURIComponent(lead.id!)}` : '/api/crm/leads', {
      method: isUpdate ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(lead),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; lead?: CRMLead; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Lead save failed.' };
    }
    return { ok: true, lead: parsed.data.lead };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiBulkImportCrmLeads(payload: {
  leads: Array<Partial<CRMLead>>;
  defaultSource?: CRMLead['source'];
  defaultStage?: CRMLead['stage'];
  skipDuplicates?: boolean;
  updateDuplicates?: boolean;
}): Promise<{
  ok: boolean;
  importedCount?: number;
  updatedCount?: number;
  skippedDuplicatesCount?: number;
  invalidCount?: number;
  leads?: CRMLead[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/crm/leads/bulk-import', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      importedCount?: number;
      updatedCount?: number;
      skippedDuplicatesCount?: number;
      invalidCount?: number;
      leads?: CRMLead[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Bulk lead import failed.' };
    }
    return {
      ok: true,
      importedCount: parsed.data.importedCount ?? 0,
      updatedCount: parsed.data.updatedCount ?? 0,
      skippedDuplicatesCount: parsed.data.skippedDuplicatesCount ?? 0,
      invalidCount: parsed.data.invalidCount ?? 0,
      leads: parsed.data.leads,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiConvertCrmLead(
  leadId: string
): Promise<{ ok: boolean; customer?: Customer; reusedExisting?: boolean; lead?: CRMLead; error?: string }> {
  try {
    const res = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/convert`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({}),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      customer?: Customer;
      reusedExisting?: boolean;
      lead?: CRMLead;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Lead conversion failed.' };
    }
    await refreshSyncState();
    return {
      ok: true,
      customer: parsed.data.customer,
      reusedExisting: parsed.data.reusedExisting,
      lead: parsed.data.lead,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmCampaign(
  campaign: Partial<CRMCampaign>
): Promise<{ ok: boolean; campaign?: CRMCampaign; error?: string }> {
  try {
    const isUpdate = Boolean(campaign.id);
    const res = await fetch(isUpdate ? `/api/crm/campaigns/${encodeURIComponent(campaign.id!)}` : '/api/crm/campaigns', {
      method: isUpdate ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(campaign),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; campaign?: CRMCampaign; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Campaign save failed.' };
    }
    return { ok: true, campaign: parsed.data.campaign };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmLoyaltyConfig(
  config: CRMLoyaltyConfig
): Promise<{ ok: boolean; config?: CRMLoyaltyConfig; error?: string }> {
  try {
    const res = await fetch('/api/crm/loyalty', {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(config),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; config?: CRMLoyaltyConfig; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Config update failed.' };
    }
    return { ok: true, config: parsed.data.config };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiRedeemLoyaltyPoints(payload: {
  customerId: string;
  points: number;
  notes?: string;
}): Promise<{ ok: boolean; coupon?: CRMLoyaltyCoupon; account?: CRMLoyaltyAccount; error?: string }> {
  try {
    const res = await fetch('/api/crm/loyalty/redeem', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      coupon?: CRMLoyaltyCoupon;
      account?: CRMLoyaltyAccount;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Redemption failed.' };
    }
    return { ok: true, coupon: parsed.data.coupon, account: parsed.data.account };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmCoupon(
  coupon: Partial<CRMLoyaltyCoupon>
): Promise<{ ok: boolean; coupon?: CRMLoyaltyCoupon; error?: string }> {
  try {
    const res = await fetch('/api/crm/coupons', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(coupon),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; coupon?: CRMLoyaltyCoupon; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Coupon save failed.' };
    }
    return { ok: true, coupon: parsed.data.coupon };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiFetchCrmTickets(): Promise<{
  ok: boolean;
  tickets?: CRMSupportTicket[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/crm/tickets', {
      method: 'GET',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      tickets?: CRMSupportTicket[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Could not load support tickets.' };
    }
    return { ok: true, tickets: parsed.data.tickets || [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmTicket(
  ticket: Partial<CRMSupportTicket> & { customerFollowUpNote?: string }
): Promise<{ ok: boolean; ticket?: CRMSupportTicket; tickets?: CRMSupportTicket[]; error?: string }> {
  try {
    const isUpdate = Boolean(ticket.id);
    const res = await fetch(isUpdate ? `/api/crm/tickets/${encodeURIComponent(ticket.id!)}` : '/api/crm/tickets', {
      method: isUpdate ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(ticket),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      ticket?: CRMSupportTicket;
      tickets?: CRMSupportTicket[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Ticket save failed.' };
    }
    return { ok: true, ticket: parsed.data.ticket, tickets: parsed.data.tickets };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveCrmAutomationRule(
  rule: Partial<CRMAutomationRule> & { id: string }
): Promise<{ ok: boolean; rule?: CRMAutomationRule; error?: string }> {
  try {
    const res = await fetch(`/api/crm/automation/rules/${encodeURIComponent(rule.id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(rule),
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; rule?: CRMAutomationRule; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Rule update failed.' };
    }
    return { ok: true, rule: parsed.data.rule };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiRunCrmAutomation(
  ruleId: string,
  options: { dryRun?: boolean; approveBulk?: boolean }
): Promise<{
  ok: boolean;
  dryRun?: boolean;
  executedCount?: number;
  skippedDuplicate?: number;
  skippedOptOut?: number;
  blockedBulkApproval?: number;
  previewMatches?: Array<{
    ruleId: string;
    ruleName: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    idempotencyKey: string;
    alreadyExecuted: boolean;
    optedOut: boolean;
    renderedMessage: string;
  }>;
  error?: string;
}> {
  try {
    const res = await fetch('/api/crm/automation/run', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ ruleId, ...options }),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      dryRun?: boolean;
      executedCount?: number;
      skippedDuplicate?: number;
      skippedOptOut?: number;
      blockedBulkApproval?: number;
      previewMatches?: Array<{
        ruleId: string;
        ruleName: string;
        customerId: string;
        customerName: string;
        customerPhone: string;
        idempotencyKey: string;
        alreadyExecuted: boolean;
        optedOut: boolean;
        renderedMessage: string;
      }>;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Automation run failed.' };
    }
    return { ok: true, ...parsed.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiLogCrmActivity(event: {
  customerId?: string;
  phone?: string;
  eventType: CRMActivityEvent['eventType'];
  title?: string;
  description?: string;
  notes?: string;
  productId?: string;
  productName?: string;
  category?: string;
  orderNumber?: string;
  amount?: number;
}): Promise<void> {
  try {
    await fetch('/api/crm/activity', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ ...event, notes: event.notes || event.description || event.title }),
    });
  } catch {
    // non-blocking telemetry
  }
}

export async function apiFetchCrmReport(
  reportKey: CRMReportKey,
  params: { dateFrom?: string; dateTo?: string }
): Promise<{
  ok: boolean;
  report?: {
    key: CRMReportKey;
    title: string;
    columns: string[];
    rows: Array<Record<string, string | number>>;
    summary?: Record<string, string | number>;
  };
  error?: string;
}> {
  try {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    const res = await fetch(`/api/crm/reports/${encodeURIComponent(reportKey)}?${qs.toString()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      report?: { key: CRMReportKey; title: string; category: string; description: string };
      columns?: string[];
      rows?: Array<Record<string, string | number>>;
      summary?: Record<string, string | number>;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok || !parsed.data.columns) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to generate report.' };
    }
    return {
      ok: true,
      report: {
        key: parsed.data.report?.key || reportKey,
        title: parsed.data.report?.title || reportKey,
        columns: parsed.data.columns,
        rows: parsed.data.rows || [],
        summary: parsed.data.summary,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function downloadCrmReportFile(
  reportKey: CRMReportKey,
  format: 'csv' | 'xls',
  params: { dateFrom?: string; dateTo?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const qs = new URLSearchParams({ format });
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    const res = await fetch(`/api/crm/reports/${encodeURIComponent(reportKey)}?${qs.toString()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `Export failed (HTTP ${res.status})` };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `100DAGAR_${reportKey}_${new Date().toISOString().split('T')[0]}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Download error' };
  }
}

// INVESTOR MANAGEMENT
export function getInvestors(): Investor[] {
  return loadFromStorage<Investor[]>(STORAGE_KEYS.INVESTORS, defaultInvestors);
}

export function saveInvestors(investors: Investor[]): void {
  saveToStorage(STORAGE_KEYS.INVESTORS, investors);
}

export function getInvestorTransactions(): InvestorTransaction[] {
  return loadFromStorage<InvestorTransaction[]>(STORAGE_KEYS.INVESTOR_TRANSACTIONS, defaultInvestorTransactions);
}

export function saveInvestorTransactions(txs: InvestorTransaction[]): void {
  saveToStorage(STORAGE_KEYS.INVESTOR_TRANSACTIONS, txs);
}

// USER ACCOUNTS & CREDENTIAL MANAGEMENT
export function getUserAccounts(): UserAccount[] {
  const saved = loadFromStorage<UserAccount[]>(STORAGE_KEYS.USER_ACCOUNTS, defaultUserAccounts);
  let didMigrate = false;

  const normalized = saved.map((u) => {
    let next = u;
    if (u.username.toLowerCase() === 'bilal_manager' && u.id === 'usr_manager_1') {
      didMigrate = true;
      next = { ...next, id: 'usr_manager_bilal' };
    }
    if (u.id === 'usr_superadmin' || u.role === 'super_admin') {
      const needsSuperAdminSync =
        u.fullName === 'Al-Haj Muhammad Asif' ||
        u.email === 'owner@100dagar.pk' ||
        u.suggestedDefaultPin !== undefined ||
        u.fullName !== 'Shahzad Malik' ||
        u.phone !== '03125256266' ||
        u.email !== 'admin@madinamarket.pk';
      if (needsSuperAdminSync) {
        didMigrate = true;
        const { suggestedDefaultPin: _removed, ...rest } = next;
        next = {
          ...rest,
          fullName: 'Shahzad Malik',
          urduName: 'شہزاد ملک (سپر ایڈمن)',
          phone: '03125256266',
          email: 'admin@madinamarket.pk',
          canAuthorizeCreditSale: true,
        };
      }
    }
    return next;
  });

  const existingUsernames = new Set(normalized.map((u) => u.username.toLowerCase()));
  const missingDefaults = defaultUserAccounts.filter(
    (def) => !existingUsernames.has(def.username.toLowerCase())
  );
  if (missingDefaults.length > 0 || didMigrate) {
    const merged = [...normalized, ...missingDefaults];
    saveToStorage(STORAGE_KEYS.USER_ACCOUNTS, merged, true);
    return merged;
  }
  return normalized;
}

export function saveUserAccounts(accounts: UserAccount[]): void {
  saveToStorage(STORAGE_KEYS.USER_ACCOUNTS, accounts);
}

export function createUserAccount(user: Omit<UserAccount, 'id' | 'createdAt'>): UserAccount {
  const newAccount: UserAccount = {
    ...user,
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString(),
    loginCount: 0,
  };
  const accounts = getUserAccounts();
  saveUserAccounts([...accounts, newAccount]);
  return newAccount;
}

export function updateUserAccount(id: string, updates: Partial<UserAccount>): boolean {
  const accounts = getUserAccounts();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return false;
  accounts[index] = { ...accounts[index], ...updates };
  saveUserAccounts(accounts);
  return true;
}

export function resetUserPasswordToDefault(userId: string): { tempPin: string; account?: UserAccount } {
  const accounts = getUserAccounts();
  const target = accounts.find((a) => a.id === userId);
  if (!target) return { tempPin: '123456' };

  const tempPin = getDefaultPinForPhone(target.phone);
  const updatedAccounts = accounts.map((a) => {
    if (a.id === userId) {
      return {
        ...a,
        passwordHash: tempPin,
        passwordSalt: undefined,
        mustChangePassword: true,
        isTemporaryPassword: true,
        suggestedDefaultPin: tempPin,
      };
    }
    return a;
  });

  saveUserAccounts(updatedAccounts);

  if (target.linkedCustomerId) {
    updateCustomerPin(target.linkedCustomerId, tempPin);
  }
  if (target.linkedResellerCode) {
    const res = getResellers().find((r) => r.referralCode === target.linkedResellerCode);
    if (res) updateResellerPin(res.id, tempPin);
  }

  return { tempPin, account: updatedAccounts.find((a) => a.id === userId) };
}

// CONFIGURABLE LOGIN FORM CONFIGURATION
export function getLoginFormConfig(): LoginFormConfig {
  const prof = getBusinessProfile();
  const raw =
    prof.loginFormConfig || loadFromStorage<LoginFormConfig>(STORAGE_KEYS.LOGIN_CONFIG, defaultLoginFormConfig);
  const instructions = raw.loginInstructions || '';
  if (/last\s*6\s*digits/i.test(instructions)) {
    return {
      ...raw,
      loginInstructions: defaultLoginFormConfig.loginInstructions,
    };
  }
  return raw;
}

export function saveLoginFormConfig(config: LoginFormConfig): void {
  saveToStorage(STORAGE_KEYS.LOGIN_CONFIG, config, true);
  const prof = getBusinessProfile();
  prof.loginFormConfig = config;
  saveBusinessProfile(prof);
}

// Calculate Customer Balance and Total Purchases from Transactions
export function recalculateCustomerBalances(
  customers: Customer[],
  transactions: Transaction[]
): Customer[] {
  const balanceMap = new Map<string, number>();
  const purchaseMap = new Map<string, number>();
  const countMap = new Map<string, number>();
  const lastPurchaseAmountMap = new Map<string, number>();
  const lastPaidAmountMap = new Map<string, number>();
  const lastPurchaseDateMap = new Map<string, string>();

  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  sortedTxs.forEach((tx) => {
    const curBalance = balanceMap.get(tx.customerId) || 0;
    const curPurchases = purchaseMap.get(tx.customerId) || 0;
    const curCount = countMap.get(tx.customerId) || 0;

    if (tx.type === 'credit') {
      balanceMap.set(tx.customerId, curBalance + (tx.dueBalance !== undefined ? tx.dueBalance : tx.amount));
      purchaseMap.set(tx.customerId, curPurchases + tx.amount);
      countMap.set(tx.customerId, curCount + 1);
      lastPurchaseAmountMap.set(tx.customerId, tx.amount);
      const paid = tx.paidAmount !== undefined ? tx.paidAmount : (tx.dueBalance === 0 ? tx.amount : 0);
      lastPaidAmountMap.set(tx.customerId, paid);
      lastPurchaseDateMap.set(tx.customerId, tx.date);
    } else {
      balanceMap.set(tx.customerId, curBalance - tx.amount);
    }
  });

  return customers.map((c) => ({
    ...c,
    creditLimit: c.creditLimit || 5000,
    paymentTermsDays: c.paymentTermsDays || 7,
    balance: balanceMap.get(c.id) ?? c.balance ?? 0,
    totalPurchases: purchaseMap.get(c.id) ?? c.totalPurchases ?? 0,
    ordersCount: countMap.get(c.id) ?? c.ordersCount ?? 0,
    lastPurchaseAmount: lastPurchaseAmountMap.get(c.id) ?? c.lastPurchaseAmount ?? (c.totalPurchases || 0),
    lastPaidAmount: lastPaidAmountMap.get(c.id) ?? c.lastPaidAmount ?? (c.totalPurchases ? Math.max(0, (c.totalPurchases || 0) - (c.balance || 0)) : 0),
    lastPurchaseDate: lastPurchaseDateMap.get(c.id) ?? c.lastPurchaseDate,
  }));
}

export function resetToDemoData(): void {
  saveToStorage(STORAGE_KEYS.PROFILE, defaultBusinessProfile);
  saveToStorage(STORAGE_KEYS.CUSTOMERS, defaultCustomers);
  saveToStorage(STORAGE_KEYS.PRODUCTS, defaultProducts);
  saveToStorage(STORAGE_KEYS.TRANSACTIONS, defaultTransactions);
  saveToStorage(STORAGE_KEYS.RECURRING, defaultRecurringInvoices);
  saveToStorage(STORAGE_KEYS.NOTIFICATIONS, defaultWhatsAppNotifications);
  saveToStorage(STORAGE_KEYS.TEMPLATES, defaultReminderTemplates);
  saveToStorage(STORAGE_KEYS.BROADCASTS, defaultProductBroadcasts);
  saveToStorage(STORAGE_KEYS.LUCKY_DRAWS, defaultLuckyDrawEvents);
  saveToStorage(STORAGE_KEYS.BROADCAST_CONTACTS, defaultBroadcastContacts);
  saveToStorage(STORAGE_KEYS.SAVED_BROADCASTS, defaultSavedBroadcasts);
  saveToStorage(STORAGE_KEYS.COD_ORDERS, defaultCODOrders);
  saveToStorage(STORAGE_KEYS.EMPLOYEES, defaultEmployees);
  saveToStorage(STORAGE_KEYS.ATTENDANCE, defaultAttendance);
  saveToStorage(STORAGE_KEYS.RESELLERS, defaultResellers);
  saveToStorage(STORAGE_KEYS.REVIEW_REWARDS, defaultReviewRewards);
  saveToStorage(STORAGE_KEYS.ACTIVE_ROLE, 'admin', true);
}

export function startFromScratchData(): void {
  const profile = getBusinessProfile();
  saveToStorage(STORAGE_KEYS.PROFILE, profile);
  const resetCustomers = defaultCustomers.map((c) => ({
    ...c,
    balance: 0,
    totalPurchases: 0,
    ordersCount: 0,
    lastPurchaseAmount: 0,
    lastPaidAmount: 0,
    creditLimit: c.creditLimit || 5000,
    paymentTermsDays: c.paymentTermsDays || 7,
  }));
  saveToStorage(STORAGE_KEYS.CUSTOMERS, resetCustomers);
  saveToStorage(STORAGE_KEYS.PRODUCTS, defaultProducts);
  saveToStorage(STORAGE_KEYS.TRANSACTIONS, []);
  saveToStorage(STORAGE_KEYS.RECURRING, []);
  saveToStorage(STORAGE_KEYS.NOTIFICATIONS, []);
  saveToStorage(STORAGE_KEYS.TEMPLATES, defaultReminderTemplates);
  saveToStorage(STORAGE_KEYS.BROADCASTS, []);
  saveToStorage(STORAGE_KEYS.LUCKY_DRAWS, []);
  saveToStorage(STORAGE_KEYS.BROADCAST_CONTACTS, defaultBroadcastContacts);
  saveToStorage(STORAGE_KEYS.SAVED_BROADCASTS, []);
  saveToStorage(STORAGE_KEYS.COD_ORDERS, []);
  saveToStorage(STORAGE_KEYS.EMPLOYEES, defaultEmployees);
  saveToStorage(STORAGE_KEYS.ATTENDANCE, []);
  const freshResellers = defaultResellers.map((r) => ({
    ...r,
    creditLimit: 25000,
    totalReferredOrders: 0,
    totalSales: 0,
    totalPaidSales: 0,
    earnedCommission: 0,
    paidCommission: 0,
  }));
  saveToStorage(STORAGE_KEYS.RESELLERS, freshResellers);
  saveToStorage(STORAGE_KEYS.REVIEW_REWARDS, []);
  saveToStorage(STORAGE_KEYS.ACTIVE_ROLE, 'customer', true);
  saveToStorage(STORAGE_KEYS.CURRENT_USER, defaultCustomerUser, true);
  saveToStorage(STORAGE_KEYS.LOGIN_AUDITS, defaultLoginAuditLogs);
}

// BRANCH MANAGEMENT
export function getBranches(): Branch[] {
  return loadFromStorage<Branch[]>(STORAGE_KEYS.BRANCHES, defaultBranches);
}

export function saveBranches(branches: Branch[]): void {
  saveToStorage(STORAGE_KEYS.BRANCHES, branches);
}

export function getBranchById(id: string): Branch | undefined {
  return getBranches().find((b) => b.id === id);
}

// SALESPERSON REFERRALS
export function getSalespersonReferrals(): SalespersonReferral[] {
  return loadFromStorage<SalespersonReferral[]>(STORAGE_KEYS.SP_REFERRALS, defaultSalespersonReferrals);
}

export function saveSalespersonReferrals(referrals: SalespersonReferral[]): void {
  saveToStorage(STORAGE_KEYS.SP_REFERRALS, referrals);
}

export function calculateSalespersonCommission(eligibleSalesAmount: number): number {
  if (eligibleSalesAmount < 1000) return 0;
  return Math.floor(eligibleSalesAmount / 1000) * 30;
}

// COMMISSION RECORDS LEDGER
export function getCommissionRecords(): CommissionRecord[] {
  return loadFromStorage<CommissionRecord[]>(STORAGE_KEYS.COMMISSIONS, defaultCommissionRecords);
}

export function saveCommissionRecords(records: CommissionRecord[]): void {
  saveToStorage(STORAGE_KEYS.COMMISSIONS, records);
}

// WALK-IN CUSTOMERS
export function getWalkInCustomers(): WalkInCustomer[] {
  return loadFromStorage<WalkInCustomer[]>(STORAGE_KEYS.WALK_IN_CUSTOMERS, defaultWalkInCustomers);
}

export function saveWalkInCustomers(customers: WalkInCustomer[]): void {
  saveToStorage(STORAGE_KEYS.WALK_IN_CUSTOMERS, customers);
}

// WALK-IN SALES
export function getWalkInSales(): WalkInSale[] {
  return loadFromStorage<WalkInSale[]>(STORAGE_KEYS.WALK_IN_SALES, defaultWalkInSales);
}

export function saveWalkInSales(sales: WalkInSale[]): void {
  saveToStorage(STORAGE_KEYS.WALK_IN_SALES, sales);
}

// PRODUCT IMPORT LOGS
export function getProductImportLogs(): ProductImportLog[] {
  return loadFromStorage<ProductImportLog[]>(STORAGE_KEYS.IMPORT_LOGS, defaultImportLogs);
}

export function saveProductImportLogs(logs: ProductImportLog[]): void {
  saveToStorage(STORAGE_KEYS.IMPORT_LOGS, logs);
}

export function logProductImport(log: Omit<ProductImportLog, 'id' | 'timestamp'>): void {
  const newLog: ProductImportLog = {
    ...log,
    id: `implog_${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
  const logs = getProductImportLogs();
  saveProductImportLogs([newLog, ...logs.slice(0, 99)]);
}

// Export all data as JSON
export function exportAllDataJSON(): string {
  const data = {
    exportDate: new Date().toISOString(),
    businessProfile: getBusinessProfile(),
    customers: getCustomers(),
    products: getProducts(),
    transactions: getTransactions(),
    recurringInvoices: getRecurringInvoices(),
    whatsAppNotifications: getWhatsAppNotifications(),
    reminderTemplates: getReminderTemplates(),
    productBroadcasts: getProductBroadcasts(),
    luckyDraws: getLuckyDraws(),
    broadcastContacts: getBroadcastContacts(),
    savedBroadcasts: getSavedBroadcasts(),
    codOrders: getCODOrders(),
    employees: getEmployees(),
    attendance: getAttendance(),
    resellers: getResellers(),
    reviewRewards: getReviewRewards(),
    loginAudits: getLoginAudits(),
    categoryRecords: getCategoryRecords(),
    investors: getInvestors(),
    investorTransactions: getInvestorTransactions(),
    userAccounts: getUserAccounts(),
    branches: getBranches(),
    salespersonReferrals: getSalespersonReferrals(),
    walkInCustomers: getWalkInCustomers(),
    walkInSales: getWalkInSales(),
    commissionRecords: getCommissionRecords(),
    importLogs: getProductImportLogs(),
    wasalSettlements: getWasalSettlements(),
    monthlyExpenses: getMonthlyExpenses(),
  };
  return JSON.stringify(data, null, 2);
}

// Import all data from JSON
export function importAllDataJSON(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.businessProfile) saveBusinessProfile(parsed.businessProfile);
    if (parsed.customers) saveCustomers(parsed.customers);
    if (parsed.products) saveProducts(parsed.products);
    if (parsed.transactions) saveTransactions(parsed.transactions);
    if (parsed.recurringInvoices) saveRecurringInvoices(parsed.recurringInvoices);
    if (parsed.whatsAppNotifications) saveWhatsAppNotifications(parsed.whatsAppNotifications);
    if (parsed.reminderTemplates) saveReminderTemplates(parsed.reminderTemplates);
    if (parsed.productBroadcasts) saveProductBroadcasts(parsed.productBroadcasts);
    if (parsed.luckyDraws) saveLuckyDraws(parsed.luckyDraws);
    if (parsed.broadcastContacts) saveBroadcastContacts(parsed.broadcastContacts);
    if (parsed.savedBroadcasts) saveSavedBroadcasts(parsed.savedBroadcasts);
    if (parsed.codOrders) saveCODOrders(parsed.codOrders);
    if (parsed.employees) saveEmployees(parsed.employees);
    if (parsed.attendance) saveAttendance(parsed.attendance);
    if (parsed.resellers) saveResellers(parsed.resellers);
    if (parsed.reviewRewards) saveReviewRewards(parsed.reviewRewards);
    if (parsed.loginAudits) saveLoginAudits(parsed.loginAudits);
    if (parsed.categoryRecords) saveCategoryRecords(parsed.categoryRecords);
    if (parsed.investors) saveInvestors(parsed.investors);
    if (parsed.investorTransactions) saveInvestorTransactions(parsed.investorTransactions);
    if (parsed.userAccounts) saveUserAccounts(parsed.userAccounts);
    if (parsed.branches) saveBranches(parsed.branches);
    if (parsed.salespersonReferrals) saveSalespersonReferrals(parsed.salespersonReferrals);
    if (parsed.walkInCustomers) saveWalkInCustomers(parsed.walkInCustomers);
    if (parsed.walkInSales) saveWalkInSales(parsed.walkInSales);
    if (parsed.commissionRecords) saveCommissionRecords(parsed.commissionRecords);
    if (parsed.importLogs) saveProductImportLogs(parsed.importLogs);
    if (parsed.wasalSettlements) saveWasalSettlements(parsed.wasalSettlements);
    if (parsed.monthlyExpenses) saveMonthlyExpenses(parsed.monthlyExpenses);
    if (parsed.investorOfferings) saveInvestorOfferings(parsed.investorOfferings);
    if (parsed.investorRequests) saveInvestorRequests(parsed.investorRequests);
    return true;
  } catch (e) {
    console.error('Failed to import JSON data', e);
    return false;
  }
}

// ==========================================
// INVESTOR PRODUCT OFFERINGS & PENDING REQUESTS
// ==========================================

export function getInvestorOfferings(): InvestorProductOffering[] {
  return loadFromStorage<InvestorProductOffering[]>(STORAGE_KEYS.INVESTOR_OFFERINGS, []);
}

export function saveInvestorOfferings(list: InvestorProductOffering[]): void {
  saveToStorage(STORAGE_KEYS.INVESTOR_OFFERINGS, list);
}

export function getInvestorRequests(): InvestorProductRequest[] {
  return loadFromStorage<InvestorProductRequest[]>(STORAGE_KEYS.INVESTOR_REQUESTS, []);
}

export function saveInvestorRequests(list: InvestorProductRequest[]): void {
  saveToStorage(STORAGE_KEYS.INVESTOR_REQUESTS, list);
}

export async function apiFetchInvestorOfferings(): Promise<{
  ok: boolean;
  offerings?: InvestorProductOffering[];
  requests?: InvestorProductRequest[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/investor-offerings', { headers: getAuthHeaders(), cache: 'no-store' });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      offerings?: InvestorProductOffering[];
      requests?: InvestorProductRequest[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to fetch investor offerings.' };
    }
    if (Array.isArray(parsed.data.offerings)) {
      memoryStore.set(STORAGE_KEYS.INVESTOR_OFFERINGS, parsed.data.offerings);
    }
    if (Array.isArray(parsed.data.requests)) {
      memoryStore.set(STORAGE_KEYS.INVESTOR_REQUESTS, parsed.data.requests);
    }
    notifyListeners();
    return { ok: true, offerings: parsed.data.offerings || [], requests: parsed.data.requests || [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiSaveInvestorOffering(
  payload: Partial<InvestorProductOffering>,
  existingId?: string
): Promise<{ ok: boolean; offering?: InvestorProductOffering; offerings?: InvestorProductOffering[]; error?: string }> {
  try {
    const endpoint = existingId
      ? `/api/investor-offerings/${encodeURIComponent(existingId)}`
      : '/api/investor-offerings';
    const res = await fetch(endpoint, {
      method: existingId ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      offering?: InvestorProductOffering;
      offerings?: InvestorProductOffering[];
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to save investor product offering.' };
    }
    await refreshSyncState();
    return { ok: true, offering: parsed.data.offering, offerings: parsed.data.offerings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiDeleteInvestorOffering(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/investor-offerings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const parsed = await safeParseJsonResponse<{ ok?: boolean; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to delete offering.' };
    }
    await refreshSyncState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiCreateInvestorRequest(payload: {
  offeringId: string;
  requestedQty: number;
  notes?: string;
  investorId?: string;
}): Promise<{ ok: boolean; request?: InvestorProductRequest; error?: string }> {
  try {
    const res = await fetch('/api/investor-requests', {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify(payload),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      request?: InvestorProductRequest;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to submit investment request.' };
    }
    await refreshSyncState();
    return { ok: true, request: parsed.data.request };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function apiReviewInvestorRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<{ ok: boolean; request?: InvestorProductRequest; error?: string }> {
  try {
    const res = await fetch(`/api/investor-requests/${encodeURIComponent(requestId)}/review`, {
      method: 'POST',
      headers: getAuthHeaders(),
      cache: 'no-store',
      body: JSON.stringify({ decision, rejectionReason }),
    });
    const parsed = await safeParseJsonResponse<{
      ok?: boolean;
      request?: InvestorProductRequest;
      error?: string;
    }>(res);
    if (!parsed.ok || !parsed.data?.ok) {
      return { ok: false, error: parsed.data?.error || parsed.error || 'Failed to review investment request.' };
    }
    await refreshSyncState();
    return { ok: true, request: parsed.data.request };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Clears ONLY browser localStorage/sessionStorage UI cache keys without modifying or deleting any server database records.
 * Used for safe recovery on subdomain/live host HTTP 505 or stale cache errors.
 */
export function clearClientCacheSafely(): void {
  try {
    memoryStore.clear();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('100dagar_') && k !== SESSION_TOKEN_KEY) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore browser storage restrictions
  }
}

