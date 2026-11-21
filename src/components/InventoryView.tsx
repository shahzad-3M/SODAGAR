import React, { useState } from 'react';
import {
  Package,
  Plus,
  Sparkles,
  TrendingUp,
  Percent,
  Search,
  AlertTriangle,
  ArrowUpDown,
  Edit2,
  Trash2,
  Check,
  X,
  RefreshCw,
  ShoppingBag,
  Globe,
  ExternalLink,
  CalendarClock,
  CheckCircle2,
  ShieldAlert,
  Layers,
  Video,
  Users,
  Phone,
  Zap,
  Truck,
  Image as ImageIcon,
  Upload,
} from 'lucide-react';
import { AppUser, BusinessProfile, CategoryRecord, DeliverySpeedCategory, Investor, ProductDeliveryFeeType, ProductItem, ProductVariation } from '../types/index.ts';
import {
  getCategories,
  addCategory,
  getCategoryRecords,
  getInvestors,
  apiSaveCategoryRecord,
  apiActivateProductArrival,
  apiCacheExternalImage,
} from '../utils/storage.ts';
import {
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
  isProductPurchaseBlocked,
  isUserAuthorizedForStockTransfer,
  doesProductMatchCategoryFilter,
  resolveCategoryIdsFromProduct,
  getCategoryBreadcrumb,
  getProductDeliveryMeta,
} from '../utils/locationCategoryHelpers.ts';
import { ProductImporterModal } from './ProductImporterModal.tsx';
import { CategoryCascadingSelect } from './CategoryCascadingSelect.tsx';

interface InventoryViewProps {
  products: ProductItem[];
  profile: BusinessProfile;
  currentUser?: AppUser;
  categoryRecords?: CategoryRecord[];
  investors?: Investor[];
  onRefreshProducts?: () => void;
  onSaveProduct: (product: ProductItem) => void;
  onUpdateStock: (productId: string, newStock: number) => void;
  onToggleWinningItem: (productId: string) => void;
  onDeleteProduct: (productId: string) => void;
  isExternalImportOpen?: boolean;
  onCloseExternalImport?: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  profile,
  currentUser,
  categoryRecords,
  investors,
  onRefreshProducts,
  onSaveProduct,
  onUpdateStock,
  onToggleWinningItem,
  onDeleteProduct,
  isExternalImportOpen = false,
  onCloseExternalImport,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedDeliveryFilter, setSelectedDeliveryFilter] = useState<'all' | DeliverySpeedCategory>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(isExternalImportOpen);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);

  // Form State for Add / Edit
  const [formName, setFormName] = useState('');
  const [formUrduName, setFormUrduName] = useState('');
  const [formCategory, setFormCategory] = useState('Cosmetics');
  const [formParentCatId, setFormParentCatId] = useState<string>('');
  const [formSubCatId, setFormSubCatId] = useState<string>('');
  const [formChildCatId, setFormChildCatId] = useState<string>('');
  const [formIsUpcoming, setFormIsUpcoming] = useState(false);
  const [formExpectedArrivalDate, setFormExpectedArrivalDate] = useState('');
  const [formDeliveryType, setFormDeliveryType] = useState<DeliverySpeedCategory>('standard');
  const [formDeliveryFeeType, setFormDeliveryFeeType] = useState<ProductDeliveryFeeType>('default');
  const [formCustomDeliveryCharge, setFormCustomDeliveryCharge] = useState('');
  const [formDetails, setFormDetails] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formMarketPrice, setFormMarketPrice] = useState('');
  const [formOurPrice, setFormOurPrice] = useState('');
  const [formStockQty, setFormStockQty] = useState('');
  const [formMinStock, setFormMinStock] = useState('10');
  const [formIsWinning, setFormIsWinning] = useState(false);
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formPictures, setFormPictures] = useState<string[]>([]);
  const [formExtraPictureUrl, setFormExtraPictureUrl] = useState('');
  const [formCachePictureLoading, setFormCachePictureLoading] = useState(false);
  const [formCachePictureError, setFormCachePictureError] = useState('');
  const [formVariations, setFormVariations] = useState<ProductVariation[]>([]);
  const [editVarMediaPickerIdx, setEditVarMediaPickerIdx] = useState<number | null>(null);
  const [formWebsiteUrl, setFormWebsiteUrl] = useState('');
  const [formVideoUrl, setFormVideoUrl] = useState('');
  const [formInvestorId, setFormInvestorId] = useState('');
  const [formInvestorWhatsApp, setFormInvestorWhatsApp] = useState('');

  const effectiveInvestors = investors && investors.length > 0 ? investors : getInvestors();

  // Central category management (3-level records)
  const [centralCategories, setCentralCategories] = useState<string[]>(() => getCategories());
  const [localCatRecords, setLocalCatRecords] = useState<CategoryRecord[]>(() => getCategoryRecords());
  const effectiveCatRecords = categoryRecords && categoryRecords.length > 0 ? categoryRecords : localCatRecords;
  const [isCreatingNewCategory, setIsCreatingNewCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [categoryError, setCategoryError] = useState('');

  // Arrival & Transfer Modal State (Upcoming -> Active Category)
  const [arrivalTarget, setArrivalTarget] = useState<ProductItem | null>(null);
  const [arrivalMainCatId, setArrivalMainCatId] = useState('');
  const [arrivalSubCatId, setArrivalSubCatId] = useState<string | undefined>(undefined);
  const [arrivalChildCatId, setArrivalChildCatId] = useState<string | undefined>(undefined);
  const [arrivalDeliveryType, setArrivalDeliveryType] = useState<DeliverySpeedCategory>('standard');
  const [arrivalDeliveryFeeType, setArrivalDeliveryFeeType] = useState<ProductDeliveryFeeType>('default');
  const [arrivalCustomDeliveryCharge, setArrivalCustomDeliveryCharge] = useState('');
  const [arrivalOurPrice, setArrivalOurPrice] = useState('');
  const [arrivalMarketPrice, setArrivalMarketPrice] = useState('');
  const [arrivalCostPrice, setArrivalCostPrice] = useState('');
  const [arrivalStockQty, setArrivalStockQty] = useState('25');
  const [arrivalDetails, setArrivalDetails] = useState('');
  const [arrivalVariations, setArrivalVariations] = useState<ProductVariation[]>([]);
  const [arrivalError, setArrivalError] = useState('');
  const [isActivatingArrival, setIsActivatingArrival] = useState(false);

  const canActivateArrival = isUserAuthorizedForStockTransfer(currentUser);

  // Synchronize external import trigger if provided
  React.useEffect(() => {
    if (isExternalImportOpen) {
      setIsImportModalOpen(true);
    }
  }, [isExternalImportOpen]);

  // Keep central categories updated with existing product categories
  const categories = Array.from(
    new Set([UPCOMING_CATEGORY_NAME, ...centralCategories])
  ).sort((a, b) => a.localeCompare(b));

  const handleCreateCategoryDirect = async () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) {
      setCategoryError('Please enter a category name.');
      return;
    }
    const apiRes = await apiSaveCategoryRecord({
      name: trimmed,
      parentCategoryId: newCategoryParentId || undefined,
      isActive: true,
    });
    if (!apiRes.ok) {
      if (apiRes.error && apiRes.error.toLowerCase().includes('already exists')) {
        setCategoryError(apiRes.error);
        return;
      }
      const result = addCategory(trimmed, newCategoryParentId || undefined);
      setCentralCategories(result.categories);
      setLocalCatRecords(getCategoryRecords());
    } else {
      setCentralCategories(getCategories());
      setLocalCatRecords(apiRes.categories || getCategoryRecords());
    }
    onRefreshProducts?.();
    setNewCategoryInput('');
    setNewCategoryParentId('');
    setIsCreatingNewCategory(false);
    setCategoryError('');
  };

  // Calculate high-level KPIs
  const totalStockCount = products.reduce((acc, p) => acc + p.stockQty, 0);
  const totalInventoryValuation = products.reduce((acc, p) => acc + p.ourPrice * p.stockQty, 0);
  const totalProfitGenerated = products.reduce((acc, p) => acc + p.totalProfit, 0);
  const lowStockCount = products.filter((p) => !isProductPurchaseBlocked(p) && p.stockQty <= p.minStockAlert).length;

  // Winning items ranked by total profit
  const winningProducts = [...products].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 3);

  const filteredProducts = products.filter((p) => {
    if (
      selectedCategory !== 'all' &&
      !doesProductMatchCategoryFilter(p, selectedCategory, effectiveCatRecords)
    ) {
      return false;
    }
    if (selectedDeliveryFilter !== 'all') {
      const pDelivery = getProductDeliveryMeta(p).deliveryType;
      if (pDelivery !== selectedDeliveryFilter) return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchUrdu = p.urduName ? p.urduName.toLowerCase().includes(q) : false;
      const matchSku = p.sku.toLowerCase().includes(q);
      return matchName || matchUrdu || matchSku;
    }
    return true;
  });

  const handleOpenAddModal = (prod?: ProductItem) => {
    setLocalCatRecords(getCategoryRecords());
    if (prod) {
      setEditingProduct(prod);
      setFormName(prod.name);
      setFormUrduName(prod.urduName || '');
      setFormCategory(prod.category);
      const resolvedIds = resolveCategoryIdsFromProduct(prod, effectiveCatRecords);
      setFormParentCatId(resolvedIds.parentCategoryId || '');
      setFormSubCatId(resolvedIds.subcategoryId || '');
      setFormChildCatId(resolvedIds.childSubcategoryId || '');
      setFormIsUpcoming(isProductPurchaseBlocked(prod));
      setFormExpectedArrivalDate(prod.expectedArrivalDate || '');
      setFormDeliveryType(prod.deliveryType === 'express' ? 'express' : 'standard');
      setFormDeliveryFeeType(prod.deliveryFeeType || 'default');
      setFormCustomDeliveryCharge(
        typeof prod.customDeliveryCharge === 'number' ? String(prod.customDeliveryCharge) : ''
      );
      setFormDetails(prod.details || prod.description || '');
      setFormSku(prod.sku);
      setFormCostPrice(String(prod.costPrice));
      setFormMarketPrice(String(prod.marketPrice));
      setFormOurPrice(String(prod.ourPrice));
      setFormStockQty(isProductPurchaseBlocked(prod) ? '0' : String(prod.stockQty));
      setFormMinStock(String(prod.minStockAlert));
      setFormIsWinning(prod.isWinningItem);
      const initialPics = Array.from(
        new Set(
          [
            ...(prod.pictures || []),
            ...(prod.imageUrl ? [prod.imageUrl] : []),
            ...((prod.variations || []).map((v) => v.image).filter(Boolean) as string[]),
          ].filter(Boolean)
        )
      );
      setFormPictures(initialPics);
      setFormImageUrl(initialPics[0] || prod.imageUrl || '');
      setFormVariations(prod.variations ? prod.variations.map((v) => ({ ...v })) : []);
      setFormWebsiteUrl(prod.websiteUrl || '');
      setFormVideoUrl(prod.videoUrl || '');
      const matchedInv =
        effectiveInvestors.find((i) => i.id === prod.investorId) ||
        effectiveInvestors.find(
          (i) =>
            i.assignedProductIds?.includes(prod.id) ||
            i.productAllocations?.some((a) => a.productId === prod.id)
        );
      setFormInvestorId(prod.investorId || matchedInv?.id || '');
      setFormInvestorWhatsApp(prod.investorWhatsApp || matchedInv?.whatsapp || matchedInv?.phone || '');
    } else {
      setEditingProduct(null);
      setFormName('');
      setFormUrduName('');
      const firstMain = effectiveCatRecords.find((c) => !c.parentCategoryId && !c.isUpcoming && c.isActive !== false);
      setFormCategory(firstMain?.name || centralCategories[0] || 'Cosmetics');
      setFormParentCatId(firstMain?.id || '');
      setFormSubCatId('');
      setFormChildCatId('');
      setFormIsUpcoming(false);
      setFormExpectedArrivalDate('');
      setFormDeliveryType('standard');
      setFormDeliveryFeeType('default');
      setFormCustomDeliveryCharge('');
      setFormDetails('');
      setFormSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`);
      setFormCostPrice('');
      setFormMarketPrice('');
      setFormOurPrice('');
      setFormStockQty('50');
      setFormMinStock('10');
      setFormIsWinning(false);
      setFormImageUrl('');
      setFormPictures([]);
      setFormVariations([]);
      setFormWebsiteUrl('');
      setFormVideoUrl('');
      setFormInvestorId('');
      setFormInvestorWhatsApp('');
    }
    setFormExtraPictureUrl('');
    setFormCachePictureError('');
    setEditVarMediaPickerIdx(null);
    setIsCreatingNewCategory(false);
    setNewCategoryInput('');
    setNewCategoryParentId('');
    setCategoryError('');
    setIsAddModalOpen(true);
  };

  const handleOpenArrivalModal = (prod: ProductItem) => {
    const freshCats = getCategoryRecords();
    setLocalCatRecords(freshCats);
    const defaultMain = freshCats.find((c) => !c.parentCategoryId && !c.isUpcoming && c.isActive !== false);
    setArrivalTarget(prod);
    setArrivalMainCatId(defaultMain?.id || '');
    setArrivalSubCatId(undefined);
    setArrivalChildCatId(undefined);
    setArrivalDeliveryType(prod.deliveryType === 'express' ? 'express' : 'standard');
    setArrivalDeliveryFeeType(prod.deliveryFeeType || 'default');
    setArrivalCustomDeliveryCharge(
      typeof prod.customDeliveryCharge === 'number' ? String(prod.customDeliveryCharge) : ''
    );
    setArrivalOurPrice(String(prod.ourPrice || ''));
    setArrivalMarketPrice(String(prod.marketPrice || ''));
    setArrivalCostPrice(String(prod.costPrice || ''));
    setArrivalStockQty(String(prod.stockQty > 0 ? prod.stockQty : 25));
    setArrivalDetails(prod.details || prod.description || '');
    setArrivalVariations(prod.variations ? prod.variations.map((v) => ({ ...v })) : []);
    setArrivalError('');
  };

  const handleSubmitArrivalActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arrivalTarget) return;
    setArrivalError('');

    if (!arrivalMainCatId || arrivalMainCatId === UPCOMING_CATEGORY_ID) {
      setArrivalError('Please select a target active Main Category outside Upcoming Viral Products.');
      return;
    }

    const qty = parseInt(arrivalStockQty, 10) || 0;
    if (qty <= 0) {
      setArrivalError('Initial physical stock quantity must be greater than 0.');
      return;
    }

    const ourP = parseFloat(arrivalOurPrice) || 0;
    if (ourP <= 0) {
      setArrivalError('Selling price must be greater than 0.');
      return;
    }

    setIsActivatingArrival(true);
    const res = await apiActivateProductArrival(arrivalTarget.id, {
      parentCategoryId: arrivalMainCatId,
      subcategoryId: arrivalSubCatId,
      childSubcategoryId: arrivalChildCatId,
      deliveryType: arrivalDeliveryType,
      deliveryFeeType: arrivalDeliveryFeeType,
      customDeliveryCharge:
        arrivalDeliveryFeeType === 'custom'
          ? Math.max(0, Math.round(parseFloat(arrivalCustomDeliveryCharge) || 0))
          : undefined,
      ourPrice: ourP,
      marketPrice: parseFloat(arrivalMarketPrice) || ourP,
      costPrice: parseFloat(arrivalCostPrice) || 0,
      stockQty: qty,
      variations: arrivalVariations.length > 0 ? arrivalVariations : undefined,
      details: arrivalDetails.trim() || undefined,
    });
    setIsActivatingArrival(false);

    if (!res.ok) {
      setArrivalError(res.error || 'Failed to activate arrived product.');
      return;
    }

    onRefreshProducts?.();
    setArrivalTarget(null);
  };

  const handleAddAndCacheFormPicture = async () => {
    const raw = formExtraPictureUrl.trim();
    if (!raw) return;
    setFormCachePictureError('');
    setFormCachePictureLoading(true);
    try {
      const res = await apiCacheExternalImage(raw, formWebsiteUrl.trim() || undefined);
      const finalUrl = res.ok && res.localUrl ? res.localUrl : raw;
      if (!formPictures.includes(finalUrl)) {
        const nextPics = [...formPictures, finalUrl];
        setFormPictures(nextPics);
        if (!formImageUrl.trim()) setFormImageUrl(finalUrl);
      }
      setFormExtraPictureUrl('');
    } catch (err: any) {
      setFormCachePictureError(err?.message || 'Could not cache image');
    } finally {
      setFormCachePictureLoading(false);
    }
  };

  const handleUploadFormPictureFile = (file: File | undefined, targetVarIdx?: number) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      if (typeof targetVarIdx === 'number') {
        setFormVariations((prev) =>
          prev.map((v, i) => (i === targetVarIdx ? { ...v, image: dataUrl } : v))
        );
        setEditVarMediaPickerIdx(null);
      }
      setFormPictures((prev) => (prev.includes(dataUrl) ? prev : [...prev, dataUrl]));
      if (!formImageUrl.trim()) setFormImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cost = parseFloat(formCostPrice) || 0;
    const market = parseFloat(formMarketPrice) || 0;
    const our = parseFloat(formOurPrice) || 0;
    const isUpcomingItem = formIsUpcoming || formParentCatId === UPCOMING_CATEGORY_ID;
    const stock = isUpcomingItem ? 0 : Math.max(0, parseInt(formStockQty, 10) || 0);
    const minStock = parseInt(formMinStock, 10) || 10;

    const assignedCategory = isUpcomingItem
      ? UPCOMING_CATEGORY_NAME
      : formParentCatId
      ? getCategoryBreadcrumb(effectiveCatRecords, formParentCatId, formSubCatId || undefined, formChildCatId || undefined, formCategory)
      : formCategory.trim() || 'General';

    if (!isUpcomingItem) {
      const catResult = addCategory(assignedCategory);
      setCentralCategories(catResult.categories);
    }

    const cleanedPictures = Array.from(
      new Set([formImageUrl.trim(), ...formPictures].filter((u) => Boolean(u)))
    );

    const cleanedVariations: ProductVariation[] = formVariations
      .filter(
        (v) =>
          v.title?.trim() ||
          v.size?.trim() ||
          v.color?.trim() ||
          v.sku?.trim() ||
          v.details?.trim() ||
          v.image
      )
      .map((v, idx) => ({
        ...v,
        id: v.id || `var_${Date.now()}_${idx}`,
        title: v.title?.trim() || [v.size, v.color].filter(Boolean).join(' · ') || `Variant ${idx + 1}`,
        details: v.details?.trim() || undefined,
      }));

    const resolvedSizes: string[] | undefined =
      cleanedVariations.length > 0
        ? cleanedVariations
            .map(
              (v) =>
                v.title ||
                [v.size, v.color, ...Object.values(v.attributes || {})].filter(Boolean).join(' · ') ||
                v.sku
            )
            .filter((s): s is string => Boolean(s))
        : editingProduct?.sizes;

    const prodToSave: ProductItem = {
      ...(editingProduct || {}),
      id: editingProduct ? editingProduct.id : `prod_${Date.now()}`,
      name: formName.trim(),
      urduName: formUrduName.trim() || undefined,
      category: assignedCategory,
      parentCategoryId: isUpcomingItem ? UPCOMING_CATEGORY_ID : formParentCatId || undefined,
      subcategoryId: isUpcomingItem ? undefined : formSubCatId || undefined,
      childSubcategoryId: isUpcomingItem ? undefined : formChildCatId || undefined,
      deliveryType: formDeliveryType,
      deliveryFeeType: formDeliveryFeeType,
      customDeliveryCharge:
        formDeliveryFeeType === 'custom'
          ? Math.max(0, Math.round(parseFloat(formCustomDeliveryCharge) || 0))
          : undefined,
      sku: formSku.trim() || `SKU-${Date.now()}`,
      costPrice: cost,
      marketPrice: market,
      ourPrice: our,
      stockQty: stock,
      minStockAlert: minStock,
      salesCount: editingProduct ? editingProduct.salesCount : 0,
      totalRevenue: editingProduct ? editingProduct.totalRevenue : 0,
      totalProfit: editingProduct ? (our - cost) * editingProduct.salesCount : 0,
      isWinningItem: formIsWinning,
      isUpcoming: isUpcomingItem,
      upcomingStatus: isUpcomingItem ? 'coming_soon' : 'available',
      expectedArrivalDate: isUpcomingItem ? formExpectedArrivalDate.trim() || undefined : undefined,
      details: formDetails.trim() || editingProduct?.details,
      imageUrl: cleanedPictures[0] || formImageUrl.trim() || undefined,
      pictures: cleanedPictures.length > 0 ? cleanedPictures : undefined,
      variations: cleanedVariations.length > 0 ? cleanedVariations : undefined,
      sizes: resolvedSizes,
      websiteUrl: formWebsiteUrl.trim() || undefined,
      videoUrl: formVideoUrl.trim() || undefined,
      investorId: formInvestorId || undefined,
      investorWhatsApp: formInvestorWhatsApp.trim() || undefined,
      createdAt: editingProduct ? editingProduct.createdAt : new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
    };

    onSaveProduct(prodToSave);
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP STATS BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <span className="text-[11px] text-slate-500 block">Total Catalog Items</span>
          <p className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
            {products.length} Products
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            {totalStockCount.toLocaleString('en-PK')} units in warehouse
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <span className="text-[11px] text-slate-500 block">Wholesale Stock Valuation</span>
          <p className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
            {profile.currencySymbol}{totalInventoryValuation.toLocaleString('en-PK')}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            At our selling price
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <span className="text-[11px] text-slate-500 block">Total Gross Profit Earned</span>
          <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {profile.currencySymbol}{totalProfitGenerated.toLocaleString('en-PK')}
          </p>
          <span className="text-[10px] text-emerald-600 mt-1 block font-medium">
            Accumulated profit from sold units
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <span className="text-[11px] text-slate-500 block">Low Stock Alert</span>
          <p className={`text-xl font-bold font-mono mt-1 ${lowStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
            {lowStockCount} Items
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block">
            {lowStockCount > 0 ? 'Requires immediate restock' : 'All stock levels healthy'}
          </span>
        </div>
      </div>

      {/* 2. WINNING ITEMS SPOTLIGHT (Requested in User Brief) */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent border border-amber-300 dark:border-amber-800 rounded-2xl p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4 fill-slate-950" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                Winning Items Spotlight (سب سے زیادہ منافع بخش اشیاء)
              </h2>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Ranked dynamically by total sales profit, margin %, and turnover speed
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {winningProducts.map((p, idx) => (
            <div
              key={p.id}
              className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 rounded-xl p-3 shadow-2xs space-y-2 relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-bold text-[11px] flex items-center justify-center shrink-0">
                  #{idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {p.name}
                  </h3>
                  {p.urduName && (
                    <span className="font-urdu text-[11px] text-slate-500 block truncate">
                      {p.urduName}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 text-[10px]">Net Profit:</span>
                  <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {profile.currencySymbol}{p.totalProfit.toLocaleString('en-PK')}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px]">Units Sold:</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {p.salesCount} sold
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                <span>Margin: {Math.round(((p.ourPrice - p.costPrice) / p.ourPrice) * 100)}%</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                  +{profile.currencySymbol}{(p.ourPrice - p.costPrice).toLocaleString('en-PK')}/unit
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. INVENTORY TABLE CONTROLS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by product name, Urdu, SKU..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={selectedDeliveryFilter}
              onChange={(e) => setSelectedDeliveryFilter(e.target.value as 'all' | DeliverySpeedCategory)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Delivery Speeds</option>
              <option value="express">⚡ Express Delivery (Instant)</option>
              <option value="standard">🚚 Standard Logistics (3–6 Working Days)</option>
            </select>

            <button
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs rounded-lg shadow-2xs cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>Import from Website (ویب سائٹ سے امپورٹ)</span>
            </button>

            <button
              onClick={() => handleOpenAddModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-2xs cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add New Product (نیا آئٹم)</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">Product Name (نام)</th>
                <th className="py-2.5 px-3">Category / SKU</th>
                <th className="py-2.5 px-3 text-right">Cost Price</th>
                <th className="py-2.5 px-3 text-right">Market Price</th>
                <th className="py-2.5 px-3 text-right">Our Price</th>
                <th className="py-2.5 px-3 text-right">Customer Saves</th>
                <th className="py-2.5 px-3 text-center">Stock Qty</th>
                <th className="py-2.5 px-3 text-center">Winning Item</th>
                <th className="py-2.5 px-3 text-right">Quick Restock</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProducts.map((p) => {
                const savings = p.marketPrice - p.ourPrice;
                const savingsPct = p.marketPrice > 0 ? Math.round((savings / p.marketPrice) * 100) : 0;
                const isUpcomingBlocked = isProductPurchaseBlocked(p);
                const isLowStock = !isUpcomingBlocked && p.stockQty <= p.minStockAlert;

                return (
                  <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-slate-900 dark:text-white line-clamp-1">
                          {p.name}
                        </p>
                        {isUpcomingBlocked ? (
                          <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 text-[9px] font-black uppercase">
                            Coming Soon
                          </span>
                        ) : getProductDeliveryMeta(p).isExpress ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[9px] font-black border border-emerald-200 dark:border-emerald-800">
                            <Zap className="w-2.5 h-2.5 fill-current" /> EXPRESS
                          </span>
                        ) : null}
                        {p.variations && p.variations.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-semibold">
                            {p.variations.length} variants
                          </span>
                        )}
                      </div>
                      {p.urduName && (
                        <p className="font-urdu text-[11px] text-slate-500 mt-0.5">
                          {p.urduName}
                        </p>
                      )}
                      {isUpcomingBlocked && p.expectedArrivalDate && (
                        <p className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold mt-0.5">
                          Expected Arrival: {p.expectedArrivalDate}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-slate-700 dark:text-slate-300 block font-medium">
                        {p.category}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {p.sku}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-500 tabular-nums">
                      {profile.currencySymbol}{p.costPrice.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400 line-through tabular-nums">
                      {profile.currencySymbol}{p.marketPrice.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {profile.currencySymbol}{p.ourPrice.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {profile.currencySymbol}{savings.toLocaleString('en-PK')} ({savingsPct}%)
                    </td>
                    <td className="py-3 px-3 text-center">
                      {isUpcomingBlocked ? (
                        <span className="inline-block font-mono font-bold px-2 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                          0 (Upcoming)
                        </span>
                      ) : (
                        <span className={`inline-block font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                          isLowStock
                            ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                        }`}>
                          {p.stockQty}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => onToggleWinningItem(p.id)}
                        className={`p-1 rounded cursor-pointer transition-colors ${
                          p.isWinningItem
                            ? 'text-amber-500 bg-amber-50 dark:bg-amber-950 hover:bg-amber-100'
                            : 'text-slate-300 hover:text-slate-400'
                        }`}
                        title="Toggle Winning Item"
                      >
                        <Sparkles className="w-4 h-4 fill-current" />
                      </button>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {isUpcomingBlocked ? (
                        canActivateArrival ? (
                          <button
                            type="button"
                            onClick={() => handleOpenArrivalModal(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] rounded-lg cursor-pointer shadow-2xs whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Confirm Arrival &amp; Activate</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Admin/Stock Mgr Only</span>
                        )
                      ) : (
                        <div className="inline-flex items-center gap-1 font-mono">
                          <button
                            onClick={() => onUpdateStock(p.id, p.stockQty + 10)}
                            className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[10px] cursor-pointer"
                          >
                            +10
                          </button>
                          <button
                            onClick={() => onUpdateStock(p.id, p.stockQty + 50)}
                            className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[10px] cursor-pointer"
                          >
                            +50
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {p.websiteUrl && (
                          <a
                            href={p.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 rounded cursor-pointer"
                            title="See more details on website (ویب سائٹ پر دیکھیں)"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => handleOpenAddModal(p)}
                          className="p-1 text-slate-400 hover:text-blue-500 rounded cursor-pointer"
                          title="Edit Product"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteProduct(p.id)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded cursor-pointer"
                          title="Delete Product"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ADD / EDIT PRODUCT MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-4 max-h-[92vh] flex flex-col">
            <div className="bg-[#FFD200] p-4 flex items-center justify-between text-slate-900 shrink-0">
              <h2 className="text-base font-extrabold tracking-tight">
                {editingProduct ? 'Edit Product Details' : 'Add New Inventory Item (نیا آئٹم)'}
              </h2>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubmit} className="p-6 space-y-4 text-xs overflow-y-auto">
              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200 block">
                  Product Name in English *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. 5-in-1 Hot Air Styler"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200 block">
                  Product Name in Urdu (اردو نام)
                </label>
                <input
                  type="text"
                  value={formUrduName}
                  onChange={(e) => setFormUrduName(e.target.value)}
                  placeholder="مثال: فائیو ان ون ہاٹ ایئر ہیئر اسٹائلر"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-urdu text-right focus:outline-hidden"
                />
              </div>

              {/* 3-Level Category Hierarchy & Upcoming Toggle */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 font-bold text-purple-800 dark:text-purple-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formIsUpcoming}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormIsUpcoming(checked);
                        if (checked) {
                          setFormParentCatId(UPCOMING_CATEGORY_ID);
                          setFormSubCatId('');
                          setFormChildCatId('');
                          setFormCategory(UPCOMING_CATEGORY_NAME);
                          setFormStockQty('0');
                        } else {
                          const firstMain = effectiveCatRecords.find(
                            (c) => !c.parentCategoryId && !c.isUpcoming && c.isActive !== false
                          );
                          setFormParentCatId(firstMain?.id || '');
                          setFormCategory(firstMain?.name || 'Cosmetics');
                        }
                      }}
                      className="w-4 h-4 rounded text-purple-600"
                    />
                    <span>Upcoming Viral Product (Coming Soon / Non-Purchasable)</span>
                  </label>

                  {!isCreatingNewCategory && !formIsUpcoming && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewCategory(true)}
                      className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      + Quick Add Category / Subcategory
                    </button>
                  )}
                </div>

                {formIsUpcoming ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-purple-700 dark:text-purple-300 block mb-1">
                        Assigned Category
                      </span>
                      <div className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 font-bold text-purple-900 dark:text-purple-200">
                        {UPCOMING_CATEGORY_NAME}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-purple-700 dark:text-purple-300 block mb-1">
                        Expected Arrival Date (Optional)
                      </label>
                      <input
                        type="date"
                        value={formExpectedArrivalDate}
                        onChange={(e) => setFormExpectedArrivalDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                      />
                    </div>
                  </div>
                ) : (
                  <CategoryCascadingSelect
                    categories={effectiveCatRecords}
                    parentCategoryId={formParentCatId}
                    subcategoryId={formSubCatId}
                    childSubcategoryId={formChildCatId}
                    excludeUpcoming={false}
                    onChange={(sel) => {
                      setFormParentCatId(sel.parentCategoryId);
                      setFormSubCatId(sel.subcategoryId || '');
                      setFormChildCatId(sel.childSubcategoryId || '');
                      setFormCategory(sel.breadcrumb);
                      if (sel.isUpcoming) {
                        setFormIsUpcoming(true);
                        setFormStockQty('0');
                      }
                    }}
                  />
                )}

                {isCreatingNewCategory && (
                  <div className="space-y-2 p-2.5 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800">
                    <span className="text-[10px] font-bold text-amber-900 dark:text-amber-200 block">
                      Quick Create Category / Subcategory:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newCategoryInput}
                        onChange={(e) => {
                          setNewCategoryInput(e.target.value);
                          setCategoryError('');
                        }}
                        placeholder="Category / Subcategory Name"
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden"
                      />
                      <select
                        value={newCategoryParentId}
                        onChange={(e) => setNewCategoryParentId(e.target.value)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">Top-Level Main Category (L1)</option>
                        {effectiveCatRecords
                          .filter((c) => !c.isUpcoming && c.id !== UPCOMING_CATEGORY_ID)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              Under: {c.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCreateCategoryDirect}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                      >
                        Save Category
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingNewCategory(false);
                          setCategoryError('');
                        }}
                        className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    {categoryError && <p className="text-[10px] text-red-500 font-medium">{categoryError}</p>}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-800 dark:text-slate-200 block">
                    SKU Code
                  </label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    placeholder="WASH-3PC-001"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-hidden"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-800 dark:text-slate-200 block">
                    Specifications / Short Details
                  </label>
                  <input
                    type="text"
                    value={formDetails}
                    onChange={(e) => setFormDetails(e.target.value)}
                    placeholder="Key specs, quality grade, size details..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Pricing Matrix */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block">
                    Cost Price (لاگت)
                  </label>
                  <input
                    type="number"
                    value={formCostPrice}
                    onChange={(e) => setFormCostPrice(e.target.value)}
                    placeholder="2200"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block">
                    Market Price (مارکیٹ)
                  </label>
                  <input
                    type="number"
                    value={formMarketPrice}
                    onChange={(e) => setFormMarketPrice(e.target.value)}
                    placeholder="6980"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-amber-700 dark:text-amber-400 block">
                    {formIsUpcoming ? 'Expected Price' : 'Our Price (ہماری قیمت)'}
                  </label>
                  <input
                    type="number"
                    value={formOurPrice}
                    onChange={(e) => setFormOurPrice(e.target.value)}
                    placeholder="3490"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                    required
                  />
                </div>
              </div>

              {/* Inventory & Winning toggle */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-800 dark:text-slate-200 block">
                    {formIsUpcoming ? 'Stock Locked (0)' : 'Initial Stock Qty'}
                  </label>
                  <input
                    type="number"
                    disabled={formIsUpcoming}
                    value={formIsUpcoming ? '0' : formStockQty}
                    onChange={(e) => setFormStockQty(e.target.value)}
                    placeholder="50"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono disabled:opacity-60"
                    required={!formIsUpcoming}
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-800 dark:text-slate-200 block">
                    Min Stock Alert
                  </label>
                  <input
                    type="number"
                    value={formMinStock}
                    onChange={(e) => setFormMinStock(e.target.value)}
                    placeholder="10"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="formIsWinning"
                    checked={formIsWinning}
                    onChange={(e) => setFormIsWinning(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                  <label htmlFor="formIsWinning" className="font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                    Winning Item ⭐
                  </label>
                </div>
              </div>

              {/* Product Delivery Speed Category: Express (Instant) vs Standard Logistics (3-6 Working Days) */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2">
                <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-amber-500" />
                    <span>Delivery Speed Category (ڈیلیوری کیٹگری)</span>
                  </span>
                  <span className="text-[10px] font-normal text-slate-500">
                    If Express is not selected, 3–6 working days logistics applies
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormDeliveryType('express')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formDeliveryType === 'express'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-400'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-extrabold text-emerald-800 dark:text-emerald-300">
                      <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Express Delivery (Instant)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Available for instant same-day / express dispatch
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormDeliveryType('standard')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      formDeliveryType === 'standard'
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-400'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-extrabold text-amber-800 dark:text-amber-300">
                      <Truck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Standard Logistics (3–6 Days)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Takes 3 to 6 working days depending on logistics
                    </p>
                  </button>
                </div>

                {/* Product Delivery Charge Policy: Standard City/Area Fee vs Free Delivery vs Custom Rs. */}
                <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700 space-y-2">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    Product Delivery Charges (اس پروڈکٹ کے ڈیلیوری چارجز)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormDeliveryFeeType('default')}
                      className={`p-2 rounded-lg border text-left text-[11px] cursor-pointer transition-all ${
                        formDeliveryFeeType === 'default'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 font-bold text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      City / Area Rate
                      <span className="block text-[9px] font-normal text-slate-500">Uses customer city/area fee</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormDeliveryFeeType('free')}
                      className={`p-2 rounded-lg border text-left text-[11px] cursor-pointer transition-all ${
                        formDeliveryFeeType === 'free'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 font-bold text-emerald-800 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Free Delivery (Rs. 0)
                      <span className="block text-[9px] font-normal text-slate-500">Customer pays no delivery fee</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormDeliveryFeeType('custom')}
                      className={`p-2 rounded-lg border text-left text-[11px] cursor-pointer transition-all ${
                        formDeliveryFeeType === 'custom'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 font-bold text-blue-800 dark:text-blue-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Custom Charge (Rs.)
                      <span className="block text-[9px] font-normal text-slate-500">Fixed delivery rate for item</span>
                    </button>
                  </div>
                  {formDeliveryFeeType === 'custom' && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Delivery Charge ({profile.currencySymbol}):
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={formCustomDeliveryCharge}
                        onChange={(e) => setFormCustomDeliveryCharge(e.target.value)}
                        placeholder="e.g. 200"
                        className="w-32 px-2.5 py-1 rounded-lg border border-blue-400 dark:border-blue-700 bg-white dark:bg-slate-900 font-mono font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Product Media Gallery & Cached Images */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-500" />
                    <span>Product Media Gallery ({formPictures.length} Photos)</span>
                  </label>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 text-[10px] font-bold cursor-pointer">
                    <Upload className="w-3 h-3" />
                    <span>Upload Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handleUploadFormPictureFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {formPictures.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {formPictures.map((pic, idx) => {
                      const isMain = (formImageUrl || formPictures[0]) === pic;
                      return (
                        <div
                          key={`${pic.slice(0, 28)}-${idx}`}
                          className={`relative rounded-lg overflow-hidden border bg-white dark:bg-slate-900 aspect-square group ${
                            isMain
                              ? 'border-amber-500 ring-2 ring-amber-400/50'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <img
                            src={pic}
                            alt={`Media ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain p-0.5"
                          />
                          {isMain ? (
                            <span className="absolute top-0.5 left-0.5 px-1 py-0.2 bg-amber-500 text-slate-950 font-black text-[8px] rounded">
                              MAIN
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setFormImageUrl(pic);
                                setFormPictures((prev) => [pic, ...prev.filter((u) => u !== pic)]);
                              }}
                              className="absolute bottom-0.5 left-0.5 px-1 py-0.5 bg-slate-900/85 text-white font-bold text-[8px] rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              Set Main
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const next = formPictures.filter((_, i) => i !== idx);
                              setFormPictures(next);
                              if (formImageUrl === pic) setFormImageUrl(next[0] || '');
                            }}
                            className="absolute top-0.5 right-0.5 p-0.5 bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Remove photo"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={formExtraPictureUrl}
                    onChange={(e) => setFormExtraPictureUrl(e.target.value)}
                    placeholder="Paste photo URL to download & add to product gallery..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddAndCacheFormPicture()}
                    disabled={formCachePictureLoading || !formExtraPictureUrl.trim()}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold text-[11px] cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {formCachePictureLoading ? 'Downloading...' : '+ Download & Add Photo'}
                  </button>
                </div>
                {formCachePictureError && (
                  <p className="text-[10px] text-red-500 font-medium">{formCachePictureError}</p>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                    Main Image URL (تصویر کا مرکزی لنک)
                  </label>
                  <input
                    type="text"
                    value={formImageUrl}
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    placeholder="/api/media/imported/... or https://..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-[11px]"
                  />
                </div>
              </div>

              {/* Variants Editor with Separate Details + Media Picker from Imported Link */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-amber-500" />
                    <span>Product Variants &amp; Separate Details ({formVariations.length})</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = formVariations.length;
                      setFormVariations((prev) => [
                        ...prev,
                        {
                          id: `var_${Date.now()}_${nextIdx}`,
                          sku: `${formSku || 'SKU'}-V${nextIdx + 1}`,
                          title: '',
                          size: '',
                          color: '',
                          attributes: {},
                          originalPrice: parseFloat(formMarketPrice) || 0,
                          salePrice: parseFloat(formOurPrice) || 0,
                          stockQty: Math.max(0, parseInt(formStockQty, 10) || 10),
                          details: '',
                        },
                      ]);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Variant</span>
                  </button>
                </div>

                {formVariations.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {formVariations.map((v, vIdx) => (
                      <div
                        key={v.id || vIdx}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {v.image ? (
                              <img
                                src={v.image}
                                alt={v.title || v.sku}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-lg object-contain border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                                <ImageIcon className="w-4 h-4" />
                              </div>
                            )}
                            <input
                              type="text"
                              value={v.title || ''}
                              onChange={(e) => {
                                const next = [...formVariations];
                                next[vIdx] = { ...next[vIdx], title: e.target.value };
                                setFormVariations(next);
                              }}
                              placeholder={`Variant #${vIdx + 1} Title (e.g. Black · Large)`}
                              className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-[11px]"
                            />
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setEditVarMediaPickerIdx(editVarMediaPickerIdx === vIdx ? null : vIdx)
                              }
                              className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 text-slate-700 dark:text-slate-200 font-bold text-[10px] cursor-pointer"
                            >
                              {editVarMediaPickerIdx === vIdx
                                ? 'Close Media'
                                : `Pick Media (${formPictures.length})`}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFormVariations((prev) => prev.filter((_, i) => i !== vIdx));
                                if (editVarMediaPickerIdx === vIdx) setEditVarMediaPickerIdx(null);
                              }}
                              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded cursor-pointer"
                              title="Remove variant"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {editVarMediaPickerIdx === vIdx && (
                          <div className="p-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-amber-900 dark:text-amber-200">
                                Select Photo from Product Media Gallery:
                              </span>
                              <label className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                                Upload New
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    handleUploadFormPictureFile(e.target.files?.[0], vIdx);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            </div>
                            {formPictures.length > 0 ? (
                              <div className="grid grid-cols-5 sm:grid-cols-7 gap-1.5">
                                {formPictures.map((pic, pIdx) => (
                                  <button
                                    key={pIdx}
                                    type="button"
                                    onClick={() => {
                                      setFormVariations((prev) =>
                                        prev.map((item, idx) =>
                                          idx === vIdx ? { ...item, image: pic } : item
                                        )
                                      );
                                      setEditVarMediaPickerIdx(null);
                                    }}
                                    className={`aspect-square rounded border overflow-hidden bg-white cursor-pointer ${
                                      v.image === pic
                                        ? 'border-amber-500 ring-2 ring-amber-400'
                                        : 'border-slate-200 hover:border-amber-400'
                                    }`}
                                  >
                                    <img
                                      src={pic}
                                      alt={`Pick ${pIdx + 1}`}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-contain"
                                    />
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-500">
                                No photos in gallery yet — download or upload a photo above first.
                              </p>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                          <input
                            type="text"
                            value={v.size || ''}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], size: e.target.value };
                              setFormVariations(next);
                            }}
                            placeholder="Size"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px]"
                          />
                          <input
                            type="text"
                            value={v.color || ''}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], color: e.target.value };
                              setFormVariations(next);
                            }}
                            placeholder="Color"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px]"
                          />
                          <input
                            type="text"
                            value={v.sku || ''}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], sku: e.target.value };
                              setFormVariations(next);
                            }}
                            placeholder="SKU"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-mono"
                          />
                          <input
                            type="number"
                            value={v.originalPrice || ''}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], originalPrice: parseFloat(e.target.value) || 0 };
                              setFormVariations(next);
                            }}
                            placeholder="Orig Rs."
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-mono"
                          />
                          <input
                            type="number"
                            value={v.salePrice || ''}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], salePrice: parseFloat(e.target.value) || 0 };
                              setFormVariations(next);
                            }}
                            placeholder="Sale Rs."
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-mono font-bold"
                          />
                          <input
                            type="number"
                            value={v.stockQty ?? 0}
                            onChange={(e) => {
                              const next = [...formVariations];
                              next[vIdx] = { ...next[vIdx], stockQty: parseInt(e.target.value, 10) || 0 };
                              setFormVariations(next);
                            }}
                            placeholder="Qty"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-mono"
                          />
                        </div>

                        <textarea
                          rows={2}
                          value={v.details || ''}
                          onChange={(e) => {
                            const next = [...formVariations];
                            next[vIdx] = { ...next[vIdx], details: e.target.value };
                            setFormVariations(next);
                          }}
                          placeholder="Separate variant details, weight, dimensions, capacity, packaging or notes for this option..."
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] text-slate-800 dark:text-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Website Link (User requirement: keep website link to see more details) */}
              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-blue-500" />
                    <span>Website Link to See More Details (ویب سائٹ لنک)</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Customer clicks this to see full details</span>
                </label>
                <input
                  type="url"
                  value={formWebsiteUrl}
                  onChange={(e) => setFormWebsiteUrl(e.target.value)}
                  placeholder="https://madinamarket.pk/products/5-in-1-hot-air-styler"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-400 focus:outline-hidden"
                />
              </div>

              {/* Paste Product Video Link Area */}
              <div className="space-y-1">
                <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Video className="w-3.5 h-3.5 text-amber-500" />
                    <span>Product Video Link (Paste Video URL)</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">YouTube, TikTok, Reels, MP4</span>
                </label>
                <input
                  type="url"
                  value={formVideoUrl}
                  onChange={(e) => setFormVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or TikTok/MP4 video link"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>

              {/* Investor Assignment & WhatsApp for Product Inquiries */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/25 border border-teal-200 dark:border-teal-900">
                <div className="space-y-1">
                  <label className="font-bold text-teal-900 dark:text-teal-200 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-teal-600" />
                    <span>Assigned Investor</span>
                  </label>
                  <select
                    value={formInvestorId}
                    onChange={(e) => {
                      const invId = e.target.value;
                      setFormInvestorId(invId);
                      const inv = effectiveInvestors.find((i) => i.id === invId);
                      if (inv) {
                        setFormInvestorWhatsApp(inv.whatsapp || inv.phone || '');
                      }
                    }}
                    className="w-full px-2.5 py-2 rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer"
                  >
                    <option value="">-- Select Investor (Optional) --</option>
                    {effectiveInvestors.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name} ({inv.whatsapp || inv.phone})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-teal-900 dark:text-teal-200 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-teal-600" />
                    <span>Investor Inquiry WhatsApp</span>
                  </label>
                  <input
                    type="text"
                    value={formInvestorWhatsApp}
                    onChange={(e) => setFormInvestorWhatsApp(e.target.value)}
                    placeholder="e.g. 03001234567"
                    className="w-full px-3 py-2 font-mono rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. CONFIRM PHYSICAL ARRIVAL & CATEGORY TRANSFER MODAL */}
      {arrivalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-8">
            <div className="bg-emerald-600 px-5 py-3.5 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold">
                    Confirm Physical Arrival &amp; Activate Product
                  </h3>
                  <p className="text-[11px] text-emerald-100">
                    Move "{arrivalTarget.name}" out of Coming Soon into active storefront stock
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setArrivalTarget(null)}
                className="p-1 hover:bg-emerald-500 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitArrivalActivation} className="p-5 space-y-4 text-xs">
              {arrivalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-center gap-2 font-semibold">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{arrivalError}</span>
                </div>
              )}

              <CategoryCascadingSelect
                categories={effectiveCatRecords}
                parentCategoryId={arrivalMainCatId}
                subcategoryId={arrivalSubCatId}
                childSubcategoryId={arrivalChildCatId}
                excludeUpcoming={true}
                label="Target Storefront Category (Main → Subcategory → Child Subcategory)"
                onChange={(sel) => {
                  setArrivalMainCatId(sel.parentCategoryId);
                  setArrivalSubCatId(sel.subcategoryId);
                  setArrivalChildCatId(sel.childSubcategoryId);
                }}
              />

              {/* Delivery Speed Category Selection upon Arrival */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setArrivalDeliveryType('express')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    arrivalDeliveryType === 'express'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-400'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}
                >
                  <span className="font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" /> Express Delivery (Instant)
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Available for instant delivery once live
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setArrivalDeliveryType('standard')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    arrivalDeliveryType === 'standard'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-400'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}
                >
                  <span className="font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5" /> Standard Logistics (3–6 Days)
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    3 to 6 working days depending on logistics
                  </span>
                </button>
              </div>

              {/* Product Delivery Charges Option upon Arrival */}
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">
                  Product Delivery Charges (Free Delivery or Custom Fee)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setArrivalDeliveryFeeType('default')}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      arrivalDeliveryFeeType === 'default'
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    City / Area Rate
                  </button>
                  <button
                    type="button"
                    onClick={() => setArrivalDeliveryFeeType('free')}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      arrivalDeliveryFeeType === 'free'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Free Delivery (Rs. 0)
                  </button>
                  <button
                    type="button"
                    onClick={() => setArrivalDeliveryFeeType('custom')}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      arrivalDeliveryFeeType === 'custom'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Custom Rs. Charge
                  </button>
                </div>
                {arrivalDeliveryFeeType === 'custom' && (
                  <input
                    type="number"
                    min={0}
                    value={arrivalCustomDeliveryCharge}
                    onChange={(e) => setArrivalCustomDeliveryCharge(e.target.value)}
                    placeholder="Enter fixed delivery charge Rs."
                    className="w-48 px-2.5 py-1 rounded-lg border border-blue-400 dark:border-blue-700 bg-white dark:bg-slate-800 font-mono"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Cost Price
                  </label>
                  <input
                    type="number"
                    value={arrivalCostPrice}
                    onChange={(e) => setArrivalCostPrice(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Market Price
                  </label>
                  <input
                    type="number"
                    value={arrivalMarketPrice}
                    onChange={(e) => setArrivalMarketPrice(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-emerald-700 dark:text-emerald-400 block mb-1">
                    Selling Price *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={arrivalOurPrice}
                    onChange={(e) => setArrivalOurPrice(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-800 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-amber-700 dark:text-amber-400 block mb-1">
                    Arrived Stock Qty *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={arrivalStockQty}
                    onChange={(e) => setArrivalStockQty(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-800 font-mono font-bold"
                  />
                </div>
              </div>

              {arrivalVariations.length > 0 && (
                <div className="space-y-2">
                  <span className="font-bold text-slate-700 dark:text-slate-300 block">
                    Confirm Arrived Variation Stock &amp; Pricing ({arrivalVariations.length})
                  </span>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                    {arrivalVariations.map((v, idx) => (
                      <div key={v.id || idx} className="p-2 flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate flex-1">
                          {[v.size, v.color].filter(Boolean).join(' · ') || v.sku}
                        </span>
                        <input
                          type="number"
                          value={v.salePrice}
                          onChange={(e) => {
                            const next = [...arrivalVariations];
                            next[idx] = { ...next[idx], salePrice: parseFloat(e.target.value) || 0 };
                            setArrivalVariations(next);
                          }}
                          className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                          placeholder="Price"
                        />
                        <input
                          type="number"
                          value={v.stockQty}
                          onChange={(e) => {
                            const next = [...arrivalVariations];
                            next[idx] = { ...next[idx], stockQty: parseInt(e.target.value, 10) || 0 };
                            setArrivalVariations(next);
                          }}
                          className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                          placeholder="Qty"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Updated Details / Specifications
                </label>
                <textarea
                  rows={2}
                  value={arrivalDetails}
                  onChange={(e) => setArrivalDetails(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setArrivalTarget(null)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActivatingArrival}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl shadow-xs cursor-pointer disabled:opacity-60"
                >
                  {isActivatingArrival ? 'Activating...' : 'Confirm Physical Arrival & Publish Live'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. COMPLETE WEBSITE PRODUCT IMPORTER MODAL */}
      <ProductImporterModal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          if (onCloseExternalImport) onCloseExternalImport();
        }}
        existingProducts={products}
        onSaveProduct={(importedProduct) => {
          onSaveProduct(importedProduct);
          setCentralCategories(getCategories());
          setLocalCatRecords(getCategoryRecords());
          onRefreshProducts?.();
        }}
      />
    </div>
  );
};
