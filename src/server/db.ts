import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AdminAuditLog,
  BusinessProfile,
  CategoryRecord,
  CODOrder,
  CRMActivityEvent,
  CRMAutomationLog,
  CRMAutomationRule,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMFollowUpTask,
  CRMLead,
  CRMLoyaltyAccount,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMLoyaltyLedgerEntry,
  CRMLoyaltyTier,
  CRMSupportTicket,
  Customer,
  DeliveryAreaConfig,
  DeliveryCityConfig,
  MonthlyExpense,
  ProductItem,
  Reseller,
  ReviewRewardSubmission,
  Transaction,
  UserAccount,
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
} from '../utils/defaultData.ts';
import {
  computeCategoryLevel,
  ensureCityAreasShape,
  getCategoryBreadcrumb,
  inferProvinceForCity,
  isProductPurchaseBlocked,
  isUpcomingCategoryName,
  normalizeTextKey,
  normalizeUpcomingCategoryRecord,
  resolveCategoryIdsFromProduct,
  slugifyId,
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
} from '../utils/locationCategoryHelpers.ts';
import {
  hasRecordContentChanges,
  mergePreservingOmittedFields,
  normalizeStoredDateValue,
  resolvePreservedCreatedAt,
  resolveUpdatedAt,
  validateAndNormalizeDateOnly,
  validateAndNormalizeDateTime,
} from './dateUtils.ts';
import {
  buildUpsertSql,
  type DbAdapter,
  type DbDriver,
  type DbExecutor,
  getMysqlConfigFromEnv,
  insertIgnoreKeyword,
  MysqlDbAdapter,
  parseJsonSafe,
  resolveDbDriver,
  SqliteDbAdapter,
  validateProductionEnv,
} from './dbAdapter.ts';

export { buildUpsertSql, insertIgnoreKeyword, parseJsonSafe };
export type { DbAdapter, DbDriver, DbExecutor };

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DEFAULT_SQLITE_PATH = path.join(DATA_DIR, 'madinamarket.db');

function resolveSqliteDbPath(): string {
  const custom = process.env.SQLITE_DB_PATH?.trim();
  if (custom && process.env.NODE_ENV !== 'production') {
    return path.resolve(custom);
  }
  return DEFAULT_SQLITE_PATH;
}

export const EXPECTED_MYSQL_TABLES = [
  'admin_audit_logs',
  'app_collections',
  'categories',
  'cities',
  'city_areas',
  'crm_activity_events',
  'crm_automation_logs',
  'crm_automation_rules',
  'crm_campaigns',
  'crm_coupons',
  'crm_custom_segments',
  'crm_follow_ups',
  'crm_leads',
  'crm_loyalty_accounts',
  'crm_loyalty_ledger',
  'crm_support_tickets',
  'customers',
  'products',
  'schema_migrations',
] as const;

export interface BackupMetadata {
  id: string;
  reason: string;
  createdAt: string;
  sqliteFile: string | null;
  jsonFile: string;
  sha256: string;
  counts: Record<string, number>;
}

const DEFAULT_COLLECTION_MAP: Record<string, unknown> = {
  transactions: defaultTransactions,
  cod_orders: defaultCODOrders,
  wasal_settlements: defaultWasalSettlements,
  investors: defaultInvestors,
  investor_transactions: defaultInvestorTransactions,
  resellers: defaultResellers,
  user_accounts: defaultUserAccounts,
  branches: defaultBranches,
  walkin_customers: defaultWalkInCustomers,
  walkin_sales: defaultWalkInSales,
  salesperson_referrals: defaultSalespersonReferrals,
  commission_records: defaultCommissionRecords,
  employees: defaultEmployees,
  attendance: defaultAttendance,
  recurring_invoices: defaultRecurringInvoices,
  notifications: defaultWhatsAppNotifications,
  templates: defaultReminderTemplates,
  product_broadcasts: defaultProductBroadcasts,
  broadcast_contacts: defaultBroadcastContacts,
  saved_broadcasts: defaultSavedBroadcasts,
  lucky_draws: defaultLuckyDrawEvents,
  review_rewards: defaultReviewRewards,
  login_audits: defaultLoginAuditLogs,
  import_logs: defaultImportLogs,
  monthly_expenses: [] as MonthlyExpense[],
  business_profile: defaultBusinessProfile,
};

let dbAdapterInstance: DbAdapter | null = null;
let dbInitPromise: Promise<DbAdapter> | null = null;
let lastSyncVersion = new Date().toISOString();

export function getSyncVersion(): string {
  return lastSyncVersion;
}

export function touchSyncVersion(): string {
  lastSyncVersion = new Date().toISOString();
  return lastSyncVersion;
}

function ensureDirectories(sqlitePath?: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (sqlitePath) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  }
}

export async function initDb(): Promise<DbAdapter> {
  if (dbAdapterInstance) return dbAdapterInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    validateProductionEnv();
    const driver = resolveDbDriver();

    if (driver === 'mysql') {
      const mysqlCfg = getMysqlConfigFromEnv();
      const adapter = await MysqlDbAdapter.create(mysqlCfg);
      dbAdapterInstance = adapter;
      await ensureMysqlSchemaAndMigrations(adapter);
      await initServerSessionSecret(adapter);
      return adapter;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to initialize SQLite in production. Configure MySQL via DB_* environment variables.');
    }

    const activeSqlitePath = resolveSqliteDbPath();
    ensureDirectories(activeSqlitePath);
    const hadExistingDb = fs.existsSync(activeSqlitePath) && fs.statSync(activeSqlitePath).size > 0;
    const { DatabaseSync } = await import('node:sqlite');
    const sqliteRaw = new DatabaseSync(activeSqlitePath);
    sqliteRaw.exec('PRAGMA busy_timeout = 5000;');
    try {
      sqliteRaw.exec('PRAGMA journal_mode = WAL;');
    } catch (walErr) {
      console.warn('SQLite WAL mode unavailable, falling back to TRUNCATE/DELETE journal mode:', walErr);
      try {
        sqliteRaw.exec('PRAGMA journal_mode = TRUNCATE;');
      } catch {
        try {
          sqliteRaw.exec('PRAGMA journal_mode = DELETE;');
        } catch {
          // ignore if journal mode cannot be switched
        }
      }
    }
    sqliteRaw.exec('PRAGMA foreign_keys = ON;');
    sqliteRaw.exec('PRAGMA synchronous = NORMAL;');

    const adapter = new SqliteDbAdapter(sqliteRaw);
    dbAdapterInstance = adapter;
    await runSqliteMigrations(adapter, hadExistingDb);
    await initServerSessionSecret(adapter);
    return adapter;
  })().catch((err) => {
    dbInitPromise = null;
    dbAdapterInstance = null;
    throw err;
  });

  return dbInitPromise;
}

export async function getDb(): Promise<DbAdapter> {
  return initDb();
}

export async function withDbTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.withTransaction(fn);
}

export async function closeDb(): Promise<void> {
  if (dbAdapterInstance) {
    await dbAdapterInstance.close();
    dbAdapterInstance = null;
    dbInitPromise = null;
  }
}

let cachedFallbackSessionSecret: string | null = null;

export async function initServerSessionSecret(dbArg?: DbExecutor): Promise<string> {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET environment variable is required in production (NODE_ENV=production).'
    );
  }
  if (cachedFallbackSessionSecret) return cachedFallbackSessionSecret;

  const db = dbArg || (await getDb());
  const row = await db.get<{ data_json: unknown }>(
    'SELECT data_json FROM app_collections WHERE collection_key = ?',
    ['server_session_secret']
  );

  if (row?.data_json) {
    try {
      const parsed = parseJsonSafe<{ secret?: string }>(row.data_json, {});
      if (parsed?.secret && typeof parsed.secret === 'string' && parsed.secret.length >= 32) {
        cachedFallbackSessionSecret = parsed.secret;
        return cachedFallbackSessionSecret;
      }
    } catch {
      // regenerate below
    }
  }

  const generated = crypto.randomBytes(32).toString('hex');
  const upsertSql = buildUpsertSql({
    driver: db.driver,
    table: 'app_collections',
    insertColumns: ['collection_key', 'data_json', 'updated_at'],
    conflictColumn: 'collection_key',
    updateAssignments: [{ column: 'data_json' }, { column: 'updated_at' }],
  });
  await db.run(upsertSql, ['server_session_secret', JSON.stringify({ secret: generated }), db.formatTimestamp()]);
  cachedFallbackSessionSecret = generated;
  return generated;
}

export function getCachedServerSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET environment variable is required in production (NODE_ENV=production).'
    );
  }
  if (!cachedFallbackSessionSecret) {
    throw new Error('Server session secret is not initialized yet.');
  }
  return cachedFallbackSessionSecret;
}

export async function createVerifiedBackup(reason: string): Promise<BackupMetadata> {
  ensureDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'manual';
  const id = `bak_${timestamp}_${safeReason}`;
  const sqliteBackupPath = path.join(BACKUP_DIR, `${id}.db`);
  const jsonBackupPath = path.join(BACKUP_DIR, `${id}.json`);

  let sqliteFile: string | null = null;
  const activeSqlitePath = resolveSqliteDbPath();
  if (dbAdapterInstance?.driver === 'sqlite' && fs.existsSync(activeSqlitePath) && fs.statSync(activeSqlitePath).size > 0) {
    try {
      if (dbAdapterInstance instanceof SqliteDbAdapter) {
        const escaped = sqliteBackupPath.replace(/'/g, "''");
        dbAdapterInstance.rawDb.exec(`VACUUM INTO '${escaped}';`);
      } else {
        fs.copyFileSync(activeSqlitePath, sqliteBackupPath);
      }
      sqliteFile = path.basename(sqliteBackupPath);
    } catch {
      fs.copyFileSync(activeSqlitePath, sqliteBackupPath);
      sqliteFile = path.basename(sqliteBackupPath);
    }
  }

  const snapshot: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  if (dbAdapterInstance) {
    const tables = ['categories', 'cities', 'city_areas', 'products', 'customers', 'app_collections', 'admin_audit_logs'];
    for (const tbl of tables) {
      try {
        const rows = await dbAdapterInstance.all(`SELECT * FROM ${tbl}`);
        snapshot[tbl] = rows;
        counts[tbl] = rows.length;
      } catch {
        counts[tbl] = 0;
      }
    }
  }

  const serialized = JSON.stringify(
    {
      backupId: id,
      reason,
      createdAt: new Date().toISOString(),
      counts,
      snapshot,
    },
    null,
    2
  );
  fs.writeFileSync(jsonBackupPath, serialized, 'utf8');
  const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');

  return {
    id,
    reason,
    createdAt: new Date().toISOString(),
    sqliteFile,
    jsonFile: path.basename(jsonBackupPath),
    sha256,
    counts,
  };
}

export function listBackups(): Array<{ file: string; sizeBytes: number; createdAt: string }> {
  ensureDirectories();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json') || f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        file: f,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
}

async function ensureMysqlSchemaAndMigrations(db: MysqlDbAdapter): Promise<void> {
  // Strictly idempotent MySQL DDL: creates missing tables without dropping, truncating, or seeding sample business data.
  const mysqlTableStatements = [
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(191) PRIMARY KEY,
      applied_at VARCHAR(40) NOT NULL,
      notes TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      urdu_name VARCHAR(255),
      parent_category_id VARCHAR(191),
      level INT NOT NULL DEFAULT 1,
      description TEXT,
      is_upcoming TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_categories_parent (parent_category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS cities (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      province VARCHAR(128),
      allowed TINYINT(1) NOT NULL DEFAULT 1,
      delivery_charge DOUBLE,
      display_order INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      UNIQUE KEY idx_cities_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS city_areas (
      id VARCHAR(191) PRIMARY KEY,
      city_id VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      allowed TINYINT(1) NOT NULL DEFAULT 1,
      delivery_charge DOUBLE,
      area_type VARCHAR(64),
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_city_areas_city (city_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      urdu_name VARCHAR(255),
      category VARCHAR(255) NOT NULL,
      parent_category_id VARCHAR(191),
      subcategory_id VARCHAR(191),
      child_subcategory_id VARCHAR(191),
      sku VARCHAR(191),
      cost_price DOUBLE NOT NULL DEFAULT 0,
      market_price DOUBLE NOT NULL DEFAULT 0,
      our_price DOUBLE NOT NULL DEFAULT 0,
      stock_qty INT NOT NULL DEFAULT 0,
      min_stock_alert INT NOT NULL DEFAULT 5,
      is_upcoming TINYINT(1) NOT NULL DEFAULT 0,
      upcoming_status VARCHAR(64) NOT NULL DEFAULT 'available',
      expected_arrival_date VARCHAR(40),
      delivery_fee_type VARCHAR(32) NOT NULL DEFAULT 'default',
      custom_delivery_charge DOUBLE,
      status VARCHAR(32) NOT NULL DEFAULT 'published',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      INDEX idx_products_category (category),
      INDEX idx_products_parent_cat (parent_category_id),
      INDEX idx_products_sku (sku)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(64) NOT NULL,
      city VARCHAR(128),
      area VARCHAR(128),
      mohalla VARCHAR(191),
      landmark VARCHAR(191),
      address TEXT,
      balance DOUBLE NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      INDEX idx_customers_phone (phone),
      INDEX idx_customers_city (city)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS app_collections (
      collection_key VARCHAR(191) PRIMARY KEY,
      data_json LONGTEXT NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id VARCHAR(191) PRIMARY KEY,
      action VARCHAR(128) NOT NULL,
      entity_type VARCHAR(128) NOT NULL,
      entity_id VARCHAR(191) NOT NULL,
      actor_id VARCHAR(191),
      actor_name VARCHAR(255),
      actor_role VARCHAR(64),
      details_json LONGTEXT,
      created_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_follow_ups (
      id VARCHAR(191) PRIMARY KEY,
      customer_id VARCHAR(191),
      lead_id VARCHAR(191),
      assigned_employee_id VARCHAR(191),
      follow_up_date VARCHAR(40) NOT NULL,
      priority VARCHAR(32) NOT NULL DEFAULT 'medium',
      status VARCHAR(32) NOT NULL DEFAULT 'Pending',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      INDEX idx_crm_follow_ups_date_status (follow_up_date, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_leads (
      id VARCHAR(191) PRIMARY KEY,
      phone VARCHAR(64) NOT NULL,
      stage VARCHAR(64) NOT NULL DEFAULT 'New',
      source VARCHAR(64) NOT NULL DEFAULT 'WhatsApp',
      assigned_salesperson_id VARCHAR(191),
      converted_customer_id VARCHAR(191),
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      INDEX idx_crm_leads_stage (stage),
      INDEX idx_crm_leads_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_campaigns (
      id VARCHAR(191) PRIMARY KEY,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_support_tickets (
      id VARCHAR(191) PRIMARY KEY,
      ticket_number VARCHAR(191) NOT NULL,
      customer_id VARCHAR(191),
      order_id VARCHAR(191),
      category VARCHAR(128) NOT NULL,
      priority VARCHAR(32) NOT NULL DEFAULT 'medium',
      status VARCHAR(32) NOT NULL DEFAULT 'Open',
      assigned_employee_id VARCHAR(191),
      due_at VARCHAR(40) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      UNIQUE KEY idx_crm_tickets_num (ticket_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_loyalty_accounts (
      customer_id VARCHAR(191) PRIMARY KEY,
      points_balance INT NOT NULL DEFAULT 0,
      lifetime_points_earned INT NOT NULL DEFAULT 0,
      lifetime_points_redeemed INT NOT NULL DEFAULT 0,
      tier VARCHAR(64) NOT NULL DEFAULT 'Bronze',
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_loyalty_ledger (
      id VARCHAR(191) PRIMARY KEY,
      customer_id VARCHAR(191) NOT NULL,
      type VARCHAR(64) NOT NULL,
      points INT NOT NULL,
      order_number VARCHAR(128),
      coupon_code VARCHAR(128),
      notes TEXT,
      created_at VARCHAR(40) NOT NULL,
      INDEX idx_crm_loyalty_ledger_cust (customer_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_coupons (
      id VARCHAR(191) PRIMARY KEY,
      code VARCHAR(128) NOT NULL,
      customer_id VARCHAR(191),
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      expires_at VARCHAR(40),
      created_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      UNIQUE KEY idx_crm_coupons_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_custom_segments (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_automation_rules (
      id VARCHAR(191) PRIMARY KEY,
      trigger_type VARCHAR(128) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      last_run_at VARCHAR(40),
      total_triggered_count INT NOT NULL DEFAULT 0,
      data_json LONGTEXT NOT NULL,
      UNIQUE KEY idx_crm_rules_trigger (trigger_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_automation_logs (
      id VARCHAR(191) PRIMARY KEY,
      rule_id VARCHAR(191) NOT NULL,
      trigger_type VARCHAR(128) NOT NULL,
      customer_id VARCHAR(191) NOT NULL,
      idempotency_key VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      UNIQUE KEY idx_crm_auto_logs_idem (idempotency_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crm_activity_events (
      id VARCHAR(191) PRIMARY KEY,
      customer_id VARCHAR(191),
      phone VARCHAR(64),
      event_type VARCHAR(64) NOT NULL,
      product_id VARCHAR(191),
      category VARCHAR(255),
      order_number VARCHAR(128),
      created_at VARCHAR(40) NOT NULL,
      data_json LONGTEXT NOT NULL,
      INDEX idx_crm_activity_cust (customer_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (const ddl of mysqlTableStatements) {
    await db.exec(ddl);
  }

  // Safe idempotent column additions on pre-existing MySQL tables (never drops or modifies existing columns)
  const safeColumnChecks: Array<[string, string, string]> = [
    ['cities', 'delivery_charge', 'ALTER TABLE cities ADD COLUMN delivery_charge DOUBLE NULL'],
    ['cities', 'province', 'ALTER TABLE cities ADD COLUMN province VARCHAR(128) NULL'],
    ['city_areas', 'delivery_charge', 'ALTER TABLE city_areas ADD COLUMN delivery_charge DOUBLE NULL'],
    ['city_areas', 'area_type', 'ALTER TABLE city_areas ADD COLUMN area_type VARCHAR(64) NULL'],
    ['products', 'delivery_fee_type', "ALTER TABLE products ADD COLUMN delivery_fee_type VARCHAR(32) NOT NULL DEFAULT 'default'"],
    ['products', 'custom_delivery_charge', 'ALTER TABLE products ADD COLUMN custom_delivery_charge DOUBLE NULL'],
  ];

  for (const [table, col, alterSql] of safeColumnChecks) {
    if (!(await db.columnExists(table, col))) {
      await db.exec(alterSql);
    }
  }

  const missingTables: string[] = [];
  for (const tbl of EXPECTED_MYSQL_TABLES) {
    if (!(await db.tableExists(tbl))) {
      missingTables.push(tbl);
    }
  }
  if (missingTables.length > 0) {
    throw new Error(
      `MySQL schema verification failed for required tables: ${missingTables.join(', ')}. Aborting cleanly.`
    );
  }

  await db.run(
    'INSERT IGNORE INTO schema_migrations (id, applied_at, notes) VALUES (?, ?, ?)',
    ['mysql_idempotent_schema_v1', db.formatTimestamp(), 'Verified MySQL tables and safe additive columns']
  );
}

async function runSqliteMigrations(db: SqliteDbAdapter, hadExistingDb: boolean) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      notes TEXT
    );
  `);

  const hasMigration = async (id: string): Promise<boolean> => {
    const row = await db.get('SELECT id FROM schema_migrations WHERE id = ?', [id]);
    return Boolean(row);
  };

  const recordMigration = async (id: string, notes: string) => {
    await db.run(
      `${insertIgnoreKeyword(db.driver)} INTO schema_migrations (id, applied_at, notes) VALUES (?, ?, ?)`,
      [id, new Date().toISOString(), notes]
    );
  };

  const pendingMigrations =
    !(await hasMigration('001_initial_schema')) ||
    !(await hasMigration('002_seed_defaults_if_empty')) ||
    !(await hasMigration('003_upgrade_upcoming_categories_locations')) ||
    !(await hasMigration('004_delivery_charges_city_areas')) ||
    !(await hasMigration('005_all_provinces_kashmir_subcities_villages')) ||
    !(await hasMigration('006_product_delivery_fees_and_templates')) ||
    !(await hasMigration('007_fix_broadcast_templates_key')) ||
    !(await hasMigration('008_audit_clean_order_history_and_links')) ||
    !(await hasMigration('009_crm_schema_and_security_hardening'));

  if (hadExistingDb && pendingMigrations) {
    await createVerifiedBackup('pre_migration');
  }

  // MIGRATION 001: Create all normalized tables cleanly
  if (!(await hasMigration('001_initial_schema'))) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        urdu_name TEXT,
        parent_category_id TEXT,
        level INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        is_upcoming INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_parent
        ON categories (LOWER(TRIM(name)), COALESCE(parent_category_id, ''));

      CREATE TABLE IF NOT EXISTS cities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        allowed INTEGER NOT NULL DEFAULT 1,
        delivery_charge REAL,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS city_areas (
        id TEXT PRIMARY KEY,
        city_id TEXT NOT NULL,
        name TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        delivery_charge REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_city_areas_unique
        ON city_areas (city_id, LOWER(TRIM(name)));

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        urdu_name TEXT,
        category TEXT NOT NULL,
        parent_category_id TEXT,
        subcategory_id TEXT,
        child_subcategory_id TEXT,
        sku TEXT,
        cost_price REAL NOT NULL DEFAULT 0,
        market_price REAL NOT NULL DEFAULT 0,
        our_price REAL NOT NULL DEFAULT 0,
        stock_qty INTEGER NOT NULL DEFAULT 0,
        min_stock_alert INTEGER NOT NULL DEFAULT 5,
        is_upcoming INTEGER NOT NULL DEFAULT 0,
        upcoming_status TEXT NOT NULL DEFAULT 'available',
        expected_arrival_date TEXT,
        status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_parent_cat ON products(parent_category_id);
      CREATE INDEX IF NOT EXISTS idx_products_sub_cat ON products(subcategory_id);
      CREATE INDEX IF NOT EXISTS idx_products_child_cat ON products(child_subcategory_id);
      CREATE INDEX IF NOT EXISTS idx_products_upcoming ON products(is_upcoming);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        city TEXT,
        area TEXT,
        mohalla TEXT,
        landmark TEXT,
        address TEXT,
        balance REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
      CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);

      CREATE TABLE IF NOT EXISTS app_collections (
        collection_key TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        actor_role TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    await recordMigration(
      '001_initial_schema',
      'Created normalized categories, cities, city_areas, products, customers, app_collections, admin_audit_logs'
    );
  }

  // MIGRATION 002: Only initialize non-sample collections if requested explicitly via ALLOW_SAMPLE_SEED=true
  if (!(await hasMigration('002_seed_defaults_if_empty'))) {
    const now = db.formatTimestamp();
    const allowSampleSeed =
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_SAMPLE_SEED === 'true';

    if (allowSampleSeed) {
      const catCountRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM categories');
      if (Number(catCountRow?.cnt || 0) === 0) {
        for (const c of defaultCategoryRecords) {
          const level = c.level || computeCategoryLevel(c, defaultCategoryRecords);
          await db.run(
            `${insertIgnoreKeyword(db.driver)} INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              c.id,
              c.name,
              c.urduName || null,
              c.parentCategoryId || null,
              level,
              c.description || null,
              c.isUpcoming ? 1 : 0,
              c.isActive === false ? 0 : 1,
              c.displayOrder || 0,
              now,
              now,
            ]
          );
        }
      }

      const cityCountRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM cities');
      if (Number(cityCountRow?.cnt || 0) === 0) {
        for (let idx = 0; idx < defaultDeliveryCities.length; idx++) {
          const city = defaultDeliveryCities[idx];
          const cityId = city.id || slugifyId('city', city.name);
          await db.run(
            `${insertIgnoreKeyword(db.driver)} INTO cities (id, name, allowed, delivery_charge, display_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [cityId, city.name, city.allowed ? 1 : 0, city.deliveryCharge ?? null, idx + 1, now, now]
          );
          for (const area of city.areas || []) {
            const areaId = area.id || slugifyId('area', `${city.name}_${area.name}`);
            await db.run(
              `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, delivery_charge, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [areaId, cityId, area.name, area.allowed ? 1 : 0, area.deliveryCharge ?? null, now, now]
            );
          }
        }
      }

      const prodCountRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products');
      if (Number(prodCountRow?.cnt || 0) === 0) {
        for (const p of defaultProducts) {
          await upsertProductRow(db, p);
        }
      }

      const custCountRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM customers');
      if (Number(custCountRow?.cnt || 0) === 0) {
        for (const cust of defaultCustomers) {
          await upsertCustomerRow(db, cust);
        }
      }

      for (const [key, val] of Object.entries(DEFAULT_COLLECTION_MAP)) {
        await db.run(
          `${insertIgnoreKeyword(db.driver)} INTO app_collections (collection_key, data_json, updated_at)
           VALUES (?, ?, ?)`,
          [key, JSON.stringify(val), now]
        );
      }
    }

    await recordMigration('002_seed_defaults_if_empty', allowSampleSeed ? 'Seeded empty tables via ALLOW_SAMPLE_SEED' : 'Skipped auto sample seeding on startup');
  }

  // MIGRATION 003: Non-destructive normalization for Upcoming Viral Products | Coming Soon, 3-level hierarchy & City areas
  if (!(await hasMigration('003_upgrade_upcoming_categories_locations'))) {
    const now = db.formatTimestamp();

    const existingUpcoming = await db.get<Record<string, unknown>>(
      'SELECT * FROM categories WHERE id = ? OR is_upcoming = 1',
      [UPCOMING_CATEGORY_ID]
    );
    if (existingUpcoming) {
      await db.run(
        `UPDATE categories
         SET name = ?, is_upcoming = 1, is_active = 1, level = 1, parent_category_id = NULL, updated_at = ?
         WHERE id = ?`,
        [UPCOMING_CATEGORY_NAME, now, String(existingUpcoming.id)]
      );
    } else {
      const upCat = defaultCategoryRecords.find((c) => c.id === UPCOMING_CATEGORY_ID)!;
      await db.run(
        `${insertIgnoreKeyword(db.driver)} INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 1, ?, 1, 1, ?, ?, ?)`,
        [upCat.id, UPCOMING_CATEGORY_NAME, upCat.urduName || null, upCat.description || null, 7, now, now]
      );
    }

    for (const c of defaultCategoryRecords) {
      await db.run(
        `${insertIgnoreKeyword(db.driver)} INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.name,
          c.urduName || null,
          c.parentCategoryId || null,
          c.level || computeCategoryLevel(c, defaultCategoryRecords),
          c.description || null,
          c.isUpcoming ? 1 : 0,
          c.isActive === false ? 0 : 1,
          c.displayOrder || 0,
          now,
          now,
        ]
      );
    }

    const allProds = await getAllProductsFromDb(db);
    for (const p of allProds) {
      if (isProductPurchaseBlocked(p)) {
        const updated: ProductItem = {
          ...p,
          category: UPCOMING_CATEGORY_NAME,
          parentCategoryId: UPCOMING_CATEGORY_ID,
          isUpcoming: true,
          upcomingStatus: 'coming_soon',
          stockQty: 0,
        };
        await upsertProductRow(db, updated);
      }
    }

    const profile = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (profile.deliveryCities && profile.deliveryCities.length > 0) {
      for (let idx = 0; idx < profile.deliveryCities.length; idx++) {
        const dc = profile.deliveryCities[idx];
        await db.run(
          `${insertIgnoreKeyword(db.driver)} INTO cities (id, name, allowed, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [dc.id || slugifyId('city', dc.name), dc.name.trim(), dc.allowed ? 1 : 0, idx + 1, now, now]
        );
      }
    }

    for (const defCity of defaultDeliveryCities) {
      const cityRow = await db.get<{ id: string }>(
        'SELECT id FROM cities WHERE LOWER(name) = LOWER(?)',
        [defCity.name]
      );
      if (cityRow && defCity.areas && defCity.areas.length > 0) {
        const cntRow = await db.get<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM city_areas WHERE city_id = ?',
          [cityRow.id]
        );
        if (Number(cntRow?.cnt || 0) === 0) {
          for (const a of defCity.areas) {
            await db.run(
              `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [a.id, cityRow.id, a.name, a.allowed ? 1 : 0, now, now]
            );
          }
        }
      }
    }
    await syncDeliveryCitiesIntoBusinessProfile(db);

    await recordMigration(
      '003_upgrade_upcoming_categories_locations',
      'Normalized Upcoming category label, seeded multi-level sample subcategories, and synced city areas'
    );
  }

  // MIGRATION 004
  if (!(await hasMigration('004_delivery_charges_city_areas'))) {
    const now = db.formatTimestamp();

    if (!(await db.columnExists('cities', 'delivery_charge'))) {
      await db.exec('ALTER TABLE cities ADD COLUMN delivery_charge REAL;');
    }
    if (!(await db.columnExists('city_areas', 'delivery_charge'))) {
      await db.exec('ALTER TABLE city_areas ADD COLUMN delivery_charge REAL;');
    }

    const mzdRow = await db.get<{ id: string; delivery_charge: number | null }>(
      "SELECT id, delivery_charge FROM cities WHERE LOWER(TRIM(name)) = 'muzaffarabad'"
    );

    if (mzdRow) {
      await db.run(
        'UPDATE cities SET allowed = 1, delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE id = ?',
        [now, mzdRow.id]
      );

      const cityCenterArea = await db.get<{ id: string }>(
        "SELECT id FROM city_areas WHERE city_id = ? AND LOWER(TRIM(name)) = 'city center'",
        [mzdRow.id]
      );

      if (!cityCenterArea) {
        await db.run(
          `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, delivery_charge, created_at, updated_at) VALUES (?, ?, ?, 1, 50, ?, ?)`,
          ['area_mzd_city_center', mzdRow.id, 'City Center', now, now]
        );
      } else {
        await db.run(
          'UPDATE city_areas SET allowed = 1, delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE id = ?',
          [now, cityCenterArea.id]
        );
      }

      await db.run(
        "UPDATE city_areas SET delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE city_id = ? AND LOWER(TRIM(name)) = 'madina market'",
        [now, mzdRow.id]
      );
    }

    const currentProfile = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (currentProfile.defaultCityCenterDeliveryCharge === undefined) {
      await saveCollectionValue(db, 'business_profile', {
        ...currentProfile,
        defaultCityCenterDeliveryCharge: 50,
      });
    }
    await syncDeliveryCitiesIntoBusinessProfile(db);

    await recordMigration(
      '004_delivery_charges_city_areas',
      'Added per-city and per-area delivery_charge columns with City Center Rs. 50 default'
    );
  }

  // MIGRATION 005
  if (!(await hasMigration('005_all_provinces_kashmir_subcities_villages'))) {
    if (hadExistingDb) {
      await createVerifiedBackup('pre_migration_005_provinces');
    }
    const now = db.formatTimestamp();

    if (!(await db.columnExists('cities', 'province'))) {
      await db.exec('ALTER TABLE cities ADD COLUMN province TEXT;');
    }
    if (!(await db.columnExists('city_areas', 'area_type'))) {
      await db.exec('ALTER TABLE city_areas ADD COLUMN area_type TEXT;');
    }

    for (let idx = 0; idx < defaultDeliveryCities.length; idx++) {
      const defCity = defaultDeliveryCities[idx];
      const resolvedProv = inferProvinceForCity(defCity.name, defCity.province);
      const existingCity = await db.get<{ id: string; name: string; province?: string }>(
        'SELECT id, name, province FROM cities WHERE id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
        [defCity.id || slugifyId('city', defCity.name), defCity.name]
      );

      let targetCityId: string;
      if (existingCity) {
        targetCityId = existingCity.id;
        await db.run(
          "UPDATE cities SET province = COALESCE(NULLIF(TRIM(province), ''), ?), updated_at = ? WHERE id = ?",
          [resolvedProv, now, targetCityId]
        );
      } else {
        targetCityId = defCity.id || slugifyId('city', defCity.name);
        await db.run(
          `${insertIgnoreKeyword(db.driver)} INTO cities (id, name, province, allowed, delivery_charge, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetCityId,
            defCity.name,
            resolvedProv,
            defCity.allowed ? 1 : 0,
            defCity.deliveryCharge ?? null,
            idx + 1,
            now,
            now,
          ]
        );
      }

      for (const a of defCity.areas || []) {
        const existingArea = await db.get<{ id: string }>(
          'SELECT id FROM city_areas WHERE city_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
          [targetCityId, a.name]
        );
        if (existingArea) {
          if (a.areaType) {
            await db.run(
              "UPDATE city_areas SET area_type = COALESCE(NULLIF(TRIM(area_type), ''), ?), updated_at = ? WHERE id = ?",
              [a.areaType, now, existingArea.id]
            );
          }
        } else {
          await db.run(
            `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, delivery_charge, area_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              a.id || slugifyId('area', `${defCity.name}_${a.name}`),
              targetCityId,
              a.name,
              a.allowed !== false ? 1 : 0,
              a.deliveryCharge ?? null,
              a.areaType || null,
              now,
              now,
            ]
          );
        }
      }
    }

    const allCityRows = await db.all<{ id: string; name: string; province?: string | null }>(
      'SELECT id, name, province FROM cities'
    );
    for (const row of allCityRows) {
      if (!row.province || !String(row.province).trim()) {
        await db.run('UPDATE cities SET province = ? WHERE id = ?', [inferProvinceForCity(row.name), row.id]);
      }
    }

    await syncDeliveryCitiesIntoBusinessProfile(db);
    await recordMigration(
      '005_all_provinces_kashmir_subcities_villages',
      'Non-destructively added all Pakistan provinces & Azad Kashmir cities, sub-cities, child cities & villages while keeping Standard delivery open nationwide'
    );
  }

  // MIGRATION 006
  if (!(await hasMigration('006_product_delivery_fees_and_templates'))) {
    if (hadExistingDb) {
      await createVerifiedBackup('pre_migration_006_delivery_fees');
    }
    const now = db.formatTimestamp();

    if (!(await db.columnExists('products', 'delivery_fee_type'))) {
      await db.exec("ALTER TABLE products ADD COLUMN delivery_fee_type TEXT NOT NULL DEFAULT 'default';");
    }
    if (!(await db.columnExists('products', 'custom_delivery_charge'))) {
      await db.exec('ALTER TABLE products ADD COLUMN custom_delivery_charge REAL;');
    }

    try {
      const tplRow = await db.get<{ data_json?: unknown }>(
        "SELECT data_json FROM app_collections WHERE collection_key = 'templates'"
      );
      if (tplRow?.data_json) {
        const templates = parseJsonSafe<Array<Record<string, unknown>>>(tplRow.data_json, []);
        let changed = false;
        const nextTemplates = templates.map((t) => {
          if (t && (t.id === 'tpl_product_broadcast' || t.type === 'product_broadcast') && typeof t.content === 'string') {
            const nextContent = t.content
              .replace(/Wholesale Deal!/gi, 'Super Best Deal!')
              .replace(/Wholesale Price:/gi, 'Super Best Price:');
            if (nextContent !== t.content) {
              changed = true;
              return { ...t, content: nextContent };
            }
          }
          return t;
        });
        if (changed) {
          await db.run('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?', [
            JSON.stringify(nextTemplates),
            now,
            'templates',
          ]);
        }
      }
    } catch {
      // ignore JSON parse issues on custom collection
    }

    for (const colKey of ['product_broadcasts', 'saved_broadcasts']) {
      try {
        const row = await db.get<{ data_json?: unknown }>(
          'SELECT data_json FROM app_collections WHERE collection_key = ?',
          [colKey]
        );
        const rawStr = typeof row?.data_json === 'string' ? row.data_json : row?.data_json ? JSON.stringify(row.data_json) : '';
        if (rawStr && (rawStr.includes('100dagar.pk') || rawStr.includes('Wholesale'))) {
          const updatedJson = rawStr
            .replace(/https?:\/\/100dagar\.pk/gi, 'https://madinamarket.pk')
            .replace(/Our Wholesale:/gi, 'Our Super Best Price:')
            .replace(/New wholesale arrival/gi, 'New Super Best Price arrival');
          if (updatedJson !== rawStr) {
            await db.run('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?', [
              updatedJson,
              now,
              colKey,
            ]);
          }
        }
      } catch {
        // ignore
      }
    }

    await recordMigration(
      '006_product_delivery_fees_and_templates',
      'Added product delivery_fee_type & custom_delivery_charge columns and updated broadcast templates to Super Best Price & madinamarket.pk'
    );
  }

  // MIGRATION 007
  if (!(await hasMigration('007_fix_broadcast_templates_key'))) {
    const now = db.formatTimestamp();
    try {
      const tplRow = await db.get<{ data_json?: unknown }>(
        "SELECT data_json FROM app_collections WHERE collection_key = 'templates'"
      );
      if (tplRow?.data_json) {
        const templates = parseJsonSafe<Array<Record<string, unknown>>>(tplRow.data_json, []);
        let changed = false;
        const nextTemplates = templates.map((t) => {
          if (t && (t.id === 'tpl_product_broadcast' || t.type === 'product_broadcast') && typeof t.content === 'string') {
            const nextContent = t.content
              .replace(/Wholesale Deal!/gi, 'Super Best Deal!')
              .replace(/Wholesale Price:/gi, 'Super Best Price:');
            if (nextContent !== t.content) {
              changed = true;
              return { ...t, content: nextContent };
            }
          }
          return t;
        });
        if (changed) {
          await db.run('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?', [
            JSON.stringify(nextTemplates),
            now,
            'templates',
          ]);
        }
      }
    } catch {
      // ignore
    }

    await recordMigration(
      '007_fix_broadcast_templates_key',
      'Upgraded broadcast template in app_collections.templates to Super Best Price & Super Best Deal'
    );
  }

  // MIGRATION 008
  if (!(await hasMigration('008_audit_clean_order_history_and_links'))) {
    if (hadExistingDb) {
      await createVerifiedBackup('pre_migration_008_order_audit');
    }
    try {
      await auditAndRepairOrderHistory(db);
    } catch (err) {
      console.warn('Migration 008 order audit warning:', err);
    }
    await recordMigration(
      '008_audit_clean_order_history_and_links',
      'Audited and repaired backend COD orders, orphaned customer/transaction links, balances, and madinamarket.pk links'
    );
  }

  // MIGRATION 009
  if (!(await hasMigration('009_crm_schema_and_security_hardening'))) {
    if (hadExistingDb) {
      await createVerifiedBackup('pre_migration_009_crm_and_security');
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS crm_follow_ups (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        lead_id TEXT,
        assigned_employee_id TEXT,
        follow_up_date TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'Pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_follow_ups_date_status ON crm_follow_ups (follow_up_date, status);
      CREATE INDEX IF NOT EXISTS idx_crm_follow_ups_cust ON crm_follow_ups (customer_id);

      CREATE TABLE IF NOT EXISTS crm_leads (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'New',
        source TEXT NOT NULL DEFAULT 'WhatsApp',
        assigned_salesperson_id TEXT,
        converted_customer_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads (stage);
      CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm_leads (phone);

      CREATE TABLE IF NOT EXISTS crm_campaigns (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crm_support_tickets (
        id TEXT PRIMARY KEY,
        ticket_number TEXT NOT NULL UNIQUE,
        customer_id TEXT,
        order_id TEXT,
        category TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'Open',
        assigned_employee_id TEXT,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_tickets_status ON crm_support_tickets (status, priority);
      CREATE INDEX IF NOT EXISTS idx_crm_tickets_cust ON crm_support_tickets (customer_id);

      CREATE TABLE IF NOT EXISTS crm_loyalty_accounts (
        customer_id TEXT PRIMARY KEY,
        points_balance INTEGER NOT NULL DEFAULT 0,
        lifetime_points_earned INTEGER NOT NULL DEFAULT 0,
        lifetime_points_redeemed INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'Bronze',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crm_loyalty_ledger (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        type TEXT NOT NULL,
        points INTEGER NOT NULL,
        order_number TEXT,
        coupon_code TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_loyalty_ledger_cust ON crm_loyalty_ledger (customer_id, created_at);

      CREATE TABLE IF NOT EXISTS crm_coupons (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL COLLATE NOCASE UNIQUE,
        customer_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crm_custom_segments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crm_automation_rules (
        id TEXT PRIMARY KEY,
        trigger_type TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        total_triggered_count INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crm_automation_logs (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_auto_logs_created ON crm_automation_logs (created_at);

      CREATE TABLE IF NOT EXISTS crm_activity_events (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        phone TEXT,
        event_type TEXT NOT NULL,
        product_id TEXT,
        category TEXT,
        order_number TEXT,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_activity_cust ON crm_activity_events (customer_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_crm_activity_prod ON crm_activity_events (product_id, event_type);
    `);

    try {
      const bp = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
      const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();
      const rawAdminPin = typeof bp.adminPin === 'string' && bp.adminPin.trim() ? bp.adminPin.trim() : undefined;

      const accounts = await getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
      let accountsChanged = false;
      const migratedAccounts = accounts.map((acc) => {
        const next: UserAccount = { ...acc };
        if (next.suggestedDefaultPin !== undefined) {
          delete next.suggestedDefaultPin;
          accountsChanged = true;
        }
        if (next.resetToken !== undefined) {
          delete next.resetToken;
          delete next.resetTokenExpiresAt;
          accountsChanged = true;
        }
        const plainSecret =
          (acc.id === 'usr_superadmin' || acc.role === 'super_admin') && !acc.passwordHash
            ? rawAdminPin || envMasterPin
            : acc.passwordHash;

        if (plainSecret && !plainSecret.startsWith('scrypt:') && !acc.passwordSalt) {
          const rec = hashServerSecret(plainSecret);
          next.passwordHash = rec.hash;
          next.passwordSalt = rec.salt;
          accountsChanged = true;
        }
        return next;
      });
      if (accountsChanged) {
        await saveCollectionValue(db, 'user_accounts', migratedAccounts);
      }

      if (bp.adminPin !== undefined) {
        const cleanedBp: BusinessProfile = { ...bp };
        delete cleanedBp.adminPin;
        await saveCollectionValue(db, 'business_profile', cleanedBp);
      }
    } catch (err) {
      console.warn('Migration 009 secret hardening warning:', err);
    }

    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_SAMPLE_SEED === 'true') {
      await seedCrmDefaultsIfEmpty(db);
    }

    await recordMigration(
      '009_crm_schema_and_security_hardening',
      'Created CRM tables, seeded defaults, and hashed stored credentials via scrypt'
    );
  }

  // MIGRATION 010
  if (!(await hasMigration('010_expand_wholesale_categories_hierarchy'))) {
    if (hadExistingDb) {
      await createVerifiedBackup('pre_migration_010_categories_hierarchy');
    }
    const now = db.formatTimestamp();
    for (const c of defaultCategoryRecords) {
      await db.run(
        `${insertIgnoreKeyword(db.driver)} INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.name,
          c.urduName || null,
          c.parentCategoryId || null,
          c.level || computeCategoryLevel(c, defaultCategoryRecords),
          c.description || null,
          c.isUpcoming ? 1 : 0,
          c.isActive === false ? 0 : 1,
          c.displayOrder || 0,
          now,
          now,
        ]
      );
    }
    await recordMigration(
      '010_expand_wholesale_categories_hierarchy',
      'Non-destructively inserted expanded 3-level main categories, subcategories, and major child categories'
    );
  }
}

// ==========================================
// DATA ACCESS HELPERS (CENTRAL SOURCE OF TRUTH)
// ==========================================

export async function getAllCategoriesFromDb(dbArg?: DbExecutor): Promise<CategoryRecord[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM categories ORDER BY display_order ASC, level ASC, name ASC'
  );

  return rows.map((r) =>
    normalizeUpcomingCategoryRecord({
      id: String(r.id),
      name: String(r.name),
      urduName: r.urdu_name ? String(r.urdu_name) : undefined,
      parentCategoryId: r.parent_category_id ? String(r.parent_category_id) : undefined,
      level: (Number(r.level) as 1 | 2 | 3) || 1,
      description: r.description ? String(r.description) : undefined,
      isUpcoming: Boolean(r.is_upcoming),
      isActive: r.is_active === undefined || r.is_active === null ? true : Boolean(r.is_active),
      displayOrder: Number(r.display_order || 0),
      createdAt: normalizeStoredDateValue(r.created_at),
      updatedAt: normalizeStoredDateValue(r.updated_at),
    })
  );
}

export async function upsertCategoryRow(db: DbExecutor, cat: CategoryRecord): Promise<CategoryRecord> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM categories WHERE id = ?', [cat.id]);
  const existingCat: CategoryRecord | undefined = existingRow
    ? normalizeUpcomingCategoryRecord({
        id: String(existingRow.id),
        name: String(existingRow.name),
        urduName: existingRow.urdu_name ? String(existingRow.urdu_name) : undefined,
        parentCategoryId: existingRow.parent_category_id ? String(existingRow.parent_category_id) : undefined,
        level: (Number(existingRow.level) as 1 | 2 | 3) || 1,
        description: existingRow.description ? String(existingRow.description) : undefined,
        isUpcoming: Boolean(existingRow.is_upcoming),
        isActive:
          existingRow.is_active === undefined || existingRow.is_active === null
            ? true
            : Boolean(existingRow.is_active),
        displayOrder: Number(existingRow.display_order || 0),
        createdAt: normalizeStoredDateValue(existingRow.created_at),
        updatedAt: normalizeStoredDateValue(existingRow.updated_at),
      })
    : undefined;

  const merged = mergePreservingOmittedFields(
    existingCat as Record<string, unknown> | undefined,
    cat as unknown as Partial<Record<string, unknown>>
  ) as unknown as CategoryRecord;
  const normalized = normalizeUpcomingCategoryRecord(merged);
  const allCats = await getAllCategoriesFromDb(db);
  const level = computeCategoryLevel(normalized, allCats.filter((c) => c.id !== normalized.id).concat(normalized));

  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existingCat?.createdAt,
    incomingCreatedAt: cat.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate = { ...normalized, level };
  const hasChanges = hasRecordContentChanges(
    existingCat as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingCat,
    hasChanges,
    existingUpdatedAt: existingCat?.updatedAt,
    incomingUpdatedAt: cat.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'categories',
    insertColumns: [
      'id',
      'name',
      'urdu_name',
      'parent_category_id',
      'level',
      'description',
      'is_upcoming',
      'is_active',
      'display_order',
      'created_at',
      'updated_at',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'urdu_name' },
      { column: 'parent_category_id' },
      { column: 'level' },
      { column: 'description' },
      { column: 'is_upcoming' },
      { column: 'is_active' },
      { column: 'display_order' },
      { column: 'updated_at' },
    ],
  });

  await db.run(sql, [
    normalized.id,
    normalized.name.trim(),
    normalized.urduName || null,
    normalized.parentCategoryId || null,
    level,
    normalized.description || null,
    normalized.isUpcoming ? 1 : 0,
    normalized.isActive === false ? 0 : 1,
    normalized.displayOrder || 0,
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
  ]);

  return { ...normalized, level, createdAt: preservedCreatedAt, updatedAt: resolvedUpdatedAt };
}

export async function getAllCitiesFromDb(dbArg?: DbExecutor): Promise<DeliveryCityConfig[]> {
  const db = dbArg || (await getDb());
  const cityRows = await db.all<Record<string, unknown>>(
    'SELECT * FROM cities ORDER BY display_order ASC, name ASC'
  );
  const areaRows = await db.all<Record<string, unknown>>(
    "SELECT * FROM city_areas ORDER BY CASE WHEN LOWER(TRIM(name)) = 'city center' THEN 0 ELSE 1 END, name ASC"
  );

  const areasByCity = new Map<string, DeliveryAreaConfig[]>();
  for (const ar of areaRows) {
    const cid = String(ar.city_id);
    const list = areasByCity.get(cid) || [];
    const areaObj: DeliveryAreaConfig = {
      id: String(ar.id),
      name: String(ar.name),
      allowed: Boolean(ar.allowed),
    };
    if (ar.area_type) {
      areaObj.areaType = String(ar.area_type) as DeliveryAreaConfig['areaType'];
    }
    if (ar.delivery_charge !== null && ar.delivery_charge !== undefined) {
      areaObj.deliveryCharge = Number(ar.delivery_charge);
    }
    list.push(areaObj);
    areasByCity.set(cid, list);
  }

  return cityRows.map((cr) => {
    const nameStr = String(cr.name);
    const cityObj: DeliveryCityConfig = {
      id: String(cr.id),
      name: nameStr,
      province: inferProvinceForCity(nameStr, cr.province ? String(cr.province) : undefined),
      allowed: Boolean(cr.allowed),
      areas: areasByCity.get(String(cr.id)) || [],
    };
    if (cr.delivery_charge !== null && cr.delivery_charge !== undefined) {
      cityObj.deliveryCharge = Number(cr.delivery_charge);
    }
    return cityObj;
  });
}

export async function syncDeliveryCitiesIntoBusinessProfile(dbArg?: DbExecutor): Promise<BusinessProfile> {
  const db = dbArg || (await getDb());
  const cities = await getAllCitiesFromDb(db);
  const profile = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
  const updatedProfile: BusinessProfile = {
    ...profile,
    defaultCityCenterDeliveryCharge:
      profile.defaultCityCenterDeliveryCharge !== undefined ? profile.defaultCityCenterDeliveryCharge : 50,
    deliveryCities: ensureCityAreasShape(cities),
  };
  await saveCollectionValue(db, 'business_profile', updatedProfile);
  return updatedProfile;
}

export async function replaceCitiesAndAreasFromList(db: DbExecutor, incomingCities: DeliveryCityConfig[]): Promise<void> {
  const now = db.formatTimestamp();
  const shaped = ensureCityAreasShape(incomingCities);

  const existingCities = await getAllCitiesFromDb(db);
  const existingByName = new Map(existingCities.map((c) => [normalizeTextKey(c.name), c]));

  const upsertCitySql = buildUpsertSql({
    driver: db.driver,
    table: 'cities',
    insertColumns: ['id', 'name', 'province', 'allowed', 'delivery_charge', 'display_order', 'created_at', 'updated_at'],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'province' },
      { column: 'allowed' },
      { column: 'delivery_charge' },
      { column: 'display_order' },
      { column: 'updated_at' },
    ],
  });

  const upsertAreaSql = buildUpsertSql({
    driver: db.driver,
    table: 'city_areas',
    insertColumns: ['id', 'city_id', 'name', 'allowed', 'delivery_charge', 'area_type', 'created_at', 'updated_at'],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'allowed' },
      { column: 'delivery_charge' },
      {
        column: 'area_type',
        expr: (rhs) => `COALESCE(${rhs}, city_areas.area_type)`,
      },
      { column: 'updated_at' },
    ],
  });

  for (let i = 0; i < shaped.length; i++) {
    const c = shaped[i];
    const matchByName = existingByName.get(normalizeTextKey(c.name));
    const cityId = matchByName?.id || c.id || slugifyId('city', c.name);
    const provinceVal = inferProvinceForCity(c.name, c.province || matchByName?.province);
    const cityCharge =
      typeof c.deliveryCharge === 'number' && Number.isFinite(c.deliveryCharge) && c.deliveryCharge >= 0
        ? Math.round(c.deliveryCharge)
        : null;

    await db.run(upsertCitySql, [cityId, c.name, provinceVal, c.allowed ? 1 : 0, cityCharge, i + 1, now, now]);

    if (c.areas && c.areas.length > 0) {
      for (const a of c.areas) {
        const existingArea = await db.get<{ id: string }>(
          'SELECT id FROM city_areas WHERE city_id = ? AND LOWER(name) = LOWER(?)',
          [cityId, a.name]
        );
        const areaId = existingArea?.id || a.id || slugifyId('area', `${c.name}_${a.name}`);
        const areaCharge =
          typeof a.deliveryCharge === 'number' && Number.isFinite(a.deliveryCharge) && a.deliveryCharge >= 0
            ? Math.round(a.deliveryCharge)
            : null;
        await db.run(upsertAreaSql, [
          areaId,
          cityId,
          a.name,
          a.allowed ? 1 : 0,
          areaCharge,
          a.areaType || null,
          now,
          now,
        ]);
      }
    }
  }
}

export async function getAllProductsFromDb(dbArg?: DbExecutor): Promise<ProductItem[]> {
  const db = dbArg || (await getDb());
  const orderSql =
    db.driver === 'sqlite'
      ? 'SELECT * FROM products ORDER BY created_at DESC, rowid DESC'
      : 'SELECT * FROM products ORDER BY created_at DESC, updated_at DESC, id DESC';
  const rows = await db.all<Record<string, unknown>>(orderSql);

  return rows.map((r) => {
    let parsed: ProductItem;
    try {
      parsed = parseJsonSafe<ProductItem>(r.data_json);
    } catch {
      parsed = {
        id: String(r.id),
        name: String(r.name),
        category: String(r.category),
        sku: String(r.sku || ''),
        costPrice: Number(r.cost_price || 0),
        marketPrice: Number(r.market_price || 0),
        ourPrice: Number(r.our_price || 0),
        stockQty: Number(r.stock_qty || 0),
        minStockAlert: Number(r.min_stock_alert || 5),
        salesCount: 0,
        totalRevenue: 0,
        totalProfit: 0,
        isWinningItem: false,
        createdAt: normalizeStoredDateValue(r.created_at) || '',
      };
    }

    const isUpcoming = Boolean(r.is_upcoming) || isProductPurchaseBlocked(parsed);
    const createdAt =
      normalizeStoredDateValue(parsed.createdAt) || normalizeStoredDateValue(r.created_at) || '';
    const updatedAt =
      normalizeStoredDateValue(parsed.updatedAt) || normalizeStoredDateValue(r.updated_at);
    const expectedArrivalDate = r.expected_arrival_date
      ? normalizeStoredDateValue(r.expected_arrival_date)
      : normalizeStoredDateValue(parsed.expectedArrivalDate);

    return {
      ...parsed,
      id: String(r.id),
      name: String(r.name),
      urduName: r.urdu_name ? String(r.urdu_name) : parsed.urduName,
      category: isUpcoming ? UPCOMING_CATEGORY_NAME : String(r.category),
      parentCategoryId: isUpcoming
        ? UPCOMING_CATEGORY_ID
        : r.parent_category_id
        ? String(r.parent_category_id)
        : parsed.parentCategoryId,
      subcategoryId: isUpcoming
        ? undefined
        : r.subcategory_id
        ? String(r.subcategory_id)
        : parsed.subcategoryId,
      childSubcategoryId: isUpcoming
        ? undefined
        : r.child_subcategory_id
        ? String(r.child_subcategory_id)
        : parsed.childSubcategoryId,
      sku: r.sku ? String(r.sku) : parsed.sku,
      costPrice: Number(r.cost_price ?? parsed.costPrice ?? 0),
      marketPrice: Number(r.market_price ?? parsed.marketPrice ?? 0),
      ourPrice: Number(r.our_price ?? parsed.ourPrice ?? 0),
      stockQty: isUpcoming ? 0 : Number(r.stock_qty ?? parsed.stockQty ?? 0),
      minStockAlert: Number(r.min_stock_alert ?? parsed.minStockAlert ?? 5),
      isUpcoming,
      upcomingStatus: isUpcoming ? 'coming_soon' : 'available',
      expectedArrivalDate,
      activatedAt: normalizeStoredDateValue(parsed.activatedAt),
      deliveryFeeType: ((r.delivery_fee_type ? String(r.delivery_fee_type) : parsed.deliveryFeeType) ||
        'default') as ProductItem['deliveryFeeType'],
      customDeliveryCharge:
        r.custom_delivery_charge !== null && r.custom_delivery_charge !== undefined
          ? Number(r.custom_delivery_charge)
          : parsed.customDeliveryCharge,
      status: String(r.status || parsed.status || 'published') as 'draft' | 'published',
      createdAt,
      updatedAt,
    };
  });
}

export async function upsertProductRow(db: DbExecutor, product: ProductItem): Promise<ProductItem> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', [product.id]);
  let existingObj: ProductItem | undefined;
  if (existingRow) {
    try {
      existingObj = parseJsonSafe<ProductItem>(existingRow.data_json);
    } catch {
      existingObj = undefined;
    }
    if (!existingObj) {
      existingObj = {
        id: String(existingRow.id),
        name: String(existingRow.name),
        category: String(existingRow.category || 'General Wholesale'),
        sku: String(existingRow.sku || ''),
        costPrice: Number(existingRow.cost_price || 0),
        marketPrice: Number(existingRow.market_price || 0),
        ourPrice: Number(existingRow.our_price || 0),
        stockQty: Number(existingRow.stock_qty || 0),
        minStockAlert: Number(existingRow.min_stock_alert || 5),
        salesCount: 0,
        totalRevenue: 0,
        totalProfit: 0,
        isWinningItem: false,
        createdAt: normalizeStoredDateValue(existingRow.created_at) || nowIso,
      };
    }
  }

  // Strictly validate incoming date fields before merging/persisting (throws HTTP 400 DateValidationError on malformed dates)
  const incomingExpectedArrival =
    product.expectedArrivalDate === ''
      ? undefined
      : validateAndNormalizeDateOnly(product.expectedArrivalDate, 'expectedArrivalDate');
  const incomingActivatedAt = validateAndNormalizeDateTime(product.activatedAt, 'activatedAt');

  const mergedInput = mergePreservingOmittedFields(
    existingObj as Record<string, unknown> | undefined,
    product as unknown as Partial<Record<string, unknown>>
  ) as unknown as ProductItem;

  const existingCreatedAt = existingObj?.createdAt || normalizeStoredDateValue(existingRow?.created_at);
  const existingUpdatedAt = existingObj?.updatedAt || normalizeStoredDateValue(existingRow?.updated_at);
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt,
    incomingCreatedAt: product.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });

  const resolvedExpectedArrival =
    product.expectedArrivalDate === ''
      ? undefined
      : incomingExpectedArrival ??
        validateAndNormalizeDateOnly(existingObj?.expectedArrivalDate ?? existingRow?.expected_arrival_date, 'expectedArrivalDate');
  const resolvedActivatedAt =
    incomingActivatedAt ??
    validateAndNormalizeDateTime(existingObj?.activatedAt, 'activatedAt');

  const allCats = await getAllCategoriesFromDb(db);
  const blockedUpcoming = isProductPurchaseBlocked(mergedInput);

  const resolvedIds = blockedUpcoming
    ? { parentCategoryId: UPCOMING_CATEGORY_ID, subcategoryId: undefined, childSubcategoryId: undefined }
    : resolveCategoryIdsFromProduct(mergedInput, allCats);

  const normalizedCategory = blockedUpcoming
    ? UPCOMING_CATEGORY_NAME
    : resolvedIds.parentCategoryId
    ? getCategoryBreadcrumb(
        allCats,
        resolvedIds.parentCategoryId,
        resolvedIds.subcategoryId,
        resolvedIds.childSubcategoryId,
        mergedInput.category
      )
    : mergedInput.category || 'General Wholesale';

  const normalizedDeliveryFeeType: ProductItem['deliveryFeeType'] =
    mergedInput.deliveryFeeType === 'free'
      ? 'free'
      : mergedInput.deliveryFeeType === 'custom'
      ? 'custom'
      : 'default';
  const normalizedCustomDeliveryCharge =
    normalizedDeliveryFeeType === 'custom' &&
    mergedInput.customDeliveryCharge !== undefined &&
    mergedInput.customDeliveryCharge !== null &&
    Number.isFinite(Number(mergedInput.customDeliveryCharge)) &&
    Number(mergedInput.customDeliveryCharge) >= 0
      ? Math.round(Number(mergedInput.customDeliveryCharge))
      : undefined;

  const candidateBeforeUpdateAt: ProductItem = {
    ...mergedInput,
    category: normalizedCategory,
    parentCategoryId: resolvedIds.parentCategoryId,
    subcategoryId: resolvedIds.subcategoryId,
    childSubcategoryId: resolvedIds.childSubcategoryId,
    deliveryFeeType: normalizedDeliveryFeeType,
    customDeliveryCharge: normalizedCustomDeliveryCharge,
    expectedArrivalDate: resolvedExpectedArrival,
    activatedAt: resolvedActivatedAt,
    isUpcoming: blockedUpcoming,
    upcomingStatus: blockedUpcoming ? 'coming_soon' : 'available',
    stockQty: blockedUpcoming ? 0 : Math.max(0, Number(mergedInput.stockQty || 0)),
    status: mergedInput.status || 'published',
    createdAt: preservedCreatedAt,
  };

  const hasChanges = hasRecordContentChanges(
    existingObj as Record<string, unknown> | undefined,
    candidateBeforeUpdateAt as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt,
    incomingUpdatedAt: product.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const normalizedProduct: ProductItem = {
    ...candidateBeforeUpdateAt,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };

  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'products',
    insertColumns: [
      'id',
      'name',
      'urdu_name',
      'category',
      'parent_category_id',
      'subcategory_id',
      'child_subcategory_id',
      'sku',
      'cost_price',
      'market_price',
      'our_price',
      'stock_qty',
      'min_stock_alert',
      'is_upcoming',
      'upcoming_status',
      'expected_arrival_date',
      'delivery_fee_type',
      'custom_delivery_charge',
      'status',
      'created_at',
      'updated_at',
      'data_json',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'urdu_name' },
      { column: 'category' },
      { column: 'parent_category_id' },
      { column: 'subcategory_id' },
      { column: 'child_subcategory_id' },
      { column: 'sku' },
      { column: 'cost_price' },
      { column: 'market_price' },
      { column: 'our_price' },
      { column: 'stock_qty' },
      { column: 'min_stock_alert' },
      { column: 'is_upcoming' },
      { column: 'upcoming_status' },
      { column: 'expected_arrival_date' },
      { column: 'delivery_fee_type' },
      { column: 'custom_delivery_charge' },
      { column: 'status' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });

  await db.run(sql, [
    normalizedProduct.id,
    normalizedProduct.name,
    normalizedProduct.urduName || null,
    normalizedProduct.category,
    normalizedProduct.parentCategoryId || null,
    normalizedProduct.subcategoryId || null,
    normalizedProduct.childSubcategoryId || null,
    normalizedProduct.sku || null,
    Number(normalizedProduct.costPrice || 0),
    Number(normalizedProduct.marketPrice || 0),
    Number(normalizedProduct.ourPrice || 0),
    Number(normalizedProduct.stockQty || 0),
    Number(normalizedProduct.minStockAlert || 5),
    normalizedProduct.isUpcoming ? 1 : 0,
    normalizedProduct.upcomingStatus || 'available',
    normalizedProduct.expectedArrivalDate || null,
    normalizedProduct.deliveryFeeType || 'default',
    normalizedProduct.customDeliveryCharge ?? null,
    normalizedProduct.status || 'published',
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(normalizedProduct),
  ]);

  return normalizedProduct;
}

export async function getAllCustomersFromDb(dbArg?: DbExecutor): Promise<Customer[]> {
  const db = dbArg || (await getDb());
  const orderSql =
    db.driver === 'sqlite'
      ? 'SELECT * FROM customers ORDER BY created_at DESC, rowid DESC'
      : 'SELECT * FROM customers ORDER BY created_at DESC, updated_at DESC, id DESC';
  const rows = await db.all<Record<string, unknown>>(orderSql);

  return rows.map((r) => {
    let parsed: Customer;
    try {
      parsed = parseJsonSafe<Customer>(r.data_json);
    } catch {
      parsed = {
        id: String(r.id),
        name: String(r.name),
        customerType: 'individual',
        phone: String(r.phone),
        creditLimit: 5000,
        paymentTermsDays: 7,
        createdAt: normalizeStoredDateValue(r.created_at) || '',
        balance: Number(r.balance || 0),
        status: String(r.status || 'active') as 'active' | 'archived',
      };
    }
    return {
      ...parsed,
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone),
      city: r.city ? String(r.city) : parsed.city,
      area: r.area ? String(r.area) : parsed.area,
      mohalla: r.mohalla ? String(r.mohalla) : parsed.mohalla,
      landmark: r.landmark ? String(r.landmark) : parsed.landmark,
      address: r.address ? String(r.address) : parsed.address,
      balance: Number(r.balance ?? parsed.balance ?? 0),
      status: String(r.status || parsed.status || 'active') as 'active' | 'archived',
      createdAt:
        normalizeStoredDateValue(parsed.createdAt) || normalizeStoredDateValue(r.created_at) || '',
      updatedAt:
        normalizeStoredDateValue(parsed.updatedAt) || normalizeStoredDateValue(r.updated_at),
    };
  });
}

export async function upsertCustomerRow(db: DbExecutor, customer: Customer): Promise<Customer> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM customers WHERE id = ?', [customer.id]);
  let existingObj: Customer | undefined;
  if (existingRow) {
    try {
      existingObj = parseJsonSafe<Customer>(existingRow.data_json);
    } catch {
      existingObj = undefined;
    }
    if (!existingObj) {
      existingObj = {
        id: String(existingRow.id),
        name: String(existingRow.name),
        customerType: 'individual',
        phone: String(existingRow.phone || ''),
        creditLimit: 5000,
        paymentTermsDays: 7,
        balance: Number(existingRow.balance || 0),
        status: String(existingRow.status || 'active') as 'active' | 'archived',
        createdAt: normalizeStoredDateValue(existingRow.created_at) || nowIso,
      };
    }
  }

  const incomingBirthday =
    customer.birthday === '' ? undefined : validateAndNormalizeDateOnly(customer.birthday, 'birthday');
  const incomingLastPurchase =
    customer.lastPurchaseDate === ''
      ? undefined
      : validateAndNormalizeDateOnly(customer.lastPurchaseDate, 'lastPurchaseDate');

  const merged = mergePreservingOmittedFields(
    existingObj as Record<string, unknown> | undefined,
    customer as unknown as Partial<Record<string, unknown>>
  ) as unknown as Customer;

  const existingCreatedAt = existingObj?.createdAt || normalizeStoredDateValue(existingRow?.created_at);
  const existingUpdatedAt = existingObj?.updatedAt || normalizeStoredDateValue(existingRow?.updated_at);
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt,
    incomingCreatedAt: customer.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });

  const candidate: Customer = {
    ...merged,
    city: merged.city?.trim() || undefined,
    area: merged.area?.trim() || undefined,
    mohalla: merged.mohalla?.trim() || undefined,
    landmark: merged.landmark?.trim() || undefined,
    address: merged.address?.trim() || undefined,
    birthday: customer.birthday === '' ? undefined : incomingBirthday ?? existingObj?.birthday,
    lastPurchaseDate:
      customer.lastPurchaseDate === ''
        ? undefined
        : incomingLastPurchase ?? existingObj?.lastPurchaseDate,
    createdAt: preservedCreatedAt,
  };

  const hasChanges = hasRecordContentChanges(
    existingObj as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt,
    incomingUpdatedAt: customer.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const normalized: Customer = {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };

  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'customers',
    insertColumns: [
      'id',
      'name',
      'phone',
      'city',
      'area',
      'mohalla',
      'landmark',
      'address',
      'balance',
      'status',
      'created_at',
      'updated_at',
      'data_json',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'phone' },
      { column: 'city' },
      { column: 'area' },
      { column: 'mohalla' },
      { column: 'landmark' },
      { column: 'address' },
      { column: 'balance' },
      { column: 'status' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });

  await db.run(sql, [
    normalized.id,
    normalized.name,
    normalized.phone,
    normalized.city || null,
    normalized.area || null,
    normalized.mohalla || null,
    normalized.landmark || null,
    normalized.address || null,
    Number(normalized.balance || 0),
    normalized.status || 'active',
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(normalized),
  ]);
  return normalized;
}

export async function getCollectionValue<T>(db: DbExecutor, key: string, fallback: T): Promise<T> {
  const row = await db.get<{ data_json: unknown }>(
    'SELECT data_json FROM app_collections WHERE collection_key = ?',
    [key]
  );
  if (!row || row.data_json === null || row.data_json === undefined) return fallback;
  try {
    return parseJsonSafe<T>(row.data_json, fallback);
  } catch {
    return fallback;
  }
}

export async function saveCollectionValue(db: DbExecutor, key: string, value: unknown): Promise<void> {
  const nowSql = db.formatTimestamp();
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'app_collections',
    insertColumns: ['collection_key', 'data_json', 'updated_at'],
    conflictColumn: 'collection_key',
    updateAssignments: [{ column: 'data_json' }, { column: 'updated_at' }],
  });
  await db.run(sql, [key, JSON.stringify(value), nowSql]);
}

export async function insertAdminAuditLog(
  db: DbExecutor,
  log: Omit<AdminAuditLog, 'id' | 'createdAt'>
): Promise<AdminAuditLog> {
  const createdAtIso = new Date().toISOString();
  const entry: AdminAuditLog = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...log,
    createdAt: createdAtIso,
  };
  await db.run(
    `INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, actor_id, actor_name, actor_role, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.actorId || null,
      entry.actorName || null,
      entry.actorRole || null,
      entry.details ? JSON.stringify(entry.details) : null,
      db.formatTimestamp(createdAtIso),
    ]
  );
  return entry;
}

export async function getAdminAuditLogs(dbArg?: DbExecutor): Promise<AdminAuditLog[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200'
  );
  return rows.map((r) => ({
    id: String(r.id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    actorId: r.actor_id ? String(r.actor_id) : undefined,
    actorName: r.actor_name ? String(r.actor_name) : undefined,
    actorRole: r.actor_role ? String(r.actor_role) : undefined,
    details: r.details_json ? parseJsonSafe<Record<string, unknown>>(r.details_json) : undefined,
    createdAt: String(r.created_at),
  }));
}

export interface ActorContext {
  id?: string;
  role?: string;
  name?: string;
  customerId?: string;
  investorId?: string;
  resellerCode?: string;
  branchId?: string;
  phone?: string;
}

export function hashServerSecret(plainText: string): { hash: string; salt: string } {
  const saltBytes = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainText.trim(), saltBytes, 64).toString('hex');
  return {
    hash: `scrypt:${derived}`,
    salt: `scrypt:${saltBytes}`,
  };
}

export function verifyServerSecret(
  plainText: string,
  storedHash?: string | null,
  storedSalt?: string | null
): boolean {
  if (!plainText || !storedHash) return false;
  const trimmed = plainText.trim();

  if (storedHash.startsWith('scrypt:') && storedSalt?.startsWith('scrypt:')) {
    const rawSalt = storedSalt.slice('scrypt:'.length);
    const expectedHex = storedHash.slice('scrypt:'.length);
    const derived = crypto.scryptSync(trimmed, rawSalt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  if (storedSalt && !storedSalt.startsWith('scrypt:')) {
    const digest = crypto.createHash('sha256').update(`${storedSalt}:${trimmed}`).digest('hex');
    if (digest.length === storedHash.length) {
      return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(storedHash, 'utf8'));
    }
  }

  if (!storedSalt) {
    const a = Buffer.from(trimmed, 'utf8');
    const b = Buffer.from(storedHash, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  return false;
}

export const DEFAULT_CRM_LOYALTY_CONFIG: CRMLoyaltyConfig = {
  pointsPerThousandPkr: 10,
  pkrPerPoint: 1,
  silverThresholdPoints: 200,
  goldThresholdPoints: 600,
  vipThresholdPoints: 1500,
  vipDiscountPercent: 5,
  goldDiscountPercent: 3,
  silverDiscountPercent: 1,
  birthdayCouponAmount: 500,
  reviewCouponAmount: 500,
  repeatOrderCouponAmount: 300,
  couponValidityDays: 30,
};

export const DEFAULT_CRM_AUTOMATION_RULES: CRMAutomationRule[] = [
  {
    id: 'rule_after_first_order',
    triggerType: 'after_first_order',
    name: 'After First Order Welcome',
    description: 'Create onboarding welcome WhatsApp / call follow-up after a customer completes their first order.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'welcome',
    actionMode: 'both',
    delayDays: 0,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_after_delivery',
    triggerType: 'after_delivery',
    name: 'After Order Delivery Check-in',
    description: 'Confirm safe parcel arrival and collect product satisfaction after COD order marks Delivered.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'delivery_confirmation',
    actionMode: 'both',
    delayDays: 1,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_review_request',
    triggerType: 'review_request_after_delivery',
    name: 'Review Request (Rs. 500 Reward Invite)',
    description: 'Invite delivered buyers to share an authentic review on WhatsApp/Facebook/TikTok for a reward voucher.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'feedback_request',
    actionMode: 'queue_whatsapp',
    delayDays: 3,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_inactive_30',
    triggerType: 'no_order_30_days',
    name: '30 Days No Order Reminder',
    description: 'Trigger repeat purchase reminder for customers inactive for 30+ days.',
    enabled: true,
    isBulkAction: true,
    requiresAdminApproval: true,
    templateType: 'repeat_purchase_reminder',
    actionMode: 'both',
    delayDays: 30,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_inactive_60',
    triggerType: 'no_order_60_days',
    name: '60 Days Recovery Offer',
    description: 'Prepare recovery discount reminder for customers inactive for 60+ days.',
    enabled: true,
    isBulkAction: true,
    requiresAdminApproval: true,
    templateType: 'inactive_recovery',
    actionMode: 'both',
    delayDays: 60,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_inactive_90',
    triggerType: 'no_order_90_days',
    name: '90 Days Win-Back Campaign',
    description: 'Flag lost-risk customers (90+ days inactive) for win-back follow-up call or offer.',
    enabled: true,
    isBulkAction: true,
    requiresAdminApproval: true,
    templateType: 'inactive_recovery',
    actionMode: 'create_task',
    delayDays: 90,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_payment_due_soon',
    triggerType: 'payment_due_soon',
    name: 'Credit Payment Due Soon (3 Days)',
    description: 'Create polite payment collection follow-up when a credit balance due date is within 3 days.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'payment_reminder',
    actionMode: 'both',
    delayDays: 3,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_payment_overdue',
    triggerType: 'payment_overdue',
    name: 'Overdue Khata Payment Escalation',
    description: 'Create urgent payment recovery task when credit balance is past due date.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'payment_reminder',
    actionMode: 'create_task',
    delayDays: 1,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_abandoned_cart',
    triggerType: 'abandoned_cart',
    name: 'Abandoned Cart / Product Inquiry Follow-Up',
    description: 'Follow up on logged cart abandonments or product inquiries that have not converted into an order.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'abandoned_cart',
    actionMode: 'both',
    delayDays: 1,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_vip_reached',
    triggerType: 'vip_threshold_reached',
    name: 'VIP Customer Milestone Celebration',
    description: 'Auto-tag VIP threshold customers (>= Rs. 25,000 lifetime purchases) and prepare VIP offer.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'vip_offer',
    actionMode: 'both',
    thresholdValue: 25000,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_cod_returns',
    triggerType: 'frequent_cod_returns',
    name: 'Frequent COD Returns Risk Alert',
    description: 'Alert store manager with verification task when a customer has 2+ returned COD parcels.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'order_confirmation',
    actionMode: 'create_task',
    thresholdValue: 2,
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_birthday',
    triggerType: 'birthday_or_anniversary',
    name: 'Birthday / Anniversary Reward',
    description: 'Issue seasonal celebration coupon reminder for customers with birthday matching today.',
    enabled: true,
    isBulkAction: false,
    requiresAdminApproval: false,
    templateType: 'discount_offer',
    actionMode: 'both',
    totalTriggeredCount: 0,
  },
  {
    id: 'rule_back_in_stock',
    triggerType: 'back_in_stock_for_interested',
    name: 'Back-in-Stock / New Arrival Alert',
    description: 'Notify customers who inquired about products that now have available stock.',
    enabled: true,
    isBulkAction: true,
    requiresAdminApproval: true,
    templateType: 'new_arrivals',
    actionMode: 'both',
    totalTriggeredCount: 0,
  },
];

export function computeLoyaltyTier(pointsEarned: number, cfg: CRMLoyaltyConfig = DEFAULT_CRM_LOYALTY_CONFIG): CRMLoyaltyTier {
  if (pointsEarned >= cfg.vipThresholdPoints) return 'VIP Platinum';
  if (pointsEarned >= cfg.goldThresholdPoints) return 'Gold';
  if (pointsEarned >= cfg.silverThresholdPoints) return 'Silver';
  return 'Bronze';
}

export async function getCrmLoyaltyConfig(dbArg?: DbExecutor): Promise<CRMLoyaltyConfig> {
  const db = dbArg || (await getDb());
  return getCollectionValue<CRMLoyaltyConfig>(db, 'crm_loyalty_config', DEFAULT_CRM_LOYALTY_CONFIG);
}

export async function saveCrmLoyaltyConfig(db: DbExecutor, config: CRMLoyaltyConfig): Promise<void> {
  await saveCollectionValue(db, 'crm_loyalty_config', config);
}

export async function seedCrmDefaultsIfEmpty(db: DbExecutor): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const existingCfg = await db.get(
    "SELECT collection_key FROM app_collections WHERE collection_key = 'crm_loyalty_config'"
  );
  if (!existingCfg) {
    await saveCollectionValue(db, 'crm_loyalty_config', DEFAULT_CRM_LOYALTY_CONFIG);
  }

  const ruleCountRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM crm_automation_rules');
  if (Number(ruleCountRow?.c || 0) === 0) {
    for (const rule of DEFAULT_CRM_AUTOMATION_RULES) {
      await db.run(
        `${insertIgnoreKeyword(db.driver)} INTO crm_automation_rules (id, trigger_type, enabled, last_run_at, total_triggered_count, data_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rule.id,
          rule.triggerType,
          rule.enabled ? 1 : 0,
          rule.lastRunAt ? db.formatTimestamp(rule.lastRunAt) : null,
          rule.totalTriggeredCount || 0,
          JSON.stringify(rule),
        ]
      );
    }
  }

  const loyaltyCountRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM crm_loyalty_accounts');
  if (Number(loyaltyCountRow?.c || 0) === 0) {
    const custs = await getAllCustomersFromDb(db);
    const now = db.formatTimestamp();
    for (const c of custs) {
      const earned = Math.max(
        0,
        Math.floor(Number(c.totalPurchases || 0) / 1000) * DEFAULT_CRM_LOYALTY_CONFIG.pointsPerThousandPkr
      );
      const tier = computeLoyaltyTier(earned, DEFAULT_CRM_LOYALTY_CONFIG);
      await db.run(
        `${insertIgnoreKeyword(db.driver)} INTO crm_loyalty_accounts (customer_id, points_balance, lifetime_points_earned, lifetime_points_redeemed, tier, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.id, earned, earned, 0, tier, now]
      );
      if (earned > 0) {
        await db.run(
          `${insertIgnoreKeyword(db.driver)} INTO crm_loyalty_ledger (id, customer_id, type, points, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [`lyl_seed_${c.id}`, c.id, 'earned', earned, 'Historical purchase loyalty points sync', now]
        );
      }
    }
  }
}

export async function getAllCrmFollowUps(dbArg?: DbExecutor): Promise<CRMFollowUpTask[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_follow_ups ORDER BY follow_up_date ASC, created_at DESC'
  );
  return rows.map((r) => parseJsonSafe<CRMFollowUpTask>(r.data_json));
}

export async function upsertCrmFollowUp(db: DbExecutor, task: CRMFollowUpTask): Promise<CRMFollowUpTask> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown; updated_at: unknown }>(
    'SELECT data_json, created_at, updated_at FROM crm_follow_ups WHERE id = ?',
    [task.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMFollowUpTask>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    task as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMFollowUpTask;

  const followUpDate =
    validateAndNormalizeDateOnly(merged.followUpDate, 'followUpDate') ||
    validateAndNormalizeDateOnly(nowIso, 'followUpDate')!;
  const nextFollowUpDate = validateAndNormalizeDateOnly(merged.nextFollowUpDate, 'nextFollowUpDate');
  const completedAt =
    merged.status === 'Completed'
      ? validateAndNormalizeDateTime(merged.completedAt, 'completedAt') || nowIso
      : validateAndNormalizeDateTime(merged.completedAt, 'completedAt');

  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: task.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate: CRMFollowUpTask = {
    ...merged,
    followUpDate,
    nextFollowUpDate,
    completedAt,
    createdAt: preservedCreatedAt,
  };
  const hasChanges = hasRecordContentChanges(
    existing as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt || existingRow?.updated_at,
    incomingUpdatedAt: task.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const saved: CRMFollowUpTask = {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_follow_ups',
    insertColumns: [
      'id',
      'customer_id',
      'lead_id',
      'assigned_employee_id',
      'follow_up_date',
      'priority',
      'status',
      'created_at',
      'updated_at',
      'data_json',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'customer_id' },
      { column: 'lead_id' },
      { column: 'assigned_employee_id' },
      { column: 'follow_up_date' },
      { column: 'priority' },
      { column: 'status' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.customerId || null,
    saved.leadId || null,
    saved.assignedEmployeeId || null,
    saved.followUpDate,
    saved.priority,
    saved.status,
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function deleteCrmFollowUp(db: DbExecutor, id: string): Promise<void> {
  await db.run('DELETE FROM crm_follow_ups WHERE id = ?', [id]);
}

export async function getAllCrmLeads(dbArg?: DbExecutor): Promise<CRMLead[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_leads ORDER BY updated_at DESC, created_at DESC'
  );
  return rows.map((r) => parseJsonSafe<CRMLead>(r.data_json));
}

export async function upsertCrmLead(db: DbExecutor, lead: CRMLead): Promise<CRMLead> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown; updated_at: unknown }>(
    'SELECT data_json, created_at, updated_at FROM crm_leads WHERE id = ?',
    [lead.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMLead>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    lead as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMLead;

  const followUpDate = validateAndNormalizeDateOnly(merged.followUpDate, 'followUpDate');
  const convertedAt = validateAndNormalizeDateTime(merged.convertedAt, 'convertedAt');
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: lead.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate: CRMLead = {
    ...merged,
    followUpDate,
    convertedAt,
    createdAt: preservedCreatedAt,
  };
  const hasChanges = hasRecordContentChanges(
    existing as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt || existingRow?.updated_at,
    incomingUpdatedAt: lead.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const saved: CRMLead = {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_leads',
    insertColumns: [
      'id',
      'phone',
      'stage',
      'source',
      'assigned_salesperson_id',
      'converted_customer_id',
      'created_at',
      'updated_at',
      'data_json',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'phone' },
      { column: 'stage' },
      { column: 'source' },
      { column: 'assigned_salesperson_id' },
      { column: 'converted_customer_id' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.phone,
    saved.stage,
    saved.source,
    saved.assignedSalespersonId || null,
    saved.convertedCustomerId || null,
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function getAllCrmCampaigns(dbArg?: DbExecutor): Promise<CRMCampaign[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_campaigns ORDER BY created_at DESC'
  );
  return rows.map((r) => parseJsonSafe<CRMCampaign>(r.data_json));
}

export async function upsertCrmCampaign(db: DbExecutor, campaign: CRMCampaign): Promise<CRMCampaign> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown; updated_at: unknown }>(
    'SELECT data_json, created_at, updated_at FROM crm_campaigns WHERE id = ?',
    [campaign.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMCampaign>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    campaign as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMCampaign;

  const adminApprovedAt = validateAndNormalizeDateTime(merged.adminApprovedAt, 'adminApprovedAt');
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: campaign.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate: CRMCampaign = {
    ...merged,
    adminApprovedAt,
    createdAt: preservedCreatedAt,
  };
  const hasChanges = hasRecordContentChanges(
    existing as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt || existingRow?.updated_at,
    incomingUpdatedAt: campaign.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const saved: CRMCampaign = {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_campaigns',
    insertColumns: ['id', 'status', 'created_at', 'updated_at', 'data_json'],
    conflictColumn: 'id',
    updateAssignments: [{ column: 'status' }, { column: 'updated_at' }, { column: 'data_json' }],
  });
  await db.run(sql, [
    saved.id,
    saved.status,
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function getAllCrmTickets(dbArg?: DbExecutor): Promise<CRMSupportTicket[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_support_tickets ORDER BY created_at DESC'
  );
  return rows.map((r) => parseJsonSafe<CRMSupportTicket>(r.data_json));
}

export async function upsertCrmTicket(db: DbExecutor, ticket: CRMSupportTicket): Promise<CRMSupportTicket> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown; updated_at: unknown }>(
    'SELECT data_json, created_at, updated_at FROM crm_support_tickets WHERE id = ?',
    [ticket.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMSupportTicket>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    ticket as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMSupportTicket;

  const dueAt = validateAndNormalizeDateTime(merged.dueAt, 'dueAt') || nowIso;
  const resolvedAt =
    merged.status === 'Resolved' || merged.status === 'Closed'
      ? validateAndNormalizeDateTime(merged.resolvedAt, 'resolvedAt') || nowIso
      : validateAndNormalizeDateTime(merged.resolvedAt, 'resolvedAt');
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: ticket.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate: CRMSupportTicket = {
    ...merged,
    dueAt,
    resolvedAt,
    createdAt: preservedCreatedAt,
  };
  const hasChanges = hasRecordContentChanges(
    existing as Record<string, unknown> | undefined,
    candidate as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt || existingRow?.updated_at,
    incomingUpdatedAt: ticket.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const saved: CRMSupportTicket = {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_support_tickets',
    insertColumns: [
      'id',
      'ticket_number',
      'customer_id',
      'order_id',
      'category',
      'priority',
      'status',
      'assigned_employee_id',
      'due_at',
      'created_at',
      'updated_at',
      'data_json',
    ],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'customer_id' },
      { column: 'order_id' },
      { column: 'category' },
      { column: 'priority' },
      { column: 'status' },
      { column: 'assigned_employee_id' },
      { column: 'due_at' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.ticketNumber,
    saved.customerId || null,
    saved.orderId || null,
    saved.category,
    saved.priority,
    saved.status,
    saved.assignedEmployeeId || null,
    db.formatTimestamp(saved.dueAt),
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function getAllCrmLoyaltyAccounts(dbArg?: DbExecutor): Promise<CRMLoyaltyAccount[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM crm_loyalty_accounts ORDER BY lifetime_points_earned DESC'
  );
  return rows.map((r) => ({
    customerId: String(r.customer_id),
    pointsBalance: Number(r.points_balance || 0),
    lifetimePointsEarned: Number(r.lifetime_points_earned || 0),
    lifetimePointsRedeemed: Number(r.lifetime_points_redeemed || 0),
    tier: String(r.tier || 'Bronze') as CRMLoyaltyTier,
    updatedAt: String(r.updated_at),
  }));
}

export async function getAllCrmLoyaltyLedger(dbArg?: DbExecutor, customerId?: string): Promise<CRMLoyaltyLedgerEntry[]> {
  const db = dbArg || (await getDb());
  const rows = customerId
    ? await db.all<Record<string, unknown>>(
        'SELECT * FROM crm_loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200',
        [customerId]
      )
    : await db.all<Record<string, unknown>>(
        'SELECT * FROM crm_loyalty_ledger ORDER BY created_at DESC LIMIT 300'
      );
  return rows.map((r) => ({
    id: String(r.id),
    customerId: String(r.customer_id),
    type: String(r.type) as CRMLoyaltyLedgerEntry['type'],
    points: Number(r.points || 0),
    orderNumber: r.order_number ? String(r.order_number) : undefined,
    couponCode: r.coupon_code ? String(r.coupon_code) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    createdAt: String(r.created_at),
  }));
}

export async function adjustCustomerLoyaltyPoints(
  db: DbExecutor,
  params: {
    customerId: string;
    pointsDelta: number;
    type: CRMLoyaltyLedgerEntry['type'];
    orderNumber?: string;
    couponCode?: string;
    notes?: string;
  }
): Promise<CRMLoyaltyAccount> {
  const cfg = await getCrmLoyaltyConfig(db);
  const nowIso = new Date().toISOString();
  const nowSql = db.formatTimestamp(nowIso);
  const existing = await db.get<Record<string, unknown>>(
    'SELECT * FROM crm_loyalty_accounts WHERE customer_id = ?',
    [params.customerId]
  );
  const curBal = Number(existing?.points_balance || 0);
  const curEarned = Number(existing?.lifetime_points_earned || 0);
  const curRedeemed = Number(existing?.lifetime_points_redeemed || 0);

  const nextBal = Math.max(0, curBal + params.pointsDelta);
  const nextEarned = params.pointsDelta > 0 ? curEarned + params.pointsDelta : curEarned;
  const nextRedeemed = params.pointsDelta < 0 ? curRedeemed + Math.abs(params.pointsDelta) : curRedeemed;
  const nextTier = computeLoyaltyTier(nextEarned, cfg);

  const upsertSql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_loyalty_accounts',
    insertColumns: [
      'customer_id',
      'points_balance',
      'lifetime_points_earned',
      'lifetime_points_redeemed',
      'tier',
      'updated_at',
    ],
    conflictColumn: 'customer_id',
    updateAssignments: [
      { column: 'points_balance' },
      { column: 'lifetime_points_earned' },
      { column: 'lifetime_points_redeemed' },
      { column: 'tier' },
      { column: 'updated_at' },
    ],
  });
  await db.run(upsertSql, [params.customerId, nextBal, nextEarned, nextRedeemed, nextTier, nowSql]);

  const entryId = `lyl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await db.run(
    `INSERT INTO crm_loyalty_ledger (id, customer_id, type, points, order_number, coupon_code, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      params.customerId,
      params.type,
      Math.abs(params.pointsDelta),
      params.orderNumber || null,
      params.couponCode || null,
      params.notes || null,
      nowSql,
    ]
  );

  return {
    customerId: params.customerId,
    pointsBalance: nextBal,
    lifetimePointsEarned: nextEarned,
    lifetimePointsRedeemed: nextRedeemed,
    tier: nextTier,
    updatedAt: nowIso,
  };
}

export async function getAllCrmCoupons(dbArg?: DbExecutor): Promise<CRMLoyaltyCoupon[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>('SELECT data_json FROM crm_coupons ORDER BY created_at DESC');
  return rows.map((r) => parseJsonSafe<CRMLoyaltyCoupon>(r.data_json));
}

export async function upsertCrmCoupon(db: DbExecutor, coupon: CRMLoyaltyCoupon): Promise<CRMLoyaltyCoupon> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown }>(
    'SELECT data_json, created_at FROM crm_coupons WHERE id = ?',
    [coupon.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMLoyaltyCoupon>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    coupon as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMLoyaltyCoupon;
  const expiresAt = validateAndNormalizeDateTime(merged.expiresAt, 'expiresAt');
  const redeemedAt = validateAndNormalizeDateTime(merged.redeemedAt, 'redeemedAt');
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: coupon.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });

  const saved: CRMLoyaltyCoupon = {
    ...merged,
    code: merged.code.trim().toUpperCase(),
    expiresAt,
    redeemedAt,
    createdAt: preservedCreatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_coupons',
    insertColumns: ['id', 'code', 'customer_id', 'status', 'expires_at', 'created_at', 'data_json'],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'code' },
      { column: 'customer_id' },
      { column: 'status' },
      { column: 'expires_at' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.code,
    saved.customerId || null,
    saved.status,
    saved.expiresAt ? db.formatTimestamp(saved.expiresAt) : null,
    db.formatTimestamp(preservedCreatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function getAllCrmCustomSegments(dbArg?: DbExecutor): Promise<CRMCustomSegmentRule[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_custom_segments ORDER BY created_at DESC'
  );
  return rows.map((r) => parseJsonSafe<CRMCustomSegmentRule>(r.data_json));
}

export async function upsertCrmCustomSegment(db: DbExecutor, rule: CRMCustomSegmentRule): Promise<CRMCustomSegmentRule> {
  const nowIso = new Date().toISOString();
  const existingRow = await db.get<{ data_json: unknown; created_at: unknown; updated_at: unknown }>(
    'SELECT data_json, created_at, updated_at FROM crm_custom_segments WHERE id = ?',
    [rule.id]
  );
  const existing = existingRow ? parseJsonSafe<CRMCustomSegmentRule>(existingRow.data_json) : undefined;
  const merged = mergePreservingOmittedFields(
    existing as Record<string, unknown> | undefined,
    rule as unknown as Partial<Record<string, unknown>>
  ) as unknown as CRMCustomSegmentRule;
  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt || existingRow?.created_at,
    incomingCreatedAt: rule.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const hasChanges = hasRecordContentChanges(
    existing as Record<string, unknown> | undefined,
    { ...merged, createdAt: preservedCreatedAt } as unknown as Record<string, unknown>
  );
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existingRow,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt || existingRow?.updated_at,
    incomingUpdatedAt: rule.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  const saved: CRMCustomSegmentRule = {
    ...merged,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_custom_segments',
    insertColumns: ['id', 'name', 'is_active', 'created_at', 'updated_at', 'data_json'],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'name' },
      { column: 'is_active' },
      { column: 'updated_at' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.name,
    saved.isActive ? 1 : 0,
    db.formatTimestamp(preservedCreatedAt),
    db.formatTimestamp(resolvedUpdatedAt),
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function deleteCrmCustomSegment(db: DbExecutor, id: string): Promise<void> {
  await db.run('DELETE FROM crm_custom_segments WHERE id = ?', [id]);
}

export async function getAllCrmAutomationRules(dbArg?: DbExecutor): Promise<CRMAutomationRule[]> {
  const db = dbArg || (await getDb());
  const rows = await db.all<Record<string, unknown>>(
    'SELECT data_json, enabled, last_run_at, total_triggered_count FROM crm_automation_rules'
  );
  return rows.map((r) => {
    const parsed = parseJsonSafe<CRMAutomationRule>(r.data_json);
    return {
      ...parsed,
      enabled: Boolean(r.enabled),
      lastRunAt: normalizeStoredDateValue(r.last_run_at) || normalizeStoredDateValue(parsed.lastRunAt),
      totalTriggeredCount: Number(r.total_triggered_count ?? parsed.totalTriggeredCount ?? 0),
    };
  });
}

export async function upsertCrmAutomationRule(db: DbExecutor, rule: CRMAutomationRule): Promise<CRMAutomationRule> {
  const lastRunAt = validateAndNormalizeDateTime(rule.lastRunAt, 'lastRunAt');
  const saved: CRMAutomationRule = { ...rule, lastRunAt };
  const sql = buildUpsertSql({
    driver: db.driver,
    table: 'crm_automation_rules',
    insertColumns: ['id', 'trigger_type', 'enabled', 'last_run_at', 'total_triggered_count', 'data_json'],
    conflictColumn: 'id',
    updateAssignments: [
      { column: 'enabled' },
      { column: 'last_run_at' },
      { column: 'total_triggered_count' },
      { column: 'data_json' },
    ],
  });
  await db.run(sql, [
    saved.id,
    saved.triggerType,
    saved.enabled ? 1 : 0,
    lastRunAt ? db.formatTimestamp(lastRunAt) : null,
    saved.totalTriggeredCount || 0,
    JSON.stringify(saved),
  ]);
  return saved;
}

export async function getAllCrmAutomationLogs(dbArg?: DbExecutor, limit = 200): Promise<CRMAutomationLog[]> {
  const db = dbArg || (await getDb());
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit) || 200)));
  const rows = await db.all<{ data_json: unknown }>(
    'SELECT data_json FROM crm_automation_logs ORDER BY created_at DESC LIMIT ?',
    [safeLimit]
  );
  return rows.map((r) => parseJsonSafe<CRMAutomationLog>(r.data_json));
}

export async function insertCrmAutomationLog(db: DbExecutor, log: CRMAutomationLog): Promise<boolean> {
  const createdAt = validateAndNormalizeDateTime(log.createdAt, 'createdAt') || new Date().toISOString();
  const info = await db.run(
    `${insertIgnoreKeyword(db.driver)} INTO crm_automation_logs (id, rule_id, trigger_type, customer_id, idempotency_key, status, created_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.ruleId,
      log.triggerType,
      log.customerId,
      log.idempotencyKey,
      log.status,
      db.formatTimestamp(createdAt),
      JSON.stringify({ ...log, createdAt }),
    ]
  );
  return Number(info.changes || 0) > 0;
}

export async function hasCrmAutomationIdempotencyKey(db: DbExecutor, key: string): Promise<boolean> {
  const row = await db.get('SELECT id FROM crm_automation_logs WHERE idempotency_key = ? LIMIT 1', [key]);
  return Boolean(row);
}

export async function insertCrmActivityEvent(
  db: DbExecutor,
  event: Omit<CRMActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): Promise<CRMActivityEvent> {
  const createdAtIso =
    validateAndNormalizeDateTime(event.createdAt, 'createdAt') || new Date().toISOString();
  const entry: CRMActivityEvent = {
    ...event,
    id: event.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: createdAtIso,
  };
  await db.run(
    `INSERT INTO crm_activity_events (id, customer_id, phone, event_type, product_id, category, order_number, created_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.customerId || null,
      entry.phone || null,
      entry.eventType,
      entry.productId || null,
      entry.category || null,
      entry.orderNumber || null,
      db.formatTimestamp(createdAtIso),
      JSON.stringify(entry),
    ]
  );
  return entry;
}

export async function getAllCrmActivityEvents(
  dbArg?: DbExecutor,
  customerId?: string,
  limit = 500
): Promise<CRMActivityEvent[]> {
  const db = dbArg || (await getDb());
  const safeLimit = Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 500)));
  const rows = customerId
    ? await db.all<{ data_json: unknown }>(
        'SELECT data_json FROM crm_activity_events WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?',
        [customerId, safeLimit]
      )
    : await db.all<{ data_json: unknown }>(
        'SELECT data_json FROM crm_activity_events ORDER BY created_at DESC LIMIT ?',
        [safeLimit]
      );
  return rows.map((r) => parseJsonSafe<CRMActivityEvent>(r.data_json));
}

function maskPhone(phone?: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
}

export function redactStateForRole(
  state: Record<string, unknown>,
  actorOrRole?: ActorContext | string
): Record<string, unknown> {
  const actor: ActorContext =
    typeof actorOrRole === 'string' ? { role: actorOrRole } : actorOrRole || {};
  const role = actor.role;
  const isAuthenticated = Boolean(actor.id && role);
  const isAdmin = isAuthenticated && (role === 'super_admin' || role === 'admin');
  const isManager = isAuthenticated && role === 'manager';
  const isStaff = isAuthenticated && role === 'staff';
  const isInternalOps = isAdmin || isManager || isStaff;

  const cloned: Record<string, unknown> = { ...state };

  if (cloned.business_profile && typeof cloned.business_profile === 'object') {
    const bp = { ...(cloned.business_profile as BusinessProfile) };
    delete bp.adminPin;
    if (bp.shippingPartner) {
      bp.shippingPartner = {
        ...bp.shippingPartner,
        apiKey: isAdmin ? bp.shippingPartner.apiKey : '',
      };
    }
    cloned.business_profile = bp;
  }

  if (Array.isArray(cloned.user_accounts)) {
    if (isAdmin) {
      cloned.user_accounts = (cloned.user_accounts as UserAccount[]).map((u) => {
        const clean = { ...u };
        delete clean.passwordHash;
        delete clean.passwordSalt;
        delete clean.resetToken;
        delete clean.resetTokenExpiresAt;
        delete clean.suggestedDefaultPin;
        return clean;
      });
    } else {
      cloned.user_accounts = [];
    }
  }

  if (Array.isArray(cloned.products) && !isAdmin && !isManager && role !== 'investor') {
    cloned.products = (cloned.products as ProductItem[]).map((p) => ({
      ...p,
      costPrice: 0,
      totalProfit: 0,
      totalRevenue: 0,
    }));
  }

  if (isInternalOps) {
    if (Array.isArray(cloned.customers)) {
      cloned.customers = (cloned.customers as Customer[]).map((c) => {
        const clean = { ...c };
        delete clean.pin;
        return clean;
      });
    }
    if (Array.isArray(cloned.resellers)) {
      cloned.resellers = (cloned.resellers as Reseller[]).map((r) => {
        const clean = { ...r };
        delete clean.pin;
        return clean;
      });
    }
    if (!isAdmin) {
      cloned.investors = [];
      cloned.investor_transactions = [];
      cloned.login_audits = [];
      cloned.admin_audit_logs = [];
    }
    if (isStaff) {
      cloned.monthly_expenses = [];
    }
    return cloned;
  }

  const normPhone = (val?: string) => (val || '').replace(/\D/g, '');
  const actorPhoneDigits = normPhone(actor.phone);

  const allCustomers = Array.isArray(cloned.customers) ? (cloned.customers as Customer[]) : [];
  const allTxs = Array.isArray(cloned.transactions) ? (cloned.transactions as Transaction[]) : [];
  const allCodOrders = Array.isArray(cloned.cod_orders) ? (cloned.cod_orders as CODOrder[]) : [];
  const allResellers = Array.isArray(cloned.resellers) ? (cloned.resellers as Reseller[]) : [];
  const allInvestors = Array.isArray(cloned.investors) ? (cloned.investors as Array<Record<string, unknown>>) : [];
  const allInvestorTxs = Array.isArray(cloned.investor_transactions)
    ? (cloned.investor_transactions as Array<Record<string, unknown>>)
    : [];
  const allReviews = Array.isArray(cloned.review_rewards)
    ? (cloned.review_rewards as ReviewRewardSubmission[])
    : [];
  const allDraws = Array.isArray(cloned.lucky_draws) ? (cloned.lucky_draws as Array<Record<string, unknown>>) : [];

  const privateKeys = [
    'customers',
    'transactions',
    'cod_orders',
    'wasal_settlements',
    'investors',
    'investor_transactions',
    'resellers',
    'user_accounts',
    'branches',
    'walkin_customers',
    'walkin_sales',
    'salesperson_referrals',
    'commission_records',
    'employees',
    'attendance',
    'recurring_invoices',
    'notifications',
    'product_broadcasts',
    'broadcast_contacts',
    'saved_broadcasts',
    'login_audits',
    'import_logs',
    'monthly_expenses',
    'admin_audit_logs',
  ];
  for (const k of privateKeys) {
    cloned[k] = [];
  }

  cloned.lucky_draws = allDraws.map((d) => ({
    ...d,
    winners: Array.isArray(d.winners)
      ? d.winners.map((w: Record<string, unknown>) => ({
          ...w,
          phone: maskPhone(String(w.phone || '')),
        }))
      : [],
    topBuyersSnapshot: Array.isArray(d.topBuyersSnapshot)
      ? d.topBuyersSnapshot.map((b: Record<string, unknown>) => ({
          ...b,
          phone: maskPhone(String(b.phone || '')),
        }))
      : [],
  }));

  cloned.review_rewards = allReviews
    .filter((r) => r.status === 'approved' || (isAuthenticated && r.customerId === actor.customerId))
    .map((r) => ({ ...r, phone: isAuthenticated && r.customerId === actor.customerId ? r.phone : maskPhone(r.phone) }));

  if (!isAuthenticated) {
    return cloned;
  }

  if (role === 'customer') {
    const matchedCusts = allCustomers.filter(
      (c) =>
        (actor.customerId && c.id === actor.customerId) ||
        (actorPhoneDigits && normPhone(c.phone) === actorPhoneDigits)
    );
    const ownedCustIds = new Set(matchedCusts.map((c) => c.id));
    if (actor.customerId) ownedCustIds.add(actor.customerId);

    cloned.customers = matchedCusts.map((c) => {
      const clean = { ...c };
      delete clean.pin;
      return clean;
    });
    cloned.transactions = allTxs.filter((t) => ownedCustIds.has(t.customerId));
    cloned.cod_orders = allCodOrders.filter(
      (o) =>
        (o.customerId && ownedCustIds.has(o.customerId)) ||
        (actorPhoneDigits && normPhone(o.phone) === actorPhoneDigits)
    );
  } else if (role === 'reseller') {
    cloned.resellers = allResellers
      .filter(
        (r) =>
          (actor.resellerCode && r.referralCode === actor.resellerCode) ||
          r.id === actor.id ||
          (actorPhoneDigits && normPhone(r.phone) === actorPhoneDigits)
      )
      .map((r) => {
        const clean = { ...r };
        delete clean.pin;
        return clean;
      });
    cloned.cod_orders = allCodOrders.filter(
      (o) => actor.resellerCode && o.resellerCode === actor.resellerCode
    );
  } else if (role === 'investor') {
    const ownInvestors = allInvestors.filter(
      (inv) =>
        (actor.investorId && String(inv.id) === actor.investorId) ||
        (actorPhoneDigits && normPhone(String(inv.phone || '')) === actorPhoneDigits)
    );
    const ownedInvIds = new Set(ownInvestors.map((i) => String(i.id)));
    cloned.investors = ownInvestors;
    cloned.investor_transactions = allInvestorTxs.filter((tx) =>
      ownedInvIds.has(String(tx.investorId || ''))
    );
  }

  return cloned;
}

export async function getFullSyncState(actorOrRole?: ActorContext | string): Promise<Record<string, unknown>> {
  const db = await getDb();
  const [cities, categories, products, customers, profile, auditLogs] = await Promise.all([
    getAllCitiesFromDb(db),
    getAllCategoriesFromDb(db),
    getAllProductsFromDb(db),
    getAllCustomersFromDb(db),
    getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile),
    getAdminAuditLogs(db),
  ]);

  const isProduction = process.env.NODE_ENV === 'production';
  const profileWithCities: BusinessProfile = {
    ...profile,
    deliveryCities: ensureCityAreasShape(
      cities.length > 0
        ? cities
        : profile.deliveryCities || (isProduction ? [] : defaultDeliveryCities)
    ),
  };

  const state: Record<string, unknown> = {
    syncVersion: lastSyncVersion,
    products,
    categories,
    cities: profileWithCities.deliveryCities,
    customers,
    business_profile: profileWithCities,
    admin_audit_logs: auditLogs,
  };

  const allowSampleFallback = !isProduction && process.env.ALLOW_SAMPLE_SEED === 'true';
  const keys = Object.keys(DEFAULT_COLLECTION_MAP).filter((k) => k !== 'business_profile');
  const collectionValues = await Promise.all(
    keys.map((key) => {
      const defVal = DEFAULT_COLLECTION_MAP[key];
      const fallback =
        allowSampleFallback || (!isProduction && key === 'templates')
          ? defVal
          : Array.isArray(defVal)
          ? []
          : defVal;
      return getCollectionValue(db, key, fallback);
    })
  );
  keys.forEach((key, idx) => {
    state[key] = collectionValues[idx];
  });

  return redactStateForRole(state, actorOrRole);
}

const COLLECTION_DATE_ONLY_FIELDS = new Set([
  'date',
  'dueDate',
  'payoutDate',
  'joinDate',
  'expectedArrivalDate',
  'birthday',
  'lastPurchaseDate',
]);

const COLLECTION_DATETIME_FIELDS = new Set([
  'updatedAt',
  'dispatchedAt',
  'deliveredAt',
  'returnedAt',
  'sentAt',
  'lastLoginAt',
  'timestamp',
  'activatedAt',
  'convertedAt',
  'resolvedAt',
  'completedAt',
  'redeemedAt',
  'expiresAt',
]);

export function sanitizeAndValidateCollectionItemDates(
  item: Record<string, unknown>,
  existing?: Record<string, unknown>,
  nowIso = new Date().toISOString()
): Record<string, unknown> {
  const merged = mergePreservingOmittedFields(existing, item);
  for (const field of COLLECTION_DATE_ONLY_FIELDS) {
    if (merged[field] !== undefined && merged[field] !== null && merged[field] !== '') {
      merged[field] = validateAndNormalizeDateOnly(merged[field], field);
    }
  }
  for (const field of COLLECTION_DATETIME_FIELDS) {
    if (merged[field] !== undefined && merged[field] !== null && merged[field] !== '') {
      merged[field] = validateAndNormalizeDateTime(merged[field], field);
    }
  }

  const preservedCreatedAt = resolvePreservedCreatedAt({
    existingCreatedAt: existing?.createdAt,
    incomingCreatedAt: item.createdAt,
    fallbackIso: nowIso,
    fieldName: 'createdAt',
  });
  const candidate = { ...merged, createdAt: preservedCreatedAt };
  const hasChanges = hasRecordContentChanges(existing, candidate);
  const resolvedUpdatedAt = resolveUpdatedAt({
    isNew: !existing,
    hasChanges,
    existingUpdatedAt: existing?.updatedAt,
    incomingUpdatedAt: item.updatedAt,
    createdAtValue: preservedCreatedAt,
    nowIso,
  });

  return {
    ...candidate,
    createdAt: preservedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
}

export async function mergeCollectionArrayNonDestructively<T extends Record<string, unknown>>(
  db: DbExecutor,
  key: string,
  incomingArr: T[],
  options?: { idField?: string }
): Promise<{ items: T[]; changed: boolean; insertedCount: number; updatedCount: number }> {
  const currentArr = await getCollectionValue<T[]>(db, key, []);
  if (!Array.isArray(incomingArr) || incomingArr.length === 0) {
    return { items: currentArr, changed: false, insertedCount: 0, updatedCount: 0 };
  }

  const idField = options?.idField || 'id';
  const nowIso = new Date().toISOString();
  const byId = new Map<string, number>();
  const working: T[] = [...currentArr];

  working.forEach((item, idx) => {
    const idVal = item?.[idField] ? String(item[idField]) : '';
    if (idVal) byId.set(idVal, idx);
  });

  let insertedCount = 0;
  let updatedCount = 0;

  for (const rawItem of incomingArr) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const itemId = rawItem[idField] ? String(rawItem[idField]) : '';
    const existingIdx = itemId ? byId.get(itemId) : undefined;
    const existing = existingIdx !== undefined ? working[existingIdx] : undefined;
    const sanitized = sanitizeAndValidateCollectionItemDates(rawItem, existing, nowIso) as T;

    if (existingIdx !== undefined) {
      if (hasRecordContentChanges(existing as Record<string, unknown>, sanitized as Record<string, unknown>, [])) {
        working[existingIdx] = sanitized;
        updatedCount++;
      }
    } else {
      working.push(sanitized);
      if (itemId) byId.set(itemId, working.length - 1);
      insertedCount++;
    }
  }

  const changed = insertedCount > 0 || updatedCount > 0;
  if (changed) {
    await saveCollectionValue(db, key, working);
  }
  return { items: working, changed, insertedCount, updatedCount };
}

export async function mergeLocalSnapshotNonDestructively(localCollections: Record<string, unknown>): Promise<{
  mergedCounts: Record<string, number>;
}> {
  const mergedCounts: Record<string, number> = {};
  const hasAnyData = Object.keys(localCollections || {}).length > 0;
  if (!hasAnyData) return { mergedCounts };

  await withDbTransaction(async (db) => {
    if (Array.isArray(localCollections.categories) && localCollections.categories.length > 0) {
      const currentCats = await getAllCategoriesFromDb(db);
      const existingIds = new Set(currentCats.map((c) => c.id));
      const existingNameParent = new Set(
        currentCats.map((c) => `${normalizeTextKey(c.name)}::${c.parentCategoryId || ''}`)
      );
      let added = 0;
      for (const raw of localCollections.categories as CategoryRecord[]) {
        if (!raw?.name) continue;
        const norm = normalizeUpcomingCategoryRecord(raw);
        const key = `${normalizeTextKey(norm.name)}::${norm.parentCategoryId || ''}`;
        if (!existingIds.has(norm.id) && !existingNameParent.has(key) && !isUpcomingCategoryName(norm.name)) {
          await upsertCategoryRow(db, norm);
          existingIds.add(norm.id);
          existingNameParent.add(key);
          added++;
        }
      }
      if (added > 0) mergedCounts.categories = added;
    }

    if (Array.isArray(localCollections.products) && localCollections.products.length > 0) {
      const existingIds = new Set((await getAllProductsFromDb(db)).map((p) => p.id));
      let added = 0;
      for (const p of localCollections.products as ProductItem[]) {
        if (p?.id && p?.name && !existingIds.has(p.id)) {
          await upsertProductRow(db, p);
          existingIds.add(p.id);
          added++;
        }
      }
      if (added > 0) mergedCounts.products = added;
    }

    if (Array.isArray(localCollections.customers) && localCollections.customers.length > 0) {
      const existingIds = new Set((await getAllCustomersFromDb(db)).map((c) => c.id));
      let added = 0;
      for (const c of localCollections.customers as Customer[]) {
        if (c?.id && c?.name && !existingIds.has(c.id)) {
          await upsertCustomerRow(db, c);
          existingIds.add(c.id);
          added++;
        }
      }
      if (added > 0) mergedCounts.customers = added;
    }

    const localProfile = localCollections.business_profile as BusinessProfile | undefined;
    const localCities = (localCollections.cities as DeliveryCityConfig[] | undefined) || localProfile?.deliveryCities;
    if (Array.isArray(localCities) && localCities.length > 0) {
      const existingCities = await getAllCitiesFromDb(db);
      const byName = new Map(existingCities.map((c) => [normalizeTextKey(c.name), c]));
      let added = 0;
      const now = db.formatTimestamp();
      for (const lc of localCities) {
        if (!lc?.name) continue;
        const existing = byName.get(normalizeTextKey(lc.name));
        if (!existing) {
          const cid = lc.id || slugifyId('city', lc.name);
          const prov = inferProvinceForCity(lc.name, lc.province);
          await db.run(
            `${insertIgnoreKeyword(db.driver)} INTO cities (id, name, province, allowed, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [cid, lc.name.trim(), prov, lc.allowed !== false ? 1 : 0, existingCities.length + added + 1, now, now]
          );
          for (const a of lc.areas || []) {
            if (!a?.name) continue;
            await db.run(
              `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, area_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [a.id || slugifyId('area', `${lc.name}_${a.name}`), cid, a.name.trim(), a.allowed !== false ? 1 : 0, a.areaType || null, now, now]
            );
          }
          added++;
        } else if (Array.isArray(lc.areas)) {
          const existingAreaNames = new Set((existing.areas || []).map((a) => normalizeTextKey(a.name)));
          for (const a of lc.areas) {
            if (a?.name && !existingAreaNames.has(normalizeTextKey(a.name))) {
              await db.run(
                `${insertIgnoreKeyword(db.driver)} INTO city_areas (id, city_id, name, allowed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [a.id || slugifyId('area', `${existing.name}_${a.name}`), existing.id!, a.name.trim(), a.allowed !== false ? 1 : 0, now, now]
              );
              existingAreaNames.add(normalizeTextKey(a.name));
            }
          }
        }
      }
      if (added > 0) {
        mergedCounts.cities = added;
        await syncDeliveryCitiesIntoBusinessProfile(db);
      }
    }

    const nowIso = new Date().toISOString();
    for (const key of Object.keys(DEFAULT_COLLECTION_MAP)) {
      if (key === 'business_profile') continue;
      const incomingArr = localCollections[key];
      if (!Array.isArray(incomingArr) || incomingArr.length === 0) continue;
      const currentArr = await getCollectionValue<Array<Record<string, unknown>>>(db, key, []);
      const existingIds = new Set(currentArr.map((item) => String(item.id || '')));
      let added = 0;
      for (const item of incomingArr as Array<Record<string, unknown>>) {
        const id = item?.id ? String(item.id) : '';
        if (id && !existingIds.has(id)) {
          const sanitized = sanitizeAndValidateCollectionItemDates(item, undefined, nowIso);
          currentArr.push(sanitized);
          existingIds.add(id);
          added++;
        }
      }
      if (added > 0) {
        await saveCollectionValue(db, key, currentArr);
        mergedCounts[key] = added;
      }
    }
  });

  touchSyncVersion();
  return { mergedCounts };
}

export interface OrderHistoryAuditResult {
  repairedOrders: number;
  linkedCustomersCreated: number;
  repairedTransactions: number;
  migratedUrlsCount: number;
  summary: string;
}

export async function auditAndRepairOrderHistory(dbArg?: DbExecutor): Promise<OrderHistoryAuditResult> {
  const runAudit = async (db: DbExecutor): Promise<OrderHistoryAuditResult> => {
    let repairedOrders = 0;
    let linkedCustomersCreated = 0;
    let repairedTransactions = 0;
    let migratedUrlsCount = 0;
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    const normalizeDigits = (val?: string) => (val || '').replace(/\D/g, '');
    const replaceLegacyDomain = (val: string) =>
      val
        .replace(/https?:\/\/(?:www\.)?100dagar\.pk/gi, 'https://www.madinamarket.pk')
        .replace(/https?:\/\/(?:www\.)?example\.com/gi, 'https://www.madinamarket.pk')
        .replace(/@100dagar\.pk/gi, '@madinamarket.pk');

    const allProds = await getAllProductsFromDb(db);
    for (const p of allProds) {
      let dirty = false;
      const nextProd = { ...p };
      if (nextProd.websiteUrl && /(?:100dagar\.pk|example\.com)/i.test(nextProd.websiteUrl)) {
        nextProd.websiteUrl = replaceLegacyDomain(nextProd.websiteUrl);
        dirty = true;
      }
      if (nextProd.sourceUrl && /(?:100dagar\.pk|example\.com)/i.test(nextProd.sourceUrl)) {
        nextProd.sourceUrl = replaceLegacyDomain(nextProd.sourceUrl);
        dirty = true;
      }
      if (dirty) {
        await upsertProductRow(db, nextProd);
        migratedUrlsCount++;
      }
    }

    const bp = await getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    let bpChanged = false;
    const nextBp: BusinessProfile = { ...bp };
    if (nextBp.email && /100dagar\.pk/i.test(nextBp.email)) {
      nextBp.email = replaceLegacyDomain(nextBp.email);
      bpChanged = true;
    }
    if (!nextBp.website || /(?:100dagar\.pk|example\.com)/i.test(nextBp.website)) {
      nextBp.website = 'https://www.madinamarket.pk';
      bpChanged = true;
    }
    if (bpChanged) {
      await saveCollectionValue(db, 'business_profile', nextBp);
      migratedUrlsCount++;
    }

    for (const colKey of ['investors', 'user_accounts', 'import_logs']) {
      const arr = await getCollectionValue<Array<Record<string, unknown>>>(db, colKey, []);
      let arrDirty = false;
      const cleanedArr = arr.map((item) => {
        const nextItem = { ...item };
        for (const field of ['email', 'sourceUrl', 'websiteUrl', 'productLink']) {
          const v = nextItem[field];
          if (typeof v === 'string' && /(?:100dagar\.pk|example\.com)/i.test(v)) {
            nextItem[field] = replaceLegacyDomain(v);
            arrDirty = true;
            migratedUrlsCount++;
          }
        }
        return nextItem;
      });
      if (arrDirty) {
        await saveCollectionValue(db, colKey, cleanedArr);
      }
    }

    const customers = await getAllCustomersFromDb(db);
    const customerById = new Map<string, Customer>(customers.map((c) => [c.id, c]));
    const rawOrders = await getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
    const rawTxs = await getCollectionValue<Transaction[]>(db, 'transactions', []);

    const seenOrderIds = new Set<string>();
    const dedupedOrders: CODOrder[] = [];
    for (const ord of rawOrders) {
      if (!ord || !ord.id || seenOrderIds.has(ord.id)) {
        repairedOrders++;
        continue;
      }
      seenOrderIds.add(ord.id);
      dedupedOrders.push(ord);
    }

    const seenTxIds = new Set<string>();
    const cleanTxs: Transaction[] = [];
    for (const tx of rawTxs) {
      if (!tx || !tx.id || seenTxIds.has(tx.id)) {
        repairedTransactions++;
        continue;
      }
      seenTxIds.add(tx.id);
      let txDirty = false;
      const safeAmount = Math.max(0, Number(tx.amount || 0));
      const safePaid = Math.max(0, Number(tx.paidAmount || 0));
      const safeDue =
        tx.dueBalance !== undefined
          ? Math.max(0, Number(tx.dueBalance))
          : tx.type === 'credit'
          ? Math.max(0, safeAmount - safePaid)
          : 0;
      const validCustomer =
        tx.customerId && customerById.has(tx.customerId) ? customerById.get(tx.customerId) : undefined;
      let resolvedCustomerId = tx.customerId || '';
      if (!validCustomer) {
        const matchedOrd = dedupedOrders.find(
          (o) =>
            (o.orderNumber && tx.notes?.includes(o.orderNumber)) ||
            (o.phone && normalizeDigits(tx.notes).includes(normalizeDigits(o.phone)))
        );
        if (matchedOrd?.customerId && customerById.has(matchedOrd.customerId)) {
          resolvedCustomerId = matchedOrd.customerId;
          txDirty = true;
        }
      }
      if (
        resolvedCustomerId !== tx.customerId ||
        safeAmount !== tx.amount ||
        !tx.date ||
        !Array.isArray(tx.auditTrail)
      ) {
        txDirty = true;
      }
      if (txDirty) repairedTransactions++;
      cleanTxs.push({
        ...tx,
        customerId: resolvedCustomerId,
        amount: safeAmount,
        paidAmount: safePaid,
        dueBalance: safeDue,
        date: tx.date || (tx.createdAt ? tx.createdAt.split('T')[0] : todayStr),
        auditTrail: Array.isArray(tx.auditTrail) ? tx.auditTrail : [],
      });
    }

    const fixedOrders: CODOrder[] = [];
    for (const ord of dedupedOrders) {
      let ordDirty = false;
      const cleanPhoneDigits = normalizeDigits(ord.phone);
      let matchedCust =
        (ord.customerId && customerById.get(ord.customerId)) ||
        (cleanPhoneDigits
          ? Array.from(customerById.values()).find((c) => normalizeDigits(c.phone) === cleanPhoneDigits)
          : undefined);

      if (!matchedCust && ord.customerName) {
        const digits = cleanPhoneDigits || '03000000000';
        const defaultPin = digits.length >= 6 ? digits.slice(-6) : '123456';
        const newCust: Customer = {
          id: `cust_ord_${ord.id.replace(/[^a-zA-Z0-9]/g, '')}`,
          name: ord.customerName,
          phone: ord.phone || digits,
          city: ord.city || 'Muzaffarabad',
          area: ord.area,
          mohalla: ord.mohalla,
          landmark: ord.landmark,
          address: ord.address || `${ord.city || 'Pakistan'}`,
          customerType: 'individual',
          balance: 0,
          totalPurchases: 0,
          creditLimit: 5000,
          paymentTermsDays: 7,
          status: 'active',
          pin: defaultPin,
          createdAt: (ord.createdAt || now).split('T')[0],
        };
        await upsertCustomerRow(db, newCust);
        customerById.set(newCust.id, newCust);
        matchedCust = newCust;
        linkedCustomersCreated++;
        ordDirty = true;
      }

      const nextCustomerId = matchedCust?.id || ord.customerId;
      if (nextCustomerId && nextCustomerId !== ord.customerId) {
        ordDirty = true;
      }

      const itemsList = Array.isArray(ord.items) ? ord.items : [];
      const computedSubtotal =
        Number.isFinite(Number(ord.subtotal)) && Number(ord.subtotal) > 0
          ? Number(ord.subtotal)
          : itemsList.reduce((sum, it) => sum + Number(it.amount || 0), 0);
      const safeDeliveryFee = Math.max(0, Number(ord.deliveryFee || 0));
      const safeTotal =
        Number.isFinite(Number(ord.totalAmount)) && Number(ord.totalAmount) > 0
          ? Number(ord.totalAmount)
          : computedSubtotal + safeDeliveryFee;

      if (
        !Array.isArray(ord.items) ||
        safeTotal !== ord.totalAmount ||
        safeDeliveryFee !== ord.deliveryFee ||
        !ord.orderNumber ||
        !ord.city
      ) {
        ordDirty = true;
      }

      const orderNum = ord.orderNumber || `COD-${ord.id}`;
      const hasLinkedOrderTx = cleanTxs.some(
        (t) =>
          (t.invoiceNumber && t.invoiceNumber === orderNum) ||
          (t.notes && t.notes.includes(orderNum))
      );
      if (!hasLinkedOrderTx && nextCustomerId && safeTotal > 0 && ord.status !== 'returned') {
        const isDelivered = ord.status === 'delivered';
        const txDate = (ord.createdAt || now).split('T')[0];
        const linkedTx: Transaction = {
          id: `tx_link_${ord.id}`,
          customerId: nextCustomerId,
          type: 'credit',
          amount: safeTotal,
          paidAmount: isDelivered ? safeTotal : 0,
          dueBalance: isDelivered ? 0 : safeTotal,
          saleType: 'cod',
          date: txDate,
          dueDate: txDate,
          paymentTermsDays: 0,
          invoiceNumber: orderNum,
          notes: `COD Order #${orderNum} (${ord.city || 'Pakistan'}${ord.deliveryFee > 0 ? ` +Rs. ${ord.deliveryFee} delivery` : ''})`,
          paymentMode: 'cod',
          items: itemsList,
          totalSavings: itemsList.reduce((acc, it) => acc + Number(it.customerSavings || 0), 0),
          status: isDelivered ? 'completed' : 'pending',
          responsibleStaff: 'Order Audit Sync',
          auditTrail: [
            {
              id: `aud_sync_${ord.id}`,
              timestamp: now,
              action: 'created',
              newStatus: isDelivered ? 'completed' : 'pending',
              newAmount: safeTotal,
              changedBy: 'System Order Audit',
              notes: `Linked COD order #${orderNum} into backend transaction history`,
            },
          ],
          createdAt: ord.createdAt || now,
        };
        cleanTxs.unshift(linkedTx);
        repairedTransactions++;
      }

      if (ordDirty) repairedOrders++;
      fixedOrders.push({
        ...ord,
        orderNumber: orderNum,
        customerId: nextCustomerId,
        city: ord.city || 'Muzaffarabad',
        items: itemsList,
        subtotal: computedSubtotal,
        deliveryFee: safeDeliveryFee,
        totalAmount: safeTotal,
      });
    }

    for (const cust of customerById.values()) {
      const custTxs = cleanTxs.filter((t) => t.customerId === cust.id && t.status !== 'cancelled');
      const totalCredit = custTxs
        .filter((t) => t.type === 'credit')
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      const totalPaidDirect = custTxs
        .filter((t) => t.type === 'credit' && t.saleType !== 'time_credit')
        .reduce((s, t) => s + Number(t.paidAmount || 0), 0);
      const totalDebit = custTxs
        .filter((t) => t.type === 'debit')
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      const ordersCount = custTxs.filter((t) => t.type === 'credit').length;
      const computedBal = Math.max(0, totalCredit - totalPaidDirect - totalDebit);
      await upsertCustomerRow(db, {
        ...cust,
        balance: computedBal,
        totalPurchases: totalCredit,
        ordersCount,
      });
    }

    await saveCollectionValue(db, 'cod_orders', fixedOrders);
    await saveCollectionValue(db, 'transactions', cleanTxs);

    const summary = `Audit complete: ${repairedOrders} order fixes, ${linkedCustomersCreated} linked customer records created, ${repairedTransactions} ledger transactions synced, ${migratedUrlsCount} legacy URLs updated to madinamarket.pk.`;
    return {
      repairedOrders,
      linkedCustomersCreated,
      repairedTransactions,
      migratedUrlsCount,
      summary,
    };
  };

  if (dbArg) {
    return runAudit(dbArg);
  }
  const result = await withDbTransaction(runAudit);
  touchSyncVersion();
  return result;
}

export interface HealthCheckResponse {
  app: 'ok';
  database: DbDriver;
  status: 'ok' | 'error';
  connected: boolean;
  environment: string;
  tables: {
    products: boolean;
    customers: boolean;
    schema_migrations: boolean;
  };
  syncVersion: string;
}

export async function checkDatabaseHealth(): Promise<HealthCheckResponse> {
  const environment = process.env.NODE_ENV || 'development';
  let driver: DbDriver = 'mysql';
  try {
    driver = resolveDbDriver();
  } catch {
    driver = process.env.NODE_ENV === 'production' ? 'mysql' : 'sqlite';
  }
  try {
    const db = await getDb();
    await db.ping();
    const [products, customers, schemaMigrations] = await Promise.all([
      db.tableExists('products'),
      db.tableExists('customers'),
      db.tableExists('schema_migrations'),
    ]);
    const allPresent = products && customers && schemaMigrations;
    return {
      app: 'ok',
      database: db.driver,
      status: allPresent ? 'ok' : 'error',
      connected: true,
      environment,
      tables: {
        products,
        customers,
        schema_migrations: schemaMigrations,
      },
      syncVersion: lastSyncVersion,
    };
  } catch {
    return {
      app: 'ok',
      database: driver,
      status: 'error',
      connected: false,
      environment,
      tables: {
        products: false,
        customers: false,
        schema_migrations: false,
      },
      syncVersion: lastSyncVersion,
    };
  }
}
