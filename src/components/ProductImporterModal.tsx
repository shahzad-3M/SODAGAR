import React, { useState, useRef } from 'react';
import {
  X,
  Globe,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Layers,
  Tag,
  ListPlus,
  Plus,
  Trash2,
  Eye,
  ExternalLink,
  ShieldAlert,
  FileText,
  Clock,
  ArrowUpDown,
  Sliders,
  DollarSign,
  Package,
  Video,
} from 'lucide-react';
import { ProductItem, ProductVariation, ProductImportLog, CategoryRecord } from '../types';
import {
  getCategories,
  addCategory,
  getCategoryRecords,
  getProductImportLogs,
  logProductImport,
  apiScrapeProductUrl,
} from '../utils/storage';
import {
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
  resolveCategoryIdsFromProduct,
  getCategoryBreadcrumb,
} from '../utils/locationCategoryHelpers';
import { CategoryCascadingSelect } from './CategoryCascadingSelect';

interface ProductImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProducts: ProductItem[];
  onSaveProduct: (product: ProductItem) => void;
}

// Convert uploaded file to optimized base64 string
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          resolve(e.target?.result as string);
        }
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const ProductImporterModal: React.FC<ProductImporterModalProps> = ({
  isOpen,
  onClose,
  existingProducts,
  onSaveProduct,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'logs'>('import');
  const [importUrl, setImportUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [showHtmlFallback, setShowHtmlFallback] = useState(false);
  const [htmlFallbackSource, setHtmlFallbackSource] = useState('');
  const [scrapeStatsSummary, setScrapeStatsSummary] = useState<string | null>(null);

  // Review & Editable Extracted Product State
  const [extractedProduct, setExtractedProduct] = useState<ProductItem | null>(null);
  const [isDraft, setIsDraft] = useState<boolean>(true);
  const [duplicateMatch, setDuplicateMatch] = useState<ProductItem | null>(null);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState<boolean>(false);

  // Category Selection (3-Level Hierarchy + Upcoming)
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>(getCategoryRecords);
  const [categoryMode, setCategoryMode] = useState<'existing' | 'new'>('existing');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedMainCatId, setSelectedMainCatId] = useState<string>('');
  const [selectedSubCatId, setSelectedSubCatId] = useState<string>('');
  const [selectedChildCatId, setSelectedChildCatId] = useState<string>('');
  const [importAsUpcoming, setImportAsUpcoming] = useState<boolean>(false);
  const [upcomingArrivalDate, setUpcomingArrivalDate] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [parentCategory, setParentCategory] = useState<string>('');

  // Manual image upload refs
  const mainImageInputRef = useRef<HTMLInputElement>(null);
  const galleryImageInputRef = useRef<HTMLInputElement>(null);
  const [variationImageTargetIndex, setVariationImageTargetIndex] = useState<number | null>(null);
  const variationImageInputRef = useRef<HTMLInputElement>(null);

  // Form helpers
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecValue, setNewSpecValue] = useState('');
  const [newFeatureText, setNewFeatureText] = useState('');
  const [newTagText, setNewTagText] = useState('');

  // Import logs
  const [logs, setLogs] = useState<ProductImportLog[]>(getProductImportLogs);

  if (!isOpen) return null;

  const categories = getCategories();

  // LIVE SERVER-SIDE EXTRACTION ENGINE (Shopify JSON, JSON-LD, OpenGraph, DOM, Video, Variations)
  const handleStartImport = async (urlToFetch: string, overrideHtml?: string) => {
    const rawUrl = urlToFetch.trim();
    if (!rawUrl) {
      setImportError('Please enter a valid website product URL.');
      return;
    }

    try {
      new URL(rawUrl);
    } catch {
      setImportError('Invalid URL format. Please include http:// or https://');
      return;
    }

    setIsLoading(true);
    setImportError(null);
    setScrapeStatsSummary(null);
    setExtractedProduct(null);
    setDuplicateMatch(null);
    setOverwriteConfirmed(false);
    setProgressPercent(25);
    setProgressStep(
      overrideHtml
        ? 'Parsing pasted HTML source (JSON-LD, OpenGraph, images, variants, video)...'
        : 'Fetching live product page & extracting JSON-LD, OpenGraph, images, specs, variants & video...'
    );

    const res = await apiScrapeProductUrl(rawUrl, overrideHtml);
    if (!res.ok || !res.product) {
      setIsLoading(false);
      setProgressPercent(0);
      setImportError(
        res.error ||
          'Failed to extract product information from this URL. Some sites block automated requests — you can open the page source (Ctrl+U / Inspect) and paste HTML below as fallback.'
      );
      setShowHtmlFallback(true);
      logProductImport({
        sourceUrl: rawUrl,
        productTitle: 'Failed Extraction',
        status: 'failed',
        variationsCount: 0,
        imagesCount: 0,
        notes: res.error || 'Inaccessible or protected website',
      });
      setLogs(getProductImportLogs());
      return;
    }

    const parsed = res.product;
    const diag = res.diagnostics;
    setProgressPercent(100);
    setProgressStep('Live extraction complete! Review & edit all fields below before saving.');
    if (diag) {
      setScrapeStatsSummary(
        `Extracted via ${diag.strategiesUsed.join(' + ')} · ${diag.imagesFound} images · ${diag.specsFound} specs · ${diag.featuresFound} features · ${diag.variantsFound} variants${
          diag.videoFound ? ' · Video URL found' : ''
        } (${diag.currencyDetected})`
      );
    }

    const existingMatch = existingProducts.find(
      (p) =>
        (p.sku && parsed.sku && p.sku.toLowerCase() === parsed.sku.toLowerCase()) ||
        p.name.toLowerCase() === parsed.name.toLowerCase() ||
        (p.websiteUrl && p.websiteUrl.toLowerCase() === rawUrl.toLowerCase())
    );
    if (existingMatch) {
      setDuplicateMatch(existingMatch);
    }

    const freshCatRecords = getCategoryRecords();
    setCategoryRecords(freshCatRecords);
    const resolvedIds = resolveCategoryIdsFromProduct(parsed, freshCatRecords);
    setSelectedMainCatId(resolvedIds.parentCategoryId || '');
    setSelectedSubCatId(resolvedIds.subcategoryId || '');
    setSelectedChildCatId(resolvedIds.childSubcategoryId || '');
    setImportAsUpcoming(Boolean(parsed.isUpcoming));
    setExtractedProduct(parsed);
    setSelectedCategory(parsed.category);
    setIsLoading(false);

    logProductImport({
      sourceUrl: rawUrl,
      productTitle: parsed.name,
      status: diag && diag.imagesFound > 0 ? 'success' : 'partial',
      variationsCount: parsed.variations?.length || 0,
      imagesCount: (parsed.pictures?.length || 0) + (parsed.imageUrl ? 1 : 0),
      notes: diag
        ? `Live scrape (${diag.strategiesUsed.join(', ')}): ${diag.imagesFound} imgs, ${diag.variantsFound} variants, ${diag.specsFound} specs.`
        : 'Live extraction completed.',
    });
    setLogs(getProductImportLogs());
  };

  // IMAGE MANAGEMENT: Local File Uploads
  const handleUploadMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !extractedProduct) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setExtractedProduct({
        ...extractedProduct,
        imageUrl: dataUrl,
        pictures: [dataUrl, ...(extractedProduct.pictures?.filter((p) => p !== extractedProduct.imageUrl) || [])],
      });
    } catch (err) {
      setImportError('Failed to load image file. Please try another image.');
    }
  };

  const handleUploadGalleryImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !extractedProduct) return;

    try {
      const newUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const url = await readFileAsDataUrl(files[i]);
        newUrls.push(url);
      }
      const existingPics = extractedProduct.pictures || [];
      setExtractedProduct({
        ...extractedProduct,
        pictures: [...existingPics, ...newUrls],
      });
    } catch (err) {
      setImportError('Failed to upload gallery images.');
    }
  };

  const handleRemoveGalleryImage = (indexToRemove: number) => {
    if (!extractedProduct?.pictures) return;
    const updated = extractedProduct.pictures.filter((_, idx) => idx !== indexToRemove);
    setExtractedProduct({
      ...extractedProduct,
      pictures: updated,
      imageUrl: updated[0] || '',
    });
  };

  const handleMoveGalleryImage = (fromIndex: number, toIndex: number) => {
    if (!extractedProduct?.pictures) return;
    const pics = [...extractedProduct.pictures];
    if (toIndex < 0 || toIndex >= pics.length) return;
    const item = pics.splice(fromIndex, 1)[0];
    pics.splice(toIndex, 0, item);
    setExtractedProduct({
      ...extractedProduct,
      pictures: pics,
      imageUrl: pics[0],
    });
  };

  const handleUploadVariationImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !extractedProduct || variationImageTargetIndex === null) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const vars = [...(extractedProduct.variations || [])];
      if (vars[variationImageTargetIndex]) {
        vars[variationImageTargetIndex] = {
          ...vars[variationImageTargetIndex],
          image: dataUrl,
        };
        setExtractedProduct({
          ...extractedProduct,
          variations: vars,
        });
      }
    } catch {
      setImportError('Failed to update variation image.');
    }
  };

  // VARIATIONS MANAGEMENT
  const handleAddVariation = () => {
    if (!extractedProduct) return;
    const vars = extractedProduct.variations || [];
    const newVar: ProductVariation = {
      id: `var_${Date.now()}_${vars.length + 1}`,
      sku: `${extractedProduct.sku}-VAR-${vars.length + 1}`,
      attributes: { 'Option': `Variant ${vars.length + 1}` },
      size: 'Standard',
      color: 'Default',
      originalPrice: extractedProduct.marketPrice,
      salePrice: extractedProduct.ourPrice,
      stockQty: 20,
    };
    setExtractedProduct({
      ...extractedProduct,
      variations: [...vars, newVar],
    });
  };

  const handleUpdateVariation = (index: number, field: keyof ProductVariation, value: any) => {
    if (!extractedProduct || !extractedProduct.variations) return;
    const vars = [...extractedProduct.variations];
    vars[index] = {
      ...vars[index],
      [field]: value,
    };
    setExtractedProduct({
      ...extractedProduct,
      variations: vars,
    });
  };

  const handleRemoveVariation = (index: number) => {
    if (!extractedProduct || !extractedProduct.variations) return;
    const vars = extractedProduct.variations.filter((_, idx) => idx !== index);
    setExtractedProduct({
      ...extractedProduct,
      variations: vars,
    });
  };

  // SPECIFICATION MANAGEMENT
  const handleAddSpecification = () => {
    if (!newSpecKey.trim() || !newSpecValue.trim() || !extractedProduct) return;
    setExtractedProduct({
      ...extractedProduct,
      specifications: {
        ...(extractedProduct.specifications || {}),
        [newSpecKey.trim()]: newSpecValue.trim(),
      },
    });
    setNewSpecKey('');
    setNewSpecValue('');
  };

  const handleRemoveSpecification = (key: string) => {
    if (!extractedProduct?.specifications) return;
    const specs = { ...extractedProduct.specifications };
    delete specs[key];
    setExtractedProduct({
      ...extractedProduct,
      specifications: specs,
    });
  };

  // FEATURE MANAGEMENT
  const handleAddFeature = () => {
    if (!newFeatureText.trim() || !extractedProduct) return;
    setExtractedProduct({
      ...extractedProduct,
      features: [...(extractedProduct.features || []), newFeatureText.trim()],
    });
    setNewFeatureText('');
  };

  const handleRemoveFeature = (idx: number) => {
    if (!extractedProduct?.features) return;
    setExtractedProduct({
      ...extractedProduct,
      features: extractedProduct.features.filter((_, i) => i !== idx),
    });
  };

  // TAG MANAGEMENT
  const handleAddTag = () => {
    if (!newTagText.trim() || !extractedProduct) return;
    setExtractedProduct({
      ...extractedProduct,
      tags: [...(extractedProduct.tags || []), newTagText.trim().toLowerCase()],
    });
    setNewTagText('');
  };

  const handleRemoveTag = (idx: number) => {
    if (!extractedProduct?.tags) return;
    setExtractedProduct({
      ...extractedProduct,
      tags: extractedProduct.tags.filter((_, i) => i !== idx),
    });
  };

  // SAVE & APPROVE
  const handleApproveAndSave = (publishImmediately: boolean) => {
    if (!extractedProduct) return;

    const freshRecords = getCategoryRecords();
    let finalParentId: string | undefined = selectedMainCatId || undefined;
    let finalSubId: string | undefined = selectedSubCatId || undefined;
    let finalChildId: string | undefined = selectedChildCatId || undefined;
    let fullCat = selectedCategory || extractedProduct.category || 'General Wholesale';
    const isUpcomingItem = importAsUpcoming || finalParentId === UPCOMING_CATEGORY_ID;

    if (isUpcomingItem) {
      finalParentId = UPCOMING_CATEGORY_ID;
      finalSubId = undefined;
      finalChildId = undefined;
      fullCat = UPCOMING_CATEGORY_NAME;
    } else if (categoryMode === 'new') {
      const leafName = newCategoryName.trim() || 'General Wholesale';
      const parentName = parentCategory.trim();
      if (parentName) {
        const pRes = addCategory(parentName);
        const pRec = getCategoryRecords().find((r) => !r.parentCategoryId && r.name.toLowerCase() === parentName.toLowerCase());
        const cRes = addCategory(leafName, pRec?.id);
        finalParentId = pRec?.id;
        finalSubId = cRes.record?.id;
        fullCat = `${parentName} > ${leafName}`;
      } else {
        const res = addCategory(leafName);
        finalParentId = res.record?.id;
        fullCat = leafName;
      }
    } else if (finalParentId) {
      fullCat = getCategoryBreadcrumb(freshRecords, finalParentId, finalSubId, finalChildId, fullCat);
    } else {
      addCategory(fullCat);
    }

    const productToSave: ProductItem = {
      ...extractedProduct,
      category: fullCat,
      parentCategoryId: finalParentId,
      subcategoryId: finalSubId,
      childSubcategoryId: finalChildId,
      isUpcoming: isUpcomingItem,
      upcomingStatus: isUpcomingItem ? 'coming_soon' : 'available',
      expectedArrivalDate: isUpcomingItem ? (upcomingArrivalDate.trim() || extractedProduct.expectedArrivalDate) : undefined,
      stockQty: isUpcomingItem ? 0 : extractedProduct.stockQty,
      videoUrl: extractedProduct.videoUrl?.trim() || undefined,
      status: publishImmediately ? 'published' : (isDraft ? 'draft' : 'published'),
      updatedAt: new Date().toISOString(),
    };

    onSaveProduct(productToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* MODAL HEADER */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Complete Website Product Importer
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-full">
                  Auto-Extract &amp; Variations
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extract complete titles, descriptions, galleries, specs, and multi-dimensional variations with draft approval.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-slate-200 dark:bg-slate-800 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`px-3 py-1 font-bold rounded-md transition-all cursor-pointer ${
                  activeTab === 'import'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Importer
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1 font-bold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                  activeTab === 'logs'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Logs ({logs.length})
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {activeTab === 'logs' ? (
            /* LOGS VIEW */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-500" />
                  Product Import Audit &amp; Extraction History
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  {logs.length} Total Import Events Recorded
                </span>
              </div>

              {logs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  No imports recorded yet. Enter a product URL to run your first extraction.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.map((log) => (
                    <div key={log.id} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              log.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'
                            }`}
                          />
                          <span>{log.productTitle}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate max-w-lg font-mono">
                          {log.sourceUrl}
                        </p>
                        {log.notes && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {log.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between text-[11px] text-slate-400 shrink-0">
                        <span className="font-mono">
                          {log.variationsCount} vars · {log.imagesCount} pics
                        </span>
                        <span>{new Date(log.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* IMPORTER WORKFLOW */
            <div className="space-y-6">
              {/* URL INPUT & ACTION BAR */}
              <div className="bg-slate-50 dark:bg-slate-950/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Website Product URL / E-Commerce Link
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder="Paste e-commerce link (e.g. Shopify, WooCommerce, Amazon, Daraz, Brand store)..."
                      className="w-full pl-9 pr-3 py-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartImport(importUrl)}
                    disabled={isLoading}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 shadow-xs"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Extracting Complete Product...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Extract All Details
                      </>
                    )}
                  </button>
                </div>

                {/* Live Scrape Helper & Optional HTML Fallback */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                  <span>
                    Live backend scraper extracts Shopify JSON, JSON-LD, OpenGraph, all gallery images, specs, variations &amp; product video URLs.
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHtmlFallback(!showHtmlFallback)}
                    className="text-amber-700 dark:text-amber-400 font-bold hover:underline cursor-pointer shrink-0"
                  >
                    {showHtmlFallback ? 'Hide HTML Source Fallback' : 'Site blocked bots? Paste HTML Source'}
                  </button>
                </div>

                {showHtmlFallback && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <textarea
                      rows={4}
                      value={htmlFallbackSource}
                      onChange={(e) => setHtmlFallbackSource(e.target.value)}
                      placeholder="Optional fallback: If a store uses Cloudflare/bot protection, copy page source (Ctrl+U -> Ctrl+A -> Ctrl+C) and paste HTML here, then click Extract from Pasted HTML..."
                      className="w-full px-3 py-2 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isLoading || !htmlFallbackSource.trim()}
                        onClick={() => handleStartImport(importUrl || 'https://supplier.example.com/product', htmlFallbackSource)}
                        className="px-4 py-1.5 bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold text-xs rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        Extract from Pasted HTML
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* PROGRESS BAR & STATUS */}
              {isLoading && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      {progressStep}
                    </span>
                    <span className="font-mono">{progressPercent}%</span>
                  </div>
                  <div className="w-full bg-amber-200 dark:bg-amber-900 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-500 h-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* SCRAPE DIAGNOSTICS BANNER */}
              {scrapeStatsSummary && !isLoading && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{scrapeStatsSummary}</span>
                </div>
              )}

              {/* ERROR ALERT */}
              {importError && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between gap-3 text-red-800 dark:text-red-200 text-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{importError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartImport(importUrl)}
                    className="px-3 py-1 bg-red-600 text-white font-bold rounded hover:bg-red-500 cursor-pointer text-[11px]"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* DUPLICATE WARNING */}
              {duplicateMatch && !overwriteConfirmed && (
                <div className="bg-amber-500/10 border-2 border-amber-500 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs sm:text-sm">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <span>Duplicate Product Detected in Existing Catalog!</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    A matching product already exists: <strong>"{duplicateMatch.name}"</strong> (SKU: {duplicateMatch.sku}).
                    To protect your operational records, existing products are never automatically overwritten.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setOverwriteConfirmed(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs cursor-pointer"
                    >
                      I Confirm: Allow Update To Existing Product
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (extractedProduct) {
                          setExtractedProduct({
                            ...extractedProduct,
                            sku: `IMP-${Math.floor(1000 + Math.random() * 9000)}-NEW`,
                            name: `${extractedProduct.name} (Copy)`,
                          });
                          setDuplicateMatch(null);
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-xs cursor-pointer hover:bg-slate-300"
                    >
                      Save As Brand New Separate Item
                    </button>
                  </div>
                </div>
              )}

              {/* REVIEW & EDIT EXTRACTED PRODUCT SECTION */}
              {extractedProduct && (
                <div className="space-y-6 pt-2 border-t border-slate-200 dark:border-slate-800 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-100 dark:bg-slate-800/80 p-3 rounded-xl">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        Review Extracted Product Before Publishing
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isDraft}
                          onChange={(e) => setIsDraft(e.target.checked)}
                          className="rounded text-amber-500 focus:ring-amber-400"
                        />
                        <span>Save as Draft (Unpublished)</span>
                      </label>
                    </div>
                  </div>

                  {/* 1. BASIC INFORMATION */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Product Title / Name (English)
                      </label>
                      <input
                        type="text"
                        value={extractedProduct.name}
                        onChange={(e) =>
                          setExtractedProduct({ ...extractedProduct, name: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Urdu Title / Name (اردو نام)
                      </label>
                      <input
                        type="text"
                        value={extractedProduct.urduName || ''}
                        onChange={(e) =>
                          setExtractedProduct({ ...extractedProduct, urduName: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-urdu"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        SKU / Reference Code
                      </label>
                      <input
                        type="text"
                        value={extractedProduct.sku}
                        onChange={(e) =>
                          setExtractedProduct({ ...extractedProduct, sku: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Brand / Manufacturer
                      </label>
                      <input
                        type="text"
                        value={extractedProduct.brand || ''}
                        onChange={(e) =>
                          setExtractedProduct({ ...extractedProduct, brand: e.target.value })
                        }
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* 2. PRICING & STOCK */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                        Market Price (Rs.)
                      </label>
                      <input
                        type="number"
                        value={extractedProduct.marketPrice}
                        onChange={(e) =>
                          setExtractedProduct({
                            ...extractedProduct,
                            marketPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                        Our Wholesale Price (Rs.)
                      </label>
                      <input
                        type="number"
                        value={extractedProduct.ourPrice}
                        onChange={(e) =>
                          setExtractedProduct({
                            ...extractedProduct,
                            ourPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono font-bold text-emerald-600 dark:text-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                        Cost Price (Rs.)
                      </label>
                      <input
                        type="number"
                        value={extractedProduct.costPrice}
                        onChange={(e) =>
                          setExtractedProduct({
                            ...extractedProduct,
                            costPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                        Stock Quantity (Units)
                      </label>
                      <input
                        type="number"
                        value={extractedProduct.stockQty}
                        onChange={(e) =>
                          setExtractedProduct({
                            ...extractedProduct,
                            stockQty: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono"
                      />
                    </div>
                  </div>

                  {/* 3. CATEGORY ASSIGNMENT (3-LEVEL HIERARCHY & UPCOMING) */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-amber-500" />
                        Category Hierarchy &amp; Status
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1 cursor-pointer mr-2">
                          <input
                            type="checkbox"
                            checked={importAsUpcoming}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setImportAsUpcoming(checked);
                              if (checked) {
                                setSelectedMainCatId(UPCOMING_CATEGORY_ID);
                                setSelectedSubCatId('');
                                setSelectedChildCatId('');
                                setSelectedCategory(UPCOMING_CATEGORY_NAME);
                                if (extractedProduct) {
                                  setExtractedProduct({ ...extractedProduct, stockQty: 0, isUpcoming: true });
                                }
                              }
                            }}
                            className="rounded text-purple-600"
                          />
                          <span>Coming Soon / Upcoming</span>
                        </label>
                        {!importAsUpcoming && (
                          <>
                            <button
                              type="button"
                              onClick={() => setCategoryMode('existing')}
                              className={`text-xs px-2.5 py-1 rounded cursor-pointer font-bold ${
                                categoryMode === 'existing'
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              Select Hierarchy
                            </button>
                            <button
                              type="button"
                              onClick={() => setCategoryMode('new')}
                              className={`text-xs px-2.5 py-1 rounded cursor-pointer font-bold ${
                                categoryMode === 'new'
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              + Create New
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {importAsUpcoming ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                        <div>
                          <span className="text-[11px] font-bold text-purple-800 dark:text-purple-200 block mb-1">
                            Upcoming Category (Stock locked at 0 until Arrival Confirmed)
                          </span>
                          <div className="px-3 py-2 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200">
                            {UPCOMING_CATEGORY_NAME}
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-purple-800 dark:text-purple-200 block mb-1">
                            Expected Arrival Date (Optional)
                          </label>
                          <input
                            type="date"
                            value={upcomingArrivalDate}
                            onChange={(e) => setUpcomingArrivalDate(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 rounded-lg text-slate-900 dark:text-white font-mono"
                          />
                        </div>
                      </div>
                    ) : categoryMode === 'existing' ? (
                      <CategoryCascadingSelect
                        categories={categoryRecords}
                        parentCategoryId={selectedMainCatId}
                        subcategoryId={selectedSubCatId}
                        childSubcategoryId={selectedChildCatId}
                        onChange={(sel) => {
                          setSelectedMainCatId(sel.parentCategoryId);
                          setSelectedSubCatId(sel.subcategoryId || '');
                          setSelectedChildCatId(sel.childSubcategoryId || '');
                          setSelectedCategory(sel.breadcrumb);
                          if (sel.isUpcoming) {
                            setImportAsUpcoming(true);
                          }
                        }}
                      />
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-slate-500 block mb-1">
                            New Category Name
                          </label>
                          <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="e.g. Shalwar Kameez"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-500 block mb-1">
                            Parent Group (Optional, e.g. Fashion &amp; Apparel)
                          </label>
                          <input
                            type="text"
                            value={parentCategory}
                            onChange={(e) => setParentCategory(e.target.value)}
                            placeholder="e.g. Cosmetics &amp; Personal Care"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. IMAGE MANAGEMENT & GALLERY (Upload, Replace, Reorder, Delete) */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Image Management &amp; Product Gallery ({extractedProduct.pictures?.length || 0})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Hidden file inputs */}
                        <input
                          ref={mainImageInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleUploadMainImage}
                        />
                        <input
                          ref={galleryImageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleUploadGalleryImages}
                        />

                        <button
                          type="button"
                          onClick={() => mainImageInputRef.current?.click()}
                          className="px-2.5 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 cursor-pointer flex items-center gap-1"
                        >
                          <Upload className="w-3.5 h-3.5 text-amber-500" />
                          Replace Main
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryImageInputRef.current?.click()}
                          className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Upload Gallery
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
                      {extractedProduct.pictures?.map((pic, idx) => (
                        <div
                          key={idx}
                          className={`relative group rounded-lg overflow-hidden border-2 ${
                            idx === 0
                              ? 'border-amber-500 shadow-sm'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <img
                            src={pic}
                            alt={`Product pic ${idx + 1}`}
                            className="w-full h-24 object-cover"
                          />
                          {idx === 0 && (
                            <span className="absolute top-1 left-1 bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.5 rounded shadow-xs">
                              MAIN
                            </span>
                          )}

                          <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => handleMoveGalleryImage(idx, idx - 1)}
                                className="p-1 bg-white/80 hover:bg-white text-slate-900 rounded cursor-pointer"
                                title="Move left"
                              >
                                ←
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveGalleryImage(idx)}
                              className="p-1 bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer"
                              title="Delete photo"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            {idx < (extractedProduct.pictures?.length || 0) - 1 && (
                              <button
                                type="button"
                                onClick={() => handleMoveGalleryImage(idx, idx + 1)}
                                className="p-1 bg-white/80 hover:bg-white text-slate-900 rounded cursor-pointer"
                                title="Move right"
                              >
                                →
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Product Video Link Paste Area */}
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                      <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                        Product Video Link (Paste Video URL — YouTube, TikTok, Reels, MP4)
                      </label>
                      <input
                        type="url"
                        value={extractedProduct.videoUrl || ''}
                        onChange={(e) =>
                          setExtractedProduct({
                            ...extractedProduct,
                            videoUrl: e.target.value,
                          })
                        }
                        placeholder="https://www.youtube.com/watch?v=... or TikTok / Reels / MP4 URL"
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:outline-hidden font-mono"
                      />
                    </div>
                  </div>

                  {/* 5. MULTI-DIMENSIONAL VARIATIONS EXTRACTION & EDITOR */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-amber-500" />
                          Multi-Dimensional Variations ({extractedProduct.variations?.length || 0})
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Sizes, colors, variation SKUs, pricing and stock extracted for individual management.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddVariation}
                        className="px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-lg cursor-pointer flex items-center gap-1 self-start sm:self-auto"
                      >
                        <Plus className="w-3 h-3" />
                        Add Variation
                      </button>
                    </div>

                    {/* Hidden input for variation image upload */}
                    <input
                      ref={variationImageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUploadVariationImage}
                    />

                    {extractedProduct.variations && extractedProduct.variations.length > 0 ? (
                      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                            <tr>
                              <th className="p-2">Image</th>
                              <th className="p-2">Size / Dimension</th>
                              <th className="p-2">Color</th>
                              <th className="p-2">Variation SKU</th>
                              <th className="p-2">Price (Rs.)</th>
                              <th className="p-2">Stock</th>
                              <th className="p-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {extractedProduct.variations.map((v, idx) => (
                              <tr key={v.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="p-2">
                                  <div
                                    onClick={() => {
                                      setVariationImageTargetIndex(idx);
                                      variationImageInputRef.current?.click();
                                    }}
                                    className="w-8 h-8 rounded border border-slate-300 dark:border-slate-700 overflow-hidden cursor-pointer hover:opacity-80 flex items-center justify-center bg-slate-100"
                                    title="Click to upload/change image"
                                  >
                                    {v.image ? (
                                      <img src={v.image} alt="var" className="w-full h-full object-cover" />
                                    ) : (
                                      <Upload className="w-3.5 h-3.5 text-slate-400" />
                                    )}
                                  </div>
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={v.size || ''}
                                    onChange={(e) => handleUpdateVariation(idx, 'size', e.target.value)}
                                    placeholder="e.g. Large / Standard"
                                    className="w-28 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={v.color || ''}
                                    onChange={(e) => handleUpdateVariation(idx, 'color', e.target.value)}
                                    placeholder="e.g. Rose Gold"
                                    className="w-24 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={v.sku || ''}
                                    onChange={(e) => handleUpdateVariation(idx, 'sku', e.target.value)}
                                    className="w-32 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    value={v.salePrice || 0}
                                    onChange={(e) =>
                                      handleUpdateVariation(idx, 'salePrice', parseFloat(e.target.value) || 0)
                                    }
                                    className="w-20 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono font-bold text-emerald-600"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    value={v.stockQty || 0}
                                    onChange={(e) =>
                                      handleUpdateVariation(idx, 'stockQty', parseInt(e.target.value, 10) || 0)
                                    }
                                    className="w-16 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 font-mono"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveVariation(idx)}
                                    className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                                    title="Remove variation"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No variations extracted. Single standard SKU will be created.
                      </p>
                    )}
                  </div>

                  {/* 6. DESCRIPTIONS, SPECIFICATIONS & FEATURES */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Descriptions */}
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                          Short Description (Highlights)
                        </label>
                        <textarea
                          rows={2}
                          value={extractedProduct.shortDescription || ''}
                          onChange={(e) =>
                            setExtractedProduct({ ...extractedProduct, shortDescription: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                          Full Product Details &amp; Description
                        </label>
                        <textarea
                          rows={4}
                          value={extractedProduct.details || ''}
                          onChange={(e) =>
                            setExtractedProduct({ ...extractedProduct, details: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* Specifications */}
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                        Product Specifications (Key-Value)
                      </label>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {extractedProduct.specifications &&
                          Object.entries(extractedProduct.specifications).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 dark:bg-slate-800 rounded text-xs border border-slate-200 dark:border-slate-700"
                            >
                              <span className="font-semibold text-slate-700 dark:text-slate-300">{k}:</span>
                              <span className="font-mono text-slate-500 truncate max-w-xs">{v}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSpecification(k)}
                                className="text-red-500 hover:text-red-700 p-0.5 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                      </div>

                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={newSpecKey}
                          onChange={(e) => setNewSpecKey(e.target.value)}
                          placeholder="Spec (e.g. Material)"
                          className="w-1/2 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                        <input
                          type="text"
                          value={newSpecValue}
                          onChange={(e) => setNewSpecValue(e.target.value)}
                          placeholder="Value (e.g. Tourmaline Ceramic)"
                          className="w-1/2 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                        <button
                          type="button"
                          onClick={handleAddSpecification}
                          className="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white rounded text-xs font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 7. FEATURES & TAGS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Features */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                        Bullet Features &amp; Selling Points
                      </label>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {extractedProduct.features?.map((feat, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs p-1.5 bg-slate-50 dark:bg-slate-800 rounded">
                            <span className="truncate">✓ {feat}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveFeature(idx)}
                              className="text-red-500 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newFeatureText}
                          onChange={(e) => setNewFeatureText(e.target.value)}
                          placeholder="Add bullet feature..."
                          className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                        <button
                          type="button"
                          onClick={handleAddFeature}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                        Product Search Tags
                      </label>
                      <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                        {extractedProduct.tags?.map((t, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] font-bold"
                          >
                            #{t}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(idx)}
                              className="hover:text-red-600"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTagText}
                          onChange={(e) => setNewTagText(e.target.value)}
                          placeholder="Add tag (e.g. wholesale, beauty)..."
                          className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                        <button
                          type="button"
                          onClick={handleAddTag}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500">
            {extractedProduct ? (
              <span>
                Status:{' '}
                <strong className={isDraft ? 'text-amber-600' : 'text-emerald-600'}>
                  {isDraft ? 'Draft (Unpublished)' : 'Ready to Publish'}
                </strong>{' '}
                · Source: {extractedProduct.sourceWebsiteName || 'Web link'}
              </span>
            ) : (
              <span>Enter URL to extract complete product details</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xs hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </button>

            {extractedProduct && (
              <>
                <button
                  type="button"
                  onClick={() => handleApproveAndSave(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-xs cursor-pointer flex items-center gap-1.5"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  onClick={() => handleApproveAndSave(true)}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-lg text-xs cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve &amp; Publish Product
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
