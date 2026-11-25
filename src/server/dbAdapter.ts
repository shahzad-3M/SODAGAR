import type { DatabaseSync as SqliteDatabaseSync } from 'node:sqlite';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

import {
  toMysqlDatetimeUtcStrict,
  validateAndNormalizeDateTime,
} from './dateUtils.ts';

export type DbDriver = 'sqlite' | 'mysql';

export interface DbRunResult {
  changes: number;
  lastInsertRowid?: number | string;
}

export interface DbExecutor {
  readonly driver: DbDriver;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<DbRunResult>;
  exec(sql: string): Promise<void>;
  formatTimestamp(iso?: string): string;
}

export interface DbAdapter extends DbExecutor {
  withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  tableExists(tableName: string): Promise<boolean>;
  columnExists(tableName: string, columnName: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface MysqlConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function resolveDbDriver(): DbDriver {
  const isProduction = process.env.NODE_ENV === 'production';
  const raw = (process.env.DB_DRIVER || '').trim().toLowerCase();

  if (raw === 'mysql') return 'mysql';
  if (raw === 'sqlite') {
    if (isProduction) {
      throw new Error(
        'Production mode (NODE_ENV=production) must use MySQL via mysql2. SQLite fallback is disabled in production to prevent data loss.'
      );
    }
    return 'sqlite';
  }
  if (raw) {
    throw new Error(`Unsupported DB_DRIVER "${raw}". Expected "mysql" or "sqlite".`);
  }

  if (isProduction) {
    return 'mysql';
  }
  const host = (process.env.DB_HOST || '').trim().toLowerCase();
  const isLoopbackHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const kService = process.env.K_SERVICE || '';
  const isAiStudioSandbox = kService.startsWith('ais-dev-') || kService.startsWith('ais-pre-');
  if (isAiStudioSandbox && (!host || isLoopbackHost)) {
    return 'sqlite';
  }
  if (
    host ||
    process.env.DB_NAME?.trim() ||
    process.env.DB_USER?.trim()
  ) {
    return 'mysql';
  }
  return 'sqlite';
}

export function getMysqlConfigFromEnv(): MysqlConnectionConfig {
  const host = (process.env.DB_HOST || '').trim();
  const portRaw = (process.env.DB_PORT || '').trim();
  const port = Number(portRaw);
  const database = (process.env.DB_NAME || '').trim();
  const user = (process.env.DB_USER || '').trim();
  const password = process.env.DB_PASSWORD;

  const missingOrInvalid: string[] = [];
  if (!host) missingOrInvalid.push('DB_HOST');
  if (!portRaw || !Number.isInteger(port) || port <= 0 || port > 65535) missingOrInvalid.push('DB_PORT');
  if (!database) missingOrInvalid.push('DB_NAME');
  if (!user) missingOrInvalid.push('DB_USER');
  if (password === undefined || password === '') missingOrInvalid.push('DB_PASSWORD');

  if (missingOrInvalid.length > 0) {
    throw new Error(
      `Missing or invalid MySQL environment variable(s): ${missingOrInvalid.join(', ')}. SQLite fallback is disabled in production.`
    );
  }

  return { host, port, database, user, password: String(password) };
}

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const rawDriver = (process.env.DB_DRIVER || '').trim().toLowerCase();
  if (rawDriver === 'sqlite') {
    throw new Error(
      'Production mode (NODE_ENV=production) must use MySQL. SQLite fallback is disabled in production to prevent data loss.'
    );
  }
  if (rawDriver && rawDriver !== 'mysql') {
    throw new Error(`Unsupported DB_DRIVER "${rawDriver}" in production. Expected "mysql" or unset.`);
  }

  const missingOrInvalid: string[] = [];
  if (!process.env.SESSION_SECRET || !process.env.SESSION_SECRET.trim()) {
    missingOrInvalid.push('SESSION_SECRET');
  }
  const host = (process.env.DB_HOST || '').trim();
  const portRaw = (process.env.DB_PORT || '').trim();
  const port = Number(portRaw);
  const database = (process.env.DB_NAME || '').trim();
  const user = (process.env.DB_USER || '').trim();
  const password = process.env.DB_PASSWORD;

  if (!host) missingOrInvalid.push('DB_HOST');
  if (!portRaw || !Number.isInteger(port) || port <= 0 || port > 65535) missingOrInvalid.push('DB_PORT');
  if (!database) missingOrInvalid.push('DB_NAME');
  if (!user) missingOrInvalid.push('DB_USER');
  if (password === undefined || password === '') missingOrInvalid.push('DB_PASSWORD');

  if (missingOrInvalid.length > 0) {
    throw new Error(
      `Missing or invalid required production environment variable(s): ${missingOrInvalid.join(', ')}. Application aborted without creating or using any SQLite database.`
    );
  }
}

function sanitizeParams(params: unknown[] = []): Array<string | number | bigint | Buffer | null> {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'number') {
      return Number.isFinite(p) ? p : null;
    }
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'string' || typeof p === 'bigint' || Buffer.isBuffer(p)) return p;
    return JSON.stringify(p);
  });
}

export function parseJsonSafe<T>(raw: unknown, fallback?: T): T {
  if (raw === null || raw === undefined || raw === '') {
    return fallback as T;
  }
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

export function insertIgnoreKeyword(driver: DbDriver): 'INSERT OR IGNORE' | 'INSERT IGNORE' {
  return driver === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
}

export function buildUpsertSql(options: {
  driver: DbDriver;
  table: string;
  insertColumns: string[];
  conflictColumn: string;
  updateAssignments: Array<{ column: string; expr?: (excludedRef: string) => string }>;
}): string {
  const { driver, table, insertColumns, conflictColumn, updateAssignments } = options;
  const colsSql = insertColumns.join(', ');
  const placeholders = insertColumns.map(() => '?').join(', ');

  const updateClauses = updateAssignments.map(({ column, expr }) => {
    const rhs = driver === 'mysql' ? `VALUES(${column})` : `excluded.${column}`;
    return `${column} = ${expr ? expr(rhs) : rhs}`;
  });

  if (driver === 'mysql') {
    return `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}`;
  }

  return `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders}) ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updateClauses.join(', ')}`;
}

function assertSafeSqlIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return name;
}

export class SqliteDbAdapter implements DbAdapter {
  readonly driver: DbDriver = 'sqlite';
  readonly rawDb: SqliteDatabaseSync;
  private txChain: Promise<void> = Promise.resolve();

  constructor(rawDb: SqliteDatabaseSync) {
    this.rawDb = rawDb;
  }

  formatTimestamp(iso?: string): string {
    if (iso === undefined || iso === null || !iso.trim()) {
      return new Date().toISOString();
    }
    return validateAndNormalizeDateTime(iso, 'timestamp')!;
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.rawDb.prepare(sql).get(...sanitizeParams(params)) as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.rawDb.prepare(sql).all(...sanitizeParams(params)) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<DbRunResult> {
    const info = this.rawDb.prepare(sql).run(...sanitizeParams(params));
    return {
      changes: Number(info?.changes ?? 0),
      lastInsertRowid: info?.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : undefined,
    };
  }

  async exec(sql: string): Promise<void> {
    this.rawDb.exec(sql);
  }

  async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const runTx = async (): Promise<T> => {
      this.rawDb.exec('BEGIN IMMEDIATE;');
      try {
        const res = await fn(this);
        this.rawDb.exec('COMMIT;');
        return res;
      } catch (err) {
        try {
          this.rawDb.exec('ROLLBACK;');
        } catch {
          // ignore rollback error after primary failure
        }
        throw err;
      }
    };

    const previous = this.txChain;
    let release!: () => void;
    this.txChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await runTx();
    } finally {
      release();
    }
  }

  async ping(): Promise<void> {
    const row = await this.get<{ ok: number }>('SELECT 1 AS ok');
    if (!row || Number(row.ok) !== 1) {
      throw new Error('SQLite connectivity probe failed.');
    }
  }

  async tableExists(tableName: string): Promise<boolean> {
    const row = await this.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      [tableName]
    );
    return Boolean(row?.name);
  }

  async columnExists(tableName: string, columnName: string): Promise<boolean> {
    const safeTable = assertSafeSqlIdentifier(tableName);
    const cols = await this.all<{ name: string }>(`PRAGMA table_info(${safeTable})`);
    return cols.some((c) => c.name === columnName);
  }

  async close(): Promise<void> {
    try {
      this.rawDb.close();
    } catch {
      // ignore if already closed
    }
  }
}

export class MysqlDbAdapter implements DbAdapter {
  readonly driver: DbDriver = 'mysql';
  private pool: Pool;
  private usesDatetimeColumns = false;

  private constructor(pool: Pool, usesDatetimeColumns: boolean) {
    this.pool = pool;
    this.usesDatetimeColumns = usesDatetimeColumns;
  }

  static async create(config: MysqlConnectionConfig): Promise<MysqlDbAdapter> {
    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      timezone: 'Z',
      dateStrings: true,
    });

    try {
      await pool.query('SELECT 1 AS ok');
      const [colRows] = await pool.query<RowDataPacket[]>(
        `SELECT DATA_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('categories', 'products', 'customers', 'app_collections')
           AND COLUMN_NAME = 'updated_at'
         LIMIT 4`
      );
      const usesDatetime = colRows.some((r) => {
        const dt = String(r.DATA_TYPE || '').toLowerCase();
        return dt === 'datetime' || dt === 'timestamp';
      });
      return new MysqlDbAdapter(pool, usesDatetime);
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  formatTimestamp(iso?: string): string {
    if (this.usesDatetimeColumns) {
      return toMysqlDatetimeUtcStrict(iso, 'timestamp');
    }
    if (iso === undefined || iso === null || !iso.trim()) {
      return new Date().toISOString();
    }
    return validateAndNormalizeDateTime(iso, 'timestamp')!;
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, sanitizeParams(params));
    return rows[0] as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, sanitizeParams(params));
    return rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<DbRunResult> {
    const [result] = await this.pool.query<ResultSetHeader>(sql, sanitizeParams(params));
    return {
      changes: Number(result?.affectedRows ?? 0),
      lastInsertRowid: result?.insertId ? Number(result.insertId) : undefined,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const conn: PoolConnection = await this.pool.getConnection();
    const adapter = this;
    const txExecutor: DbExecutor = {
      driver: 'mysql',
      formatTimestamp(iso?: string): string {
        return adapter.formatTimestamp(iso);
      },
      async get<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R | undefined> {
        const [rows] = await conn.query<RowDataPacket[]>(sql, sanitizeParams(params));
        return rows[0] as R | undefined;
      },
      async all<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
        const [rows] = await conn.query<RowDataPacket[]>(sql, sanitizeParams(params));
        return rows as R[];
      },
      async run(sql: string, params: unknown[] = []): Promise<DbRunResult> {
        const [result] = await conn.query<ResultSetHeader>(sql, sanitizeParams(params));
        return {
          changes: Number(result?.affectedRows ?? 0),
          lastInsertRowid: result?.insertId ? Number(result.insertId) : undefined,
        };
      },
      async exec(sql: string): Promise<void> {
        await conn.query(sql);
      },
    };

    try {
      await conn.beginTransaction();
      const res = await fn(txExecutor);
      await conn.commit();
      return res;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failure after primary error
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  async ping(): Promise<void> {
    const row = await this.get<{ ok: number }>('SELECT 1 AS ok');
    if (!row || Number(row.ok) !== 1) {
      throw new Error('MySQL connectivity probe failed.');
    }
  }

  async tableExists(tableName: string): Promise<boolean> {
    const row = await this.get<{ TABLE_NAME: string }>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
      [tableName]
    );
    return Boolean(row?.TABLE_NAME);
  }

  async columnExists(tableName: string, columnName: string): Promise<boolean> {
    const row = await this.get<{ COLUMN_NAME: string }>(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
      [tableName, columnName]
    );
    return Boolean(row?.COLUMN_NAME);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
