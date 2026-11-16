import net from 'node:net';
import { CategoryRecord, ProductItem, ProductVariation } from '../types';
import { normalizeTextKey, UPCOMING_CATEGORY_ID } from '../utils/locationCategoryHelpers';

export interface ScrapeDiagnostics {
  strategiesUsed: string[];
  currencyDetected: string;
  originalPriceText?: string;
  imagesFound: number;
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
  if (cleaned.startsWith('//')) cleaned = `https:${cleaned}`;
  try {
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function isLikelyProductImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('favicon')) return false;
  const blockedPatterns = [
    'logo',
    'icon',
    'sprite',
    'avatar',
    'placeholder',
    'spinner',
    'loader',
    'badge',
    'payment',
    'visa',
    'mastercard',
    'jazzcash-logo',
    'easypaisa-logo',
    'flag',
    'social',
    'facebook',
    'instagram',
    'tiktok',
    'whatsapp-icon',
    '1x1',
    'pixel',
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
  categories: CategoryRecord[]
): CategoryRecord | undefined {
  const active = categories.filter((c) => c.id !== UPCOMING_CATEGORY_ID && !c.isUpcoming && c.isActive !== false);
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
        `${domain} blocked automated fetching (HTTP ${attempt.status}). Open the product page in your browser, copy Page Source (Ctrl+U → Ctrl+A → Ctrl+C), and paste it into "Paste HTML Source" below.`
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
  featured_image?: { src?: string } | null;
}

interface ShopifyProductJson {
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string | string[];
  images?: Array<{ src?: string; id?: number | string }>;
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

function extractWooVariationsFromHtml(html: string, finalUrl: string): ProductVariation[] {
  const match = html.match(/data-product_variations=["']([\s\S]*?)["']/i);
  if (!match?.[1]) return [];
  try {
    const raw = decodeHtmlEntities(match[1]);
    const list = JSON.parse(raw) as Array<{
      variation_id?: number | string;
      sku?: string;
      display_price?: number;
      display_regular_price?: number;
      is_in_stock?: boolean;
      max_qty?: number;
      attributes?: Record<string, string>;
      image?: { url?: string; full_src?: string };
    }>;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 25).map((v, idx) => {
      const attrs: Record<string, string> = {};
      if (v.attributes) {
        Object.entries(v.attributes).forEach(([k, val]) => {
          if (val) {
            const cleanKey = k.replace(/^attribute_(pa_)?/i, '').replace(/[-_]/g, ' ');
            attrs[cleanKey || `Option ${idx + 1}`] = String(val);
          }
        });
      }
      const salePrice = typeof v.display_price === 'number' ? Math.round(v.display_price) : 0;
      const regularPrice =
        typeof v.display_regular_price === 'number' ? Math.round(v.display_regular_price) : salePrice;
      return {
        id: `var_woo_${Date.now()}_${idx + 1}`,
        sku: v.sku || `WOO-V${idx + 1}`,
        attributes: Object.keys(attrs).length > 0 ? attrs : { Variant: `Option ${idx + 1}` },
        size: attrs.size || attrs.Size || Object.values(attrs)[0] || undefined,
        color: attrs.color || attrs.Color || attrs.colour || undefined,
        originalPrice: regularPrice,
        salePrice,
        stockQty: v.is_in_stock === false ? 0 : typeof v.max_qty === 'number' && v.max_qty > 0 ? v.max_qty : 25,
        image: resolveAbsoluteUrl(v.image?.full_src || v.image?.url, finalUrl) || undefined,
      };
    });
  } catch {
    return [];
  }
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
      if (types.some((t) => t.toLowerCase() === 'product' || t.toLowerCase().endsWith('/product'))) {
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

export async function scrapeProductFromUrl(
  rawUrl: string,
  categories: CategoryRecord[],
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
      // Before failing, if URL looks like a Shopify /products/ URL, try direct .json endpoint
      if (parsedUrl.pathname.toLowerCase().includes('/products/')) {
        directShopifyProd = await tryFetchShopifyProductJson(parsedUrl, '', true);
      }
      if (!directShopifyProd) {
        throw fetchErr;
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
  const imageSet = new Set<string>();
  const specifications: Record<string, string> = {};
  const features: string[] = [];
  const tagSet = new Set<string>();
  const categoryHints: string[] = [];
  const variations: ProductVariation[] = [];

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
        const abs = resolveAbsoluteUrl(val, finalUrl);
        if (abs && isLikelyProductImage(abs)) imageSet.add(abs);
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
    (shopifyProd.images || []).forEach((img) => {
      const abs = resolveAbsoluteUrl(img.src, finalUrl);
      if (abs) imageSet.add(abs);
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

      variantsList.slice(0, 25).forEach((v, idx) => {
        const attrs: Record<string, string> = {};
        if (v.option1 && v.option1 !== 'Default Title') attrs[optNames[0] || 'Option 1'] = v.option1;
        if (v.option2) attrs[optNames[1] || 'Option 2'] = v.option2;
        if (v.option3) attrs[optNames[2] || 'Option 3'] = v.option3;
        if (Object.keys(attrs).length === 0 && v.title && v.title !== 'Default Title') {
          attrs['Variant'] = v.title;
        }
        const vPrice = parseNumericPrice(v.price) || salePriceRaw || 0;
        const vComp = parseNumericPrice(v.compare_at_price) || marketPriceRaw || vPrice;
        variations.push({
          id: `var_imp_${Date.now()}_${idx + 1}`,
          sku: v.sku || `${sku || 'IMP'}-V${idx + 1}`,
          attributes: Object.keys(attrs).length > 0 ? attrs : { Edition: 'Standard' },
          size: attrs[optNames[0] || ''] || v.option1 || undefined,
          color: attrs['Color'] || attrs['Colour'] || v.option2 || undefined,
          originalPrice: Math.round(vComp),
          salePrice: Math.round(vPrice),
          stockQty: typeof v.inventory_quantity === 'number' && v.inventory_quantity > 0 ? v.inventory_quantity : v.available === false ? 0 : 25,
          image: resolveAbsoluteUrl(v.featured_image?.src, finalUrl) || undefined,
        });
      });
    }
  }

  // 3. Parse JSON-LD Product Schema
  const jsonLdProducts = collectJsonLdProducts(html);
  if (jsonLdProducts.length > 0) {
    strategiesUsed.push('JSON-LD Product Schema');
    for (const jp of jsonLdProducts) {
      if (!name && typeof jp.name === 'string') name = decodeHtmlEntities(jp.name).trim();
      if (!sku && (typeof jp.sku === 'string' || typeof jp.mpn === 'string')) {
        sku = String(jp.sku || jp.mpn).trim();
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

      const collectLdImages = (imgNode: unknown) => {
        if (!imgNode) return;
        if (typeof imgNode === 'string') {
          const abs = resolveAbsoluteUrl(imgNode, finalUrl);
          if (abs) imageSet.add(abs);
        } else if (Array.isArray(imgNode)) {
          imgNode.forEach(collectLdImages);
        } else if (typeof imgNode === 'object') {
          const rec = imgNode as Record<string, unknown>;
          collectLdImages(rec.url || rec.contentUrl);
        }
      };
      collectLdImages(jp.image);

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
      // Strip trailing " | StoreName" or " - StoreName" when long
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

  if (!details) {
    // Try common product description containers before falling back to meta
    const descBlocks = [
      /<div[^>]*(?:id|class)=["'][^"']*(?:product[-_ ]?description|woocommerce-product-details__short-description|tab-description|pdp-product-desc|product-details)[^"']*["'][^>]*>([\s\S]{30,5000}?)<\/div>/i,
      /<section[^>]*(?:id|class)=["'][^"']*(?:description|details)[^"']*["'][^>]*>([\s\S]{30,5000}?)<\/section>/i,
    ];
    for (const pat of descBlocks) {
      const m = html.match(pat);
      if (m && m[1]) {
        const text = stripHtmlTags(m[1]);
        if (text.length > 35) {
          details = text.slice(0, 2000);
          strategiesUsed.push('HTML Product Description');
          break;
        }
      }
    }
    if (!details) details = shortDescription || `Imported product from ${domain}`;
  }
  if (!shortDescription && details) {
    shortDescription = details.slice(0, 260);
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
    // Check common JSON/inline price properties or currency expressions near price classes
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

  // Gallery Image HTML Extraction (collect high-res zoom/data-src/srcset/img tags)
  const imgTagRegex = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRegex.exec(html)) !== null && imageSet.size < 16) {
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
      const abs = resolveAbsoluteUrl(c, finalUrl);
      if (abs && isLikelyProductImage(abs)) {
        imageSet.add(abs);
        break;
      }
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

  // Specifications Table & <dl> Extraction
  const tableRowRegex = /<tr[^>]*>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = tableRowRegex.exec(html)) !== null && Object.keys(specifications).length < 18) {
    const k = stripHtmlTags(rowMatch[1]).replace(/:$/, '').trim();
    const v = stripHtmlTags(rowMatch[2]).trim();
    if (k && v && k.length <= 45 && v.length <= 180 && !k.toLowerCase().includes('total')) {
      specifications[k] = v;
    }
  }
  const dlRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let dlMatch: RegExpExecArray | null;
  while ((dlMatch = dlRegex.exec(html)) !== null && Object.keys(specifications).length < 18) {
    const k = stripHtmlTags(dlMatch[1]).replace(/:$/, '').trim();
    const v = stripHtmlTags(dlMatch[2]).trim();
    if (k && v && k.length <= 45 && v.length <= 180) {
      specifications[k] = v;
    }
  }

  // Bullet Features Extraction from <ul><li> inside descriptions or general meaningful bullets
  const liRegex = /<li[^>]*>([\s\S]{10,220}?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  const featureSeen = new Set<string>();
  while ((liMatch = liRegex.exec(html)) !== null && features.length < 8) {
    // Ignore nav/menu <li> containing nested links
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

  // 5. WooCommerce Embedded Variations Fallback
  if (variations.length === 0 && html) {
    const wooVars = extractWooVariationsFromHtml(html, finalUrl);
    if (wooVars.length > 0) {
      variations.push(...wooVars);
      strategiesUsed.push('WooCommerce Variations JSON');
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

  // Adjust variation prices to PKR if foreign currency detected
  const normalizedVariations = variations.map((v) => ({
    ...v,
    originalPrice: v.originalPrice ? convertToPkrIfForeign(v.originalPrice, currencyDetected) : marketPrice,
    salePrice: v.salePrice ? convertToPkrIfForeign(v.salePrice, currencyDetected) : ourPrice,
  }));

  if (currencyDetected !== 'PKR' && salePriceRaw) {
    specifications['Original Listed Price'] = `${currencyDetected} ${salePriceRaw} (~Rs. ${ourPrice.toLocaleString('en-PK')} PKR)`;
  }
  specifications['Source Host'] = domain;

  const pictures = Array.from(imageSet);
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

  const product: ProductItem = {
    id: `prod_imp_${Date.now()}`,
    name,
    urduName: '',
    category: matchedCat?.name || categoryHints[0] || 'General Wholesale',
    parentCategoryId: matchedCat?.parentCategoryId ? undefined : matchedCat?.id,
    subcategoryId: matchedCat?.parentCategoryId ? matchedCat.id : undefined,
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
    sizes: normalizedVariations.map((v) => v.size || v.attributes?.Variant || '').filter(Boolean),
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
      specsFound: Object.keys(specifications).length,
      featuresFound: features.length,
      variantsFound: normalizedVariations.length,
      videoFound: Boolean(videoUrl),
    },
  };
}
