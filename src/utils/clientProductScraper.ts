import {
  CategoryRecord,
  ProductItem,
  ProductSizeChart,
  ProductSizeChartRow,
  ProductVariation,
} from '../types';
import { normalizeTextKey, UPCOMING_CATEGORY_ID } from './locationCategoryHelpers';

export interface ClientScrapeDiagnostics {
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

function cleanText(raw: string | null | undefined): string {
  return decodeHtmlEntities(String(raw || ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
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

function parseNumericPrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  if (!cleaned) return null;
  const val = parseFloat(cleaned[0]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function convertToPkrIfForeign(amount: number, currency: string): number {
  const c = (currency || 'PKR').toUpperCase();
  const rates: Record<string, number> = {
    PKR: 1,
    RS: 1,
    USD: 278,
    EUR: 300,
    GBP: 352,
    AED: 75.7,
    SAR: 74.1,
    CNY: 38.5,
  };
  return Math.round(amount * (rates[c] || 1));
}

function resolveAbsoluteUrl(candidate: string | null | undefined, baseUrl: string): string | null {
  if (!candidate) return null;
  let cleaned = decodeHtmlEntities(String(candidate)).trim();
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('javascript:')) return null;
  cleaned = cleaned.replace(/\{width\}|%7Bwidth%7D/gi, '1200').replace(/\{height\}|%7Bheight%7D/gi, '1200');
  if (cleaned.startsWith('//')) cleaned = `https:${cleaned}`;
  try {
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function isLikelyProductImage(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  if (lower.startsWith('data:image/svg')) return false;
  if (/(logo|favicon|sprite|spinner|loader|placeholder|avatar|badge|payment-icon)/i.test(lower)) {
    return false;
  }
  if (/\.svg(\?|$)/i.test(lower)) return false;
  return true;
}

function upgradeImageUrl(rawUrl: string): string {
  return rawUrl
    .replace(/_(pico|icon|thumb|small|compact|medium)(_crop_center)?(\.(?:jpe?g|png|webp|gif))(\?.*)?$/i, '$3$4')
    .replace(/-(?:1[0-9]{2}|2[0-9]{2}|300)x(?:1[0-9]{2}|2[0-9]{2}|300)(\.(?:jpe?g|png|webp|gif))(\?.*)?$/i, '$1$2');
}

function formatRichElementText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, noscript, table').forEach((n) => n.remove());

  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/[ \t]+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (tag === 'li') {
      const inner = cleanText((node as Element).textContent);
      if (inner) parts.push(`\n• ${inner}`);
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const inner = cleanText((node as Element).textContent);
      if (inner) parts.push(`\n\n${inner}\n`);
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
    if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol'].includes(tag)) {
      parts.push('\n\n');
    }
  };

  walk(clone);
  return decodeHtmlEntities(parts.join(''))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSizeColLabel(rawHeader: string): string {
  const s = cleanText(rawHeader);
  if (/^s$/i.test(s)) return 'Small (S)';
  if (/^m$/i.test(s)) return 'Medium (M)';
  if (/^l$/i.test(s)) return 'Large (L)';
  return s;
}

function looksLikeSizeHeaderCell(header: string): boolean {
  const h = header.trim().toLowerCase();
  return /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|small|medium|large|free\s*size|one\s*size|standard|size\s*\d+|\d{2,3})$/i.test(
    h.replace(/\s*\([^)]*\)/g, '').trim()
  );
}

function matchCategoryRecord(hints: string[], categories: CategoryRecord[]): CategoryRecord | undefined {
  const normHints = hints.map((h) => normalizeTextKey(decodeHtmlEntities(h))).filter(Boolean);
  for (const h of normHints) {
    const exact = categories.find(
      (c) => c.id !== UPCOMING_CATEGORY_ID && normalizeTextKey(c.name) === h
    );
    if (exact) return exact;
  }
  for (const h of normHints) {
    const partial = categories.find(
      (c) =>
        c.id !== UPCOMING_CATEGORY_ID &&
        (h.includes(normalizeTextKey(c.name)) || normalizeTextKey(c.name).includes(h))
    );
    if (partial) return partial;
  }
  return undefined;
}

export function parseProductFromHtmlInBrowser(
  sourceUrl: string,
  html: string,
  categories: CategoryRecord[]
): { product: ProductItem; diagnostics: ClientScrapeDiagnostics } {
  const fallbackOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://localhost';
  const safeUrl = sourceUrl || `${fallbackOrigin}/products/imported-item`;
  const parsedUrl = new URL(safeUrl);
  const domain = parsedUrl.hostname.replace(/^www\./, '');
  const strategiesUsed: string[] = [];

  const doc = new DOMParser().parseFromString(html, 'text/html');

  const metaMap = new Map<string, string>();
  doc.querySelectorAll('meta').forEach((m) => {
    const k = (m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop') || '')
      .toLowerCase()
      .trim();
    const v = (m.getAttribute('content') || '').trim();
    if (k && v && !metaMap.has(k)) metaMap.set(k, v);
  });
  if (metaMap.size > 0) strategiesUsed.push('OpenGraph & Meta');

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
  const detectedSizes: string[] = [];

  const addImg = (raw?: string | null): string | null => {
    const abs = resolveAbsoluteUrl(raw, safeUrl);
    if (!abs || !isLikelyProductImage(abs)) return null;
    const up = upgradeImageUrl(abs);
    imageSet.add(up);
    return up;
  };

  for (const k of ['og:image', 'og:image:secure_url', 'twitter:image']) {
    if (metaMap.get(k)) addImg(metaMap.get(k));
  }
  const currencyMeta = metaMap.get('product:price:currency') || metaMap.get('og:price:currency');
  if (currencyMeta) currencyDetected = currencyMeta.toUpperCase();
  const priceMeta = metaMap.get('product:price:amount') || metaMap.get('og:price:amount');
  if (priceMeta) salePriceRaw = parseNumericPrice(priceMeta);

  // 1. JSON-LD Product schema
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const parsed = JSON.parse((script.textContent || '').trim());
      const queue: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? [...parsed]
        : parsed && typeof parsed === 'object'
        ? [parsed]
        : [];
      const products: Array<Record<string, unknown>> = [];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur['@graph'])) {
          cur['@graph'].forEach((g) => {
            if (g && typeof g === 'object') queue.push(g as Record<string, unknown>);
          });
        }
        const t = cur['@type'];
        const isProd =
          t === 'Product' ||
          t === 'ProductGroup' ||
          (Array.isArray(t) && (t.includes('Product') || t.includes('ProductGroup')));
        if (isProd) products.push(cur);
      }

      if (products.length > 0 && !strategiesUsed.includes('JSON-LD Product Schema')) {
        strategiesUsed.push('JSON-LD Product Schema');
      }

      for (const jp of products) {
        if (!name && typeof jp.name === 'string') name = cleanText(jp.name);
        if (!sku && (typeof jp.sku === 'string' || typeof jp.mpn === 'string')) {
          sku = String(jp.sku || jp.mpn).trim();
        }
        if (!brand && jp.brand) {
          if (typeof jp.brand === 'string') brand = cleanText(jp.brand);
          else if (typeof jp.brand === 'object' && typeof (jp.brand as Record<string, unknown>).name === 'string') {
            brand = cleanText(String((jp.brand as Record<string, unknown>).name));
          }
        }
        if (!details && typeof jp.description === 'string') {
          details = decodeHtmlEntities(jp.description).replace(/<[^>]+>/g, ' ').trim();
        }
        if (typeof jp.category === 'string') categoryHints.push(decodeHtmlEntities(jp.category));

        const imgs = Array.isArray(jp.image) ? jp.image : jp.image ? [jp.image] : [];
        imgs.forEach((im) => {
          if (typeof im === 'string') addImg(im);
          else if (im && typeof im === 'object') {
            const r = im as Record<string, unknown>;
            addImg(String(r.url || r.contentUrl || ''));
          }
        });

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
    } catch {
      // ignore malformed ld+json block
    }
  });

  // 2. Title, brand & descriptions
  if (!name) {
    const h1Text = cleanText(doc.querySelector('h1')?.textContent);
    const ogTitle = cleanText(metaMap.get('og:title') || metaMap.get('title'));
    const titleText = cleanText(doc.querySelector('title')?.textContent);
    const rawTitle = h1Text || ogTitle || titleText;
    if (rawTitle) {
      name = rawTitle.replace(/\s+[|\-–—»]\s+[^|\-–—»]{2,35}$/, '').trim() || rawTitle;
      strategiesUsed.push('HTML Title/H1');
    }
  }
  if (name) {
    name = name.replace(/\s*[»|–—-]\s*(?:3M\s+)?Madina Market\s*$/i, '').trim();
  }

  if (!brand) {
    brand = cleanText(metaMap.get('product:brand') || metaMap.get('og:site_name')) || domain.split('.')[0].toUpperCase();
  }

  const descEl =
    doc.querySelector('#tab-description') ||
    doc.querySelector('.woocommerce-Tabs-panel--description') ||
    doc.querySelector('.product__description') ||
    doc.querySelector('#productDescription') ||
    doc.querySelector('.pdp-product-desc');
  if (descEl) {
    const formatted = formatRichElementText(descEl);
    if (formatted.length > details.length) {
      details = formatted.slice(0, 3200);
      strategiesUsed.push('Structured HTML Description');
    }
  }

  const shortEl = doc.querySelector('.woocommerce-product-details__short-description');
  if (shortEl) {
    const formattedShort = formatRichElementText(shortEl);
    if (!shortDescription && formattedShort) {
      shortDescription = formattedShort.split('\n')[0].slice(0, 280);
    }
    if (!details && formattedShort) details = formattedShort.slice(0, 2200);
  }
  if (!shortDescription) {
    shortDescription = cleanText(metaMap.get('og:description') || metaMap.get('description')).slice(0, 280);
  }
  if (!details) details = shortDescription || `Imported product from ${domain}`;

  // 3. Price fallback from DOM if missing
  if (!salePriceRaw) {
    const priceNode = doc.querySelector('.price ins .amount, .price .amount, [itemprop="price"]');
    if (priceNode) {
      const txt = cleanText(priceNode.textContent);
      const n = parseNumericPrice(txt);
      if (n) {
        salePriceRaw = n;
        originalPriceText = txt;
      }
    }
    const delNode = doc.querySelector('.price del .amount');
    if (delNode) {
      const n = parseNumericPrice(cleanText(delNode.textContent));
      if (n && (!salePriceRaw || n >= salePriceRaw)) marketPriceRaw = n;
    }
  }

  // 4. Gallery images
  doc.querySelectorAll('img').forEach((img) => {
    if (imageSet.size >= 20) return;
    const candidates = [
      img.getAttribute('data-zoom-image'),
      img.getAttribute('data-large_image'),
      img.getAttribute('data-large-image'),
      img.getAttribute('data-old-hires'),
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('src'),
    ];
    for (const c of candidates) {
      if (addImg(c)) break;
    }
  });

  // 5. Tables -> Structured Size Chart + Technical Specifications
  doc.querySelectorAll('table').forEach((table) => {
    const rows: string[][] = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => cleanText(c.textContent));
      if (cells.length >= 2 && cells.some(Boolean)) rows.push(cells);
    });
    if (rows.length === 0) return;

    const firstRow = rows[0];
    const hasMeasurementHeader =
      firstRow.length >= 3 &&
      (firstRow.slice(1).some((h) => looksLikeSizeHeaderCell(h)) ||
        /^(measurement|size|dimension|chest|length|waist)/i.test(firstRow[0] || ''));

    if (!sizeChart && hasMeasurementHeader && rows.length >= 2) {
      const cols = firstRow.slice(1).map((c) => normalizeSizeColLabel(c)).filter(Boolean);
      const chartRows: ProductSizeChartRow[] = [];
      rows.slice(1).forEach((r) => {
        const label = cleanSpecLabel(r[0] || '');
        if (!label || /^(measurement|attribute|property)$/i.test(label)) return;
        const vals = cols.map((_, idx) => r[idx + 1] || '—');
        if (vals.some((v) => v && v !== '—')) {
          chartRows.push({ label, values: vals });
        }
      });
      if (cols.length >= 2 && chartRows.length >= 1) {
        const joined = chartRows.flatMap((r) => r.values).join(' ').toLowerCase();
        sizeChart = {
          columns: cols,
          rows: chartRows,
          unit: /\bcm\b/.test(joined) ? 'cm' : 'in',
        };
        cols.forEach((c) => detectedSizes.push(c));
        strategiesUsed.push('Structured Size Chart');
        return;
      }
    }

    rows.forEach((r) => {
      if (r.length === 2 && Object.keys(specifications).length < 20) {
        const k = cleanSpecLabel(r[0]);
        const v = r[1];
        if (!k || !v || k.length > 48 || v.length > 220) return;
        if (/^(attribute|property|specification)$/i.test(k) && /^(details?|value)$/i.test(v)) return;
        const dup = Object.keys(specifications).find((ex) => ex.toLowerCase() === k.toLowerCase());
        if (!dup) specifications[k] = v;
      }
    });
  });

  // 6. Bullet features
  const featSeen = new Set<string>();
  const featureScope = descEl || doc.body;
  featureScope?.querySelectorAll('li').forEach((li) => {
    if (features.length >= 8) return;
    if (li.querySelector('a, nav, button')) return;
    const text = cleanText(li.textContent);
    if (
      text.length >= 12 &&
      text.length <= 180 &&
      !/home|login|cart|checkout|privacy|terms|contact|menu|copyright/i.test(text) &&
      !featSeen.has(text.toLowerCase())
    ) {
      featSeen.add(text.toLowerCase());
      features.push(text);
    }
  });

  // 7. WooCommerce Variations JSON
  const varForm = doc.querySelector('form.variations_form[data-product_variations]');
  if (varForm) {
    const labelMap = new Map<string, string>();
    varForm.querySelectorAll('select option').forEach((opt) => {
      const slug = (opt.getAttribute('value') || '').trim();
      const label = cleanText(opt.textContent);
      if (slug && label && !/choose an option/i.test(label)) {
        labelMap.set(slug.toLowerCase(), label);
      }
    });

    try {
      const rawJson = decodeHtmlEntities(varForm.getAttribute('data-product_variations') || '[]');
      const parsedVars = JSON.parse(rawJson) as Array<Record<string, unknown>>;
      parsedVars.slice(0, 30).forEach((v, idx) => {
        const rawAttrs = (v.attributes && typeof v.attributes === 'object' ? v.attributes : {}) as Record<string, string>;
        const attrs: Record<string, string> = {};
        let sizeVal: string | undefined;
        let colorVal: string | undefined;

        for (const [ak, av] of Object.entries(rawAttrs)) {
          if (!av) continue;
          const cleanKey = ak.replace(/^attribute_(pa_)?/i, '').replace(/[_-]+/g, ' ').trim();
          const niceKey = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);
          const resolved = labelMap.get(String(av).toLowerCase()) || String(av).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          attrs[niceKey] = resolved;
          if (/size/i.test(niceKey)) sizeVal = resolved;
          else if (/colou?r|shade/i.test(niceKey)) colorVal = resolved;
        }

        const vImgObj = v.image as Record<string, unknown> | undefined;
        const vImg = vImgObj ? addImg(String(vImgObj.full_src || vImgObj.url || vImgObj.src || '')) || undefined : undefined;
        const displayPrice = parseNumericPrice(v.display_price) || salePriceRaw || 0;
        const regularPrice = parseNumericPrice(v.display_regular_price) || marketPriceRaw || displayPrice;
        const title = [sizeVal, colorVal, ...Object.values(attrs).filter((x) => x !== sizeVal && x !== colorVal)]
          .filter(Boolean)
          .join(' · ') || `Variant ${idx + 1}`;

        variations.push({
          id: `var_cli_${Date.now()}_${idx + 1}`,
          title,
          sku: typeof v.sku === 'string' && v.sku.trim() ? v.sku.trim() : `${sku || 'IMP'}-V${idx + 1}`,
          attributes: attrs,
          size: sizeVal,
          color: colorVal,
          details: Object.entries(attrs).map(([k, val]) => `${k}: ${val}`).join(' · ') || undefined,
          originalPrice: Math.round(regularPrice),
          salePrice: Math.round(displayPrice),
          stockQty: v.is_in_stock === false ? 0 : 25,
          image: vImg,
        });
      });
      if (variations.length > 0) strategiesUsed.push('WooCommerce Variations JSON');
    } catch {
      // ignore invalid JSON
    }
  }

  // Breadcrumb category hints
  const bcEl = doc.querySelector('.woocommerce-breadcrumb, nav[aria-label*="breadcrumb" i], .breadcrumb');
  if (bcEl) {
    cleanText(bcEl.textContent)
      .split(/[›>/|]/)
      .map((s) => decodeHtmlEntities(s).trim())
      .filter((s) => s.length > 2 && !/^home$/i.test(s))
      .slice(0, 3)
      .forEach((c) => categoryHints.push(c));
  }

  const matchedCat = matchCategoryRecord([...categoryHints, name, ...Array.from(tagSet)], categories);
  const ourPrice = salePriceRaw ? convertToPkrIfForeign(salePriceRaw, currencyDetected) : 0;
  const marketPrice = marketPriceRaw
    ? convertToPkrIfForeign(marketPriceRaw, currencyDetected)
    : ourPrice > 0
    ? Math.round(ourPrice * 1.25)
    : 0;
  const costPrice = ourPrice > 0 ? Math.round(ourPrice * 0.68) : 0;

  if (!videoUrl) {
    const videoSrc =
      doc.querySelector('video source[src], video[src]')?.getAttribute('src') ||
      doc.querySelector('iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"]')?.getAttribute('src');
    if (videoSrc) {
      videoUrl = resolveAbsoluteUrl(videoSrc, safeUrl) || '';
    }
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
  variations.forEach((v) => registerSize(v.size || v.title));

  if (!name) {
    const slug = parsedUrl.pathname.split('/').filter(Boolean).pop() || domain;
    name = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const pictures = Array.from(imageSet).slice(0, 20);
  specifications['Source Host'] = domain;

  const product: ProductItem = {
    id: `prod_imp_${Date.now()}`,
    name,
    urduName: '',
    category: decodeHtmlEntities(matchedCat?.name || categoryHints[0] || 'General Wholesale'),
    parentCategoryId: matchedCat?.parentCategoryId ? undefined : matchedCat?.id,
    subcategoryId: matchedCat?.parentCategoryId ? matchedCat.id : undefined,
    deliveryType: 'standard',
    sku: sku || `IMP-${domain.split('.')[0].slice(0, 4).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
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
    websiteUrl: safeUrl,
    sourceUrl: safeUrl,
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
    tags: Array.from(tagSet),
    variations,
    sizes: uniqueSizes,
    sizeChart,
    status: 'draft',
    createdAt: new Date().toISOString().split('T')[0],
  };

  return {
    product,
    diagnostics: {
      strategiesUsed: strategiesUsed.length > 0 ? [...strategiesUsed, 'Browser HTML Engine'] : ['Browser HTML Engine'],
      currencyDetected,
      originalPriceText,
      imagesFound: pictures.length,
      imagesDownloaded: 0,
      specsFound: Object.keys(specifications).length,
      featuresFound: features.length,
      variantsFound: variations.length,
      videoFound: Boolean(videoUrl),
    },
  };
}

export async function tryFetchProductInBrowserFallback(
  targetUrl: string,
  categories: CategoryRecord[]
): Promise<{ ok: boolean; product?: ProductItem; diagnostics?: ClientScrapeDiagnostics; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }

  // 1. Try Shopify .json endpoint directly if URL contains /products/<handle>
  const shopifyMatch = parsed.pathname.match(/\/products\/([^/?#]+)/i);
  if (shopifyMatch?.[1]) {
    try {
      const jsonUrl = `${parsed.origin}/products/${shopifyMatch[1].replace(/\.json$/i, '')}.json`;
      const res = await fetch(jsonUrl, { mode: 'cors', signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const data = (await res.json()) as { product?: Record<string, unknown> };
        if (data?.product && typeof data.product.title === 'string') {
          const syntheticHtml = `<html><head><title>${data.product.title}</title></head><body><h1>${data.product.title}</h1><div id="tab-description">${String(data.product.body_html || '')}</div></body></html>`;
          const parsedResult = parseProductFromHtmlInBrowser(targetUrl, syntheticHtml, categories);
          const imgs = Array.isArray(data.product.images)
            ? (data.product.images as Array<{ src?: string }>).map((i) => i.src).filter((x): x is string => Boolean(x))
            : [];
          if (imgs.length > 0) {
            parsedResult.product.pictures = imgs;
            parsedResult.product.imageUrl = imgs[0];
          }
          parsedResult.diagnostics.strategiesUsed = ['Shopify JSON Direct'];
          return { ok: true, product: parsedResult.product, diagnostics: parsedResult.diagnostics };
        }
      }
    } catch {
      // continue to proxy/HTML bridges
    }
  }

  // 2. Try direct CORS fetch of HTML page
  try {
    const directRes = await fetch(targetUrl, { mode: 'cors', signal: AbortSignal.timeout(7000) });
    if (directRes.ok) {
      const html = await directRes.text();
      if (html && html.length > 400 && /<title|<h1|<meta/i.test(html)) {
        return { ok: true, ...parseProductFromHtmlInBrowser(targetUrl, html, categories) };
      }
    }
  } catch {
    // CORS not enabled on remote host; proceed to CORS bridge
  }

  // 3. Try CORS bridge fetchers
  const bridges = [
    async () => {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { contents?: string };
      return j?.contents || null;
    },
    async () => {
      const r = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) return null;
      return await r.text();
    },
  ];

  for (const fetcher of bridges) {
    try {
      const html = await fetcher();
      if (html && html.length > 400 && /<title|<h1|<meta/i.test(html)) {
        return { ok: true, ...parseProductFromHtmlInBrowser(targetUrl, html, categories) };
      }
    } catch {
      // try next bridge
    }
  }

  return {
    ok: false,
    error:
      'Could not reach the backend scraper or direct store page (blocked by host/CORS). Click "Paste HTML Source" below (Ctrl+U -> Ctrl+A -> Ctrl+C on the product page) and click "Extract from Pasted HTML" — it parses directly in your browser.',
  };
}
