import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CategoryRecord, ProductItem, ProductSizeChart, ProductSizeChartRow, ProductVariation } from '../types';
import { normalizeTextKey, UPCOMING_CATEGORY_ID } from '../utils/locationCategoryHelpers';

export const IMPORTED_MEDIA_DIR = path.resolve(process.cwd(), 'data', 'imported-media');
fs.mkdirSync(IMPORTED_MEDIA_DIR, { recursive: true });

export interface ScrapeDiagnostics {
  strategiesUsed: string[];
  currencyDetected: string;
  originalPriceText?: string;
  imagesFound: number;
  imagesDownloaded?: number;
  specsFound: number;
  featuresFound: number;
  variantsFound: number;
  videoFound: boolean;
}

export interface ScrapeProductResult {
  product: ProductItem;
  diagnostics: ScrapeDiagnostics;
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '—',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  bull: '•',
  raquo: '»',
  laquo: '«',
  times: '×',
  hellip: '...',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITY_MAP[name.toLowerCase()] ?? m);
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatStructuredDescriptionFromHtml(html: string): string {
  if (!html) return '';
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<table[\s\S]*?<\/table>/gi, '\n')
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `\n\n${inner.replace(/<[^>]+>/g, ' ').trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n• ${inner.replace(/<[^>]+>/g, ' ').trim()}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(cleaned)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBalancedElementInnerHtml(
  html: string,
  tagName: 'div' | 'section' | 'article',
  openAttrPattern: RegExp
): string | null {
  const openRegex = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  const tokenRegex = new RegExp(`<(\\/?)${tagName}\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    const attrText = match[1] || '';
    if (!openAttrPattern.test(attrText)) continue;
    const contentStart = match.index + match[0].length;
    tokenRegex.lastIndex = contentStart;
    let depth = 1;
    let tok: RegExpExecArray | null;
    while ((tok = tokenRegex.exec(html)) !== null) {
      if (tok[1] === '/') {
        depth--;
        if (depth === 0) {
          const inner = html.slice(contentStart, tok.index);
          if (stripHtmlTags(inner).length >= 30) {
            return inner;
          }
          break;
        }
      } else {
        depth++;
      }
      if (tok.index - contentStart > 60000) break;
    }
  }
  return null;
}

function cleanSpecLabel(raw: string): string {
  const cleaned = decodeHtmlEntities(raw)
    .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D\s]+/gu, '')
    .replace(/:$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^[a-z]/i.test(cleaned) && cleaned === cleaned.toLowerCase()) {
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return cleaned;
}

function isBlockedHostOrIp(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const ipType = net.isIP(lower);
  if (ipType === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  } else if (ipType === 6) {
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

function resolveAbsoluteUrl(candidate: string | undefined | null, baseUrl: string): string | null {
  if (!candidate) return null;
  let cleaned = decodeHtmlEntities(String(candidate)).trim();
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('javascript:')) return null;
  if (/\{width\}|%7Bwidth%7D/i.test(cleaned)) {
    cleaned = cleaned.replace(/\{width\}|%7Bwidth%7D/gi, '1200');
  }
  if (/\{height\}|%7Bheight%7D/i.test(cleaned)) {
    cleaned = cleaned.replace(/\{height\}|%7Bheight%7D/gi, '1200');
  }
  if (cleaned.startsWith('//')) cleaned = `https:${cleaned}`;
  try {
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

export function upgradeProductImageUrl(rawUrl: string): string {
  try {
    let url = rawUrl
      .replace(/\{width\}|%7Bwidth%7D/gi, '1200')
      .replace(/\{height\}|%7Bheight%7D/gi, '1200');

    // Upgrade Shopify small thumbnail filenames to full/high-res
    url = url.replace(
      /_(pico|icon|thumb|small|compact|medium)(_crop_center)?(\.(?:jpe?g|png|webp|gif))(\?.*)?$/i,
      '$3$4'
    );
    // Upgrade Shopify _120x120.jpg or _300x.png (<450px) to _1200x
    url = url.replace(
      /_(\d{1,3})x(\d{0,3})(_crop_[a-z]+)?(\.(?:jpe?g|png|webp|gif))(\?.*)?$/i,
      (full, wStr, _hStr, _crop, ext, qs = '') => {
        const w = parseInt(wStr, 10);
        return w > 0 && w < 450 ? `${ext}${qs}` : full;
      }
    );
    // Upgrade WordPress -150x150.jpg / -300x300.png thumbnails to original image
    url = url.replace(
      /-(?:1[0-9]{2}|2[0-9]{2}|300)x(?:1[0-9]{2}|2[0-9]{2}|300)(\.(?:jpe?g|png|webp|gif))(\?.*)?$/i,
      '$1$2'
    );

    const parsed = new URL(url);
    for (const key of ['width', 'w']) {
      const val = parsed.searchParams.get(key);
      if (val && /^\d+$/.test(val) && Number(val) > 0 && Number(val) < 500) {
        parsed.searchParams.set(key, '1200');
      }
    }
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

function detectImageMagicExt(buf: Buffer, contentType: string): string | null {
  if (!buf || buf.length < 250 || buf.length > 5 * 1024 * 1024) return null;
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('svg') || ct.includes('text/html') || ct.includes('application/json')) {
    return null;
  }
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WEBP
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  // AVIF / HEIC ftyp box
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase();
    if (brand.startsWith('avi') || brand.startsWith('hei') || brand.startsWith('mif')) {
      return brand.startsWith('hei') ? 'heic' : 'avif';
    }
  }
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';

  // Fallback to explicit raster Content-Type header (excluding SVG)
  if (ct.startsWith('image/')) {
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
    if (ct.includes('png')) return 'png';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('gif')) return 'gif';
    if (ct.includes('avif')) return 'avif';
  }
  return null;
}

async function fetchImageBuffer(targetUrl: string, referer?: string): Promise<{ buf: Buffer; ext: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (isBlockedHostOrIp(parsed.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) {
      try {
        headers['Referer'] = new URL(referer).origin + '/';
      } catch {
        // ignore invalid referer
      }
    }
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const ext = detectImageMagicExt(buf, contentType);
    if (!ext) return null;
    return { buf, ext };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadAndCacheExternalImage(
  remoteUrl: string,
  referer?: string
): Promise<{ localUrl: string; downloaded: boolean }> {
  const trimmed = (remoteUrl || '').trim();
  if (!trimmed) return { localUrl: '', downloaded: false };
  if (trimmed.startsWith('/api/media/imported/') || trimmed.startsWith('data:image/')) {
    return { localUrl: trimmed, downloaded: false };
  }

  const upgraded = upgradeProductImageUrl(trimmed);
  let result = await fetchImageBuffer(upgraded, referer);
  if (!result && upgraded !== trimmed) {
    result = await fetchImageBuffer(trimmed, referer);
  }

  if (!result) {
    return { localUrl: upgraded, downloaded: false };
  }

  const hash = crypto.createHash('sha256').update(result.buf).digest('hex').slice(0, 16);
  const fileName = `${hash}.${result.ext}`;
  const filePath = path.join(IMPORTED_MEDIA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, result.buf);
  }
  return { localUrl: `/api/media/imported/${fileName}`, downloaded: true };
}

function isLikelyProductImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('.svg?') || lower.includes('favicon')) return false;
  const blockedPatterns = [
    'logo',
    'sprite',
    'avatar',
    'placeholder',
    'spinner',
    'loader',
    'payment-icon',
    'visa-icon',
    'mastercard-icon',
    'jazzcash-logo',
    'easypaisa-logo',
    'whatsapp-icon',
    '1x1',
    'pixel.',
    'analytics',
  ];
  return !blockedPatterns.some((p) => lower.includes(p));
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeHtmlEntities(val);
  }
  return attrs;
}

function parseNumericPrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!cleaned) return null;
  const num = Number(cleaned[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function convertToPkrIfForeign(amount: number, currency: string): number {
  const cur = currency.toUpperCase();
  if (cur === 'USD' || cur === '$') return Math.round(amount * 278);
  if (cur === 'EUR' || cur === '€') return Math.round(amount * 300);
  if (cur === 'GBP' || cur === '£') return Math.round(amount * 350);
  if (cur === 'AED') return Math.round(amount * 76);
  if (cur === 'SAR') return Math.round(amount * 74);
  if (cur === 'CNY' || cur === 'RMB' || cur === '¥') return Math.round(amount * 39);
  return Math.round(amount);
}

function detectCurrencyFromText(text: string): string {
  if (/\bPKR\b|\bRs\.?\s*\d/i.test(text)) return 'PKR';
  if (/\bAED\b/i.test(text)) return 'AED';
  if (/\bSAR\b/i.test(text)) return 'SAR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/\$\s*\d|\bUSD\b/i.test(text)) return 'USD';
  return 'PKR';
}

function pickBestSrcFromSrcset(srcset: string, baseUrl: string): string | null {
  const parts = srcset
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const resolved = resolveAbsoluteUrl(tokens[0], baseUrl);
    if (!resolved) continue;
    const descriptor = tokens[1] || '';
    const score = descriptor.endsWith('w')
      ? parseInt(descriptor, 10) || 1
      : descriptor.endsWith('x')
      ? (parseFloat(descriptor) || 1) * 1000
      : 100;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = resolved;
    }
  }
  return bestUrl;
}

function matchCategoryRecord(
  candidates: string[],
  categories: CategoryRecord[] = []
): CategoryRecord | undefined {
  const active = (categories || []).filter((c) => c.id !== UPCOMING_CATEGORY_ID && !c.isUpcoming && c.isActive !== false);
  for (const cand of candidates) {
    const cleanCand = normalizeTextKey(cand);
    if (!cleanCand) continue;
    const exact = active.find((c) => normalizeTextKey(c.name) === cleanCand);
    if (exact) return exact;
    const partial = active.find(
      (c) => normalizeTextKey(c.name).includes(cleanCand) || cleanCand.includes(normalizeTextKey(c.name))
    );
    if (partial) return partial;
  }
  return undefined;
}

function normalizeScrapeUrl(rawUrl: string): URL {
  let trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Please enter a product website URL.');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    trimmed = `https://${trimmed.replace(/^\/+/, '')}`;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error('Invalid website link. Please paste a valid product URL (e.g. https://store.com/products/item).');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only http:// and https:// website links are supported.');
  }
  return parsedUrl;
}

function detectBotChallengePage(html: string): string | null {
  if (!html) return null;
  const sample = html.slice(0, 12000).toLowerCase();
  const titleMatch = sample.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] || '').trim();

  if (
    title === 'just a moment...' ||
    title.includes('attention required! | cloudflare') ||
    sample.includes('/cdn-cgi/challenge-platform/') ||
    sample.includes('cf-browser-verification') ||
    sample.includes('enable javascript and cookies to continue')
  ) {
    return 'Cloudflare / anti-bot security challenge';
  }
  if (
    sample.includes('type the characters you see in this image') ||
    sample.includes('api-services-support@amazon.com') ||
    sample.includes('sorry, we just need to make sure you\'re not a robot')
  ) {
    return 'CAPTCHA / anti-bot verification';
  }
  if (
    (title === 'access denied' || title === '403 forbidden') &&
    sample.length < 4000
  ) {
    return 'Access Denied protection';
  }
  return null;
}

async function fetchUrlText(
  targetUrl: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<{ status: number; statusText: string; contentType: string; finalUrl: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    return {
      status: res.status,
      statusText: res.statusText || '',
      contentType,
      finalUrl: res.url || targetUrl,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlWithHeaders(parsedUrl: URL): Promise<{ html: string; finalUrl: string }> {
  const domain = parsedUrl.hostname.replace(/^www\./, '');
  const primaryHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    Referer: `${parsedUrl.origin}/`,
  };

  let attempt: { status: number; statusText: string; contentType: string; finalUrl: string; text: string };
  try {
    attempt = await fetchUrlText(parsedUrl.href, primaryHeaders, 9500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      throw new Error(
        `Connection to ${domain} timed out. Use "Paste HTML Source" below as an instant fallback.`
      );
    }
    throw new Error(
      `Could not connect to ${domain}${msg ? ` (${msg})` : ''}. Check the link or use "Paste HTML Source" below.`
    );
  }

  // Fallback retry with clean bot/minimal headers if WAF returned 403/406/429/503 or JS challenge
  const challengePrimary = attempt.status >= 200 && attempt.status < 400 ? detectBotChallengePage(attempt.text) : null;
  if ([403, 406, 429, 503].includes(attempt.status) || challengePrimary) {
    try {
      const retryAttempt = await fetchUrlText(
        parsedUrl.href,
        {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        6000
      );
      const retryChallenge = detectBotChallengePage(retryAttempt.text);
      if (retryAttempt.status >= 200 && retryAttempt.status < 400 && !retryChallenge) {
        attempt = retryAttempt;
      }
    } catch {
      // keep original attempt result for diagnostic error
    }
  }

  if (attempt.status < 200 || attempt.status >= 400) {
    if (attempt.status === 404) {
      throw new Error(`Product page not found on ${domain} (HTTP 404). Please check the URL.`);
    }
    if ([401, 403, 406, 429, 503].includes(attempt.status)) {
      throw new Error(
        `${domain} blocked automated fetching (HTTP ${attempt.status}). Open the product page in your browser, copy Page Source (Ctrl+U -> Ctrl+A -> Ctrl+C), and paste it into "Paste HTML Source" below.`
      );
    }
    if ([500, 502, 504, 505].includes(attempt.status)) {
      throw new Error(
        `${domain} returned HTTP ${attempt.status} (${attempt.statusText || 'Gateway/Protocol error'}). Open the product page in your browser, copy Page Source (Ctrl+U -> Ctrl+A -> Ctrl+C), and paste it into "Paste HTML Source" below.`
      );
    }
    throw new Error(
      `${domain} returned HTTP ${attempt.status} (${attempt.statusText || 'Unavailable'}). Try again or use "Paste HTML Source" below.`
    );
  }

  const contentType = attempt.contentType.toLowerCase();
  if (
    contentType &&
    !contentType.includes('text/') &&
    !contentType.includes('json') &&
    !contentType.includes('xml') &&
    !contentType.includes('xhtml')
  ) {
    throw new Error(
      `This link points to a non-webpage file (${attempt.contentType}). Please paste a product web page URL.`
    );
  }

  const challenge = detectBotChallengePage(attempt.text);
  if (challenge) {
    throw new Error(
      `${domain} showed a ${challenge} to automated requests. Open the page in your browser, copy Page Source (Ctrl+U → Ctrl+A → Ctrl+C), and use "Paste HTML Source" below.`
    );
  }

  return { html: attempt.text, finalUrl: attempt.finalUrl };
}

interface ShopifyVariantJson {
  id?: number | string;
  title?: string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  sku?: string | null;
  price?: string | number;
  compare_at_price?: string | number | null;
  available?: boolean;
  inventory_quantity?: number;
  weight?: number;
  weight_unit?: string;
  grams?: number;
  image_id?: number | string | null;
  featured_image?: { src?: string } | null;
}

interface ShopifyProductJson {
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string | string[];
  images?: Array<{ src?: string; id?: number | string; variant_ids?: Array<number | string> }>;
  options?: Array<{ name?: string; position?: number; values?: string[] }>;
  variants?: ShopifyVariantJson[];
}

async function tryFetchShopifyProductJson(
  parsedUrl: URL,
  html = '',
  forceAttempt = false
): Promise<ShopifyProductJson | null> {
  const isShopify =
    forceAttempt ||
    /shopify\.com|cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html) ||
    parsedUrl.pathname.includes('/products/');
  if (!isShopify) return null;

  const prodMatch = parsedUrl.pathname.match(/(\/products\/[^/?#]+)/i);
  if (!prodMatch) return null;

  const jsonUrl = `${parsedUrl.origin}${prodMatch[1].replace(/\.json$/i, '')}.json`;
  try {
    const attempt = await fetchUrlText(
      jsonUrl,
      {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      6000
    );
    if (attempt.status < 200 || attempt.status >= 400) return null;
    const trimmed = attempt.text.trim();
    if (!trimmed || trimmed.startsWith('<')) return null;
    const data = JSON.parse(trimmed) as { product?: ShopifyProductJson };
    if (data?.product?.title) return data.product;
  } catch {
    return null;
  }
  return null;
}

function tryExtractShopifyJsonFromHtml(html: string): ShopifyProductJson | null {
  const patterns = [
    /<script[^>]*type=["']application\/json["'][^>]*data-product-json[^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*id=["']ProductJson[^"']*["'][^>]*>([\s\S]*?)<\/script>/i,
    /var\s+meta\s*=\s*(\{"product":[\s\S]*?\});/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) {
      try {
        const parsed = JSON.parse(m[1].trim()) as ShopifyProductJson & { product?: ShopifyProductJson };
        const prod = parsed.product || parsed;
        if (prod?.title) return prod;
      } catch {
        // ignore invalid inline JSON
      }
    }
  }
  return null;
}

function extractWooAttributeLabelMap(html: string): Map<string, Map<string, string>> {
  const attrMap = new Map<string, Map<string, string>>();
  const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let selMatch: RegExpExecArray | null;
  while ((selMatch = selectRegex.exec(html)) !== null) {
    const attrs = parseAttributes(`<select ${selMatch[1]}>`);
    const rawName = (attrs['data-attribute_name'] || attrs.name || '').toLowerCase().trim();
    if (!rawName.includes('attribute_') && !/(size|color|colour|option|variant)/i.test(rawName)) {
      continue;
    }
    const cleanKey = rawName.replace(/^attribute_(pa_)?/i, '').replace(/[-_]/g, ' ').trim();
    const valToLabel = new Map<string, string>();
    const optRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = optRegex.exec(selMatch[2])) !== null) {
      const optAttrs = parseAttributes(`<option ${optMatch[1]}>`);
      const label = stripHtmlTags(optMatch[2]).trim();
      const val = (optAttrs.value || '').trim();
      if (val && label && !/choose|select\s+an?\s+option/i.test(label)) {
        valToLabel.set(val.toLowerCase(), label);
      }
    }
    if (valToLabel.size > 0) {
      attrMap.set(rawName, valToLabel);
      if (cleanKey) attrMap.set(cleanKey, valToLabel);
    }
  }
  return attrMap;
}

function extractWooVariationsFromHtml(html: string, finalUrl: string): ProductVariation[] {
  const match = html.match(/data-product_variations=["']([\s\S]*?)["']/i);
  if (!match?.[1]) return [];
  try {
    const labelMaps = extractWooAttributeLabelMap(html);
    const raw = decodeHtmlEntities(match[1]);
    const list = JSON.parse(raw) as Array<{
      variation_id?: number | string;
      sku?: string;
      display_price?: number;
      display_regular_price?: number;
      is_in_stock?: boolean;
      max_qty?: number;
      variation_description?: string;
      weight_html?: string;
      dimensions_html?: string;
      attributes?: Record<string, string>;
      image?: { url?: string; full_src?: string; src?: string };
    }>;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 30).map((v, idx) => {
      const attrs: Record<string, string> = {};
      if (v.attributes) {
        Object.entries(v.attributes).forEach(([k, val]) => {
          if (val) {
            const rawAttrKey = k.toLowerCase().trim();
            const cleanKeyRaw = k.replace(/^attribute_(pa_)?/i, '').replace(/[-_]/g, ' ').trim();
            const cleanKey = cleanKeyRaw
              ? cleanKeyRaw.replace(/\b\w/g, (c) => c.toUpperCase())
              : `Option ${idx + 1}`;
            const map = labelMaps.get(rawAttrKey) || labelMaps.get(cleanKeyRaw.toLowerCase());
            const mappedVal = map?.get(String(val).toLowerCase().trim()) || String(val).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
            attrs[cleanKey] = mappedVal;
          }
        });
      }
      const attrTitle = Object.values(attrs).filter(Boolean).join(' · ') || `Option ${idx + 1}`;
      const salePrice = typeof v.display_price === 'number' ? Math.round(v.display_price) : 0;
      const regularPrice =
        typeof v.display_regular_price === 'number' ? Math.round(v.display_regular_price) : salePrice;
      const detailParts: string[] = [];
      if (v.variation_description) {
        const descText = stripHtmlTags(v.variation_description);
        if (descText) detailParts.push(descText);
      }
      if (v.dimensions_html) {
        const dimText = stripHtmlTags(v.dimensions_html);
        if (dimText && !/n\/a/i.test(dimText)) detailParts.push(`Dimensions: ${dimText}`);
      }
      if (v.weight_html) {
        const wtText = stripHtmlTags(v.weight_html);
        if (wtText && !/n\/a/i.test(wtText)) detailParts.push(`Weight: ${wtText}`);
      }
      const sizeKey = Object.keys(attrs).find((k) => /size|dimension|capacity|pack|edition/i.test(k));
      const colorKey = Object.keys(attrs).find((k) => /colou?r|shade|finish|style/i.test(k));

      return {
        id: `var_woo_${Date.now()}_${idx + 1}`,
        title: attrTitle,
        sku: v.sku || `WOO-V${idx + 1}`,
        attributes: Object.keys(attrs).length > 0 ? attrs : { Variant: attrTitle },
        size: (sizeKey ? attrs[sizeKey] : undefined) || (!colorKey ? Object.values(attrs)[0] : undefined),
        color: colorKey ? attrs[colorKey] : undefined,
        details: detailParts.join(' | ') || undefined,
        originalPrice: regularPrice,
        salePrice,
        stockQty: v.is_in_stock === false ? 0 : typeof v.max_qty === 'number' && v.max_qty > 0 ? v.max_qty : 25,
        image: resolveAbsoluteUrl(v.image?.full_src || v.image?.url || v.image?.src, finalUrl) || undefined,
      };
    });
  } catch {
    return [];
  }
}

function extractTablesAndSizeChart(html: string): {
  sizeChart?: ProductSizeChart;
  tableSpecs: Record<string, string>;
  detectedSizes: string[];
} {
  const tableSpecs: Record<string, string> = {};
  let sizeChart: ProductSizeChart | undefined;
  const detectedSizes: string[] = [];

  const tableRegex = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let tMatch: RegExpExecArray | null;
  while ((tMatch = tableRegex.exec(html)) !== null) {
    const tableAttrs = (tMatch[1] || '').toLowerCase();
    const tableBody = tMatch[2] || '';
    if (
      tableAttrs.includes('variations') ||
      tableAttrs.includes('shop_table') ||
      tableAttrs.includes('cart') ||
      /<select\b|<input\b/i.test(tableBody)
    ) {
      continue;
    }

    const parsedRows: string[][] = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = trRegex.exec(tableBody)) !== null && parsedRows.length < 25) {
      const cells: string[] = [];
      const cellRegex = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cellRegex.exec(rMatch[1])) !== null && cells.length < 12) {
        const text = stripHtmlTags(cMatch[1]).replace(/\s+/g, ' ').trim();
        cells.push(text);
      }
      if (cells.length >= 2 && cells.some((c) => c.length > 0)) {
        parsedRows.push(cells);
      }
    }

    if (parsedRows.length === 0) continue;

    // Multi-column matrix (e.g. Size Chart: Measurement | Small (S) | Medium (M) | Large (L) | XL)
    const maxCols = Math.max(...parsedRows.map((r) => r.length));
    if (maxCols >= 3 && parsedRows.length >= 2 && !sizeChart) {
      const headerRow = parsedRows[0];
      const bodyRows = parsedRows.slice(1).filter((r) => r.length >= 2);
      const headerLooksSize = headerRow.some((h) =>
        /size|small|medium|large|\bxs\b|\bs\b|\bm\b|\bl\b|\bxl\b|\bxxl\b|chest|length|waist|shoulder|measurement|age|uk|us|eu/i.test(h)
      );
      const bodyLooksMeasure = bodyRows.some((r) =>
        /chest|length|sleeve|trouser|waist|hip|shoulder|width|height|bust|inseam|weight|\bin\b|\bcm\b/i.test(r.join(' '))
      );
      if (headerLooksSize || bodyLooksMeasure) {
        const columns = headerRow.slice(1).map((c, idx) => c || `Option ${idx + 1}`);
        const chartRows: ProductSizeChartRow[] = bodyRows
          .map((r) => ({
            label: cleanSpecLabel(r[0]) || 'Measurement',
            values: columns.map((_, cIdx) => (r[cIdx + 1] || '—').trim()),
          }))
          .filter((r) => r.label && r.values.some((v) => v && v !== '—'));

        if (columns.length >= 2 && chartRows.length >= 1) {
          const joinedVals = chartRows.flatMap((r) => r.values).join(' ').toLowerCase();
          const unit = /\bcm\b/i.test(joinedVals) ? 'cm' : /\bin\b|inches/i.test(joinedVals) ? 'in' : undefined;
          sizeChart = {
            columns,
            rows: chartRows,
            unit,
          };
          columns.forEach((c) => {
            if (c && !/measurement|attribute|detail|feature/i.test(c) && !detectedSizes.includes(c)) {
              detectedSizes.push(c);
            }
          });
          continue;
        }
      }
    }

    // Standard 2-column specification table
    for (const row of parsedRows) {
      if (row.length !== 2) continue;
      const rawKey = cleanSpecLabel(row[0]);
      const rawVal = cleanSpecLabel(row[1]).replace(/\s*,\s*/g, ', ');
      if (!rawKey || !rawVal || rawKey.length > 48 || rawVal.length > 220) continue;
      if (/^(attribute|feature|property|specification)$/i.test(rawKey) && /^(details?|value)$/i.test(rawVal)) {
        continue;
      }
      if (/total|subtotal|shipping|tax/i.test(rawKey)) continue;
      const existingMatchKey = Object.keys(tableSpecs).find(
        (k) => k.toLowerCase() === rawKey.toLowerCase()
      );
      if (!existingMatchKey) {
        tableSpecs[rawKey] = rawVal;
      }
    }
  }

  return { sizeChart, tableSpecs, detectedSizes };
}

async function tryFetchWooStoreProduct(parsedUrl: URL): Promise<{
  name?: string;
  description?: string;
  shortDescription?: string;
  sku?: string;
  salePrice?: number;
  regularPrice?: number;
  currency?: string;
  images: string[];
  categories: string[];
  inStock?: boolean;
} | null> {
  if (!/\/product\//i.test(parsedUrl.pathname)) return null;
  const slug = parsedUrl.pathname.split('/').filter(Boolean).pop();
  if (!slug) return null;
  const apiUrl = `${parsedUrl.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`;
  try {
    const res = await fetchUrlText(
      apiUrl,
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      6000
    );
    if (res.status < 200 || res.status >= 400) return null;
    const trimmed = res.text.trim();
    if (!trimmed || trimmed.startsWith('<')) return null;
    const arr = JSON.parse(trimmed) as Array<Record<string, unknown>>;
    const item = Array.isArray(arr) ? arr[0] : null;
    if (!item || typeof item.name !== 'string') return null;

    const prices = (item.prices && typeof item.prices === 'object' ? item.prices : {}) as Record<string, unknown>;
    const minorUnit = Number(prices.currency_minor_unit ?? 0);
    const divisor = Number.isFinite(minorUnit) && minorUnit > 0 ? Math.pow(10, minorUnit) : 1;
    const sale = prices.sale_price ? Number(prices.sale_price) / divisor : prices.price ? Number(prices.price) / divisor : undefined;
    const regular = prices.regular_price ? Number(prices.regular_price) / divisor : undefined;

    const images = Array.isArray(item.images)
      ? (item.images as Array<{ src?: string }>).map((i) => i.src || '').filter(Boolean)
      : [];
    const categories = Array.isArray(item.categories)
      ? (item.categories as Array<{ name?: string }>).map((c) => c.name || '').filter(Boolean)
      : [];

    return {
      name: decodeHtmlEntities(item.name),
      description: typeof item.description === 'string' ? formatStructuredDescriptionFromHtml(item.description) : undefined,
      shortDescription: typeof item.short_description === 'string' ? stripHtmlTags(item.short_description) : undefined,
      sku: typeof item.sku === 'string' ? item.sku : undefined,
      salePrice: sale && Number.isFinite(sale) && sale > 0 ? Math.round(sale) : undefined,
      regularPrice: regular && Number.isFinite(regular) && regular > 0 ? Math.round(regular) : undefined,
      currency: typeof prices.currency_code === 'string' ? prices.currency_code : undefined,
      images,
      categories,
      inStock: item.is_in_stock !== false,
    };
  } catch {
    return null;
  }
}

function extractHtmlFallbackVariations(
  html: string,
  baseSku: string,
  baseSalePrice: number,
  baseMarketPrice: number
): ProductVariation[] {
  const foundGroups: Array<{ optionName: string; values: string[] }> = [];

  // 1. Parse variation <select> dropdowns
  const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let selMatch: RegExpExecArray | null;
  while ((selMatch = selectRegex.exec(html)) !== null && foundGroups.length < 3) {
    const attrs = parseAttributes(`<select ${selMatch[1]}>`);
    const idOrName = `${attrs.name || ''} ${attrs.id || ''} ${attrs['data-attribute_name'] || ''}`.toLowerCase();
    if (!/(size|color|colour|option|variant|style|pack|weight|capacity|attribute_)/i.test(idOrName)) {
      continue;
    }
    const cleanOptName = (attrs['data-attribute_name'] || attrs.name || attrs.id || 'Option')
      .replace(/^attribute_(pa_)?/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    const optValues: string[] = [];
    const optRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = optRegex.exec(selMatch[2])) !== null && optValues.length < 15) {
      const optAttrs = parseAttributes(`<option ${optMatch[1]}>`);
      const label = stripHtmlTags(optMatch[2]).trim();
      const val = (optAttrs.value || label).trim();
      if (!val || /choose|select\s+an?\s+option|default\s+title/i.test(label)) continue;
      if (!optValues.includes(label || val)) optValues.push(label || val);
    }
    if (optValues.length > 0) {
      foundGroups.push({ optionName: cleanOptName || 'Option', values: optValues });
    }
  }

  // 2. Parse swatch buttons/labels if no <select> variation options found
  if (foundGroups.length === 0) {
    const swatchVals = new Set<string>();
    const swatchRegex = /<(?:button|label|li|a|span)\b[^>]*\bdata-(?:value|option|swatch-value|color)=["']([^"']+)["'][^>]*>/gi;
    let swMatch: RegExpExecArray | null;
    while ((swMatch = swatchRegex.exec(html)) !== null && swatchVals.size < 15) {
      const v = decodeHtmlEntities(swMatch[1]).trim();
      if (v && v.length <= 40 && !/^\{/.test(v)) swatchVals.add(v);
    }
    if (swatchVals.size > 1) {
      foundGroups.push({ optionName: 'Option', values: Array.from(swatchVals) });
    }
  }

  if (foundGroups.length === 0) return [];
  const primary = foundGroups[0];
  return primary.values.slice(0, 20).map((val, idx) => {
    const isColor = /colou?r|shade|finish/i.test(primary.optionName);
    const isSize = /size|dimension|capacity|weight|pack/i.test(primary.optionName) || !isColor;
    return {
      id: `var_html_${Date.now()}_${idx + 1}`,
      title: val,
      sku: `${baseSku || 'IMP'}-V${idx + 1}`,
      attributes: { [primary.optionName]: val },
      size: isSize ? val : undefined,
      color: isColor ? val : undefined,
      details: `${primary.optionName}: ${val}`,
      originalPrice: baseMarketPrice,
      salePrice: baseSalePrice,
      stockQty: 25,
    };
  });
}

function collectJsonLdProducts(html: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const typeVal = obj['@type'];
      const types = Array.isArray(typeVal) ? typeVal.map(String) : typeVal ? [String(typeVal)] : [];
      if (
        types.some(
          (t) =>
            t.toLowerCase() === 'product' ||
            t.toLowerCase() === 'productgroup' ||
            t.toLowerCase().endsWith('/product') ||
            t.toLowerCase().endsWith('/productgroup')
        )
      ) {
        results.push(obj);
      }
      if (Array.isArray(obj['@graph'])) walk(obj['@graph']);
    }
  };
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      walk(parsed);
    } catch {
      // ignore malformed JSON-LD block
    }
  }
  return results;
}

function extractInlineGalleryImagesFromScriptsAndCss(html: string, finalUrl: string): string[] {
  const found: string[] = [];
  const addCandidate = (raw: string) => {
    const clean = raw.replace(/\\\//g, '/').trim();
    if (!clean || clean.includes('{width}') === false && clean.length < 10) {
      // allow template URLs cleanly via resolveAbsoluteUrl
    }
    const abs = resolveAbsoluteUrl(clean, finalUrl);
    if (abs && isLikelyProductImage(abs)) {
      found.push(abs);
    }
  };

  // Match JSON arrays like "images": ["https://...", "//cdn..."] or "gallery": [...] or "media": [...]
  const arrayRegex = /"(?:images|gallery|productImages|mediaGallery|media|zoomImages|large_images)"\s*:\s*\[([^\]]{10,12000})\]/gi;
  let arrMatch: RegExpExecArray | null;
  while ((arrMatch = arrayRegex.exec(html)) !== null && found.length < 30) {
    const urlStrRegex = /["']((?:https?:)?\\?\/\\?\/[^"'\s<>]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"'\s<>]*)?)["']/gi;
    let uMatch: RegExpExecArray | null;
    while ((uMatch = urlStrRegex.exec(arrMatch[1])) !== null && found.length < 30) {
      addCandidate(uMatch[1]);
    }
  }

  // Match inline CSS background-image: url(...)
  const bgRegex = /background-image\s*:\s*url\((?:"|')?([^"')]+)(?:"|')?\)/gi;
  let bgMatch: RegExpExecArray | null;
  while ((bgMatch = bgRegex.exec(html)) !== null && found.length < 35) {
    addCandidate(bgMatch[1]);
  }

  return found;
}

function matchBestGalleryImageForVariant(
  v: ProductVariation,
  originalImageUrls: string[]
): string | undefined {
  if (v.image) return v.image;
  const tokens = [v.color, v.size, v.title, ...Object.values(v.attributes || {})]
    .filter((t): t is string => Boolean(t && t.trim().length >= 3 && !/^(standard|default|none)$/i.test(t.trim())))
    .flatMap((t) =>
      t
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((tok) => tok.length >= 3)
    );
  if (tokens.length === 0) return undefined;

  for (const imgUrl of originalImageUrls) {
    const fileAndPath = imgUrl.toLowerCase();
    if (tokens.some((tok) => fileAndPath.includes(tok))) {
      return imgUrl;
    }
  }
  return undefined;
}

export async function scrapeProductFromUrl(
  rawUrl: string,
  categories: CategoryRecord[] = [],
  htmlOverride?: string
): Promise<ScrapeProductResult> {
  const parsedUrl = normalizeScrapeUrl(rawUrl);

  let html = '';
  let finalUrl = parsedUrl.href;
  let directShopifyProd: ShopifyProductJson | null = null;
  const strategiesUsed: string[] = [];

  if (htmlOverride && htmlOverride.trim().length > 40) {
    html = htmlOverride;
    const challenge = detectBotChallengePage(html);
    if (challenge) {
      throw new Error(
        `The pasted HTML appears to be a ${challenge} page instead of the product page. Make sure the product page finished loading in your browser before copying Page Source.`
      );
    }
    strategiesUsed.push('Manual HTML Source');
  } else {
    if (isBlockedHostOrIp(parsedUrl.hostname)) {
      throw new Error('Private/local network URLs are restricted for security reasons.');
    }
    try {
      const fetched = await fetchHtmlWithHeaders(parsedUrl);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    } catch (fetchErr) {
      // Before failing, try Shopify .json or WooCommerce Store JSON API if applicable
      if (parsedUrl.pathname.toLowerCase().includes('/products/')) {
        directShopifyProd = await tryFetchShopifyProductJson(parsedUrl, '', true);
      }
      const directWooProd = !directShopifyProd ? await tryFetchWooStoreProduct(parsedUrl) : null;
      if (!directShopifyProd && !directWooProd) {
        throw fetchErr;
      }
      if (directWooProd) {
        html = `<html><head><title>${directWooProd.name || ''}</title></head><body><h1>${directWooProd.name || ''}</h1></body></html>`;
      }
    }
  }

  const domain = new URL(finalUrl).hostname.replace(/^www\./, '');

  // Accumulators
  let name = '';
  let brand = '';
  let sku = '';
  let shortDescription = '';
  let details = '';
  let currencyDetected = 'PKR';
  let originalPriceText: string | undefined;
  let salePriceRaw: number | null = null;
  let marketPriceRaw: number | null = null;
  let stockQty = 50;
  let videoUrl = '';
  let sizeChart: ProductSizeChart | undefined;
  const imageSet = new Set<string>();
  const specifications: Record<string, string> = {};
  const features: string[] = [];
  const tagSet = new Set<string>();
  const categoryHints: string[] = [];
  const variations: ProductVariation[] = [];

  const addImageUrl = (rawImgUrl: string | null | undefined): string | null => {
    if (!rawImgUrl) return null;
    const abs = resolveAbsoluteUrl(rawImgUrl, finalUrl);
    if (!abs || !isLikelyProductImage(abs)) return null;
    const upgraded = upgradeProductImageUrl(abs);
    imageSet.add(upgraded);
    return upgraded;
  };

  // 1. Extract Meta Tags (OpenGraph / Twitter / Product Meta)
  const metaMap = new Map<string, string>();
  const metaTagRegex = /<meta\b[^>]*>/gi;
  let mTag: RegExpExecArray | null;
  while ((mTag = metaTagRegex.exec(html)) !== null) {
    const attrs = parseAttributes(mTag[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase().trim();
    const val = (attrs.content || '').trim();
    if (key && val) {
      if (key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') {
        addImageUrl(val);
      } else if (key === 'og:video' || key === 'og:video:url' || key === 'og:video:secure_url') {
        const abs = resolveAbsoluteUrl(val, finalUrl);
        if (abs && !videoUrl) videoUrl = abs;
      }
      if (!metaMap.has(key)) metaMap.set(key, val);
    }
  }
  if (metaMap.size > 0) strategiesUsed.push('OpenGraph & Meta');

  // 2. Try Shopify Direct Product JSON API or Embedded Shopify JSON in HTML
  const shopifyProd =
    directShopifyProd ||
    (!htmlOverride ? await tryFetchShopifyProductJson(new URL(finalUrl), html) : null) ||
    tryExtractShopifyJsonFromHtml(html);
  if (shopifyProd) {
    strategiesUsed.push('Shopify Product JSON');
    if (shopifyProd.title) name = decodeHtmlEntities(shopifyProd.title).trim();
    if (shopifyProd.vendor) brand = decodeHtmlEntities(shopifyProd.vendor).trim();
    if (shopifyProd.product_type) categoryHints.push(shopifyProd.product_type);
    if (shopifyProd.body_html) {
      const stripped = stripHtmlTags(shopifyProd.body_html);
      if (stripped) details = stripped;
    }
    const rawTags = Array.isArray(shopifyProd.tags)
      ? shopifyProd.tags
      : typeof shopifyProd.tags === 'string'
      ? shopifyProd.tags.split(',')
      : [];
    rawTags.forEach((t) => {
      const clean = t.trim().toLowerCase();
      if (clean && tagSet.size < 15) tagSet.add(clean);
    });

    const shopifyImageById = new Map<string, string>();
    const shopifyImageByVariantId = new Map<string, string>();
    (shopifyProd.images || []).forEach((img) => {
      const added = addImageUrl(img.src);
      if (added && img.id !== undefined) {
        shopifyImageById.set(String(img.id), added);
      }
      if (added && Array.isArray(img.variant_ids)) {
        img.variant_ids.forEach((vid) => shopifyImageByVariantId.set(String(vid), added));
      }
    });

    const optNames = (shopifyProd.options || []).map((o) => o.name || 'Option');
    const variantsList = shopifyProd.variants || [];
    if (variantsList.length > 0) {
      const firstV = variantsList[0];
      if (firstV.sku) sku = String(firstV.sku).trim();
      const firstPrice = parseNumericPrice(firstV.price);
      const firstCompare = parseNumericPrice(firstV.compare_at_price);
      if (firstPrice) salePriceRaw = firstPrice;
      if (firstCompare && firstCompare > (firstPrice || 0)) marketPriceRaw = firstCompare;

      variantsList.slice(0, 30).forEach((v, idx) => {
        const attrs: Record<string, string> = {};
        if (v.option1 && v.option1 !== 'Default Title') attrs[optNames[0] || 'Option 1'] = v.option1;
        if (v.option2) attrs[optNames[1] || 'Option 2'] = v.option2;
        if (v.option3) attrs[optNames[2] || 'Option 3'] = v.option3;
        if (Object.keys(attrs).length === 0 && v.title && v.title !== 'Default Title') {
          attrs['Variant'] = v.title;
        }
        const attrTitle =
          (v.title && v.title !== 'Default Title' ? v.title : '') ||
          Object.values(attrs).filter(Boolean).join(' / ') ||
          `Variant ${idx + 1}`;
        const vPrice = parseNumericPrice(v.price) || salePriceRaw || 0;
        const vComp = parseNumericPrice(v.compare_at_price) || marketPriceRaw || vPrice;
        const rawVarImg =
          v.featured_image?.src ||
          (v.image_id ? shopifyImageById.get(String(v.image_id)) : undefined) ||
          (v.id ? shopifyImageByVariantId.get(String(v.id)) : undefined);
        const varImg = rawVarImg ? addImageUrl(rawVarImg) || undefined : undefined;

        const detailSegments = Object.entries(attrs).map(([k, val]) => `${k}: ${val}`);
        if (v.weight && v.weight > 0) {
          detailSegments.push(`Weight: ${v.weight} ${v.weight_unit || 'g'}`);
        } else if (v.grams && v.grams > 0) {
          detailSegments.push(`Weight: ${v.grams}g`);
        }

        const sizeKey = Object.keys(attrs).find((k) => /size|dimension|capacity|pack|model/i.test(k));
        const colorKey = Object.keys(attrs).find((k) => /colou?r|shade|finish|style/i.test(k));

        variations.push({
          id: `var_imp_${Date.now()}_${idx + 1}`,
          title: attrTitle,
          sku: v.sku || `${sku || 'IMP'}-V${idx + 1}`,
          attributes: Object.keys(attrs).length > 0 ? attrs : { Edition: 'Standard' },
          size: (sizeKey ? attrs[sizeKey] : undefined) || v.option1 || undefined,
          color: (colorKey ? attrs[colorKey] : undefined) || v.option2 || undefined,
          details: detailSegments.join(' · ') || undefined,
          originalPrice: Math.round(vComp),
          salePrice: Math.round(vPrice),
          stockQty: typeof v.inventory_quantity === 'number' && v.inventory_quantity > 0 ? v.inventory_quantity : v.available === false ? 0 : 25,
          image: varImg,
        });
      });
    }
  }

  // 3. Parse JSON-LD Product & ProductGroup Schema
  const jsonLdProducts = collectJsonLdProducts(html);
  if (jsonLdProducts.length > 0) {
    strategiesUsed.push('JSON-LD Product Schema');
    for (const jp of jsonLdProducts) {
      if (!name && typeof jp.name === 'string') name = decodeHtmlEntities(jp.name).trim();
      if (!sku && (typeof jp.sku === 'string' || typeof jp.mpn === 'string' || typeof jp.productGroupID === 'string')) {
        sku = String(jp.sku || jp.mpn || jp.productGroupID).trim();
      }
      if (!brand && jp.brand) {
        if (typeof jp.brand === 'string') brand = jp.brand.trim();
        else if (typeof jp.brand === 'object' && typeof (jp.brand as Record<string, unknown>).name === 'string') {
          brand = String((jp.brand as Record<string, unknown>).name).trim();
        }
      }
      if (!details && typeof jp.description === 'string') {
        details = stripHtmlTags(jp.description);
      }
      if (typeof jp.category === 'string') categoryHints.push(jp.category);

      const extractFirstLdImage = (imgNode: unknown): string | undefined => {
        if (!imgNode) return undefined;
        if (typeof imgNode === 'string') return addImageUrl(imgNode) || undefined;
        if (Array.isArray(imgNode)) {
          let first: string | undefined;
          imgNode.forEach((n) => {
            const added = extractFirstLdImage(n);
            if (!first && added) first = added;
          });
          return first;
        }
        if (typeof imgNode === 'object') {
          const rec = imgNode as Record<string, unknown>;
          return extractFirstLdImage(rec.url || rec.contentUrl);
        }
        return undefined;
      };
      extractFirstLdImage(jp.image);

      if (Array.isArray(jp.additionalProperty)) {
        for (const prop of jp.additionalProperty as Array<Record<string, unknown>>) {
          if (prop?.name && prop?.value) {
            specifications[String(prop.name).trim()] = String(prop.value).trim();
          }
        }
      }

      const offers = Array.isArray(jp.offers) ? jp.offers : jp.offers ? [jp.offers] : [];
      for (const off of offers as Array<Record<string, unknown>>) {
        if (off.priceCurrency) currencyDetected = String(off.priceCurrency).toUpperCase();
        const p = parseNumericPrice(off.price ?? off.lowPrice);
        const hi = parseNumericPrice(off.highPrice);
        if (p && !salePriceRaw) salePriceRaw = p;
        if (hi && (!marketPriceRaw || hi > marketPriceRaw)) marketPriceRaw = hi;
        if (typeof off.availability === 'string' && off.availability.toLowerCase().includes('outofstock')) {
          stockQty = 0;
        }
      }

      // Extract ProductGroup hasVariant items if variations are not yet populated
      if (Array.isArray(jp.hasVariant) && variations.length === 0) {
        const hvList = jp.hasVariant as Array<Record<string, unknown>>;
        hvList.slice(0, 30).forEach((hv, idx) => {
          const hvName = typeof hv.name === 'string' ? decodeHtmlEntities(hv.name).trim() : '';
          const hvSize = typeof hv.size === 'string' ? hv.size.trim() : undefined;
          const hvColor = typeof hv.color === 'string' ? hv.color.trim() : undefined;
          const hvMat = typeof hv.material === 'string' ? hv.material.trim() : undefined;
          const hvDesc = typeof hv.description === 'string' ? stripHtmlTags(hv.description) : '';
          const hvOffers = Array.isArray(hv.offers) ? hv.offers[0] : hv.offers;
          const offRec = (hvOffers && typeof hvOffers === 'object' ? hvOffers : {}) as Record<string, unknown>;
          if (offRec.priceCurrency) currencyDetected = String(offRec.priceCurrency).toUpperCase();
          const hvPrice = parseNumericPrice(offRec.price ?? offRec.lowPrice) || salePriceRaw || 0;
          if (hvPrice && !salePriceRaw) salePriceRaw = hvPrice;
          const hvImage = extractFirstLdImage(hv.image);
          const attrs: Record<string, string> = {};
          if (hvSize) attrs['Size'] = hvSize;
          if (hvColor) attrs['Color'] = hvColor;
          if (hvMat) attrs['Material'] = hvMat;
          if (Object.keys(attrs).length === 0 && hvName) attrs['Variant'] = hvName;

          const detailParts = [
            hvDesc,
            hvMat ? `Material: ${hvMat}` : '',
            hvSize ? `Size: ${hvSize}` : '',
            hvColor ? `Color: ${hvColor}` : '',
          ].filter(Boolean);

          variations.push({
            id: `var_ld_${Date.now()}_${idx + 1}`,
            title: hvName || [hvColor, hvSize].filter(Boolean).join(' · ') || `Variant ${idx + 1}`,
            sku: typeof hv.sku === 'string' ? hv.sku.trim() : `${sku || 'IMP'}-V${idx + 1}`,
            attributes: attrs,
            size: hvSize || hvName || undefined,
            color: hvColor,
            details: detailParts.join(' · ') || undefined,
            originalPrice: marketPriceRaw || hvPrice,
            salePrice: hvPrice,
            stockQty:
              typeof offRec.availability === 'string' && offRec.availability.toLowerCase().includes('outofstock')
                ? 0
                : 25,
            image: hvImage,
          });
        });
        if (variations.length > 0) strategiesUsed.push('ProductGroup Variants');
      }
    }
  }

  // 4. HTML DOM & Script Heuristics for any missing fields (WooCommerce / Daraz / Amazon / Generic)
  const htmlCurrencyMeta = metaMap.get('product:price:currency') || metaMap.get('og:price:currency');
  if (htmlCurrencyMeta) currencyDetected = htmlCurrencyMeta.toUpperCase();

  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const ogTitle = metaMap.get('og:title') || metaMap.get('twitter:title') || metaMap.get('title');
    const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle =
      (h1Match ? stripHtmlTags(h1Match[1]) : '') ||
      ogTitle ||
      (titleTagMatch ? stripHtmlTags(titleTagMatch[1]) : '');
    if (rawTitle) {
      name = rawTitle.replace(/\s+[|\-–—]\s+[^|\-–—]{2,35}$/, '').trim() || rawTitle.trim();
      strategiesUsed.push('HTML Title/H1');
    }
  }

  if (!brand) {
    brand =
      metaMap.get('product:brand') ||
      metaMap.get('og:brand') ||
      metaMap.get('og:site_name') ||
      domain.split('.')[0].toUpperCase();
  }

  if (!shortDescription) {
    shortDescription =
      metaMap.get('og:description') ||
      metaMap.get('description') ||
      metaMap.get('twitter:description') ||
      '';
    shortDescription = stripHtmlTags(shortDescription).slice(0, 320);
  }

  // Extract full balanced HTML descriptions (never cut off prematurely on nested </div>)
  const fullDescInner =
    extractBalancedElementInnerHtml(html, 'div', /id=["']tab-description["']|class=["'][^"']*(?:woocommerce-Tabs-panel--description|product__description|pdp-product-desc|product-description|entry-content)[^"']*["']/i) ||
    extractBalancedElementInnerHtml(html, 'div', /id=["'](?:productDescription|description|product-details)["']/i) ||
    extractBalancedElementInnerHtml(html, 'section', /id=["'][^"']*(?:description|details)[^"']*["']|class=["'][^"']*(?:product-description|details)[^"']*["']/i);
  if (fullDescInner) {
    const formattedDesc = formatStructuredDescriptionFromHtml(fullDescInner);
    if (formattedDesc.length > details.length) {
      details = formattedDesc.slice(0, 3200);
      strategiesUsed.push('Balanced HTML Description');
    }
  }

  if (!details) {
    const shortDescInner = extractBalancedElementInnerHtml(
      html,
      'div',
      /class=["'][^"']*woocommerce-product-details__short-description[^"']*["']/i
    );
    if (shortDescInner) {
      const formattedShort = formatStructuredDescriptionFromHtml(shortDescInner);
      if (formattedShort.length > 25) {
        details = formattedShort.slice(0, 2200);
        strategiesUsed.push('HTML Product Description');
      }
    }
    if (!details) details = shortDescription || `Imported product from ${domain}`;
  } else if (details && !details.includes('\n')) {
    // Preserve readable formatting even if extracted from plain JSON-LD description
    details = details.replace(/\.\s+(?=[A-Z])/g, '.\n\n').slice(0, 3200);
  }
  if (!shortDescription && details) {
    shortDescription = details.split('\n')[0].slice(0, 260);
  }

  // WooCommerce Store API supplement when URL has /product/ and fields are still sparse
  if (!htmlOverride && /\/product\//i.test(finalUrl) && (!salePriceRaw || imageSet.size === 0 || details.length < 80)) {
    const wooStore = await tryFetchWooStoreProduct(new URL(finalUrl));
    if (wooStore) {
      strategiesUsed.push('WooCommerce Store API');
      if (!name && wooStore.name) name = wooStore.name;
      if (!sku && wooStore.sku) sku = wooStore.sku;
      if (!salePriceRaw && wooStore.salePrice) salePriceRaw = wooStore.salePrice;
      if (!marketPriceRaw && wooStore.regularPrice) marketPriceRaw = wooStore.regularPrice;
      if (wooStore.currency) currencyDetected = wooStore.currency.toUpperCase();
      if (wooStore.inStock === false) stockQty = 0;
      if (wooStore.description && wooStore.description.length > details.length) details = wooStore.description;
      if (!shortDescription && wooStore.shortDescription) shortDescription = wooStore.shortDescription;
      wooStore.images.forEach((img) => addImageUrl(img));
      wooStore.categories.forEach((cat) => categoryHints.push(cat));
    }
  }

  // Price extraction fallbacks
  if (!salePriceRaw) {
    const metaPrice = metaMap.get('product:price:amount') || metaMap.get('og:price:amount');
    if (metaPrice) {
      salePriceRaw = parseNumericPrice(metaPrice);
      originalPriceText = `${currencyDetected} ${metaPrice}`;
    }
  }

  if (!salePriceRaw) {
    const pricePatterns = [
      /"(?:salePrice|finalPrice|currentPrice|price)"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/i,
      /class=["'][^"']*(?:price|pdp-price|amount)[^"']*["'][^>]*>[^<]{0,40}((?:Rs\.?|PKR|USD|\$|£|€)\s*[\d,]+(?:\.\d{1,2})?)/i,
      /((?:Rs\.?|PKR)\s*[\d,]{2,9})/i,
      /(\$\s*[\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pat of pricePatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        const detected = detectCurrencyFromText(m[1]);
        if (detected !== 'PKR' || /\b(PKR|Rs)\b/i.test(m[1])) currencyDetected = detected;
        const n = parseNumericPrice(m[1]);
        if (n) {
          salePriceRaw = n;
          originalPriceText = m[1].trim();
          strategiesUsed.push('HTML/Script Price Extraction');
          break;
        }
      }
    }
  }

  if (!marketPriceRaw) {
    const compareMatch =
      html.match(/"(?:compare_at_price|originalPrice|regularPrice|listPrice|highPrice)"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/i) ||
      html.match(/<(?:del|s)[^>]*>\s*((?:Rs\.?|PKR|\$|£|€)?\s*[\d,]+(?:\.\d{1,2})?)\s*<\/(?:del|s)>/i);
    if (compareMatch && compareMatch[1]) {
      const n = parseNumericPrice(compareMatch[1]);
      if (n && (!salePriceRaw || n >= salePriceRaw)) {
        marketPriceRaw = n;
      }
    }
  }

  // Gallery Image HTML Extraction (high-res zoom/data-src/srcset/img tags + script JSON + CSS background)
  const imgTagRegex = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRegex.exec(html)) !== null && imageSet.size < 20) {
    const attrs = parseAttributes(imgMatch[0]);
    const candidates = [
      attrs['data-zoom-image'],
      attrs['data-large_image'],
      attrs['data-large-image'],
      attrs['data-old-hires'],
      attrs['data-src'],
      attrs['data-original'],
      attrs['data-lazy-src'],
      attrs.srcset ? pickBestSrcFromSrcset(attrs.srcset, finalUrl) : null,
      attrs.src,
    ];
    for (const c of candidates) {
      if (addImageUrl(c)) break;
    }
  }

  if (imageSet.size < 16) {
    const scriptCssImages = extractInlineGalleryImagesFromScriptsAndCss(html, finalUrl);
    for (const scImg of scriptCssImages) {
      if (imageSet.size >= 20) break;
      addImageUrl(scImg);
    }
  }

  // Video extraction (<video>, <source>, <iframe> YouTube/Vimeo/TikTok, .mp4/.webm links)
  if (!videoUrl) {
    const videoTagMatch =
      html.match(/<(?:video|source)[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/i) ||
      html.match(/<iframe[^>]+src=["']([^"']*(?:youtube\.com\/embed|youtu\.be|player\.vimeo\.com|tiktok\.com)[^"']*)["']/i) ||
      html.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|webm))/i);
    if (videoTagMatch?.[1]) {
      videoUrl = resolveAbsoluteUrl(videoTagMatch[1], finalUrl) || '';
    }
  }
  if (videoUrl) strategiesUsed.push('Video Link Extracted');

  // Structured Size Chart & Technical Specifications Extraction (Multi-column Matrix + Key-Value Specs)
  const { sizeChart: parsedSizeChart, tableSpecs, detectedSizes } = extractTablesAndSizeChart(html);
  if (parsedSizeChart) {
    sizeChart = parsedSizeChart;
    strategiesUsed.push('Structured Size Chart');
  }
  for (const [k, v] of Object.entries(tableSpecs)) {
    if (Object.keys(specifications).length >= 20) break;
    const dup = Object.keys(specifications).find((ex) => ex.toLowerCase() === k.toLowerCase());
    if (!dup) {
      specifications[k] = v;
    }
  }

  const dlRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let dlMatch: RegExpExecArray | null;
  while ((dlMatch = dlRegex.exec(html)) !== null && Object.keys(specifications).length < 20) {
    const k = cleanSpecLabel(dlMatch[1]);
    const v = stripHtmlTags(dlMatch[2]).trim();
    if (k && v && k.length <= 45 && v.length <= 180) {
      const dup = Object.keys(specifications).find((ex) => ex.toLowerCase() === k.toLowerCase());
      if (!dup) specifications[k] = v;
    }
  }

  // Bullet Features Extraction
  const liRegex = /<li[^>]*>([\s\S]{10,220}?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  const featureSeen = new Set<string>();
  while ((liMatch = liRegex.exec(html)) !== null && features.length < 8) {
    if (/<a\b/i.test(liMatch[1]) || /<(ul|nav|button)/i.test(liMatch[1])) continue;
    const text = stripHtmlTags(liMatch[1]);
    if (
      text.length >= 12 &&
      text.length <= 180 &&
      !/home|login|cart|checkout|privacy|terms|contact|menu|copyright/i.test(text) &&
      !featureSeen.has(text.toLowerCase())
    ) {
      featureSeen.add(text.toLowerCase());
      features.push(text);
    }
  }

  // 5. WooCommerce Embedded Variations & HTML Option Fallback
  if (variations.length === 0 && html) {
    const wooVars = extractWooVariationsFromHtml(html, finalUrl);
    if (wooVars.length > 0) {
      wooVars.forEach((v) => {
        if (v.image) {
          v.image = addImageUrl(v.image) || v.image;
        }
      });
      variations.push(...wooVars);
      strategiesUsed.push('WooCommerce Variations JSON');
    }
  }

  if (variations.length === 0 && html) {
    const htmlVars = extractHtmlFallbackVariations(
      html,
      sku,
      salePriceRaw || 0,
      marketPriceRaw || salePriceRaw || 0
    );
    if (htmlVars.length > 0) {
      variations.push(...htmlVars);
      strategiesUsed.push('HTML Variation Options');
    }
  }

  // Breadcrumb Category Hints
  const breadcrumbMatch = html.match(/(?:breadcrumb|woocommerce-breadcrumb)[^>]*>([\s\S]{10,600}?)<\/(?:nav|div|ol|ul)>/i);
  if (breadcrumbMatch?.[1]) {
    const crumbs = stripHtmlTags(breadcrumbMatch[1])
      .split(/[›>/|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2 && !/^home$/i.test(s));
    crumbs.slice(0, 3).forEach((c) => categoryHints.push(c));
  }
  const matchedCat = matchCategoryRecord(
    [...categoryHints, name, ...Array.from(tagSet)],
    categories
  );

  // Convert currencies cleanly to PKR so admin always works in PKR
  const ourPrice = salePriceRaw ? convertToPkrIfForeign(salePriceRaw, currencyDetected) : 0;
  const marketPrice = marketPriceRaw
    ? convertToPkrIfForeign(marketPriceRaw, currencyDetected)
    : ourPrice > 0
    ? Math.round(ourPrice * 1.25)
    : 0;
  const costPrice = ourPrice > 0 ? Math.round(ourPrice * 0.68) : 0;

  // Match any missing variation image against original gallery URLs BEFORE caching to hashed filenames
  const rawGalleryList = Array.from(imageSet).slice(0, 20);
  const preCachedVariations = variations.map((v, idx) => {
    const matchedRawImage = v.image ? addImageUrl(v.image) || v.image : matchBestGalleryImageForVariant(v, rawGalleryList);
    const titleStr =
      v.title ||
      [v.color, v.size, ...Object.values(v.attributes || {})].filter(Boolean).join(' · ') ||
      v.sku ||
      `Variant ${idx + 1}`;
    const detailStr =
      v.details ||
      Object.entries(v.attributes || {})
        .map(([k, val]) => `${k}: ${val}`)
        .join(' · ') ||
      undefined;
    return {
      ...v,
      title: titleStr,
      details: detailStr,
      image: matchedRawImage,
      originalPrice: v.originalPrice ? convertToPkrIfForeign(v.originalPrice, currencyDetected) : marketPrice,
      salePrice: v.salePrice ? convertToPkrIfForeign(v.salePrice, currencyDetected) : ourPrice,
    };
  });

  // Download & cache unique product + variant images locally on the server (bounded total budget to prevent gateway 502/504/505 timeouts)
  const allRemoteImagesToCache = Array.from(
    new Set([
      ...rawGalleryList,
      ...preCachedVariations.map((v) => v.image).filter((x): x is string => Boolean(x)),
    ])
  ).slice(0, 16);

  const remoteToLocalMap = new Map<string, string>();
  let imagesDownloaded = 0;

  const CONCURRENCY = 6;
  const IMAGE_CACHE_BUDGET_MS = 7500;
  const cacheStart = Date.now();
  for (let i = 0; i < allRemoteImagesToCache.length; i += CONCURRENCY) {
    if (Date.now() - cacheStart >= IMAGE_CACHE_BUDGET_MS) {
      break;
    }
    const batch = allRemoteImagesToCache.slice(i, i + CONCURRENCY);
    const remainingBudget = Math.max(1200, IMAGE_CACHE_BUDGET_MS - (Date.now() - cacheStart));
    const results = await Promise.race([
      Promise.all(
        batch.map(async (u) => ({
          remote: u,
          res: await downloadAndCacheExternalImage(u, finalUrl),
        }))
      ),
      new Promise<Array<{ remote: string; res: { localUrl: string; downloaded: boolean } }>>((resolve) =>
        setTimeout(
          () => resolve(batch.map((u) => ({ remote: u, res: { localUrl: u, downloaded: false } }))),
          remainingBudget
        )
      ),
    ]);
    for (const item of results) {
      remoteToLocalMap.set(item.remote, item.res.localUrl);
      if (item.res.downloaded) imagesDownloaded += 1;
    }
  }
  if (imagesDownloaded > 0) strategiesUsed.push('Local Media Cache');

  const pictures = Array.from(
    new Set(rawGalleryList.map((u) => remoteToLocalMap.get(u) || u).filter(Boolean))
  );

  const normalizedVariations: ProductVariation[] = preCachedVariations.map((v) => ({
    ...v,
    image: v.image ? remoteToLocalMap.get(v.image) || v.image : undefined,
  }));

  if (currencyDetected !== 'PKR' && salePriceRaw) {
    specifications['Original Listed Price'] = `${currencyDetected} ${salePriceRaw} (~Rs. ${ourPrice.toLocaleString('en-PK')} PKR)`;
  }
  specifications['Source Host'] = domain;

  if (name) {
    name = decodeHtmlEntities(name)
      .replace(/\s*[»|–—-]\s*(?:3M\s+)?Madina Market\s*$/i, '')
      .trim();
  }

  if (!name) {
    const slug = parsedUrl.pathname.split('/').filter(Boolean).pop() || domain;
    name = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const finalSku =
    sku ||
    `IMP-${domain.split('.')[0].slice(0, 4).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  if (tagSet.size === 0) {
    name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .forEach((w) => tagSet.add(w.replace(/[^a-z0-9]/g, '')));
  }

  const uniqueSizes: string[] = [];
  const seenSizeKeys = new Set<string>();
  const registerSize = (s?: string) => {
    const clean = (s || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seenSizeKeys.has(key)) {
      seenSizeKeys.add(key);
      uniqueSizes.push(clean);
    }
  };
  detectedSizes.forEach(registerSize);
  normalizedVariations.forEach((v) => registerSize(v.size || v.title || v.attributes?.Variant));

  const product: ProductItem = {
    id: `prod_imp_${Date.now()}`,
    name,
    urduName: '',
    category: decodeHtmlEntities(matchedCat?.name || categoryHints[0] || 'General Wholesale'),
    parentCategoryId: matchedCat?.parentCategoryId ? undefined : matchedCat?.id,
    subcategoryId: matchedCat?.parentCategoryId ? matchedCat.id : undefined,
    deliveryType: 'standard',
    sku: finalSku,
    costPrice,
    marketPrice,
    ourPrice,
    stockQty,
    minStockAlert: 10,
    salesCount: 0,
    totalRevenue: 0,
    totalProfit: 0,
    isWinningItem: false,
    badgeText: 'IMPORTED LOT',
    websiteUrl: finalUrl,
    sourceUrl: finalUrl,
    sourceWebsiteName: domain,
    imageUrl: pictures[0] || '',
    pictures,
    videoUrl: videoUrl || undefined,
    brand: brand || domain,
    shortDescription: shortDescription || details.slice(0, 260),
    details,
    description: details,
    specifications,
    features,
    tags: Array.from(tagSet).filter(Boolean),
    variations: normalizedVariations,
    sizes: uniqueSizes,
    sizeChart,
    status: 'draft',
    createdAt: new Date().toISOString().split('T')[0],
  };

  return {
    product,
    diagnostics: {
      strategiesUsed: strategiesUsed.length > 0 ? strategiesUsed : ['HTML Metadata'],
      currencyDetected,
      originalPriceText,
      imagesFound: pictures.length,
      imagesDownloaded,
      specsFound: Object.keys(specifications).length,
      featuresFound: features.length,
      variantsFound: normalizedVariations.length,
      videoFound: Boolean(videoUrl),
    },
  };
}
