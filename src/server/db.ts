import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'madinamarket.db');

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

let dbInstance: DatabaseSync | null = null;
let lastSyncVersion = new Date().toISOString();

export function getSyncVersion(): string {
  return lastSyncVersion;
}

export function touchSyncVersion(): string {
  lastSyncVersion = new Date().toISOString();
  return lastSyncVersion;
}

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    ensureDirectories();
    const hadExistingDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    try {
      dbInstance.exec('PRAGMA journal_mode = WAL;');
    } catch (walErr) {
      console.warn('SQLite WAL mode unavailable, falling back to TRUNCATE/DELETE journal mode:', walErr);
      try {
        dbInstance.exec('PRAGMA journal_mode = TRUNCATE;');
      } catch {
        try {
          dbInstance.exec('PRAGMA journal_mode = DELETE;');
        } catch {
          // ignore if journal mode cannot be switched
        }
      }
    }
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA synchronous = NORMAL;');
    runMigrations(dbInstance, hadExistingDb);
  }
  return dbInstance;
}

export function createVerifiedBackup(reason: string): BackupMetadata {
  ensureDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'manual';
  const id = `bak_${timestamp}_${safeReason}`;
  const sqliteBackupPath = path.join(BACKUP_DIR, `${id}.db`);
  const jsonBackupPath = path.join(BACKUP_DIR, `${id}.json`);

  let sqliteFile: string | null = null;
  if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
    try {
      if (dbInstance) {
        const escaped = sqliteBackupPath.replace(/'/g, "''");
        dbInstance.exec(`VACUUM INTO '${escaped}';`);
      } else {
        fs.copyFileSync(DB_PATH, sqliteBackupPath);
      }
      sqliteFile = path.basename(sqliteBackupPath);
    } catch {
      fs.copyFileSync(DB_PATH, sqliteBackupPath);
      sqliteFile = path.basename(sqliteBackupPath);
    }
  }

  let snapshot: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  if (dbInstance) {
    try {
      const tableRows = (table: string) =>
        dbInstance!.prepare(`SELECT * FROM ${table}`).all();
      const tables = ['categories', 'cities', 'city_areas', 'products', 'customers', 'app_collections', 'admin_audit_logs'];
      for (const tbl of tables) {
        try {
          const rows = tableRows(tbl);
          snapshot[tbl] = rows;
          counts[tbl] = rows.length;
        } catch {
          counts[tbl] = 0;
        }
      }
    } catch {
      // ignore on brand-new uninitialized db
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

function runMigrations(db: DatabaseSync, hadExistingDb: boolean) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      notes TEXT
    );
  `);

  const hasMigration = (id: string): boolean => {
    const row = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(id);
    return Boolean(row);
  };

  const recordMigration = (id: string, notes: string) => {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at, notes) VALUES (?, ?, ?)').run(
      id,
      new Date().toISOString(),
      notes
    );
  };

  // Pre-migration safety backup if an existing DB was present and pending migrations exist
  const pendingMigrations =
    !hasMigration('001_initial_schema') ||
    !hasMigration('002_seed_defaults_if_empty') ||
    !hasMigration('003_upgrade_upcoming_categories_locations') ||
    !hasMigration('004_delivery_charges_city_areas') ||
    !hasMigration('005_all_provinces_kashmir_subcities_villages') ||
    !hasMigration('006_product_delivery_fees_and_templates') ||
    !hasMigration('007_fix_broadcast_templates_key') ||
    !hasMigration('008_audit_clean_order_history_and_links') ||
    !hasMigration('009_crm_schema_and_security_hardening');

  if (hadExistingDb && pendingMigrations) {
    createVerifiedBackup('pre_migration');
  }

  // MIGRATION 001: Create all normalized tables cleanly
  if (!hasMigration('001_initial_schema')) {
    db.exec(`
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
    recordMigration('001_initial_schema', 'Created normalized categories, cities, city_areas, products, customers, app_collections, admin_audit_logs');
  }

  // MIGRATION 002: Seed defaults ONLY into empty tables/keys (strictly non-destructive)
  if (!hasMigration('002_seed_defaults_if_empty')) {
    const now = new Date().toISOString();

    const catCount = Number((db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number }).cnt || 0);
    if (catCount === 0) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of defaultCategoryRecords) {
        const level = c.level || computeCategoryLevel(c, defaultCategoryRecords);
        stmt.run(
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
          now
        );
      }
    }

    const cityCount = Number((db.prepare('SELECT COUNT(*) as cnt FROM cities').get() as { cnt: number }).cnt || 0);
    if (cityCount === 0) {
      const insertCity = db.prepare(`
        INSERT OR IGNORE INTO cities (id, name, allowed, delivery_charge, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertArea = db.prepare(`
        INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, delivery_charge, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      defaultDeliveryCities.forEach((city, idx) => {
        const cityId = city.id || slugifyId('city', city.name);
        insertCity.run(
          cityId,
          city.name,
          city.allowed ? 1 : 0,
          city.deliveryCharge ?? null,
          idx + 1,
          now,
          now
        );
        (city.areas || []).forEach((area) => {
          const areaId = area.id || slugifyId('area', `${city.name}_${area.name}`);
          insertArea.run(
            areaId,
            cityId,
            area.name,
            area.allowed ? 1 : 0,
            area.deliveryCharge ?? null,
            now,
            now
          );
        });
      });
    }

    const prodCount = Number((db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number }).cnt || 0);
    if (prodCount === 0) {
      for (const p of defaultProducts) {
        upsertProductRow(db, p);
      }
    }

    const custCount = Number((db.prepare('SELECT COUNT(*) as cnt FROM customers').get() as { cnt: number }).cnt || 0);
    if (custCount === 0) {
      for (const cust of defaultCustomers) {
        upsertCustomerRow(db, cust);
      }
    }

    const insertCollection = db.prepare(`
      INSERT OR IGNORE INTO app_collections (collection_key, data_json, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const [key, val] of Object.entries(DEFAULT_COLLECTION_MAP)) {
      insertCollection.run(key, JSON.stringify(val), now);
    }

    recordMigration('002_seed_defaults_if_empty', 'Seeded empty tables safely using INSERT OR IGNORE');
  }

  // MIGRATION 003: Non-destructive normalization for Upcoming Viral Products | Coming Soon, 3-level hierarchy & City areas
  if (!hasMigration('003_upgrade_upcoming_categories_locations')) {
    const now = new Date().toISOString();

    // 1. Ensure canonical Upcoming category record exists and uses new label without losing ID
    const existingUpcoming = db
      .prepare('SELECT * FROM categories WHERE id = ? OR is_upcoming = 1')
      .get(UPCOMING_CATEGORY_ID) as Record<string, unknown> | undefined;
    if (existingUpcoming) {
      db.prepare(`
        UPDATE categories
        SET name = ?, is_upcoming = 1, is_active = 1, level = 1, parent_category_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(UPCOMING_CATEGORY_NAME, now, String(existingUpcoming.id));
    } else {
      const upCat = defaultCategoryRecords.find((c) => c.id === UPCOMING_CATEGORY_ID)!;
      db.prepare(`
        INSERT OR IGNORE INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 1, ?, 1, 1, ?, ?, ?)
      `).run(upCat.id, UPCOMING_CATEGORY_NAME, upCat.urduName || null, upCat.description || null, 7, now, now);
    }

    // 2. Ensure default subcategories/child categories exist without touching custom user categories
    const insertCatIgnore = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of defaultCategoryRecords) {
      insertCatIgnore.run(
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
        now
      );
    }

    // 3. Normalize existing Upcoming products non-destructively
    const allProds = getAllProductsFromDb(db);
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
        upsertProductRow(db, updated);
      }
    }

    // 4. Sync business_profile.deliveryCities with cities & city_areas non-destructively
    const profile = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (profile.deliveryCities && profile.deliveryCities.length > 0) {
      const insertCityIgnore = db.prepare(`
        INSERT OR IGNORE INTO cities (id, name, allowed, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      profile.deliveryCities.forEach((dc, idx) => {
        insertCityIgnore.run(dc.id || slugifyId('city', dc.name), dc.name.trim(), dc.allowed ? 1 : 0, idx + 1, now, now);
      });
    }
    // Add default areas only to cities that currently have 0 areas
    const insertAreaIgnore = db.prepare(`
      INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const defCity of defaultDeliveryCities) {
      const cityRow = db.prepare('SELECT id FROM cities WHERE LOWER(name) = LOWER(?)').get(defCity.name) as { id: string } | undefined;
      if (cityRow && defCity.areas && defCity.areas.length > 0) {
        const existingAreaCnt = Number(
          (db.prepare('SELECT COUNT(*) as cnt FROM city_areas WHERE city_id = ?').get(cityRow.id) as { cnt: number }).cnt || 0
        );
        if (existingAreaCnt === 0) {
          for (const a of defCity.areas) {
            insertAreaIgnore.run(a.id, cityRow.id, a.name, a.allowed ? 1 : 0, now, now);
          }
        }
      }
    }
    syncDeliveryCitiesIntoBusinessProfile(db);

    recordMigration('003_upgrade_upcoming_categories_locations', 'Normalized Upcoming category label, seeded multi-level sample subcategories, and synced city areas');
  }

  if (!hasMigration('004_delivery_charges_city_areas')) {
    const now = new Date().toISOString();

    const cityCols = db.prepare('PRAGMA table_info(cities)').all() as Array<{ name: string }>;
    if (!cityCols.some((c) => c.name === 'delivery_charge')) {
      db.exec('ALTER TABLE cities ADD COLUMN delivery_charge REAL;');
    }

    const areaCols = db.prepare('PRAGMA table_info(city_areas)').all() as Array<{ name: string }>;
    if (!areaCols.some((c) => c.name === 'delivery_charge')) {
      db.exec('ALTER TABLE city_areas ADD COLUMN delivery_charge REAL;');
    }

    // Ensure Muzaffarabad stays active and defaults to Rs. 50 for City Center
    const mzdRow = db
      .prepare("SELECT id, delivery_charge FROM cities WHERE LOWER(TRIM(name)) = 'muzaffarabad'")
      .get() as { id: string; delivery_charge: number | null } | undefined;

    if (mzdRow) {
      db.prepare(
        'UPDATE cities SET allowed = 1, delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE id = ?'
      ).run(now, mzdRow.id);

      const cityCenterArea = db
        .prepare("SELECT id FROM city_areas WHERE city_id = ? AND LOWER(TRIM(name)) = 'city center'")
        .get(mzdRow.id) as { id: string } | undefined;

      if (!cityCenterArea) {
        db.prepare(
          'INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, delivery_charge, created_at, updated_at) VALUES (?, ?, ?, 1, 50, ?, ?)'
        ).run('area_mzd_city_center', mzdRow.id, 'City Center', now, now);
      } else {
        db.prepare(
          'UPDATE city_areas SET allowed = 1, delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE id = ?'
        ).run(now, cityCenterArea.id);
      }

      db.prepare(
        "UPDATE city_areas SET delivery_charge = COALESCE(delivery_charge, 50), updated_at = ? WHERE city_id = ? AND LOWER(TRIM(name)) = 'madina market'"
      ).run(now, mzdRow.id);
    }

    const currentProfile = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
    if (currentProfile.defaultCityCenterDeliveryCharge === undefined) {
      saveCollectionValue(db, 'business_profile', {
        ...currentProfile,
        defaultCityCenterDeliveryCharge: 50,
      });
    }
    syncDeliveryCitiesIntoBusinessProfile(db);

    recordMigration('004_delivery_charges_city_areas', 'Added per-city and per-area delivery_charge columns with City Center Rs. 50 default');
  }

  // MIGRATION 005: Non-destructive expansion across ALL Pakistan provinces & Azad Kashmir (cities, sub-cities, child cities & villages)
  if (!hasMigration('005_all_provinces_kashmir_subcities_villages')) {
    if (hadExistingDb) {
      createVerifiedBackup('pre_migration_005_provinces');
    }
    const now = new Date().toISOString();

    const cityCols = db.prepare('PRAGMA table_info(cities)').all() as Array<{ name: string }>;
    if (!cityCols.some((c) => c.name === 'province')) {
      db.exec('ALTER TABLE cities ADD COLUMN province TEXT;');
    }

    const areaCols = db.prepare('PRAGMA table_info(city_areas)').all() as Array<{ name: string }>;
    if (!areaCols.some((c) => c.name === 'area_type')) {
      db.exec('ALTER TABLE city_areas ADD COLUMN area_type TEXT;');
    }

    const findCityByNameOrId = db.prepare(
      'SELECT id, name, province FROM cities WHERE id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
    );
    const insertCityIgnore = db.prepare(`
      INSERT OR IGNORE INTO cities (id, name, province, allowed, delivery_charge, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateCityProvinceOnly = db.prepare(
      'UPDATE cities SET province = COALESCE(NULLIF(TRIM(province), \'\'), ?), updated_at = ? WHERE id = ?'
    );
    const findAreaByName = db.prepare(
      'SELECT id FROM city_areas WHERE city_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
    );
    const updateAreaTypeOnly = db.prepare(
      'UPDATE city_areas SET area_type = COALESCE(NULLIF(TRIM(area_type), \'\'), ?), updated_at = ? WHERE id = ?'
    );
    const insertAreaIgnore = db.prepare(`
      INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, delivery_charge, area_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultDeliveryCities.forEach((defCity, idx) => {
      const resolvedProv = inferProvinceForCity(defCity.name, defCity.province);
      const existingCity = findCityByNameOrId.get(
        defCity.id || slugifyId('city', defCity.name),
        defCity.name
      ) as { id: string; name: string; province?: string } | undefined;

      let targetCityId: string;
      if (existingCity) {
        targetCityId = existingCity.id;
        // Strictly preserve existing allowed & delivery_charge; only populate missing province label
        updateCityProvinceOnly.run(resolvedProv, now, targetCityId);
      } else {
        targetCityId = defCity.id || slugifyId('city', defCity.name);
        insertCityIgnore.run(
          targetCityId,
          defCity.name,
          resolvedProv,
          defCity.allowed ? 1 : 0,
          defCity.deliveryCharge ?? null,
          idx + 1,
          now,
          now
        );
      }

      for (const a of defCity.areas || []) {
        const existingArea = findAreaByName.get(targetCityId, a.name) as { id: string } | undefined;
        if (existingArea) {
          if (a.areaType) {
            updateAreaTypeOnly.run(a.areaType, now, existingArea.id);
          }
        } else {
          insertAreaIgnore.run(
            a.id || slugifyId('area', `${defCity.name}_${a.name}`),
            targetCityId,
            a.name,
            a.allowed !== false ? 1 : 0,
            a.deliveryCharge ?? null,
            a.areaType || null,
            now,
            now
          );
        }
      }
    });

    // Backfill province on any custom cities created before Migration 005
    const allCityRows = db.prepare('SELECT id, name, province FROM cities').all() as Array<{
      id: string;
      name: string;
      province?: string | null;
    }>;
    for (const row of allCityRows) {
      if (!row.province || !String(row.province).trim()) {
        db.prepare('UPDATE cities SET province = ? WHERE id = ?').run(
          inferProvinceForCity(row.name),
          row.id
        );
      }
    }

    syncDeliveryCitiesIntoBusinessProfile(db);
    recordMigration(
      '005_all_provinces_kashmir_subcities_villages',
      'Non-destructively added all Pakistan provinces & Azad Kashmir cities, sub-cities, child cities & villages while keeping Standard delivery open nationwide'
    );
  }

  // MIGRATION 006: Add per-product delivery_fee_type & custom_delivery_charge columns + update default broadcast Super Best Price & madinamarket.pk URLs
  if (!hasMigration('006_product_delivery_fees_and_templates')) {
    if (hadExistingDb) {
      createVerifiedBackup('pre_migration_006_delivery_fees');
    }
    const now = new Date().toISOString();

    const prodCols = db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>;
    if (!prodCols.some((c) => c.name === 'delivery_fee_type')) {
      db.exec("ALTER TABLE products ADD COLUMN delivery_fee_type TEXT NOT NULL DEFAULT 'default';");
    }
    if (!prodCols.some((c) => c.name === 'custom_delivery_charge')) {
      db.exec('ALTER TABLE products ADD COLUMN custom_delivery_charge REAL;');
    }

    // Non-destructively upgrade tpl_product_broadcast in templates if it still contains "Wholesale Price" / "Wholesale Deal"
    try {
      const tplRow = db
        .prepare("SELECT data_json FROM app_collections WHERE collection_key = 'templates'")
        .get() as { data_json?: string } | undefined;
      if (tplRow?.data_json) {
        const templates = JSON.parse(tplRow.data_json) as Array<Record<string, unknown>>;
        let changed = false;
        const nextTemplates = templates.map((t) => {
          if (t && (t.id === 'tpl_product_broadcast' || t.type === 'product_broadcast') && typeof t.content === 'string') {
            let nextContent = t.content
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
          db.prepare('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?').run(
            JSON.stringify(nextTemplates),
            now,
            'templates'
          );
        }
      }
    } catch {
      // ignore JSON parse issues on custom collection
    }

    // Non-destructively replace legacy seeded 100dagar.pk/example.com dummy URLs in product_broadcasts & saved_broadcasts
    for (const colKey of ['product_broadcasts', 'saved_broadcasts']) {
      try {
        const row = db
          .prepare('SELECT data_json FROM app_collections WHERE collection_key = ?')
          .get(colKey) as { data_json?: string } | undefined;
        if (row?.data_json && (row.data_json.includes('100dagar.pk') || row.data_json.includes('Wholesale'))) {
          const updatedJson = row.data_json
            .replace(/https?:\/\/100dagar\.pk/gi, 'https://madinamarket.pk')
            .replace(/Our Wholesale:/gi, 'Our Super Best Price:')
            .replace(/New wholesale arrival/gi, 'New Super Best Price arrival');
          if (updatedJson !== row.data_json) {
            db.prepare('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?').run(
              updatedJson,
              now,
              colKey
            );
          }
        }
      } catch {
        // ignore
      }
    }

    recordMigration(
      '006_product_delivery_fees_and_templates',
      'Added product delivery_fee_type & custom_delivery_charge columns and updated broadcast templates to Super Best Price & madinamarket.pk'
    );
  }

  // MIGRATION 007: Upgrade templates collection under correct key ('templates') for existing DBs
  if (!hasMigration('007_fix_broadcast_templates_key')) {
    const now = new Date().toISOString();
    try {
      const tplRow = db
        .prepare("SELECT data_json FROM app_collections WHERE collection_key = 'templates'")
        .get() as { data_json?: string } | undefined;
      if (tplRow?.data_json) {
        const templates = JSON.parse(tplRow.data_json) as Array<Record<string, unknown>>;
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
          db.prepare('UPDATE app_collections SET data_json = ?, updated_at = ? WHERE collection_key = ?').run(
            JSON.stringify(nextTemplates),
            now,
            'templates'
          );
        }
      }
    } catch {
      // ignore
    }

    recordMigration(
      '007_fix_broadcast_templates_key',
      'Upgraded broadcast template in app_collections.templates to Super Best Price & Super Best Deal'
    );
  }

  // MIGRATION 008: Audit & repair backend order history (missing customer links, ledger consistency, stale dummy URLs)
  if (!hasMigration('008_audit_clean_order_history_and_links')) {
    if (hadExistingDb) {
      createVerifiedBackup('pre_migration_008_order_audit');
    }
    try {
      auditAndRepairOrderHistory(db);
    } catch (err) {
      console.warn('Migration 008 order audit warning:', err);
    }
    recordMigration(
      '008_audit_clean_order_history_and_links',
      'Audited and repaired backend COD orders, orphaned customer/transaction links, balances, and madinamarket.pk links'
    );
  }

  // MIGRATION 009: Complete CRM tables, retention automation defaults & server-side scrypt secret hardening
  if (!hasMigration('009_crm_schema_and_security_hardening')) {
    if (hadExistingDb) {
      createVerifiedBackup('pre_migration_009_crm_and_security');
    }

    db.exec(`
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

    // Security hardening: migrate legacy plaintext PINs in user_accounts & business_profile to scrypt hashes
    try {
      const bp = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
      const envMasterPin = (process.env.ADMIN_MASTER_PIN || '').trim();
      const rawAdminPin = typeof bp.adminPin === 'string' && bp.adminPin.trim() ? bp.adminPin.trim() : undefined;

      const accounts = getCollectionValue<UserAccount[]>(db, 'user_accounts', []);
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
        saveCollectionValue(db, 'user_accounts', migratedAccounts);
      }

      if (bp.adminPin !== undefined) {
        const cleanedBp: BusinessProfile = { ...bp };
        delete cleanedBp.adminPin;
        saveCollectionValue(db, 'business_profile', cleanedBp);
      }
    } catch (err) {
      console.warn('Migration 009 secret hardening warning:', err);
    }

    // Seed CRM loyalty config & automation rules (idempotent)
    seedCrmDefaultsIfEmpty(db);

    recordMigration(
      '009_crm_schema_and_security_hardening',
      'Created CRM tables (leads, follow-ups, campaigns, tickets, loyalty, coupons, custom segments, automation, activity), seeded defaults, and hashed stored credentials via scrypt'
    );
  }
}

// ==========================================
// DATA ACCESS HELPERS (CENTRAL SOURCE OF TRUTH)
// ==========================================

export function getAllCategoriesFromDb(db = getDb()): CategoryRecord[] {
  const rows = db
    .prepare('SELECT * FROM categories ORDER BY display_order ASC, level ASC, name ASC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) =>
    normalizeUpcomingCategoryRecord({
      id: String(r.id),
      name: String(r.name),
      urduName: r.urdu_name ? String(r.urdu_name) : undefined,
      parentCategoryId: r.parent_category_id ? String(r.parent_category_id) : undefined,
      level: (Number(r.level) as 1 | 2 | 3) || 1,
      description: r.description ? String(r.description) : undefined,
      isUpcoming: Boolean(r.is_upcoming),
      isActive: r.is_active === undefined ? true : Boolean(r.is_active),
      displayOrder: Number(r.display_order || 0),
      createdAt: r.created_at ? String(r.created_at) : undefined,
      updatedAt: r.updated_at ? String(r.updated_at) : undefined,
    })
  );
}

export function upsertCategoryRow(db: DatabaseSync, cat: CategoryRecord): CategoryRecord {
  const normalized = normalizeUpcomingCategoryRecord(cat);
  const allCats = getAllCategoriesFromDb(db);
  const level = computeCategoryLevel(normalized, allCats.filter((c) => c.id !== normalized.id).concat(normalized));
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO categories (id, name, urdu_name, parent_category_id, level, description, is_upcoming, is_active, display_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      urdu_name = excluded.urdu_name,
      parent_category_id = excluded.parent_category_id,
      level = excluded.level,
      description = excluded.description,
      is_upcoming = excluded.is_upcoming,
      is_active = excluded.is_active,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `).run(
    normalized.id,
    normalized.name.trim(),
    normalized.urduName || null,
    normalized.parentCategoryId || null,
    level,
    normalized.description || null,
    normalized.isUpcoming ? 1 : 0,
    normalized.isActive === false ? 0 : 1,
    normalized.displayOrder || 0,
    normalized.createdAt || now,
    now
  );

  return { ...normalized, level, updatedAt: now };
}

export function getAllCitiesFromDb(db = getDb()): DeliveryCityConfig[] {
  const cityRows = db
    .prepare('SELECT * FROM cities ORDER BY display_order ASC, name ASC')
    .all() as Array<Record<string, unknown>>;
  const areaRows = db
    .prepare("SELECT * FROM city_areas ORDER BY CASE WHEN LOWER(TRIM(name)) = 'city center' THEN 0 ELSE 1 END, name ASC")
    .all() as Array<Record<string, unknown>>;

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

export function syncDeliveryCitiesIntoBusinessProfile(db = getDb()): BusinessProfile {
  const cities = getAllCitiesFromDb(db);
  const profile = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
  const updatedProfile: BusinessProfile = {
    ...profile,
    defaultCityCenterDeliveryCharge:
      profile.defaultCityCenterDeliveryCharge !== undefined
        ? profile.defaultCityCenterDeliveryCharge
        : 50,
    deliveryCities: ensureCityAreasShape(cities),
  };
  saveCollectionValue(db, 'business_profile', updatedProfile);
  return updatedProfile;
}

export function replaceCitiesAndAreasFromList(db: DatabaseSync, incomingCities: DeliveryCityConfig[]) {
  const now = new Date().toISOString();
  const shaped = ensureCityAreasShape(incomingCities);

  const existingCities = getAllCitiesFromDb(db);
  const existingByName = new Map(existingCities.map((c) => [normalizeTextKey(c.name), c]));

  for (let i = 0; i < shaped.length; i++) {
    const c = shaped[i];
    const matchByName = existingByName.get(normalizeTextKey(c.name));
    const cityId = matchByName?.id || c.id || slugifyId('city', c.name);
    const provinceVal = inferProvinceForCity(c.name, c.province || matchByName?.province);
    const cityCharge =
      typeof c.deliveryCharge === 'number' && Number.isFinite(c.deliveryCharge) && c.deliveryCharge >= 0
        ? Math.round(c.deliveryCharge)
        : null;
    db.prepare(`
      INSERT INTO cities (id, name, province, allowed, delivery_charge, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        province = excluded.province,
        allowed = excluded.allowed,
        delivery_charge = excluded.delivery_charge,
        display_order = excluded.display_order,
        updated_at = excluded.updated_at
    `).run(cityId, c.name, provinceVal, c.allowed ? 1 : 0, cityCharge, i + 1, now, now);

    if (c.areas && c.areas.length > 0) {
      for (const a of c.areas) {
        const existingArea = db
          .prepare('SELECT id FROM city_areas WHERE city_id = ? AND LOWER(name) = LOWER(?)')
          .get(cityId, a.name) as { id: string } | undefined;
        const areaId = existingArea?.id || a.id || slugifyId('area', `${c.name}_${a.name}`);
        const areaCharge =
          typeof a.deliveryCharge === 'number' && Number.isFinite(a.deliveryCharge) && a.deliveryCharge >= 0
            ? Math.round(a.deliveryCharge)
            : null;
        db.prepare(`
          INSERT INTO city_areas (id, city_id, name, allowed, delivery_charge, area_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            allowed = excluded.allowed,
            delivery_charge = excluded.delivery_charge,
            area_type = COALESCE(excluded.area_type, city_areas.area_type),
            updated_at = excluded.updated_at
        `).run(areaId, cityId, a.name, a.allowed ? 1 : 0, areaCharge, a.areaType || null, now, now);
      }
    }
  }
}

export function getAllProductsFromDb(db = getDb()): ProductItem[] {
  const rows = db
    .prepare('SELECT * FROM products ORDER BY created_at DESC, rowid DESC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => {
    let parsed: ProductItem;
    try {
      parsed = JSON.parse(String(r.data_json)) as ProductItem;
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
        createdAt: String(r.created_at),
      };
    }

    const isUpcoming = Boolean(r.is_upcoming) || isProductPurchaseBlocked(parsed);
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
      expectedArrivalDate: r.expected_arrival_date
        ? String(r.expected_arrival_date)
        : parsed.expectedArrivalDate,
      deliveryFeeType: ((r.delivery_fee_type ? String(r.delivery_fee_type) : parsed.deliveryFeeType) || 'default') as ProductItem['deliveryFeeType'],
      customDeliveryCharge:
        r.custom_delivery_charge !== null && r.custom_delivery_charge !== undefined
          ? Number(r.custom_delivery_charge)
          : parsed.customDeliveryCharge,
      status: (String(r.status || parsed.status || 'published') as 'draft' | 'published'),
      updatedAt: r.updated_at ? String(r.updated_at) : parsed.updatedAt,
    };
  });
}

export function upsertProductRow(db: DatabaseSync, product: ProductItem): ProductItem {
  const allCats = getAllCategoriesFromDb(db);
  const blockedUpcoming = isProductPurchaseBlocked(product);
  const now = new Date().toISOString();

  const resolvedIds = blockedUpcoming
    ? { parentCategoryId: UPCOMING_CATEGORY_ID, subcategoryId: undefined, childSubcategoryId: undefined }
    : resolveCategoryIdsFromProduct(product, allCats);

  const normalizedCategory = blockedUpcoming
    ? UPCOMING_CATEGORY_NAME
    : resolvedIds.parentCategoryId
    ? getCategoryBreadcrumb(
        allCats,
        resolvedIds.parentCategoryId,
        resolvedIds.subcategoryId,
        resolvedIds.childSubcategoryId,
        product.category
      )
    : product.category || 'General Wholesale';

  const normalizedDeliveryFeeType: ProductItem['deliveryFeeType'] =
    product.deliveryFeeType === 'free'
      ? 'free'
      : product.deliveryFeeType === 'custom'
      ? 'custom'
      : 'default';
  const normalizedCustomDeliveryCharge =
    normalizedDeliveryFeeType === 'custom' &&
    product.customDeliveryCharge !== undefined &&
    product.customDeliveryCharge !== null &&
    Number.isFinite(Number(product.customDeliveryCharge)) &&
    Number(product.customDeliveryCharge) >= 0
      ? Math.round(Number(product.customDeliveryCharge))
      : undefined;

  const normalizedProduct: ProductItem = {
    ...product,
    category: normalizedCategory,
    parentCategoryId: resolvedIds.parentCategoryId,
    subcategoryId: resolvedIds.subcategoryId,
    childSubcategoryId: resolvedIds.childSubcategoryId,
    deliveryFeeType: normalizedDeliveryFeeType,
    customDeliveryCharge: normalizedCustomDeliveryCharge,
    isUpcoming: blockedUpcoming,
    upcomingStatus: blockedUpcoming ? 'coming_soon' : 'available',
    stockQty: blockedUpcoming ? 0 : Math.max(0, Number(product.stockQty || 0)),
    status: product.status || 'published',
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO products (
      id, name, urdu_name, category, parent_category_id, subcategory_id, child_subcategory_id,
      sku, cost_price, market_price, our_price, stock_qty, min_stock_alert,
      is_upcoming, upcoming_status, expected_arrival_date, delivery_fee_type, custom_delivery_charge,
      status, created_at, updated_at, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      urdu_name = excluded.urdu_name,
      category = excluded.category,
      parent_category_id = excluded.parent_category_id,
      subcategory_id = excluded.subcategory_id,
      child_subcategory_id = excluded.child_subcategory_id,
      sku = excluded.sku,
      cost_price = excluded.cost_price,
      market_price = excluded.market_price,
      our_price = excluded.our_price,
      stock_qty = excluded.stock_qty,
      min_stock_alert = excluded.min_stock_alert,
      is_upcoming = excluded.is_upcoming,
      upcoming_status = excluded.upcoming_status,
      expected_arrival_date = excluded.expected_arrival_date,
      delivery_fee_type = excluded.delivery_fee_type,
      custom_delivery_charge = excluded.custom_delivery_charge,
      status = excluded.status,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
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
    normalizedProduct.createdAt || now.split('T')[0],
    now,
    JSON.stringify(normalizedProduct)
  );

  return normalizedProduct;
}

export function getAllCustomersFromDb(db = getDb()): Customer[] {
  const rows = db
    .prepare('SELECT * FROM customers ORDER BY created_at DESC, rowid DESC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => {
    let parsed: Customer;
    try {
      parsed = JSON.parse(String(r.data_json)) as Customer;
    } catch {
      parsed = {
        id: String(r.id),
        name: String(r.name),
        customerType: 'individual',
        phone: String(r.phone),
        creditLimit: 5000,
        paymentTermsDays: 7,
        createdAt: String(r.created_at),
        balance: Number(r.balance || 0),
        status: (String(r.status || 'active') as 'active' | 'archived'),
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
      status: (String(r.status || parsed.status || 'active') as 'active' | 'archived'),
    };
  });
}

export function upsertCustomerRow(db: DatabaseSync, customer: Customer): Customer {
  const now = new Date().toISOString();
  const normalized: Customer = {
    ...customer,
    city: customer.city?.trim() || undefined,
    area: customer.area?.trim() || undefined,
    mohalla: customer.mohalla?.trim() || undefined,
    landmark: customer.landmark?.trim() || undefined,
    address: customer.address?.trim() || undefined,
  };

  db.prepare(`
    INSERT INTO customers (id, name, phone, city, area, mohalla, landmark, address, balance, status, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      city = excluded.city,
      area = excluded.area,
      mohalla = excluded.mohalla,
      landmark = excluded.landmark,
      address = excluded.address,
      balance = excluded.balance,
      status = excluded.status,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
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
    normalized.createdAt || now.split('T')[0],
    now,
    JSON.stringify(normalized)
  );
  return normalized;
}

export function getCollectionValue<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db
    .prepare('SELECT data_json FROM app_collections WHERE collection_key = ?')
    .get(key) as { data_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.data_json) as T;
  } catch {
    return fallback;
  }
}

export function saveCollectionValue(db: DatabaseSync, key: string, value: unknown) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_collections (collection_key, data_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(collection_key) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now);
}

export function insertAdminAuditLog(db: DatabaseSync, log: Omit<AdminAuditLog, 'id' | 'createdAt'>): AdminAuditLog {
  const entry: AdminAuditLog = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...log,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, actor_id, actor_name, actor_role, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.actorId || null,
    entry.actorName || null,
    entry.actorRole || null,
    entry.details ? JSON.stringify(entry.details) : null,
    entry.createdAt
  );
  return entry;
}

export function getAdminAuditLogs(db = getDb()): AdminAuditLog[] {
  const rows = db
    .prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    actorId: r.actor_id ? String(r.actor_id) : undefined,
    actorName: r.actor_name ? String(r.actor_name) : undefined,
    actorRole: r.actor_role ? String(r.actor_role) : undefined,
    details: r.details_json ? (JSON.parse(String(r.details_json)) as Record<string, unknown>) : undefined,
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

  // 1. Node scrypt format
  if (storedHash.startsWith('scrypt:') && storedSalt?.startsWith('scrypt:')) {
    const rawSalt = storedSalt.slice('scrypt:'.length);
    const expectedHex = storedHash.slice('scrypt:'.length);
    const derived = crypto.scryptSync(trimmed, rawSalt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  // 2. Client WebCrypto SHA-256 salted format (64 hex chars + random salt)
  if (storedSalt && !storedSalt.startsWith('scrypt:')) {
    const digest = crypto.createHash('sha256').update(`${storedSalt}:${trimmed}`).digest('hex');
    if (digest.length === storedHash.length) {
      return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(storedHash, 'utf8'));
    }
  }

  // 3. Plaintext fallback ONLY for pre-hash compatibility if any external record still uses plain PIN
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

export function getCrmLoyaltyConfig(db = getDb()): CRMLoyaltyConfig {
  return getCollectionValue<CRMLoyaltyConfig>(db, 'crm_loyalty_config', DEFAULT_CRM_LOYALTY_CONFIG);
}

export function saveCrmLoyaltyConfig(db: DatabaseSync, config: CRMLoyaltyConfig) {
  saveCollectionValue(db, 'crm_loyalty_config', config);
}

export function seedCrmDefaultsIfEmpty(db: DatabaseSync) {
  const existingCfg = db.prepare("SELECT collection_key FROM app_collections WHERE collection_key = 'crm_loyalty_config'").get();
  if (!existingCfg) {
    saveCollectionValue(db, 'crm_loyalty_config', DEFAULT_CRM_LOYALTY_CONFIG);
  }

  const ruleCount = Number((db.prepare('SELECT COUNT(*) as c FROM crm_automation_rules').get() as { c: number }).c);
  if (ruleCount === 0) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO crm_automation_rules (id, trigger_type, enabled, last_run_at, total_triggered_count, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const rule of DEFAULT_CRM_AUTOMATION_RULES) {
      stmt.run(rule.id, rule.triggerType, rule.enabled ? 1 : 0, rule.lastRunAt || null, rule.totalTriggeredCount || 0, JSON.stringify(rule));
    }
  }

  // Initialize loyalty accounts non-destructively from existing historical customer spend
  const loyaltyCount = Number((db.prepare('SELECT COUNT(*) as c FROM crm_loyalty_accounts').get() as { c: number }).c);
  if (loyaltyCount === 0) {
    const custs = getAllCustomersFromDb(db);
    const now = new Date().toISOString();
    for (const c of custs) {
      const earned = Math.max(0, Math.floor(Number(c.totalPurchases || 0) / 1000) * DEFAULT_CRM_LOYALTY_CONFIG.pointsPerThousandPkr);
      const tier = computeLoyaltyTier(earned, DEFAULT_CRM_LOYALTY_CONFIG);
      db.prepare(`
        INSERT OR IGNORE INTO crm_loyalty_accounts (customer_id, points_balance, lifetime_points_earned, lifetime_points_redeemed, tier, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(c.id, earned, earned, 0, tier, now);
      if (earned > 0) {
        db.prepare(`
          INSERT OR IGNORE INTO crm_loyalty_ledger (id, customer_id, type, points, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`lyl_seed_${c.id}`, c.id, 'earned', earned, 'Historical purchase loyalty points sync', now);
      }
    }
  }
}

export function getAllCrmFollowUps(db = getDb()): CRMFollowUpTask[] {
  const rows = db.prepare('SELECT data_json FROM crm_follow_ups ORDER BY follow_up_date ASC, created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMFollowUpTask);
}

export function upsertCrmFollowUp(db: DatabaseSync, task: CRMFollowUpTask): CRMFollowUpTask {
  const now = new Date().toISOString();
  const saved: CRMFollowUpTask = {
    ...task,
    createdAt: task.createdAt || now,
    updatedAt: now,
    completedAt: task.status === 'Completed' ? task.completedAt || now : task.completedAt,
  };
  db.prepare(`
    INSERT INTO crm_follow_ups (id, customer_id, lead_id, assigned_employee_id, follow_up_date, priority, status, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      lead_id = excluded.lead_id,
      assigned_employee_id = excluded.assigned_employee_id,
      follow_up_date = excluded.follow_up_date,
      priority = excluded.priority,
      status = excluded.status,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    saved.id,
    saved.customerId || null,
    saved.leadId || null,
    saved.assignedEmployeeId || null,
    saved.followUpDate,
    saved.priority,
    saved.status,
    saved.createdAt,
    now,
    JSON.stringify(saved)
  );
  return saved;
}

export function deleteCrmFollowUp(db: DatabaseSync, id: string) {
  db.prepare('DELETE FROM crm_follow_ups WHERE id = ?').run(id);
}

export function getAllCrmLeads(db = getDb()): CRMLead[] {
  const rows = db.prepare('SELECT data_json FROM crm_leads ORDER BY updated_at DESC, created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMLead);
}

export function upsertCrmLead(db: DatabaseSync, lead: CRMLead): CRMLead {
  const now = new Date().toISOString();
  const saved: CRMLead = {
    ...lead,
    createdAt: lead.createdAt || now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO crm_leads (id, phone, stage, source, assigned_salesperson_id, converted_customer_id, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      phone = excluded.phone,
      stage = excluded.stage,
      source = excluded.source,
      assigned_salesperson_id = excluded.assigned_salesperson_id,
      converted_customer_id = excluded.converted_customer_id,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    saved.id,
    saved.phone,
    saved.stage,
    saved.source,
    saved.assignedSalespersonId || null,
    saved.convertedCustomerId || null,
    saved.createdAt,
    now,
    JSON.stringify(saved)
  );
  return saved;
}

export function getAllCrmCampaigns(db = getDb()): CRMCampaign[] {
  const rows = db.prepare('SELECT data_json FROM crm_campaigns ORDER BY created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMCampaign);
}

export function upsertCrmCampaign(db: DatabaseSync, campaign: CRMCampaign): CRMCampaign {
  const now = new Date().toISOString();
  const saved: CRMCampaign = {
    ...campaign,
    createdAt: campaign.createdAt || now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO crm_campaigns (id, status, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(saved.id, saved.status, saved.createdAt, now, JSON.stringify(saved));
  return saved;
}

export function getAllCrmTickets(db = getDb()): CRMSupportTicket[] {
  const rows = db.prepare('SELECT data_json FROM crm_support_tickets ORDER BY created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMSupportTicket);
}

export function upsertCrmTicket(db: DatabaseSync, ticket: CRMSupportTicket): CRMSupportTicket {
  const now = new Date().toISOString();
  const saved: CRMSupportTicket = {
    ...ticket,
    createdAt: ticket.createdAt || now,
    updatedAt: now,
    resolvedAt:
      ticket.status === 'Resolved' || ticket.status === 'Closed'
        ? ticket.resolvedAt || now
        : ticket.resolvedAt,
  };
  db.prepare(`
    INSERT INTO crm_support_tickets (id, ticket_number, customer_id, order_id, category, priority, status, assigned_employee_id, due_at, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      order_id = excluded.order_id,
      category = excluded.category,
      priority = excluded.priority,
      status = excluded.status,
      assigned_employee_id = excluded.assigned_employee_id,
      due_at = excluded.due_at,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    saved.id,
    saved.ticketNumber,
    saved.customerId || null,
    saved.orderId || null,
    saved.category,
    saved.priority,
    saved.status,
    saved.assignedEmployeeId || null,
    saved.dueAt,
    saved.createdAt,
    now,
    JSON.stringify(saved)
  );
  return saved;
}

export function getAllCrmLoyaltyAccounts(db = getDb()): CRMLoyaltyAccount[] {
  const rows = db.prepare('SELECT * FROM crm_loyalty_accounts ORDER BY lifetime_points_earned DESC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    customerId: String(r.customer_id),
    pointsBalance: Number(r.points_balance || 0),
    lifetimePointsEarned: Number(r.lifetime_points_earned || 0),
    lifetimePointsRedeemed: Number(r.lifetime_points_redeemed || 0),
    tier: String(r.tier || 'Bronze') as CRMLoyaltyTier,
    updatedAt: String(r.updated_at),
  }));
}

export function getAllCrmLoyaltyLedger(db = getDb(), customerId?: string): CRMLoyaltyLedgerEntry[] {
  const rows = (
    customerId
      ? db.prepare('SELECT * FROM crm_loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200').all(customerId)
      : db.prepare('SELECT * FROM crm_loyalty_ledger ORDER BY created_at DESC LIMIT 300').all()
  ) as Array<Record<string, unknown>>;
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

export function adjustCustomerLoyaltyPoints(
  db: DatabaseSync,
  params: {
    customerId: string;
    pointsDelta: number;
    type: CRMLoyaltyLedgerEntry['type'];
    orderNumber?: string;
    couponCode?: string;
    notes?: string;
  }
): CRMLoyaltyAccount {
  const cfg = getCrmLoyaltyConfig(db);
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM crm_loyalty_accounts WHERE customer_id = ?').get(params.customerId) as Record<string, unknown> | undefined;
  const curBal = Number(existing?.points_balance || 0);
  const curEarned = Number(existing?.lifetime_points_earned || 0);
  const curRedeemed = Number(existing?.lifetime_points_redeemed || 0);

  const nextBal = Math.max(0, curBal + params.pointsDelta);
  const nextEarned = params.pointsDelta > 0 ? curEarned + params.pointsDelta : curEarned;
  const nextRedeemed = params.pointsDelta < 0 ? curRedeemed + Math.abs(params.pointsDelta) : curRedeemed;
  const nextTier = computeLoyaltyTier(nextEarned, cfg);

  db.prepare(`
    INSERT INTO crm_loyalty_accounts (customer_id, points_balance, lifetime_points_earned, lifetime_points_redeemed, tier, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      points_balance = excluded.points_balance,
      lifetime_points_earned = excluded.lifetime_points_earned,
      lifetime_points_redeemed = excluded.lifetime_points_redeemed,
      tier = excluded.tier,
      updated_at = excluded.updated_at
  `).run(params.customerId, nextBal, nextEarned, nextRedeemed, nextTier, now);

  const entryId = `lyl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO crm_loyalty_ledger (id, customer_id, type, points, order_number, coupon_code, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entryId,
    params.customerId,
    params.type,
    Math.abs(params.pointsDelta),
    params.orderNumber || null,
    params.couponCode || null,
    params.notes || null,
    now
  );

  return {
    customerId: params.customerId,
    pointsBalance: nextBal,
    lifetimePointsEarned: nextEarned,
    lifetimePointsRedeemed: nextRedeemed,
    tier: nextTier,
    updatedAt: now,
  };
}

export function getAllCrmCoupons(db = getDb()): CRMLoyaltyCoupon[] {
  const rows = db.prepare('SELECT data_json FROM crm_coupons ORDER BY created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMLoyaltyCoupon);
}

export function upsertCrmCoupon(db: DatabaseSync, coupon: CRMLoyaltyCoupon): CRMLoyaltyCoupon {
  const saved: CRMLoyaltyCoupon = {
    ...coupon,
    code: coupon.code.trim().toUpperCase(),
    createdAt: coupon.createdAt || new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO crm_coupons (id, code, customer_id, status, expires_at, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      customer_id = excluded.customer_id,
      status = excluded.status,
      expires_at = excluded.expires_at,
      data_json = excluded.data_json
  `).run(
    saved.id,
    saved.code,
    saved.customerId || null,
    saved.status,
    saved.expiresAt || null,
    saved.createdAt,
    JSON.stringify(saved)
  );
  return saved;
}

export function getAllCrmCustomSegments(db = getDb()): CRMCustomSegmentRule[] {
  const rows = db.prepare('SELECT data_json FROM crm_custom_segments ORDER BY created_at DESC').all() as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMCustomSegmentRule);
}

export function upsertCrmCustomSegment(db: DatabaseSync, rule: CRMCustomSegmentRule): CRMCustomSegmentRule {
  const now = new Date().toISOString();
  const saved: CRMCustomSegmentRule = { ...rule, createdAt: rule.createdAt || now, updatedAt: now };
  db.prepare(`
    INSERT INTO crm_custom_segments (id, name, is_active, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(saved.id, saved.name, saved.isActive ? 1 : 0, saved.createdAt, now, JSON.stringify(saved));
  return saved;
}

export function deleteCrmCustomSegment(db: DatabaseSync, id: string) {
  db.prepare('DELETE FROM crm_custom_segments WHERE id = ?').run(id);
}

export function getAllCrmAutomationRules(db = getDb()): CRMAutomationRule[] {
  const rows = db.prepare('SELECT data_json, enabled, last_run_at, total_triggered_count FROM crm_automation_rules').all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const parsed = JSON.parse(String(r.data_json)) as CRMAutomationRule;
    return {
      ...parsed,
      enabled: Boolean(r.enabled),
      lastRunAt: r.last_run_at ? String(r.last_run_at) : parsed.lastRunAt,
      totalTriggeredCount: Number(r.total_triggered_count ?? parsed.totalTriggeredCount ?? 0),
    };
  });
}

export function upsertCrmAutomationRule(db: DatabaseSync, rule: CRMAutomationRule): CRMAutomationRule {
  db.prepare(`
    INSERT INTO crm_automation_rules (id, trigger_type, enabled, last_run_at, total_triggered_count, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      last_run_at = excluded.last_run_at,
      total_triggered_count = excluded.total_triggered_count,
      data_json = excluded.data_json
  `).run(
    rule.id,
    rule.triggerType,
    rule.enabled ? 1 : 0,
    rule.lastRunAt || null,
    rule.totalTriggeredCount || 0,
    JSON.stringify(rule)
  );
  return rule;
}

export function getAllCrmAutomationLogs(db = getDb(), limit = 200): CRMAutomationLog[] {
  const rows = db.prepare('SELECT data_json FROM crm_automation_logs ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMAutomationLog);
}

export function insertCrmAutomationLog(db: DatabaseSync, log: CRMAutomationLog): boolean {
  const info = db.prepare(`
    INSERT OR IGNORE INTO crm_automation_logs (id, rule_id, trigger_type, customer_id, idempotency_key, status, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.id,
    log.ruleId,
    log.triggerType,
    log.customerId,
    log.idempotencyKey,
    log.status,
    log.createdAt,
    JSON.stringify(log)
  );
  return Number(info.changes || 0) > 0;
}

export function hasCrmAutomationIdempotencyKey(db: DatabaseSync, key: string): boolean {
  const row = db.prepare('SELECT id FROM crm_automation_logs WHERE idempotency_key = ?').get(key);
  return Boolean(row);
}

export function insertCrmActivityEvent(db: DatabaseSync, event: Omit<CRMActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CRMActivityEvent {
  const entry: CRMActivityEvent = {
    ...event,
    id: event.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: event.createdAt || new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO crm_activity_events (id, customer_id, phone, event_type, product_id, category, order_number, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.customerId || null,
    entry.phone || null,
    entry.eventType,
    entry.productId || null,
    entry.category || null,
    entry.orderNumber || null,
    entry.createdAt,
    JSON.stringify(entry)
  );
  return entry;
}

export function getAllCrmActivityEvents(db = getDb(), customerId?: string, limit = 500): CRMActivityEvent[] {
  const rows = (
    customerId
      ? db.prepare('SELECT data_json FROM crm_activity_events WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?').all(customerId, limit)
      : db.prepare('SELECT data_json FROM crm_activity_events ORDER BY created_at DESC LIMIT ?').all(limit)
  ) as Array<{ data_json: string }>;
  return rows.map((r) => JSON.parse(r.data_json) as CRMActivityEvent);
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

  // Never expose adminPin or shipping API key over API
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

  // Never expose credential hashes, salts, reset tokens, or suggested default PINs
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

  // Strip costPrice & margin metrics from products unless Admin/Manager/Investor
  if (Array.isArray(cloned.products) && !isAdmin && !isManager && role !== 'investor') {
    cloned.products = (cloned.products as ProductItem[]).map((p) => ({
      ...p,
      costPrice: 0,
      totalProfit: 0,
      totalRevenue: 0,
    }));
  }

  if (isInternalOps) {
    // Strip PINs from customer/reseller lists even for staff/managers
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

  // Scoped visibility for Customer / Reseller / Investor / Unauthenticated Guest
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

  // Default zero-leak private collections
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

  // Public lucky draws: mask winner phone digits
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

  // Public reviews: approved only + masked phone
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

export function getFullSyncState(actorOrRole?: ActorContext | string): Record<string, unknown> {
  const db = getDb();
  const cities = getAllCitiesFromDb(db);
  const categories = getAllCategoriesFromDb(db);
  const products = getAllProductsFromDb(db);
  const customers = getAllCustomersFromDb(db);

  const profile = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
  const profileWithCities: BusinessProfile = {
    ...profile,
    deliveryCities: ensureCityAreasShape(cities.length > 0 ? cities : profile.deliveryCities || defaultDeliveryCities),
  };

  const state: Record<string, unknown> = {
    syncVersion: lastSyncVersion,
    products,
    categories,
    cities: profileWithCities.deliveryCities,
    customers,
    business_profile: profileWithCities,
    admin_audit_logs: getAdminAuditLogs(db),
  };

  for (const [key, fallback] of Object.entries(DEFAULT_COLLECTION_MAP)) {
    if (key === 'business_profile') continue;
    state[key] = getCollectionValue(db, key, fallback);
  }

  return redactStateForRole(state, actorOrRole);
}

/**
 * Non-destructive one-time localStorage -> SQLite merge.
 * Strictly inserts missing IDs only and never overwrites or deletes existing database rows.
 */
export function mergeLocalSnapshotNonDestructively(localCollections: Record<string, unknown>): {
  mergedCounts: Record<string, number>;
} {
  const db = getDb();
  const mergedCounts: Record<string, number> = {};
  const hasAnyData = Object.keys(localCollections || {}).length > 0;
  if (!hasAnyData) return { mergedCounts };

  createVerifiedBackup('before_local_merge');

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. Categories
    if (Array.isArray(localCollections.categories)) {
      const existingIds = new Set(getAllCategoriesFromDb(db).map((c) => c.id));
      const existingNameParent = new Set(
        getAllCategoriesFromDb(db).map((c) => `${normalizeTextKey(c.name)}::${c.parentCategoryId || ''}`)
      );
      let added = 0;
      for (const raw of localCollections.categories as CategoryRecord[]) {
        if (!raw?.name) continue;
        const norm = normalizeUpcomingCategoryRecord(raw);
        const key = `${normalizeTextKey(norm.name)}::${norm.parentCategoryId || ''}`;
        if (!existingIds.has(norm.id) && !existingNameParent.has(key) && !isUpcomingCategoryName(norm.name)) {
          upsertCategoryRow(db, norm);
          existingIds.add(norm.id);
          existingNameParent.add(key);
          added++;
        }
      }
      if (added > 0) mergedCounts.categories = added;
    }

    // 2. Products
    if (Array.isArray(localCollections.products)) {
      const existingIds = new Set(getAllProductsFromDb(db).map((p) => p.id));
      let added = 0;
      for (const p of localCollections.products as ProductItem[]) {
        if (p?.id && p?.name && !existingIds.has(p.id)) {
          upsertProductRow(db, p);
          existingIds.add(p.id);
          added++;
        }
      }
      if (added > 0) mergedCounts.products = added;
    }

    // 3. Customers
    if (Array.isArray(localCollections.customers)) {
      const existingIds = new Set(getAllCustomersFromDb(db).map((c) => c.id));
      let added = 0;
      for (const c of localCollections.customers as Customer[]) {
        if (c?.id && c?.name && !existingIds.has(c.id)) {
          upsertCustomerRow(db, c);
          existingIds.add(c.id);
          added++;
        }
      }
      if (added > 0) mergedCounts.customers = added;
    }

    // 4. Cities / Delivery Cities (add missing cities/areas only)
    const localProfile = localCollections.business_profile as BusinessProfile | undefined;
    const localCities = (localCollections.cities as DeliveryCityConfig[] | undefined) || localProfile?.deliveryCities;
    if (Array.isArray(localCities) && localCities.length > 0) {
      const existingCities = getAllCitiesFromDb(db);
      const byName = new Map(existingCities.map((c) => [normalizeTextKey(c.name), c]));
      let added = 0;
      const now = new Date().toISOString();
      for (const lc of localCities) {
        if (!lc?.name) continue;
        const existing = byName.get(normalizeTextKey(lc.name));
        if (!existing) {
          const cid = lc.id || slugifyId('city', lc.name);
          const prov = inferProvinceForCity(lc.name, lc.province);
          db.prepare('INSERT OR IGNORE INTO cities (id, name, province, allowed, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            cid,
            lc.name.trim(),
            prov,
            lc.allowed !== false ? 1 : 0,
            existingCities.length + added + 1,
            now,
            now
          );
          for (const a of lc.areas || []) {
            if (!a?.name) continue;
            db.prepare('INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, area_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              a.id || slugifyId('area', `${lc.name}_${a.name}`),
              cid,
              a.name.trim(),
              a.allowed !== false ? 1 : 0,
              a.areaType || null,
              now,
              now
            );
          }
          added++;
        } else if (Array.isArray(lc.areas)) {
          const existingAreaNames = new Set((existing.areas || []).map((a) => normalizeTextKey(a.name)));
          for (const a of lc.areas) {
            if (a?.name && !existingAreaNames.has(normalizeTextKey(a.name))) {
              db.prepare('INSERT OR IGNORE INTO city_areas (id, city_id, name, allowed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
                a.id || slugifyId('area', `${existing.name}_${a.name}`),
                existing.id!,
                a.name.trim(),
                a.allowed !== false ? 1 : 0,
                now,
                now
              );
              existingAreaNames.add(normalizeTextKey(a.name));
            }
          }
        }
      }
      if (added > 0) {
        mergedCounts.cities = added;
        syncDeliveryCitiesIntoBusinessProfile(db);
      }
    }

    // 5. Generic array collections
    for (const key of Object.keys(DEFAULT_COLLECTION_MAP)) {
      if (key === 'business_profile') continue;
      const incomingArr = localCollections[key];
      if (!Array.isArray(incomingArr) || incomingArr.length === 0) continue;
      const currentArr = getCollectionValue<Array<Record<string, unknown>>>(db, key, []);
      const existingIds = new Set(currentArr.map((item) => String(item.id || '')));
      let added = 0;
      for (const item of incomingArr as Array<Record<string, unknown>>) {
        const id = item?.id ? String(item.id) : '';
        if (id && !existingIds.has(id)) {
          currentArr.push(item);
          existingIds.add(id);
          added++;
        }
      }
      if (added > 0) {
        saveCollectionValue(db, key, currentArr);
        mergedCounts[key] = added;
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

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

export function auditAndRepairOrderHistory(db = getDb()): OrderHistoryAuditResult {
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

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. Clean legacy domain links in products
    const allProds = getAllProductsFromDb(db);
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
        upsertProductRow(db, nextProd);
        migratedUrlsCount++;
      }
    }

    // 2. Clean business_profile, investors, user_accounts, import_logs URLs/emails (preserving internal owner alias in code)
    const bp = getCollectionValue<BusinessProfile>(db, 'business_profile', defaultBusinessProfile);
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
      saveCollectionValue(db, 'business_profile', nextBp);
      migratedUrlsCount++;
    }

    for (const colKey of ['investors', 'user_accounts', 'import_logs']) {
      const arr = getCollectionValue<Array<Record<string, unknown>>>(db, colKey, []);
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
        saveCollectionValue(db, colKey, cleanedArr);
      }
    }

    // 3. Audit customers, cod_orders, and transactions
    const customers = getAllCustomersFromDb(db);
    const customerById = new Map<string, Customer>(customers.map((c) => [c.id, c]));
    const rawOrders = getCollectionValue<CODOrder[]>(db, 'cod_orders', []);
    const rawTxs = getCollectionValue<Transaction[]>(db, 'transactions', []);

    // Deduplicate COD orders by id
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

    // Deduplicate & sanitize transactions
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
        tx.customerId && customerById.has(tx.customerId)
          ? customerById.get(tx.customerId)
          : undefined;
      let resolvedCustomerId = tx.customerId || '';
      if (!validCustomer) {
        // Attempt match via notes / order reference
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

    // Audit every COD order -> resolve or create Customer & link pending/delivered COD transaction if missing
    const fixedOrders: CODOrder[] = dedupedOrders.map((ord) => {
      let ordDirty = false;
      const cleanPhoneDigits = normalizeDigits(ord.phone);
      let matchedCust =
        (ord.customerId && customerById.get(ord.customerId)) ||
        (cleanPhoneDigits
          ? Array.from(customerById.values()).find(
              (c) => normalizeDigits(c.phone) === cleanPhoneDigits
            )
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
        upsertCustomerRow(db, newCust);
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

      // Ensure corresponding credit Transaction exists in ledger for order history traceability
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
      return {
        ...ord,
        orderNumber: orderNum,
        customerId: nextCustomerId,
        city: ord.city || 'Muzaffarabad',
        items: itemsList,
        subtotal: computedSubtotal,
        deliveryFee: safeDeliveryFee,
        totalAmount: safeTotal,
      };
    });

    // 4. Recalculate customer balances & purchases cleanly from cleanTxs
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
      upsertCustomerRow(db, {
        ...cust,
        balance: computedBal,
        totalPurchases: totalCredit,
        ordersCount,
      });
    }

    saveCollectionValue(db, 'cod_orders', fixedOrders);
    saveCollectionValue(db, 'transactions', cleanTxs);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  touchSyncVersion();
  const summary = `Audit complete: ${repairedOrders} order fixes, ${linkedCustomersCreated} linked customer records created, ${repairedTransactions} ledger transactions synced, ${migratedUrlsCount} legacy URLs updated to madinamarket.pk.`;
  return {
    repairedOrders,
    linkedCustomersCreated,
    repairedTransactions,
    migratedUrlsCount,
    summary,
  };
}

export function getDatabaseHealthSummary() {
  const db = getDb();
  const counts = {
    categories: Number((db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c),
    cities: Number((db.prepare('SELECT COUNT(*) as c FROM cities').get() as { c: number }).c),
    cityAreas: Number((db.prepare('SELECT COUNT(*) as c FROM city_areas').get() as { c: number }).c),
    products: Number((db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c),
    customers: Number((db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number }).c),
    transactions: getCollectionValue<Transaction[]>(db, 'transactions', []).length,
    codOrders: getCollectionValue<CODOrder[]>(db, 'cod_orders', []).length,
    monthlyExpenses: getCollectionValue<MonthlyExpense[]>(db, 'monthly_expenses', []).length,
    auditLogs: Number((db.prepare('SELECT COUNT(*) as c FROM admin_audit_logs').get() as { c: number }).c),
  };
  return {
    status: 'ok',
    dbPath: DB_PATH,
    syncVersion: lastSyncVersion,
    counts,
    backups: listBackups().slice(0, 5),
  };
}
