import React, { useState, useRef, useEffect } from 'react';
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
  Zap,
  Truck,
  Check,
  Ruler,
} from 'lucide-react';
import type { ProductItem, ProductVariation, ProductImportLog, CategoryRecord, ProductSizeChart } from '../types/index.ts';
import {
  getCategories,
  addCategory,
  getCategoryRecords,
  getProductImportLogs,
  logProductImport,
  apiScrapeProductUrl,
  apiCacheExternalImage,
} from '../utils/storage.ts';
import {
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
  resolveCategoryIdsFromProduct,
  getCategoryBreadcrumb,
} from '../utils/locationCategoryHelpers.ts';
import { buildCurrentOriginUrl } from '../utils/whatsapp.ts';
import { CategoryCascadingSelect } from './CategoryCascadingSelect.tsx';
import { ProductSpecSizingShowcase } from './ProductSpecSizingShowcase.tsx';

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

  // Manual image upload & imported media picker refs
  const mainImageInputRef = useRef<HTMLInputElement>(null);
  const galleryImageInputRef = useRef<HTMLInputElement>(null);
  const [variationImageTargetIndex, setVariationImageTargetIndex] = useState<number | null>(null);
  const variationImageInputRef = useRef<HTMLInputElement>(null);
  const [mediaPickerVarIndex, setMediaPickerVarIndex] = useState<number | null>(null);
  const [manualImageUrlInput, setManualImageUrlInput] = useState('');
  const [isCachingImageUrl, setIsCachingImageUrl] = useState(false);

  // Form helpers
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecValue, setNewSpecValue] = useState('');
  const [newFeatureText, setNewFeatureText] = useState('');
  const [newTagText, setNewTagText] = useState('');
  const [specsTabMode, setSpecsTabMode] = useState<'edit' | 'preview'>('edit');
  const [newSizeColInput, setNewSizeColInput] = useState('');
  const [newSizeRowInput, setNewSizeRowInput] = useState('');

  // Import logs
  const [logs, setLogs] = useState<ProductImportLog[]>(getProductImportLogs);

  useEffect(() => {
    if (isOpen) {
      setImportError(null);
      setProgressStep('');
      setProgressPercent(0);
      setScrapeStatsSummary(null);
      setDuplicateMatch(null);
      setOverwriteConfirmed(false);
      setSpecsTabMode('edit');
      setLogs(getProductImportLogs());
      setCategoryRecords(getCategoryRecords());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const categories = getCategories();

  // LIVE SERVER-SIDE EXTRACTION ENGINE (Shopify JSON, JSON-LD, OpenGraph, DOM, Video, Variations)
  const normalizeInputUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      return `https://${trimmed.replace(/^\/+/, '')}`;
    }
    return trimmed;
  };

  const handleStartImport = async (urlToFetch: string, overrideHtml?: string) => {
    const hasOverrideHtml = Boolean(overrideHtml && overrideHtml.trim().length > 0);
    let normalizedUrl = normalizeInputUrl(urlToFetch);

    if (hasOverrideHtml) {
      try {
        if (normalizedUrl) {
          new URL(normalizedUrl);
        } else {
          normalizedUrl = buildCurrentOriginUrl('/products/imported-item');
        }
      } catch {
        normalizedUrl = buildCurrentOriginUrl('/products/imported-item');
      }
    } else {
      if (!normalizedUrl) {
        setImportError('Please enter a valid website product URL.');
        return;
      }

      try {
        const parsedCheck = new URL(normalizedUrl);
        if (parsedCheck.protocol !== 'http:' && parsedCheck.protocol !== 'https:') {
          setImportError('Only http:// and https:// website links are supported.');
          return;
        }
      } catch {
        setImportError('Invalid URL format. Example: https://store.com/products/item-name');
        return;
      }
    }

    if (!hasOverrideHtml && normalizedUrl !== importUrl) {
      setImportUrl(normalizedUrl);
    }

    setIsLoading(true);
    setImportError(null);
    setScrapeStatsSummary(null);
    setExtractedProduct(null);
    setDuplicateMatch(null);
    setOverwriteConfirmed(false);
    setSpecsTabMode('edit');
    setProgressPercent(25);
    setProgressStep(
      hasOverrideHtml
        ? 'Parsing pasted HTML source (JSON-LD, OpenGraph, images, size charts, variants, video)...'
        : 'Fetching live product page & extracting JSON-LD, OpenGraph, images, size charts, specs, variants & video...'
    );

    const res = await apiScrapeProductUrl(normalizedUrl, overrideHtml);
    const rawUrl = normalizedUrl;
    const errText =
      res.error ||
      'Failed to extract product information from this link. Use "Paste HTML Source" or "Create Manual Draft from Link" below.';

    if (!res.ok || !res.product) {
      setIsLoading(false);
      setProgressPercent(0);
      setImportError(errText);
      const shouldSuggestHtml =
        /paste html|inspect|outerhtml|blocked|challenge|captcha|cors|shell|dynamically|html source|timed out|could not reach/i.test(
          errText
        );
      if (shouldSuggestHtml) {
        setShowHtmlFallback(true);
      }
      logProductImport({
        sourceUrl: rawUrl,
        productTitle: 'Failed Extraction',
        status: 'failed',
        variationsCount: 0,
        imagesCount: 0,
        notes: errText,
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
        `Extracted via ${diag.strategiesUsed.join(' + ')} · ${diag.imagesFound} images${
          diag.imagesDownloaded ? ` (${diag.imagesDownloaded} downloaded locally)` : ''
        } · ${diag.specsFound} specs · ${diag.featuresFound} features · ${diag.variantsFound} variants${
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

  const handleCreateManualDraftFromUrl = () => {
    const raw = importUrl.trim();
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : raw ? `https://${raw}` : '';
    let domain = 'External Store';
    let derivedName = 'New Imported Product';
    try {
      if (withProtocol) {
        const u = new URL(withProtocol);
        domain = u.hostname.replace(/^www\./i, '');
        const slug = u.pathname.split('/').filter(Boolean).pop() || '';
        if (slug) {
          derivedName = decodeURIComponent(slug)
            .replace(/\.html?$/i, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim() || derivedName;
        }
      }
    } catch {
      // keep defaults
    }

    const freshCatRecords = getCategoryRecords();
    setCategoryRecords(freshCatRecords);
    const draftProduct: ProductItem = {
      id: `prod_man_${Date.now()}`,
      name: derivedName,
      urduName: '',
      category: freshCatRecords[0]?.name || 'General Wholesale',
      deliveryType: 'standard',
      sku: `MAN-${domain.split('.')[0].slice(0, 4).toUpperCase() || 'ITEM'}-${Math.floor(1000 + Math.random() * 9000)}`,
      costPrice: 0,
      marketPrice: 0,
      ourPrice: 0,
      stockQty: 25,
      minStockAlert: 10,
      salesCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      isWinningItem: false,
      badgeText: 'IMPORTED LOT',
      websiteUrl: withProtocol || undefined,
      sourceUrl: withProtocol || undefined,
      sourceWebsiteName: domain,
      imageUrl: '',
      pictures: [],
      brand: domain,
      shortDescription: '',
      details: '',
      description: '',
      specifications: { 'Source Host': domain },
      features: [],
      tags: [],
      variations: [],
      sizes: [],
      status: 'draft',
      createdAt: new Date().toISOString().split('T')[0],
    };

    setImportError(null);
    setShowHtmlFallback(false);
    setDuplicateMatch(null);
    setOverwriteConfirmed(false);
    setExtractedProduct(draftProduct);
    setSelectedCategory(draftProduct.category);
    setSelectedMainCatId(freshCatRecords[0]?.id || '');
    setSelectedSubCatId('');
    setSelectedChildCatId('');
    setScrapeStatsSummary(
      `Manual draft initialized from ${domain}. Upload photos, set pricing & details below, and save.`
    );
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
        const existingPics = extractedProduct.pictures || [];
        const nextPics = existingPics.includes(dataUrl) ? existingPics : [...existingPics, dataUrl];
        setExtractedProduct({
          ...extractedProduct,
          pictures: nextPics,
          variations: vars,
        });
      }
    } catch {
      setImportError('Failed to update variation image.');
    }
  };

  const handleSetMainGalleryImage = (idx: number) => {
    if (!extractedProduct?.pictures || !extractedProduct.pictures[idx]) return;
    const pics = [...extractedProduct.pictures];
    const [picked] = pics.splice(idx, 1);
    const nextPics = [picked, ...pics];
    setExtractedProduct({
      ...extractedProduct,
      imageUrl: picked,
      pictures: nextPics,
    });
  };

  const handleAddExternalImageUrl = async () => {
    const raw = manualImageUrlInput.trim();
    if (!raw || !extractedProduct) return;
    setIsCachingImageUrl(true);
    const cached = await apiCacheExternalImage(raw, extractedProduct.sourceUrl || extractedProduct.websiteUrl);
    setIsCachingImageUrl(false);
    const finalImgUrl = cached.localUrl || raw;
    const existingPics = extractedProduct.pictures || [];
    const nextPics = existingPics.includes(finalImgUrl) ? existingPics : [...existingPics, finalImgUrl];
    setExtractedProduct({
      ...extractedProduct,
      imageUrl: extractedProduct.imageUrl || nextPics[0] || '',
      pictures: nextPics,
    });
    setManualImageUrlInput('');
  };

  // VARIATIONS MANAGEMENT
  const handleAddVariation = () => {
    if (!extractedProduct) return;
    const vars = extractedProduct.variations || [];
    const newVar: ProductVariation = {
      id: `var_${Date.now()}_${vars.length + 1}`,
      title: `Variant ${vars.length + 1}`,
      sku: `${extractedProduct.sku}-VAR-${vars.length + 1}`,
      attributes: { Option: `Variant ${vars.length + 1}` },
      size: 'Standard',
      color: 'Default',
      details: '',
      originalPrice: extractedProduct.marketPrice,
      salePrice: extractedProduct.ourPrice,
      stockQty: 20,
      image: extractedProduct.pictures?.[0] || extractedProduct.imageUrl || undefined,
    };
    setExtractedProduct({
      ...extractedProduct,
      variations: [...vars, newVar],
    });
    setMediaPickerVarIndex(vars.length);
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

  // SIZE CHART MANAGEMENT
  const handleInitSizeChart = () => {
    if (!extractedProduct) return;
    const defaultCols = ['Small (S)', 'Medium (M)', 'Large (L)', 'XL'];
    const emptyVals = defaultCols.map(() => '');
    const initialChart: ProductSizeChart = {
      unit: 'in',
      columns: defaultCols,
      rows: [
        { label: 'Chest', values: [...emptyVals] },
        { label: 'Length', values: [...emptyVals] },
      ],
    };
    setExtractedProduct({ ...extractedProduct, sizeChart: initialChart });
  };

  const handleUpdateSizeChartUnit = (unit: 'in' | 'cm') => {
    if (!extractedProduct?.sizeChart) return;
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: { ...extractedProduct.sizeChart, unit },
    });
  };

  const handleAddSizeChartColumn = () => {
    const col = newSizeColInput.trim();
    if (!col || !extractedProduct) return;
    const chart: ProductSizeChart = extractedProduct.sizeChart || {
      unit: 'in',
      columns: [],
      rows: [{ label: 'Chest', values: [] }],
    };
    if (chart.columns.some((c) => c.toLowerCase() === col.toLowerCase())) {
      setNewSizeColInput('');
      return;
    }
    const nextCols = [...chart.columns, col];
    const nextRows = chart.rows.map((r) => ({
      ...r,
      values: [...r.values, ''],
    }));
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: { ...chart, columns: nextCols, rows: nextRows },
    });
    setNewSizeColInput('');
  };

  const handleRemoveSizeChartColumn = (colIdx: number) => {
    if (!extractedProduct?.sizeChart) return;
    const nextCols = extractedProduct.sizeChart.columns.filter((_, idx) => idx !== colIdx);
    const nextRows = extractedProduct.sizeChart.rows.map((r) => ({
      ...r,
      values: r.values.filter((_, idx) => idx !== colIdx),
    }));
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: nextCols.length > 0 ? { ...extractedProduct.sizeChart, columns: nextCols, rows: nextRows } : undefined,
    });
  };

  const handleAddSizeChartRow = () => {
    const label = newSizeRowInput.trim();
    if (!label || !extractedProduct?.sizeChart) return;
    const emptyVals = extractedProduct.sizeChart.columns.map(() => '');
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: {
        ...extractedProduct.sizeChart,
        rows: [...extractedProduct.sizeChart.rows, { label, values: emptyVals }],
      },
    });
    setNewSizeRowInput('');
  };

  const handleRemoveSizeChartRow = (rowIdx: number) => {
    if (!extractedProduct?.sizeChart) return;
    const nextRows = extractedProduct.sizeChart.rows.filter((_, i) => i !== rowIdx);
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: { ...extractedProduct.sizeChart, rows: nextRows },
    });
  };

  const handleUpdateSizeChartCell = (rowIdx: number, colIdx: number, val: string) => {
    if (!extractedProduct?.sizeChart) return;
    const colCount = extractedProduct.sizeChart.columns.length;
    const nextRows = extractedProduct.sizeChart.rows.map((row, idx) => {
      if (idx !== rowIdx) return row;
      const padded = Array.from({ length: colCount }, (_, i) => row.values[i] || '');
      padded[colIdx] = val;
      return { ...row, values: padded };
    });
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: { ...extractedProduct.sizeChart, rows: nextRows },
    });
  };

  const handleUpdateSizeChartRowLabel = (rowIdx: number, nextLabel: string) => {
    if (!extractedProduct?.sizeChart) return;
    const nextRows = extractedProduct.sizeChart.rows.map((row, idx) =>
      idx === rowIdx ? { ...row, label: nextLabel } : row
    );
    setExtractedProduct({
      ...extractedProduct,
      sizeChart: { ...extractedProduct.sizeChart, rows: nextRows },
    });
  };

  // SAVE & APPROVE
  const handleApproveAndSave = (publishImmediately: boolean) => {
    if (!extractedProduct) return;

    const cleanName = extractedProduct.name.trim();
    if (!cleanName) {
      setImportError('Product title cannot be empty before saving.');
      return;
    }
    if (!Number.isFinite(Number(extractedProduct.ourPrice)) || Number(extractedProduct.ourPrice) < 0) {
      setImportError('Please provide a valid store price before saving.');
      return;
    }

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
        addCategory(parentName);
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

    // Deduplicate derived sizes case-insensitively while preserving order
    const rawSizes =
      extractedProduct.variations && extractedProduct.variations.length > 0
        ? extractedProduct.variations
            .map((v) => v.title || [v.size, v.color].filter(Boolean).join(' · ') || v.sku || '')
            .filter(Boolean)
        : extractedProduct.sizes || [];
    const seenSizeKeys = new Set<string>();
    const dedupedSizes: string[] = [];
    for (const s of rawSizes) {
      const cleanS = s.trim();
      if (!cleanS) continue;
      const key = cleanS.toLowerCase();
      if (!seenSizeKeys.has(key)) {
        seenSizeKeys.add(key);
        dedupedSizes.push(cleanS);
      }
    }

    // Clean specifications (remove empty keys/values)
    const cleanedSpecs: Record<string, string> = {};
    if (extractedProduct.specifications) {
      for (const [k, v] of Object.entries(extractedProduct.specifications)) {
        if (k.trim() && String(v || '').trim()) {
          cleanedSpecs[k.trim()] = String(v).trim();
        }
      }
    }

    // Normalize size chart if present
    const normalizedSizeChart =
      extractedProduct.sizeChart &&
      extractedProduct.sizeChart.columns.length > 0 &&
      extractedProduct.sizeChart.rows.some((r) => r.label.trim())
        ? {
            ...extractedProduct.sizeChart,
            rows: extractedProduct.sizeChart.rows.filter((r) => r.label.trim()),
          }
        : undefined;

    const isOverwrite = Boolean(duplicateMatch && overwriteConfirmed);

    const productToSave: ProductItem = {
      ...extractedProduct,
      ...(isOverwrite && duplicateMatch
        ? {
            id: duplicateMatch.id,
            salesCount: duplicateMatch.salesCount,
            totalRevenue: duplicateMatch.totalRevenue,
            totalProfit: duplicateMatch.totalProfit,
            createdAt: duplicateMatch.createdAt,
          }
        : {}),
      name: cleanName,
      category: fullCat,
      parentCategoryId: finalParentId,
      subcategoryId: finalSubId,
      childSubcategoryId: finalChildId,
      deliveryType: extractedProduct.deliveryType === 'express' ? 'express' : 'standard',
      deliveryFeeType: extractedProduct.deliveryFeeType || 'default',
      customDeliveryCharge:
        extractedProduct.deliveryFeeType === 'custom'
          ? Math.max(0, Math.round(Number(extractedProduct.customDeliveryCharge) || 0))
          : undefined,
      isUpcoming: isUpcomingItem,
      upcomingStatus: isUpcomingItem ? 'coming_soon' : 'available',
      expectedArrivalDate: isUpcomingItem ? (upcomingArrivalDate.trim() || extractedProduct.expectedArrivalDate) : undefined,
      stockQty: isUpcomingItem ? 0 : extractedProduct.stockQty,
      sizes: dedupedSizes,
      specifications: cleanedSpecs,
      sizeChart: normalizedSizeChart,
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
                      type="text"
                      inputMode="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isLoading) {
                          e.preventDefault();
                          handleStartImport(importUrl);
                        }
                      }}
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
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 leading-relaxed">
                      <strong>How to copy HTML properly:</strong> On Shopify/WooCommerce pages, press <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+U</code> → <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+A</code> → <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+C</code>. On <strong>Daraz / React / JavaScript</strong> sites, open the page, right-click → <strong>Inspect</strong> → right-click the top <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">&lt;html&gt;</code> tag → <strong>Copy → Copy outerHTML</strong>.
                    </div>
                    <textarea
                      rows={4}
                      value={htmlFallbackSource}
                      onChange={(e) => setHtmlFallbackSource(e.target.value)}
                      placeholder="Paste full HTML source / outerHTML here, then click Extract from Pasted HTML..."
                      className="w-full px-3 py-2 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCreateManualDraftFromUrl}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        Create Manual Draft from Link
                      </button>
                      <button
                        type="button"
                        disabled={isLoading || !htmlFallbackSource.trim()}
                        onClick={() => handleStartImport(importUrl || buildCurrentOriginUrl('/products/imported-item'), htmlFallbackSource)}
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
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-4 flex flex-col gap-3 text-red-800 dark:text-red-200 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <div className="font-bold text-red-900 dark:text-red-100">
                        Product Extraction Could Not Complete Automatically
                      </div>
                      <div className="whitespace-pre-line leading-relaxed text-red-800/95 dark:text-red-200/95">
                        {importError}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-red-200/70 dark:border-red-800/60">
                    {!showHtmlFallback && (
                      <button
                        type="button"
                        onClick={() => setShowHtmlFallback(true)}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-200 font-bold rounded-lg hover:bg-red-100 cursor-pointer text-[11px]"
                      >
                        Paste HTML Source
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleCreateManualDraftFromUrl}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200 font-bold rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer text-[11px]"
                    >
                      Create Manual Draft from Link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartImport(importUrl)}
                      className="px-3 py-1.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 cursor-pointer text-[11px]"
                    >
                      Retry Link
                    </button>
                  </div>
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
                        Our Super Best Price (Rs.)
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
                    {/* Delivery Speed Category: Express Delivery vs Standard 3-6 Working Days */}
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-amber-500" />
                        Delivery Speed Category (Express Instant vs 3–6 Working Days Logistics)
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExtractedProduct({
                              ...extractedProduct,
                              deliveryType: 'express',
                            })
                          }
                          className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                            extractedProduct.deliveryType === 'express'
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-400/50'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                          }`}
                        >
                          <Zap
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              extractedProduct.deliveryType === 'express'
                                ? 'text-emerald-600 dark:text-emerald-400 fill-emerald-500'
                                : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white block">
                              Express Delivery (Instant Available)
                            </span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-0.5">
                              In-hand / immediate stock available for same-day &amp; instant dispatch.
                            </span>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExtractedProduct({
                              ...extractedProduct,
                              deliveryType: 'standard',
                            })
                          }
                          className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                            extractedProduct.deliveryType !== 'express'
                              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-400/50'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                          }`}
                        >
                          <Truck
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              extractedProduct.deliveryType !== 'express'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white block">
                              Standard Logistics (3–6 Working Days)
                            </span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-0.5">
                              Express not selected — takes 3 to 6 working days depending on logistics.
                            </span>
                          </div>
                        </button>
                      </div>

                      {/* Product Delivery Charges: Default vs Free vs Custom Charge */}
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                          Product Delivery Charges (Free Delivery or Custom Delivery Charge)
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExtractedProduct({
                                ...extractedProduct,
                                deliveryFeeType: 'default',
                                customDeliveryCharge: undefined,
                              })
                            }
                            className={`p-2 rounded-lg border text-left text-xs cursor-pointer ${
                              (extractedProduct.deliveryFeeType || 'default') === 'default'
                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 font-bold text-slate-900 dark:text-white'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            City / Area Fee (Default)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExtractedProduct({
                                ...extractedProduct,
                                deliveryFeeType: 'free',
                                customDeliveryCharge: 0,
                              })
                            }
                            className={`p-2 rounded-lg border text-left text-xs cursor-pointer ${
                              extractedProduct.deliveryFeeType === 'free'
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 font-bold text-emerald-800 dark:text-emerald-200'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Free Delivery (Rs. 0)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExtractedProduct({
                                ...extractedProduct,
                                deliveryFeeType: 'custom',
                                customDeliveryCharge: extractedProduct.customDeliveryCharge ?? 200,
                              })
                            }
                            className={`p-2 rounded-lg border text-left text-xs cursor-pointer ${
                              extractedProduct.deliveryFeeType === 'custom'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 font-bold text-blue-800 dark:text-blue-200'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Custom Charge (Rs.)
                          </button>
                        </div>
                        {extractedProduct.deliveryFeeType === 'custom' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              Fixed Delivery Charge (Rs.):
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={extractedProduct.customDeliveryCharge ?? 0}
                              onChange={(e) =>
                                setExtractedProduct({
                                  ...extractedProduct,
                                  customDeliveryCharge: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                })
                              }
                              className="w-32 px-2.5 py-1 text-xs font-mono font-bold rounded-lg border border-blue-400 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 4. IMAGE MANAGEMENT & GALLERY (Downloaded Media, Upload, Reorder, Add URL) */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Imported Product Media Gallery ({extractedProduct.pictures?.length || 0} photos)
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

                    {/* Paste / Download Extra Image URL */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={manualImageUrlInput}
                        onChange={(e) => setManualImageUrlInput(e.target.value)}
                        placeholder="Paste additional photo URL to download & add to product media..."
                        className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-slate-800 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        disabled={isCachingImageUrl || !manualImageUrlInput.trim()}
                        onClick={handleAddExternalImageUrl}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 text-white font-bold text-xs rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {isCachingImageUrl ? 'Downloading...' : '+ Download & Add Photo'}
                      </button>
                    </div>

                    {extractedProduct.pictures && extractedProduct.pictures.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-1">
                        {extractedProduct.pictures.map((pic, idx) => (
                          <div
                            key={`${pic}_${idx}`}
                            className={`relative group rounded-lg overflow-hidden border-2 bg-white dark:bg-slate-900 ${
                              idx === 0
                                ? 'border-amber-500 shadow-sm'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <img
                              src={pic}
                              alt={`Product pic ${idx + 1}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-24 object-contain bg-slate-100 dark:bg-slate-800"
                            />
                            {idx === 0 ? (
                              <span className="absolute top-1 left-1 bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.5 rounded shadow-xs">
                                MAIN
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetMainGalleryImage(idx)}
                                className="absolute top-1 left-1 bg-slate-900/80 hover:bg-amber-500 hover:text-slate-950 text-white text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Set as main product photo"
                              >
                                Set Main
                              </button>
                            )}

                            <div className="flex items-center justify-between gap-1 px-1.5 py-1 bg-slate-50 dark:bg-slate-800/90 border-t border-slate-200 dark:border-slate-700 text-[10px]">
                              <div className="flex items-center gap-1">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveGalleryImage(idx, idx - 1)}
                                    className="px-1.5 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded cursor-pointer font-bold"
                                    title="Move left"
                                  >
                                    ←
                                  </button>
                                )}
                                {idx < (extractedProduct.pictures?.length || 0) - 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveGalleryImage(idx, idx + 1)}
                                    className="px-1.5 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded cursor-pointer font-bold"
                                    title="Move right"
                                  >
                                    →
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveGalleryImage(idx)}
                                className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded cursor-pointer"
                                title="Delete photo"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500">
                        No photos extracted from link yet. Use "Upload Gallery" or "Download &amp; Add Photo" above.
                      </div>
                    )}

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

                  {/* 5. MULTI-DIMENSIONAL VARIATIONS WITH SEPARATE DETAILS & MEDIA PICKER */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Sliders className="w-4 h-4 text-amber-500" />
                          Variations &amp; Separate Variant Details ({extractedProduct.variations?.length || 0})
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Each variant has separate title, photo (pick directly from imported media or upload), pricing, stock &amp; specifications.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddVariation}
                        className="px-3 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-lg cursor-pointer flex items-center gap-1 self-start sm:self-auto"
                      >
                        <Plus className="w-3.5 h-3.5" />
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
                      <div className="space-y-3">
                        {extractedProduct.variations.map((v, idx) => {
                          const isPickerOpen = mediaPickerVarIndex === idx;
                          const importedPics = extractedProduct.pictures || [];
                          return (
                            <div
                              key={v.id}
                              className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3 shadow-2xs"
                            >
                              <div className="flex flex-col sm:flex-row items-start gap-3">
                                {/* Variant Image Preview + Picker Trigger */}
                                <div className="flex sm:flex-col items-center gap-2 shrink-0">
                                  <div className="w-16 h-16 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                    {v.image ? (
                                      <img
                                        src={v.image}
                                        alt={v.title || `Variant ${idx + 1}`}
                                        referrerPolicy="no-referrer"
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <ImageIcon className="w-6 h-6 text-slate-400" />
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setMediaPickerVarIndex(isPickerOpen ? null : idx)}
                                      className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer border transition-colors ${
                                        isPickerOpen
                                          ? 'bg-amber-500 text-slate-950 border-amber-500'
                                          : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                                      }`}
                                    >
                                      {isPickerOpen
                                        ? 'Close Media Picker'
                                        : `Pick Media (${importedPics.length})`}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVariationImageTargetIndex(idx);
                                        variationImageInputRef.current?.click();
                                      }}
                                      className="px-2 py-1 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer flex items-center justify-center gap-1"
                                    >
                                      <Upload className="w-2.5 h-2.5" />
                                      Upload
                                    </button>
                                  </div>
                                </div>

                                {/* Variant Fields Grid */}
                                <div className="flex-1 w-full space-y-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                      Variant #{idx + 1}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveVariation(idx)}
                                      className="text-red-500 hover:text-red-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      Remove
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Variant Title / Option
                                      </label>
                                      <input
                                        type="text"
                                        value={v.title || ''}
                                        onChange={(e) => handleUpdateVariation(idx, 'title', e.target.value)}
                                        placeholder="e.g. Rose Gold · Large"
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Size / Dimension
                                      </label>
                                      <input
                                        type="text"
                                        value={v.size || ''}
                                        onChange={(e) => handleUpdateVariation(idx, 'size', e.target.value)}
                                        placeholder="e.g. Large / 500ml"
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Color / Finish
                                      </label>
                                      <input
                                        type="text"
                                        value={v.color || ''}
                                        onChange={(e) => handleUpdateVariation(idx, 'color', e.target.value)}
                                        placeholder="e.g. Black / Rose Gold"
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Variation SKU
                                      </label>
                                      <input
                                        type="text"
                                        value={v.sku || ''}
                                        onChange={(e) => handleUpdateVariation(idx, 'sku', e.target.value)}
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Market Price (Rs.)
                                      </label>
                                      <input
                                        type="number"
                                        value={v.originalPrice || 0}
                                        onChange={(e) =>
                                          handleUpdateVariation(idx, 'originalPrice', parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 block mb-0.5">
                                        Our Price (Rs.)
                                      </label>
                                      <input
                                        type="number"
                                        value={v.salePrice || 0}
                                        onChange={(e) =>
                                          handleUpdateVariation(idx, 'salePrice', parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full px-2.5 py-1.5 text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg bg-slate-50 dark:bg-slate-800 font-mono font-bold text-emerald-700 dark:text-emerald-400"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                                        Stock Qty
                                      </label>
                                      <input
                                        type="number"
                                        value={v.stockQty || 0}
                                        onChange={(e) =>
                                          handleUpdateVariation(idx, 'stockQty', parseInt(e.target.value, 10) || 0)
                                        }
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 font-mono"
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-0.5">
                                      Separate Variant Details / Specs (shown to customer when selecting this variant)
                                    </label>
                                    <textarea
                                      rows={2}
                                      value={v.details || ''}
                                      onChange={(e) => handleUpdateVariation(idx, 'details', e.target.value)}
                                      placeholder="Specific dimensions, capacity, packaging, color note or specs for this variant..."
                                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Inline Select Variant Image from Imported Media Picker */}
                              {isPickerOpen && (
                                <div className="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                                      Select Photo for Variant #{idx + 1} from Imported Link Media ({importedPics.length}):
                                    </span>
                                    {v.image && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateVariation(idx, 'image', undefined)}
                                        className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer"
                                      >
                                        Clear Variant Photo
                                      </button>
                                    )}
                                  </div>

                                  {importedPics.length > 0 ? (
                                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                      {importedPics.map((mediaUrl, mIdx) => {
                                        const isSelected = v.image === mediaUrl;
                                        return (
                                          <button
                                            key={`${mediaUrl}_${mIdx}`}
                                            type="button"
                                            onClick={() => {
                                              handleUpdateVariation(idx, 'image', mediaUrl);
                                              setMediaPickerVarIndex(null);
                                            }}
                                            className={`relative rounded-lg overflow-hidden border-2 h-14 bg-white dark:bg-slate-900 cursor-pointer transition-all ${
                                              isSelected
                                                ? 'border-amber-500 ring-2 ring-amber-400 scale-105'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-amber-400'
                                            }`}
                                          >
                                            <img
                                              src={mediaUrl}
                                              alt={`Media ${mIdx + 1}`}
                                              referrerPolicy="no-referrer"
                                              className="w-full h-full object-contain"
                                            />
                                            {isSelected && (
                                              <span className="absolute top-0.5 right-0.5 bg-amber-500 text-slate-950 rounded-full p-0.5">
                                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-slate-500">
                                      No imported media in gallery yet. Upload gallery photos above or upload directly for this variant.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No variations extracted. Click "Add Variation" to define choices with separate photos &amp; details.
                      </p>
                    )}
                  </div>

                  {/* 6. SPECS, SIZING CHART & DESCRIPTION STUDIO */}
                  <div className="bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div>
                        <h4 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Ruler className="w-4 h-4 text-amber-500" />
                          6. Specs, Sizing Chart &amp; Description Studio
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Edit garment measurement matrices, structured specs &amp; copy, or preview the live Customer Dossier.
                        </p>
                      </div>

                      <div className="inline-flex rounded-lg bg-slate-200 dark:bg-slate-800 p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setSpecsTabMode('edit')}
                          className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                            specsTabMode === 'edit'
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          Edit Fields
                        </button>
                        <button
                          type="button"
                          onClick={() => setSpecsTabMode('preview')}
                          className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            specsTabMode === 'preview'
                              ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview Customer Dossier
                        </button>
                      </div>
                    </div>

                    {specsTabMode === 'preview' ? (
                      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800">
                        <ProductSpecSizingShowcase product={extractedProduct} />
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {/* EXTRACTED SIZE & MEASUREMENT CHART EDITOR */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                <Ruler className="w-3.5 h-3.5 text-amber-500" />
                                Size &amp; Measurement Chart
                              </span>
                              {extractedProduct.sizeChart ? (
                                <span className="text-[11px] font-mono text-slate-500">
                                  {extractedProduct.sizeChart.rows.length} rows × {extractedProduct.sizeChart.columns.length} sizes
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">
                                  No structured chart detected on page
                                </span>
                              )}
                            </div>

                            {extractedProduct.sizeChart ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unit:</span>
                                <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateSizeChartUnit('in')}
                                    className={`px-2 py-0.5 font-mono font-bold cursor-pointer ${
                                      (extractedProduct.sizeChart.unit || 'in') === 'in'
                                        ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950'
                                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    INCHES
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateSizeChartUnit('cm')}
                                    className={`px-2 py-0.5 font-mono font-bold cursor-pointer ${
                                      extractedProduct.sizeChart.unit === 'cm'
                                        ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950'
                                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    CM
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={handleInitSizeChart}
                                className="px-2.5 py-1 rounded-md bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-[11px] font-bold cursor-pointer flex items-center gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                Initialize Size Chart
                              </button>
                            )}
                          </div>

                          {extractedProduct.sizeChart && (
                            <div className="space-y-3">
                              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                                      <th className="py-2 px-2.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 min-w-[130px]">
                                        Measurement
                                      </th>
                                      {extractedProduct.sizeChart.columns.map((col, cIdx) => (
                                        <th key={`${col}_${cIdx}`} className="py-1.5 px-2 text-center min-w-[90px]">
                                          <div className="inline-flex items-center gap-1 font-mono font-bold text-slate-800 dark:text-slate-200">
                                            <span>{col}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveSizeChartColumn(cIdx)}
                                              title={`Remove ${col}`}
                                              className="text-red-400 hover:text-red-600 cursor-pointer"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </th>
                                      ))}
                                      <th className="py-1.5 px-2 w-8" />
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {extractedProduct.sizeChart.rows.map((row, rIdx) => (
                                      <tr key={`sc_row_${rIdx}`}>
                                        <td className="p-1.5">
                                          <input
                                            type="text"
                                            value={row.label}
                                            onChange={(e) => handleUpdateSizeChartRowLabel(rIdx, e.target.value)}
                                            className="w-full px-2 py-1 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                                          />
                                        </td>
                                        {extractedProduct.sizeChart?.columns.map((col, cIdx) => (
                                          <td key={`${rIdx}_${col}_${cIdx}`} className="p-1.5">
                                            <input
                                              type="text"
                                              value={row.values[cIdx] || ''}
                                              onChange={(e) => handleUpdateSizeChartCell(rIdx, cIdx, e.target.value)}
                                              placeholder="—"
                                              className="w-full px-2 py-1 text-xs font-mono text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                                            />
                                          </td>
                                        ))}
                                        <td className="p-1.5 text-center">
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveSizeChartRow(rIdx)}
                                            className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                                  <input
                                    type="text"
                                    value={newSizeRowInput}
                                    onChange={(e) => setNewSizeRowInput(e.target.value)}
                                    placeholder="Add measurement row (e.g. Shoulder)..."
                                    className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                                  />
                                  <button
                                    type="button"
                                    onClick={handleAddSizeChartRow}
                                    className="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white rounded text-xs font-bold cursor-pointer"
                                  >
                                    + Row
                                  </button>
                                </div>
                                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                                  <input
                                    type="text"
                                    value={newSizeColInput}
                                    onChange={(e) => setNewSizeColInput(e.target.value)}
                                    placeholder="Add size column (e.g. XXL)..."
                                    className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                                  />
                                  <button
                                    type="button"
                                    onClick={handleAddSizeChartColumn}
                                    className="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white rounded text-xs font-bold cursor-pointer"
                                  >
                                    + Size
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Descriptions */}
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                                Short Description (Lead Editorial Summary)
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
                                Full Product Details &amp; Structured Description
                              </label>
                              <textarea
                                rows={6}
                                value={extractedProduct.details || ''}
                                onChange={(e) =>
                                  setExtractedProduct({ ...extractedProduct, details: e.target.value })
                                }
                                className="w-full px-3 py-2 text-xs leading-relaxed bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>

                          {/* Specifications */}
                          <div className="space-y-3">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                              Product Specifications (Key-Value Ledger)
                            </label>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                              {extractedProduct.specifications &&
                                Object.entries(extractedProduct.specifications).map(([k, v]) => (
                                  <div
                                    key={k}
                                    className="flex items-center justify-between gap-2 p-1.5 bg-white dark:bg-slate-800 rounded text-xs border border-slate-200 dark:border-slate-700"
                                  >
                                    <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">{k}:</span>
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
                                placeholder="Value (e.g. Micro Velvet)"
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

                        {/* FEATURES & TAGS */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                          {/* Features */}
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                              Key Highlights (Numbered in Customer Dossier)
                            </label>
                            <div className="space-y-1 max-h-28 overflow-y-auto">
                              {extractedProduct.features?.map((feat, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded">
                                  <span className="truncate font-medium">
                                    <span className="font-mono text-amber-600 mr-1.5">{String(idx + 1).padStart(2, '0')}.</span>
                                    {feat}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFeature(idx)}
                                    className="text-red-500 p-0.5 cursor-pointer"
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
                                placeholder="Add numbered highlight point..."
                                className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              />
                              <button
                                type="button"
                                onClick={handleAddFeature}
                                className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold cursor-pointer"
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
                                    className="hover:text-red-600 cursor-pointer"
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
                                placeholder="Add tag (e.g. velvet, winter)..."
                                className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                              />
                              <button
                                type="button"
                                onClick={handleAddTag}
                                className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold cursor-pointer"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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
