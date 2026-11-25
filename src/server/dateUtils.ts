export class DateValidationError extends Error {
  readonly statusCode = 400;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'DateValidationError';
    this.field = field;
  }
}

export function isDateValidationError(err: unknown): err is DateValidationError {
  return err instanceof DateValidationError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'DateValidationError');
}

function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Validates and normalizes an incoming date/datetime value into a canonical UTC ISO 8601 string.
 * - Returns undefined when input is undefined, null, or empty/whitespace.
 * - Accepts valid YYYY-MM-DD, MySQL DATETIME (YYYY-MM-DD HH:MM:SS), ISO 8601 strings, or Date objects.
 * - Throws DateValidationError (HTTP 400) for malformed strings or impossible calendar dates (e.g. 2025-02-30).
 */
export function validateAndNormalizeDateTime(value: unknown, fieldName = 'date'): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DateValidationError(`Invalid Date object for "${fieldName}".`, fieldName);
    }
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    throw new DateValidationError(`Invalid date type for "${fieldName}". Expected ISO 8601 or YYYY-MM-DD string.`, fieldName);
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Date-only: YYYY-MM-DD
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (!isValidCalendarYmd(year, month, day)) {
      throw new DateValidationError(`Invalid calendar date for "${fieldName}": "${trimmed}".`, fieldName);
    }
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00.000Z`;
  }

  // MySQL DATETIME: YYYY-MM-DD HH:MM:SS(.ffffff)?
  const mysqlMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
  if (mysqlMatch) {
    const year = Number(mysqlMatch[1]);
    const month = Number(mysqlMatch[2]);
    const day = Number(mysqlMatch[3]);
    const hour = Number(mysqlMatch[4]);
    const minute = Number(mysqlMatch[5]);
    const second = Number(mysqlMatch[6]);
    const msStr = (mysqlMatch[7] || '0').slice(0, 3).padEnd(3, '0');
    if (
      !isValidCalendarYmd(year, month, day) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      throw new DateValidationError(`Invalid datetime value for "${fieldName}": "${trimmed}".`, fieldName);
    }
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, Number(msStr))).toISOString();
  }

  // Strict ISO 8601 with timezone / offset validation (prevents silent calendar rollover)
  const isoPrefixMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i);
  if (isoPrefixMatch) {
    const year = Number(isoPrefixMatch[1]);
    const month = Number(isoPrefixMatch[2]);
    const day = Number(isoPrefixMatch[3]);
    const hour = Number(isoPrefixMatch[4]);
    const minute = Number(isoPrefixMatch[5]);
    const second = Number(isoPrefixMatch[6] || '0');
    if (
      !isValidCalendarYmd(year, month, day) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      throw new DateValidationError(`Invalid ISO datetime value for "${fieldName}": "${trimmed}".`, fieldName);
    }
    const normalizedInput = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
    const parsed = new Date(normalizedInput);
    if (Number.isNaN(parsed.getTime())) {
      throw new DateValidationError(`Invalid ISO datetime value for "${fieldName}": "${trimmed}".`, fieldName);
    }
    return parsed.toISOString();
  }

  // Reject purely numeric garbage or short nonsense before falling back to Date.parse
  if (!/[a-zA-Z]/.test(trimmed) && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) {
    throw new DateValidationError(`Invalid date format for "${fieldName}": "${trimmed}".`, fieldName);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new DateValidationError(`Invalid date format for "${fieldName}": "${trimmed}".`, fieldName);
  }
  const year = parsed.getUTCFullYear();
  if (year < 1970 || year > 2100) {
    throw new DateValidationError(`Date out of supported range for "${fieldName}": "${trimmed}".`, fieldName);
  }
  return parsed.toISOString();
}

/**
 * Validates and normalizes a date-only field (YYYY-MM-DD).
 * Rejects malformed strings with DateValidationError instead of defaulting to today's date.
 */
export function validateAndNormalizeDateOnly(value: unknown, fieldName = 'date'): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      validateAndNormalizeDateTime(trimmed, fieldName);
      return trimmed;
    }
  }
  const iso = validateAndNormalizeDateTime(value, fieldName);
  return iso ? iso.slice(0, 10) : undefined;
}

/**
 * Converts a valid ISO/date string to MySQL UTC DATETIME format ('YYYY-MM-DD HH:MM:SS').
 * Throws DateValidationError if a non-empty invalid value is provided.
 */
export function toMysqlDatetimeUtcStrict(iso?: unknown, fieldName = 'timestamp'): string {
  if (iso === undefined || iso === null || (typeof iso === 'string' && !iso.trim())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  const normalized = validateAndNormalizeDateTime(iso, fieldName)!;
  return normalized.slice(0, 19).replace('T', ' ');
}

/**
 * Normalizes a date read back from SQLite or MySQL (handles 'YYYY-MM-DD HH:MM:SS' and ISO).
 */
export function normalizeStoredDateValue(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
  }
  const str = String(raw).trim();
  if (!str) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const mysqlMatch = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/);
  if (mysqlMatch) {
    return `${mysqlMatch[1]}T${mysqlMatch[2]}.000Z`;
  }
  return str;
}

/**
 * Preserves immutable createdAt across updates/imports:
 * - Always validates incomingCreatedAt first (rejects invalid dates with HTTP 400).
 * - If existingCreatedAt exists and is valid, returns existingCreatedAt unchanged.
 * - Otherwise uses valid incomingCreatedAt, falling back to fallbackIso only when no date was supplied.
 */
export function resolvePreservedCreatedAt(params: {
  existingCreatedAt?: unknown;
  incomingCreatedAt?: unknown;
  fallbackIso: string;
  fieldName?: string;
}): string {
  const fieldName = params.fieldName || 'createdAt';
  const validIncoming = validateAndNormalizeDateTime(params.incomingCreatedAt, fieldName);
  const existingNorm = normalizeStoredDateValue(params.existingCreatedAt);
  if (existingNorm) {
    // Preserve exact stored representation if valid (including YYYY-MM-DD or ISO timestamp)
    try {
      validateAndNormalizeDateTime(existingNorm, fieldName);
      return existingNorm;
    } catch {
      // Only fall back if legacy stored value itself was corrupt
    }
  }
  return validIncoming || params.fallbackIso;
}

/**
 * Determines updatedAt strictly:
 * - Validates incomingUpdatedAt if present.
 * - For new records: preserves valid incomingUpdatedAt, otherwise defaults to createdAtIso.
 * - For existing records: returns nowIso ONLY when the record was actually edited (hasChanges === true),
 *   otherwise keeps existingUpdatedAt unchanged.
 */
export function resolveUpdatedAt(params: {
  isNew: boolean;
  hasChanges: boolean;
  existingUpdatedAt?: unknown;
  incomingUpdatedAt?: unknown;
  createdAtValue: string;
  nowIso: string;
}): string {
  const validIncoming = validateAndNormalizeDateTime(params.incomingUpdatedAt, 'updatedAt');
  const existingNorm = normalizeStoredDateValue(params.existingUpdatedAt);

  if (params.isNew) {
    return validIncoming || params.createdAtValue || params.nowIso;
  }
  if (params.hasChanges) {
    return params.nowIso;
  }
  return existingNorm || validIncoming || params.createdAtValue || params.nowIso;
}

/**
 * Merges an incoming partial object onto an existing persisted record without erasing omitted fields.
 */
export function mergePreservingOmittedFields<T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: Partial<T>
): T {
  if (!existing) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (v !== undefined) clean[k] = v;
    }
    return clean as T;
  }
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  return merged as T;
}

/**
 * Checks whether an updated payload actually changed any non-timestamp field compared to existing.
 */
export function hasRecordContentChanges(
  existing: Record<string, unknown> | undefined,
  candidate: Record<string, unknown>,
  ignoredKeys: string[] = ['createdAt', 'updatedAt']
): boolean {
  if (!existing) return true;
  const ignore = new Set(ignoredKeys);
  const allKeys = new Set([...Object.keys(existing), ...Object.keys(candidate)]);
  for (const key of allKeys) {
    if (ignore.has(key)) continue;
    const prev = existing[key];
    const next = candidate[key];
    if (prev === next) continue;
    if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) {
      return true;
    }
  }
  return false;
}
