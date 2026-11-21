import React, { useMemo, useState } from 'react';
import { Ruler, FileText, SlidersHorizontal, Layers, Check } from 'lucide-react';
import { ProductItem, ProductSizeChart, ProductVariation } from '../types/index.ts';
import { normalizeTextKey } from '../utils/locationCategoryHelpers.ts';

interface ProductSpecSizingShowcaseProps {
  product: ProductItem;
  selectedSize?: string;
  activeVariation?: ProductVariation | null;
  onSelectSizeOrVariant?: (sizeLabel: string) => void;
}

type DossierTab = 'all' | 'sizing' | 'specs' | 'story';

function stripLeadingDecorativeSymbols(raw: string): string {
  return raw
    .replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D\s]+/gu, '')
    .trim();
}

function convertMeasurementCell(cell: string, targetUnit: 'in' | 'cm'): string {
  const trimmed = (cell || '').trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return trimmed || '—';

  const inchMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/i);
  if (inchMatch) {
    const val = parseFloat(inchMatch[1]);
    if (!Number.isFinite(val)) return trimmed;
    if (targetUnit === 'cm') {
      return `${(val * 2.54).toFixed(1).replace(/\.0$/, '')} cm`;
    }
    return `${val} in`;
  }

  const cmMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)$/i);
  if (cmMatch) {
    const val = parseFloat(cmMatch[1]);
    if (!Number.isFinite(val)) return trimmed;
    if (targetUnit === 'in') {
      return `${(val / 2.54).toFixed(1).replace(/\.0$/, '')} in`;
    }
    return `${val} cm`;
  }

  return trimmed;
}

function inferSizeChartFromProduct(product: ProductItem): ProductSizeChart | null {
  if (product.sizeChart && product.sizeChart.columns.length > 0 && product.sizeChart.rows.length > 0) {
    return product.sizeChart;
  }

  // Fallback: detect multi-line measurement specs from earlier imports (e.g. "38 in \n 39 in \n 40 in \n 41 in")
  const specs = product.specifications || {};
  const multilineMeasureEntries = Object.entries(specs).filter(([_k, v]) => {
    const lines = String(v || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length >= 2 && lines.some((l) => /\d+\s*(?:in|cm|mm|inch)/i.test(l));
  });

  if (multilineMeasureEntries.length === 0) {
    return null;
  }

  const maxLen = Math.max(
    ...multilineMeasureEntries.map(([_k, v]) => String(v).split(/\n+/).filter((s) => s.trim()).length)
  );
  const candidateSizes = Array.from(
    new Set(
      [
        ...(product.sizes || []),
        ...((product.variations || []).map((v) => v.size || '').filter(Boolean)),
      ].filter(Boolean)
    )
  );

  const defaultColLabels =
    candidateSizes.length >= maxLen
      ? candidateSizes.slice(0, maxLen)
      : maxLen === 4
      ? ['Small (S)', 'Medium (M)', 'Large (L)', 'XL']
      : maxLen === 3
      ? ['Small (S)', 'Medium (M)', 'Large (L)']
      : Array.from({ length: maxLen }, (_, idx) => candidateSizes[idx] || `Size ${idx + 1}`);

  const rows = multilineMeasureEntries.map(([k, v]) => {
    const vals = String(v)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      label: stripLeadingDecorativeSymbols(k),
      values: defaultColLabels.map((_, i) => vals[i] || '—'),
    };
  });

  const joined = rows.flatMap((r) => r.values).join(' ').toLowerCase();
  const unit = /\bcm\b/.test(joined) ? 'cm' : 'in';

  return {
    columns: defaultColLabels,
    rows,
    unit,
  };
}

function isColumnActiveForSelection(colName: string, selectedSize?: string, activeVariation?: ProductVariation | null): boolean {
  const targets = [
    selectedSize,
    activeVariation?.size,
    activeVariation?.title,
  ]
    .filter(Boolean)
    .map((s) => normalizeTextKey(String(s)));

  if (targets.length === 0) return false;
  const colKey = normalizeTextKey(colName);
  const colBase = colKey.replace(/\s*\([^)]*\)/g, '').trim();
  const parenMatch = colName.match(/\(([^)]+)\)/);
  const colShort = parenMatch ? normalizeTextKey(parenMatch[1]) : '';

  return targets.some((t) => {
    const tokens = t.split(/[·/|,\s]+/).filter(Boolean);
    if (t === colKey || t === colBase || (colShort && t === colShort)) return true;
    return tokens.some((tok) => tok === colBase || (colShort && tok === colShort));
  });
}

function parseDescriptionBlocks(rawText: string): Array<
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string }
> {
  const clean = (rawText || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const rawLines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: Array<
    | { type: 'heading'; text: string }
    | { type: 'bullet'; text: string }
    | { type: 'paragraph'; text: string }
  > = [];

  for (const line of rawLines) {
    if (/^[•\-✓✔*]\s+/.test(line)) {
      blocks.push({ type: 'bullet', text: line.replace(/^[•\-✓✔*]\s+/, '').trim() });
    } else if (line.length <= 48 && /:$/.test(line)) {
      blocks.push({ type: 'heading', text: line.replace(/:$/, '').trim() });
    } else {
      blocks.push({ type: 'paragraph', text: line });
    }
  }
  return blocks;
}

export const ProductSpecSizingShowcase: React.FC<ProductSpecSizingShowcaseProps> = ({
  product,
  selectedSize,
  activeVariation,
  onSelectSizeOrVariant,
}) => {
  const sizeChart = useMemo(() => inferSizeChartFromProduct(product), [product]);
  const [unitMode, setUnitMode] = useState<'in' | 'cm'>(
    sizeChart?.unit === 'cm' ? 'cm' : 'in'
  );
  const [activeTab, setActiveTab] = useState<DossierTab>('all');

  const cleanSpecEntries = useMemo(() => {
    const rawSpecs = product.specifications || {};
    const seen = new Set<string>();
    const entries: Array<{ key: string; value: string }> = [];

    for (const [k, rawVal] of Object.entries(rawSpecs)) {
      const valStr = String(rawVal || '').trim();
      if (!valStr) continue;
      // Exclude noisy placeholder header pairs or multiline size rows already rendered cleanly in Size Chart
      const cleanK = stripLeadingDecorativeSymbols(k);
      const cleanV = stripLeadingDecorativeSymbols(valStr).replace(/\s*,\s*/g, ', ');
      if (!cleanK || !cleanV) continue;
      if (/^(attribute|property|specification)$/i.test(cleanK) && /^(details?|value)$/i.test(cleanV)) continue;
      if (sizeChart && valStr.includes('\n') && /\d+\s*(?:in|cm)/i.test(valStr)) continue;

      const dedupKey = cleanK.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      entries.push({ key: cleanK, value: cleanV.replace(/\n+/g, ' · ') });
    }
    return entries;
  }, [product.specifications, sizeChart]);

  const availableSizesList = useMemo(() => {
    const raw = [
      ...(sizeChart?.columns || []),
      ...(product.sizes || []),
      ...((product.variations || []).map((v) => v.size || '').filter(Boolean)),
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of raw) {
      const clean = s.trim();
      if (!clean) continue;
      const base = clean.replace(/\s*\([^)]*\)/g, '').toLowerCase();
      if (!seen.has(base)) {
        seen.add(base);
        out.push(clean);
      }
    }
    return out;
  }, [sizeChart, product.sizes, product.variations]);

  const featuresList = useMemo(
    () => (product.features || []).map((f) => f.trim()).filter(Boolean),
    [product.features]
  );

  const descriptionBlocks = useMemo(
    () => parseDescriptionBlocks(product.details || product.description || ''),
    [product.details, product.description]
  );

  const hasSizing = Boolean(sizeChart || availableSizesList.length > 0 || activeVariation);
  const hasSpecs = cleanSpecEntries.length > 0 || featuresList.length > 0;
  const hasStory = Boolean(product.shortDescription || descriptionBlocks.length > 0);

  if (!hasSizing && !hasSpecs && !hasStory) return null;

  const showSizing = (activeTab === 'all' || activeTab === 'sizing') && hasSizing;
  const showSpecs = (activeTab === 'all' || activeTab === 'specs') && hasSpecs;
  const showStory = (activeTab === 'all' || activeTab === 'story') && hasStory;

  return (
    <section
      id="product-dossier-section"
      className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-6"
    >
      {/* Editorial Dossier Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
            <span>Product Dossier</span>
            <span aria-hidden="true">·</span>
            <span className="font-urdu tracking-normal normal-case text-xs text-slate-600 dark:text-slate-300">
              سائزنگ چارٹ، تفصیلات اور خصوصیات
            </span>
          </div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
            Sizing, Technical Specs &amp; Complete Story
          </h2>
        </div>

        {/* Clean Segmented Switcher */}
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
          {(
            [
              { id: 'all', label: 'Complete View', show: true },
              { id: 'sizing', label: 'Sizing & Fit', show: hasSizing },
              { id: 'specs', label: 'Specs', show: hasSpecs },
              { id: 'story', label: 'Description', show: hasStory },
            ] as Array<{ id: DossierTab; label: string; show: boolean }>
          )
            .filter((t) => t.show)
            .map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
        </div>
      </div>

      {/* 1. INTERACTIVE SIZING & FIT MATRIX */}
      {showSizing && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Ruler className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Sizing &amp; Fit Blueprint
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {sizeChart
                    ? 'Garment measurements — click a size header to highlight or select that fit.'
                    : 'Available size & option breakdown for this item.'}
                </p>
              </div>
            </div>

            {sizeChart && (
              <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px]">
                <button
                  type="button"
                  onClick={() => setUnitMode('in')}
                  className={`px-2.5 py-1 rounded-md font-mono font-bold transition-colors cursor-pointer ${
                    unitMode === 'in'
                      ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  INCHES
                </button>
                <button
                  type="button"
                  onClick={() => setUnitMode('cm')}
                  className={`px-2.5 py-1 rounded-md font-mono font-bold transition-colors cursor-pointer ${
                    unitMode === 'cm'
                      ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  CM
                </button>
              </div>
            )}
          </div>

          {sizeChart ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
                    <th className="py-3 px-4 font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                      Measurement
                    </th>
                    {sizeChart.columns.map((col, cIdx) => {
                      const isColActive = isColumnActiveForSelection(col, selectedSize, activeVariation);
                      return (
                        <th
                          key={`${col}_${cIdx}`}
                          className={`py-3 px-4 text-center transition-colors ${
                            isColActive
                              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-t-2 border-t-amber-500'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectSizeOrVariant?.(col)}
                            className={`inline-flex items-center justify-center gap-1 font-extrabold text-xs tracking-tight ${
                              onSelectSizeOrVariant ? 'cursor-pointer hover:text-amber-700 dark:hover:text-amber-300' : ''
                            }`}
                          >
                            <span>{col}</span>
                            {isColActive && <Check className="w-3 h-3 text-amber-600 shrink-0" />}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sizeChart.rows.map((row, rIdx) => (
                    <tr
                      key={`${row.label}_${rIdx}`}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.label}
                      </td>
                      {sizeChart.columns.map((col, cIdx) => {
                        const isColActive = isColumnActiveForSelection(col, selectedSize, activeVariation);
                        const rawVal = row.values[cIdx] || '—';
                        const converted = convertMeasurementCell(rawVal, unitMode);
                        return (
                          <td
                            key={`${rIdx}_${cIdx}`}
                            className={`py-2.5 px-4 text-center font-mono tabular-nums transition-colors ${
                              isColActive
                                ? 'bg-amber-50/60 dark:bg-amber-950/30 font-bold text-slate-950 dark:text-white'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {converted}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            availableSizesList.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 py-2 border-y border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-2">
                  Available Sizes:
                </span>
                {availableSizesList.map((sz, i) => {
                  const isActive = isColumnActiveForSelection(sz, selectedSize, activeVariation);
                  return (
                    <button
                      key={`${sz}_${i}`}
                      type="button"
                      onClick={() => onSelectSizeOrVariant?.(sz)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-slate-900 text-white border-slate-900 dark:bg-amber-500 dark:text-slate-950 dark:border-amber-500'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                      }`}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Active Variant Quick Spec Strip */}
          {activeVariation && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700 dark:text-slate-200">
                <span className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-600" />
                  Selected Fit / Variant: {activeVariation.title || selectedSize}
                </span>
                {activeVariation.sku && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">|</span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      SKU {activeVariation.sku}
                    </span>
                  </>
                )}
                {activeVariation.details && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">|</span>
                    <span className="text-slate-600 dark:text-slate-300">{activeVariation.details}</span>
                  </>
                )}
              </div>
              <span className="font-mono tabular-nums text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                {(activeVariation.stockQty ?? 0) > 0
                  ? `${activeVariation.stockQty} units available`
                  : 'Made to order / Confirm'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 2. ARCHITECTURAL 2-COLUMN SPECS LEDGER & NUMBERED HIGHLIGHTS */}
      {showSpecs && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Technical Spec Ledger */}
          {cleanSpecEntries.length > 0 && (
            <div className={featuresList.length > 0 ? 'lg:col-span-7 space-y-3' : 'lg:col-span-12 space-y-3'}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>Technical &amp; Material Specifications</span>
                </h3>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {cleanSpecEntries.length} attributes
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                {cleanSpecEntries.map((item) => (
                  <div
                    key={item.key}
                    className="grid grid-cols-12 gap-3 px-4 py-2.5 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <dt className="col-span-5 sm:col-span-4 font-semibold text-slate-500 dark:text-slate-400">
                      {item.key}
                    </dt>
                    <dd className="col-span-7 sm:col-span-8 font-medium text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editorial Numbered Key Highlights */}
          {featuresList.length > 0 && (
            <div className={cleanSpecEntries.length > 0 ? 'lg:col-span-5 space-y-3' : 'lg:col-span-12 space-y-3'}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Key Highlights &amp; Quality Notes
                </h3>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {featuresList.length} points
                </span>
              </div>

              <ol className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 divide-y divide-slate-200/70 dark:divide-slate-800 overflow-hidden">
                {featuresList.map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-3 px-4 py-3 text-xs">
                    <span className="font-mono tabular-nums text-[11px] font-bold text-amber-700 dark:text-amber-400 shrink-0 pt-0.5">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <span className="text-slate-700 dark:text-slate-200 leading-relaxed">
                      {feat}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* 3. STRUCTURED EDITORIAL DESCRIPTION */}
      {showStory && (
        <div className="space-y-3 pt-2 border-t border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Detailed Description &amp; Craftsmanship</span>
            </h3>
            {product.brand && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {product.brand} · Verified Listing
              </span>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
            {product.shortDescription && (
              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-relaxed pb-3 border-b border-slate-100 dark:border-slate-800 max-w-prose">
                {product.shortDescription}
              </p>
            )}

            {descriptionBlocks.length > 0 && (
              <div className="space-y-2.5 text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-prose">
                {descriptionBlocks.map((block, bIdx) => {
                  if (block.type === 'heading') {
                    return (
                      <h4
                        key={bIdx}
                        className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100 pt-2"
                      >
                        {block.text}
                      </h4>
                    );
                  }
                  if (block.type === 'bullet') {
                    return (
                      <div key={bIdx} className="flex items-start gap-2.5 pl-1">
                        <span className="text-amber-600 dark:text-amber-400 font-bold leading-relaxed" aria-hidden="true">
                          —
                        </span>
                        <span>{block.text}</span>
                      </div>
                    );
                  }
                  return <p key={bIdx}>{block.text}</p>;
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
