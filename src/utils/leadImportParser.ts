import readXlsxFile, { readSheet } from 'read-excel-file/browser';
import type { CRMLead, CRMLeadStage, CRMSourceChannel } from '../types/index.ts';
import { normalizeDigits } from './crmEngine.ts';

export interface ParsedLeadDraft {
  rowNumber: number;
  leadName: string;
  phone: string;
  normalizedPhone: string;
  city?: string;
  source: CRMSourceChannel;
  interestedProductName?: string;
  estimatedValue: number;
  followUpDate?: string;
  createdAt?: string;
  notes?: string;
  email?: string;
  whatsapp?: string;
  stage: CRMLeadStage;
  isValid: boolean;
  errorReason?: string;
  isDuplicateInFile?: boolean;
  isExistingLead?: boolean;
  isExistingCustomer?: boolean;
}

export interface LeadImportParseResult {
  fileName: string;
  formatLabel: string;
  detectedHeaders: string[];
  rows: ParsedLeadDraft[];
  warnings: string[];
}

const ALLOWED_SOURCES: CRMSourceChannel[] = [
  'WhatsApp',
  'Website',
  'Facebook',
  'Instagram',
  'Walk-in',
  'Phone',
  'Referral',
  'Reseller Network',
];

const ALLOWED_STAGES: CRMLeadStage[] = [
  'New',
  'Contacted',
  'Interested',
  'Follow-up',
  'Converted',
  'Lost',
];

export function normalizeLeadSource(raw: unknown, fallback: CRMSourceChannel): CRMSourceChannel {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return fallback;
  const exact = ALLOWED_SOURCES.find((ch) => ch.toLowerCase() === s);
  if (exact) return exact;
  if (s.includes('wa') || s.includes('whats')) return 'WhatsApp';
  if (s.includes('web') || s.includes('site') || s.includes('madina')) return 'Website';
  if (s.includes('fb') || s.includes('face')) return 'Facebook';
  if (s.includes('ig') || s.includes('insta')) return 'Instagram';
  if (s.includes('walk') || s.includes('shop') || s.includes('store')) return 'Walk-in';
  if (s.includes('call') || s.includes('phone') || s.includes('tel')) return 'Phone';
  if (s.includes('ref')) return 'Referral';
  if (s.includes('resell')) return 'Reseller Network';
  return fallback;
}

export function normalizeLeadStage(raw: unknown, fallback: CRMLeadStage): CRMLeadStage {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return fallback;
  const exact = ALLOWED_STAGES.find((st) => st.toLowerCase() === s);
  if (exact) return exact;
  if (s.includes('contact')) return 'Contacted';
  if (s.includes('interest') || s.includes('warm') || s.includes('hot')) return 'Interested';
  if (s.includes('follow')) return 'Follow-up';
  if (s.includes('convert') || s.includes('won') || s.includes('cust')) return 'Converted';
  if (s.includes('lost') || s.includes('dead') || s.includes('cancel')) return 'Lost';
  return fallback;
}

function normalizePhoneCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const numStr = Math.trunc(raw).toString();
    // Pakistani mobile numbers exported from Excel as numbers lose leading 0 (e.g. 3001234567 -> 03001234567)
    if (/^3\d{9}$/.test(numStr)) return `0${numStr}`;
    if (/^923\d{9}$/.test(numStr)) return `0${numStr.slice(2)}`;
    return numStr;
  }
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return `0${digits}`;
  return str;
}

function parseNumberCell(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  const cleaned = String(raw || '')
    .replace(/rs\.?|pkr|,/gi, '')
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function isValidCalendarDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function parseDateCellStrict(
  raw: unknown,
  mode: 'dateOnly' | 'datetime' = 'dateOnly'
): { value?: string; invalidRaw?: string } {
  if (raw === null || raw === undefined || raw === '') return {};
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return { invalidRaw: 'Invalid Date' };
    }
    const iso = raw.toISOString();
    return { value: mode === 'dateOnly' ? iso.slice(0, 10) : iso };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Support Excel numeric serial dates (days since 1899-12-30)
    if (raw >= 25569 && raw <= 80000) {
      const utcMs = Math.round((raw - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        return { value: mode === 'dateOnly' ? iso.slice(0, 10) : iso };
      }
    }
    return { invalidRaw: String(raw) };
  }
  const str = String(raw).trim();
  if (!str) return {};

  // Strict ISO YYYY-MM-DD or YYYY/MM/DD
  const ymdOnly = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(str);
  if (ymdOnly) {
    const year = Number(ymdOnly[1]);
    const month = Number(ymdOnly[2]);
    const day = Number(ymdOnly[3]);
    if (!isValidCalendarDateParts(year, month, day)) {
      return { invalidRaw: str };
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return { value: `${year}-${mm}-${dd}` };
  }

  // Strict DD/MM/YYYY, DD-MM-YYYY, or unambiguous MM/DD/YYYY from Excel exports
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(str);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const year = Number(dmy[3]);
    let day = first;
    let month = second;
    if (second > 12 && first >= 1 && first <= 12) {
      // Unambiguous MM/DD/YYYY (e.g. 11/28/2026)
      month = first;
      day = second;
    }
    if (!isValidCalendarDateParts(year, month, day)) {
      return { invalidRaw: str };
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return { value: `${year}-${mm}-${dd}` };
  }

  // Full ISO datetime / timestamp with calendar verification
  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(str);
  if (isoPrefix) {
    const year = Number(isoPrefix[1]);
    const month = Number(isoPrefix[2]);
    const day = Number(isoPrefix[3]);
    if (!isValidCalendarDateParts(year, month, day)) {
      return { invalidRaw: str };
    }
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) {
    return { invalidRaw: str };
  }
  const iso = parsed.toISOString();
  return { value: mode === 'dateOnly' ? iso.slice(0, 10) : iso };
}

function looksLikePhone(val: string): boolean {
  const digits = val.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && !/[a-zA-Z]{3,}/.test(val);
}

function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

type CanonicalLeadField =
  | 'leadName'
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'city'
  | 'source'
  | 'interestedProductName'
  | 'estimatedValue'
  | 'followUpDate'
  | 'createdAt'
  | 'notes'
  | 'stage';

const HEADER_ALIASES: Record<CanonicalLeadField, string[]> = {
  leadName: ['leadname', 'name', 'fullname', 'customername', 'customer', 'prospect', 'contactname', 'client'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'cell', 'contact', 'contactno', 'tel', 'telephone', 'number'],
  whatsapp: ['whatsapp', 'wa', 'whatsappno', 'whatsappnumber'],
  email: ['email', 'emailaddress', 'mail'],
  city: ['city', 'location', 'area', 'town', 'address', 'region'],
  source: ['source', 'sourcechannel', 'channel', 'leadsource', 'platform', 'origin'],
  interestedProductName: ['product', 'interestedproduct', 'interestedproductname', 'item', 'productname', 'interest', 'category'],
  estimatedValue: ['estimatedvalue', 'estvalue', 'value', 'amount', 'price', 'budget', 'pkr', 'total'],
  followUpDate: ['followupdate', 'followup', 'nextfollowup', 'callbackdate', 'date'],
  createdAt: ['createdat', 'createddate', 'leadcreatedat', 'entrydate', 'dateadded'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'details', 'description', 'message'],
  stage: ['stage', 'status', 'leadstage', 'pipeline'],
};

function mapHeaderToField(header: string): CanonicalLeadField | null {
  const key = normalizeHeaderKey(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[CanonicalLeadField, string[]]>) {
    if (aliases.includes(key)) return field;
  }
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[CanonicalLeadField, string[]]>) {
    if (aliases.some((alias) => key.includes(alias) && alias.length >= 4)) return field;
  }
  return null;
}

function detectDelimiter(lines: string[]): '\t' | ',' | ';' | '|' | ' - ' {
  const sample = lines.slice(0, 10);
  const candidates: Array<'\t' | ',' | ';' | '|'> = ['\t', ',', ';', '|'];
  let bestDelim: '\t' | ',' | ';' | '|' = ',';
  let bestScore = 0;

  for (const delim of candidates) {
    let totalSplits = 0;
    let multiColLines = 0;
    for (const line of sample) {
      const count = line.split(delim).length - 1;
      if (count > 0) {
        multiColLines++;
        totalSplits += count;
      }
    }
    const score = multiColLines * 10 + totalSplits;
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }

  if (bestScore === 0) {
    const dashLines = sample.filter((l) => /\s-\s/.test(l)).length;
    if (dashLines > 0) return ' - ';
  }

  return bestDelim;
}

function parseDelimitedLine(line: string, delim: string): string[] {
  if (delim === ' - ') {
    return line.split(/\s+-\s+/).map((cell) => cell.trim());
  }
  if (delim !== ',') {
    return line.split(delim).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));
  }

  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvOrNotepadTextToMatrix(rawText: string): string[][] {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const rawLines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  if (rawLines.length === 0) return [];

  // Support Notepad "Name: Ali | Phone: 0300..." or multi-line "Name: ...\nPhone: ..." if no table delimiter
  const hasKeyValBlocks = rawLines.some((l) => /^(lead\s*name|name|phone|mobile)\s*:/i.test(l));
  if (hasKeyValBlocks && !rawLines[0].includes(',') && !rawLines[0].includes('\t') && !rawLines[0].includes('|')) {
    const records: Array<Record<string, string>> = [];
    let currentRec: Record<string, string> = {};
    const pushCurrent = () => {
      if (Object.keys(currentRec).length > 0) {
        records.push(currentRec);
        currentRec = {};
      }
    };
    for (const line of rawLines) {
      if (/^[-=_]{3,}$/.test(line)) {
        pushCurrent();
        continue;
      }
      const m = line.match(/^([^:]{2,30}):\s*(.+)$/);
      if (m) {
        const field = mapHeaderToField(m[1]);
        const key = field || normalizeHeaderKey(m[1]);
        if (field === 'leadName' && currentRec.leadName) {
          pushCurrent();
        }
        currentRec[key] = m[2].trim();
      }
    }
    pushCurrent();
    if (records.length > 0) {
      const headers = ['leadName', 'phone', 'city', 'source', 'interestedProductName', 'estimatedValue', 'notes', 'stage'];
      return [
        headers,
        ...records.map((rec) => headers.map((h) => rec[h] || '')),
      ];
    }
  }

  const delim = detectDelimiter(rawLines);
  return rawLines.map((line) => {
    const cells = parseDelimitedLine(line, delim);
    if (cells.length === 1 && delim !== ' - ' && /\s+-\s+/.test(line)) {
      return parseDelimitedLine(line, ' - ');
    }
    return cells;
  });
}

function parseHtmlTableToMatrix(html: string): string[][] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('table tr'));
  if (rows.length === 0) return [];
  return rows
    .map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((cell) => (cell.textContent || '').trim())
    )
    .filter((row) => row.some((c) => c.length > 0));
}

export function matrixToLeadDrafts(
  matrix: unknown[][],
  options: {
    defaultSource: CRMSourceChannel;
    defaultStage: CRMLeadStage;
    existingLeads?: CRMLead[];
    existingCustomerPhones?: Set<string>;
  }
): { detectedHeaders: string[]; rows: ParsedLeadDraft[]; warnings: string[] } {
  const warnings: string[] = [];
  const nonEmptyRows = matrix.filter((row) =>
    Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
  );

  if (nonEmptyRows.length === 0) {
    return { detectedHeaders: [], rows: [], warnings: ['The uploaded file has no data rows.'] };
  }

  // Detect whether row 0 is a header row
  const firstRowStrings = nonEmptyRows[0].map((c) => String(c ?? '').trim());
  const mappedHeaders = firstRowStrings.map(mapHeaderToField);
  const headerHitCount = mappedHeaders.filter(Boolean).length;
  const firstRowHasPhone = firstRowStrings.some((cell) => looksLikePhone(cell));
  const hasHeaderRow = headerHitCount >= 2 || (headerHitCount >= 1 && !firstRowHasPhone);

  const detectedHeaders = hasHeaderRow ? firstRowStrings : [];
  const dataRows = hasHeaderRow ? nonEmptyRows.slice(1) : nonEmptyRows;
  const startRowNumber = hasHeaderRow ? 2 : 1;

  if (!hasHeaderRow) {
    warnings.push(
      'No column header row detected — auto-mapped columns by Phone & Name pattern (expected order: Name, Phone, City, Source, Product, Value, Notes).'
    );
  }

  const existingLeadPhones = new Set(
    (options.existingLeads || []).map((l) => normalizeDigits(l.phone)).filter((d) => d.length >= 7)
  );
  const seenFilePhones = new Set<string>();

  const rows: ParsedLeadDraft[] = dataRows.map((rawRow, idx) => {
    const rowNumber = startRowNumber + idx;
    const cells = rawRow;
    const mapped: Partial<Record<CanonicalLeadField, unknown>> = {};

    if (hasHeaderRow) {
      mappedHeaders.forEach((field, colIdx) => {
        if (!field) return;
        const val = cells[colIdx];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          mapped[field] = val;
        }
      });
    } else {
      // Headerless Notepad / CSV smart inference per row
      const strCells = cells.map((c) => String(c ?? '').trim());
      const phoneIdx = strCells.findIndex((c) => looksLikePhone(c));
      if (phoneIdx !== -1) {
        mapped.phone = cells[phoneIdx];
        const remaining = strCells
          .map((val, colIdx) => ({ val, colIdx }))
          .filter((item) => item.colIdx !== phoneIdx && item.val.length > 0);
        if (remaining[0]) mapped.leadName = remaining[0].val;
        if (remaining[1]) mapped.city = remaining[1].val;
        if (remaining[2]) {
          const maybeSource = normalizeLeadSource(remaining[2].val, options.defaultSource);
          if (
            ALLOWED_SOURCES.some((s) => s.toLowerCase() === remaining[2].val.toLowerCase()) ||
            /whats|fb|face|insta|web|walk|call|phone|ref/i.test(remaining[2].val)
          ) {
            mapped.source = maybeSource;
          } else {
            mapped.interestedProductName = remaining[2].val;
          }
        }
        if (remaining[3]) {
          const maybeNum = parseNumberCell(remaining[3].val);
          if (maybeNum > 0 && /^\d[\d,\s.]*$/.test(remaining[3].val.replace(/rs\.?|pkr/gi, '').trim())) {
            mapped.estimatedValue = maybeNum;
          } else if (!mapped.interestedProductName) {
            mapped.interestedProductName = remaining[3].val;
          } else {
            mapped.notes = remaining[3].val;
          }
        }
        if (remaining.length > 4) {
          const tail = remaining
            .slice(4)
            .map((r) => r.val)
            .join(' | ');
          mapped.notes = [mapped.notes ? String(mapped.notes) : '', tail].filter(Boolean).join(' | ');
        }
      } else {
        mapped.leadName = strCells[0] || '';
        mapped.phone = strCells[1] || '';
      }
    }

    const rawLeadName = String(mapped.leadName ?? '').trim();
    const phone = normalizePhoneCell(mapped.phone ?? mapped.whatsapp);
    const normalizedPhone = normalizeDigits(phone);
    const leadName = rawLeadName || (normalizedPhone.length >= 7 ? `WhatsApp Contact (${normalizedPhone.slice(-4)})` : '');
    const whatsapp = mapped.whatsapp ? normalizePhoneCell(mapped.whatsapp) : undefined;
    const email = mapped.email ? String(mapped.email).trim() : undefined;
    const city = mapped.city ? String(mapped.city).trim() : undefined;
    const source = normalizeLeadSource(mapped.source, options.defaultSource);
    const stage = normalizeLeadStage(mapped.stage, options.defaultStage);
    const interestedProductName = mapped.interestedProductName
      ? String(mapped.interestedProductName).trim()
      : undefined;
    const estimatedValue = parseNumberCell(mapped.estimatedValue);
    const followUpParsed = parseDateCellStrict(mapped.followUpDate, 'dateOnly');
    const createdAtParsed = parseDateCellStrict(mapped.createdAt, 'datetime');
    const followUpDate = followUpParsed.value;
    const createdAt = createdAtParsed.value;
    const notes = mapped.notes ? String(mapped.notes).trim() : undefined;

    let isValid = true;
    let errorReason: string | undefined;
    if (!leadName && normalizedPhone.length < 7) {
      isValid = false;
      errorReason = 'Missing phone number';
    } else if (normalizedPhone.length < 7) {
      isValid = false;
      errorReason = 'Missing or invalid phone number';
    } else if (followUpParsed.invalidRaw) {
      isValid = false;
      errorReason = `Invalid follow-up date: "${followUpParsed.invalidRaw}"`;
    } else if (createdAtParsed.invalidRaw) {
      isValid = false;
      errorReason = `Invalid created date: "${createdAtParsed.invalidRaw}"`;
    }

    const isDuplicateInFile = Boolean(normalizedPhone.length >= 7 && seenFilePhones.has(normalizedPhone));
    if (isValid && normalizedPhone.length >= 7) {
      seenFilePhones.add(normalizedPhone);
    }

    const isExistingLead = Boolean(normalizedPhone.length >= 7 && existingLeadPhones.has(normalizedPhone));
    const isExistingCustomer = Boolean(
      normalizedPhone.length >= 7 && options.existingCustomerPhones?.has(normalizedPhone)
    );

    return {
      rowNumber,
      leadName,
      phone,
      normalizedPhone,
      city,
      source,
      interestedProductName,
      estimatedValue,
      followUpDate,
      createdAt,
      notes,
      email,
      whatsapp,
      stage,
      isValid,
      errorReason,
      isDuplicateInFile,
      isExistingLead,
      isExistingCustomer,
    };
  });

  return { detectedHeaders, rows, warnings };
}

export async function parseLeadUploadFile(
  file: File,
  options: {
    defaultSource: CRMSourceChannel;
    defaultStage: CRMLeadStage;
    existingLeads?: CRMLead[];
    existingCustomerPhones?: Set<string>;
  }
): Promise<LeadImportParseResult> {
  const fileName = file.name || 'leads-upload';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (ext === 'xlsx') {
    let sheetData: unknown[][] = [];
    try {
      const sheets = await readXlsxFile(file);
      const bestSheet = [...sheets].sort((a, b) => (b.data?.length || 0) - (a.data?.length || 0))[0];
      sheetData = bestSheet?.data || [];
    } catch {
      sheetData = await readSheet(file);
    }
    const parsed = matrixToLeadDrafts(sheetData, options);
    return {
      fileName,
      formatLabel: 'Excel (.xlsx)',
      ...parsed,
    };
  }

  if (ext === 'xls') {
    const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isZip = headerBytes[0] === 0x50 && headerBytes[1] === 0x4b;
    const isOle2 =
      headerBytes[0] === 0xd0 &&
      headerBytes[1] === 0xcf &&
      headerBytes[2] === 0x11 &&
      headerBytes[3] === 0xe0;

    if (isZip) {
      let sheetData: unknown[][] = [];
      try {
        const sheets = await readXlsxFile(file);
        const bestSheet = [...sheets].sort((a, b) => (b.data?.length || 0) - (a.data?.length || 0))[0];
        sheetData = bestSheet?.data || [];
      } catch {
        sheetData = await readSheet(file);
      }
      const parsed = matrixToLeadDrafts(sheetData, options);
      return {
        fileName,
        formatLabel: 'Excel (.xls / OOXML)',
        ...parsed,
      };
    }

    if (isOle2) {
      return {
        fileName,
        formatLabel: 'Legacy Binary Excel (.xls)',
        detectedHeaders: [],
        rows: [],
        warnings: [
          'This file is a legacy binary Excel 97-2003 (.xls) workbook. Please open it in Excel and choose "Save As -> Excel Workbook (.xlsx)" or "CSV (.csv)" and upload again.',
        ],
      };
    }

    const text = await file.text();
    const isHtml = /<table[\s>]/i.test(text);
    const matrix = isHtml ? parseHtmlTableToMatrix(text) : parseCsvOrNotepadTextToMatrix(text);
    const parsed = matrixToLeadDrafts(matrix, options);
    return {
      fileName,
      formatLabel: isHtml ? 'Excel Table (.xls)' : 'Excel Text (.xls)',
      ...parsed,
    };
  }

  // .csv, .tsv, .txt (Notepad) or plain text files
  const text = await file.text();
  const matrix = parseCsvOrNotepadTextToMatrix(text);
  const parsed = matrixToLeadDrafts(matrix, options);
  return {
    fileName,
    formatLabel: ext === 'txt' ? 'Notepad (.txt)' : ext === 'tsv' ? 'Tab-Separated (.tsv)' : 'CSV (.csv)',
    ...parsed,
  };
}

export function buildSampleLeadsCsv(): string {
  return [
    'Lead Name,Phone,City,Source,Interested Product,Estimated Value,Follow-up Date,Stage,Notes',
    'Ali Raza,03001234567,Muzaffarabad,WhatsApp,Smart Watch Ultra,4500,2026-11-28,New,Asked for COD delivery charges',
    'Sara Bibi,03125556677,Rawalpindi,Facebook,Bridal Cosmetics Bundle,8200,2026-11-29,Interested,Wants wholesale rate for 3 packs',
    'Usman Tariq,03339876543,Lahore,Instagram,Kitchen Blender Pro,6900,,Contacted,Call after 5 PM',
  ].join('\r\n');
}

export function buildSampleLeadsTxt(): string {
  return [
    '# 100DAGAR Notepad Lead Import Format (Comma, Tab, Pipe |, or Dash - supported)',
    'Name | Phone | City | Source | Product | Value | Notes',
    'Ali Raza | 03001234567 | Muzaffarabad | WhatsApp | Smart Watch Ultra | 4500 | COD inquiry',
    'Sara Bibi | 03125556677 | Rawalpindi | Facebook | Bridal Cosmetics Bundle | 8200 | Wholesale pack',
    'Usman Tariq | 03339876543 | Lahore | Phone | Kitchen Blender Pro | 6900 | Evening call back',
  ].join('\r\n');
}
