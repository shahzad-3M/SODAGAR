import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Filter,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Percent,
  Plus,
  Minus,
  Trash2,
  CheckCircle,
  Clock,
  ArrowRight,
  Send,
  Eye,
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  Tag,
  AlertTriangle,
  ExternalLink,
  Globe,
  Download,
  Phone,
  FolderTree,
  ChevronDown,
  Zap,
  Truck,
  Lock,
} from 'lucide-react';
import type { AppUser, BusinessProfile, CartItem, CategoryRecord, Customer, DeliverySpeedCategory, Investor, ProductItem } from '../types/index.ts';
import { ProductDetailsModal } from './ProductDetailsModal.tsx';
import {
  buildDirectProductWhatsAppMessage,
  buildInvestorProductInquiryMessage,
  openWhatsAppDirect,
  resolveProductInvestorContact,
} from '../utils/whatsapp.ts';
import { getCategoryRecords, getInvestors } from '../utils/storage.ts';
import {
  UPCOMING_CATEGORY_ID,
  UPCOMING_CATEGORY_NAME,
  doesProductMatchCategoryFilter,
  getProductDeliveryMeta,
  isProductPurchaseBlocked,
  normalizeTextKey,
} from '../utils/locationCategoryHelpers.ts';

interface StoreCatalogViewProps {
  products: ProductItem[];
  customers: Customer[];
  profile: BusinessProfile;
  cart: CartItem[];
  categoryRecords?: CategoryRecord[];
  investors?: Investor[];
  initialProductId?: string | null;
  onClearInitialProduct?: () => void;
  onUpdateProduct?: (updatedProduct: ProductItem) => void;
  onAddToCart: (product: ProductItem, qty?: number, selectedSize?: string) => void;
  onUpdateCartQty: (productId: string, qty: number, selectedSize?: string) => void;
  onRemoveFromCart: (productId: string, selectedSize?: string) => void;
  onClearCart: () => void;
  onOpenCheckout: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
  onOpenImportModal?: () => void;
  onOpenCategoryModal?: () => void;
  isCustomerView?: boolean;
  hideCostPrice?: boolean;
  userRole?: string;
  currentUser?: AppUser;
}

export const StoreCatalogView: React.FC<StoreCatalogViewProps> = ({
  products,
  customers,
  profile,
  cart,
  categoryRecords,
  investors,
  initialProductId,
  onClearInitialProduct,
  onUpdateProduct,
  onAddToCart,
  onUpdateCartQty,
  onRemoveFromCart,
  onClearCart,
  onOpenCheckout,
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  onOpenImportModal,
  onOpenCategoryModal,
  isCustomerView = false,
  hideCostPrice = false,
  userRole = 'customer',
  currentUser,
}) => {
  const [sortBy, setSortBy] = useState<'default' | 'winning_profit' | 'highest_savings' | 'price_low' | 'price_high'>('default');
  const [customerTypeFilter, setCustomerTypeFilter] = useState<'all' | 'individual' | 'retail'>('all');
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | DeliverySpeedCategory>('all');
  const [showWinningOnly, setShowWinningOnly] = useState(false);
  const [selectedDetailProduct, setSelectedDetailProduct] = useState<ProductItem | null>(null);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [isConfirmClearCartOpen, setIsConfirmClearCartOpen] = useState(false);
  const [expandedSidebarCats, setExpandedSidebarCats] = useState<Record<string, boolean>>({});

  const effectiveInvestors = useMemo(
    () => (investors && investors.length > 0 ? investors : getInvestors()),
    [investors]
  );

  // Open product modal automatically if ?product=<id|sku|slug> deep-link is active
  useEffect(() => {
    if (!initialProductId) return;
    const norm = normalizeTextKey(initialProductId);
    const target = products.find((p) => {
      if (p.id === initialProductId || normalizeTextKey(p.id) === norm) return true;
      if (p.sku && normalizeTextKey(p.sku) === norm) return true;
      return Boolean(
        (p.websiteUrl || p.sourceUrl || '').toLowerCase().includes(initialProductId.toLowerCase())
      );
    });
    if (target) {
      setSelectedDetailProduct(target);
      onClearInitialProduct?.();
    }
  }, [initialProductId, products, onClearInitialProduct]);

  const activeDetailProduct = useMemo(() => {
    if (!selectedDetailProduct) return null;
    return products.find((p) => p.id === selectedDetailProduct.id) || selectedDetailProduct;
  }, [selectedDetailProduct, products]);

  const canEditProductDetails =
    !isCustomerView && (userRole === 'super_admin' || userRole === 'admin' || userRole === 'manager');

  const effectiveCatRecords = useMemo(
    () => (categoryRecords && categoryRecords.length > 0 ? categoryRecords : getCategoryRecords()),
    [categoryRecords]
  );

  // Upcoming product count (always visible category even if 0)
  const upcomingCount = useMemo(
    () => products.filter((p) => isProductPurchaseBlocked(p)).length,
    [products]
  );

  // Build 3-level Category Tree + uncategorized legacy fallback categories
  const activeCatRecords = useMemo(
    () =>
      effectiveCatRecords.filter(
        (c) => c.isActive !== false && !c.isUpcoming && c.id !== UPCOMING_CATEGORY_ID
      ),
    [effectiveCatRecords]
  );

  const mainCategoryNodes = useMemo(
    () => activeCatRecords.filter((c) => !c.parentCategoryId),
    [activeCatRecords]
  );

  const unmappedProductCategories = useMemo(() => {
    const extra: Array<{ name: string; count: number }> = [];
    const seen = new Set<string>();
    products.forEach((p) => {
      if (isProductPurchaseBlocked(p)) return;
      const topName = (p.category || '').split('>')[0]?.trim();
      if (!topName) return;
      const matchesManaged = activeCatRecords.some(
        (c) => normalizeTextKey(c.name) === normalizeTextKey(topName)
      );
      if (!matchesManaged && !seen.has(normalizeTextKey(topName))) {
        seen.add(normalizeTextKey(topName));
        extra.push({
          name: topName,
          count: products.filter((pr) => normalizeTextKey(pr.category) === normalizeTextKey(p.category)).length,
        });
      }
    });
    return extra;
  }, [products, activeCatRecords]);

  // Active subcategories / child chips for current selection
  const selectedCatObj = useMemo(
    () =>
      effectiveCatRecords.find(
        (c) => c.id === selectedCategory || normalizeTextKey(c.name) === normalizeTextKey(selectedCategory)
      ),
    [effectiveCatRecords, selectedCategory]
  );

  const selectedCatChildren = useMemo(() => {
    if (!selectedCatObj || selectedCatObj.isUpcoming) return [];
    return activeCatRecords.filter(
      (c) =>
        c.parentCategoryId === selectedCatObj.id &&
        products.some((p) => doesProductMatchCategoryFilter(p, c.id, effectiveCatRecords))
    );
  }, [activeCatRecords, selectedCatObj, products, effectiveCatRecords]);

  // Cart calculations
  const totalCartItems = cart.reduce((acc, it) => acc + it.quantity, 0);
  const totalCartMarket = cart.reduce((acc, it) => acc + it.marketPrice * it.quantity, 0);
  const totalCartAmount = cart.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
  const totalCartSavings = totalCartMarket - totalCartAmount;

  // Filter & sort logic (ensuring full parity between mobile and desktop)
  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        if (selectedCategory && selectedCategory !== 'All Categories' && selectedCategory !== 'For you') {
          if (!doesProductMatchCategoryFilter(p, selectedCategory, effectiveCatRecords)) {
            return false;
          }
        }

        // Winning items toggle
        if (showWinningOnly && !p.isWinningItem) {
          return false;
        }

        // Delivery Speed category filter (Express Instant vs Standard Logistics 3-6 days)
        if (deliveryFilter !== 'all') {
          const pDelivery = getProductDeliveryMeta(p).deliveryType;
          if (pDelivery !== deliveryFilter) return false;
        }

        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = p.name.toLowerCase().includes(q);
          const matchUrdu = p.urduName ? p.urduName.toLowerCase().includes(q) : false;
          const matchSku = p.sku.toLowerCase().includes(q);
          const matchCat = p.category ? p.category.toLowerCase().includes(q) : false;
          if (!matchName && !matchUrdu && !matchSku && !matchCat) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'winning_profit') {
          return b.totalProfit - a.totalProfit;
        }
        if (sortBy === 'highest_savings') {
          const saveA = a.marketPrice - a.ourPrice;
          const saveB = b.marketPrice - b.ourPrice;
          return saveB - saveA;
        }
        if (sortBy === 'price_low') {
          return a.ourPrice - b.ourPrice;
        }
        if (sortBy === 'price_high') {
          return b.ourPrice - a.ourPrice;
        }
        return 0;
      });
  }, [products, selectedCategory, searchQuery, sortBy, showWinningOnly, deliveryFilter, effectiveCatRecords]);

  const expressProductCount = useMemo(
    () => products.filter((p) => !isProductPurchaseBlocked(p) && getProductDeliveryMeta(p).isExpress).length,
    [products]
  );
  const standardProductCount = useMemo(
    () => products.filter((p) => !isProductPurchaseBlocked(p) && !getProductDeliveryMeta(p).isExpress).length,
    [products]
  );

  const expressGroupProducts = useMemo(
    () =>
      filteredProducts.filter(
        (p) => !isProductPurchaseBlocked(p) && getProductDeliveryMeta(p).isExpress
      ),
    [filteredProducts]
  );
  const standardGroupProducts = useMemo(
    () =>
      filteredProducts.filter(
        (p) => isProductPurchaseBlocked(p) || !getProductDeliveryMeta(p).isExpress
      ),
    [filteredProducts]
  );

  const renderProductCard = (product: ProductItem) => {
    const savings = product.marketPrice - product.ourPrice;
    const savingsPercent = product.marketPrice > 0 ? Math.round((savings / product.marketPrice) * 100) : 0;
    const matchingCartItems = cart.filter((it) => it.product.id === product.id);
    const inCart = matchingCartItems[0];
    const totalQtyInCart = matchingCartItems.reduce((sum, it) => sum + it.quantity, 0);
    const isUpcomingBlocked = isProductPurchaseBlocked(product);
    const isOutOfStock = !isUpcomingBlocked && Number(product.stockQty ?? 0) <= 0;
    const dMeta = getProductDeliveryMeta(product);
    const isExpress = !isUpcomingBlocked && dMeta.isExpress;

    return (
      <div
        key={product.id}
        className={`bg-white dark:bg-slate-900 border rounded-xl overflow-hidden hover:shadow-md transition-all flex flex-col justify-between group ${
          isExpress
            ? 'border-emerald-300 dark:border-emerald-800/80'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        {/* Top Image */}
        <div
          onClick={() => setSelectedDetailProduct(product)}
          className="relative bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 h-36 sm:h-48 overflow-hidden flex items-center justify-center cursor-pointer"
        >
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="text-slate-400 text-xs flex flex-col items-center gap-1 font-mono">
              <ShoppingBag className="w-6 h-6 sm:w-8 sm:h-8 opacity-40" />
              <span className="text-[10px]">100DAGAR Lot</span>
            </div>
          )}

          {/* Discount / Upcoming / Winning Badges */}
          <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 flex flex-col gap-1 items-start">
            {isUpcomingBlocked ? (
              <span className="bg-purple-600 text-white font-extrabold text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded shadow-xs">
                COMING SOON
              </span>
            ) : (
              <span className="bg-emerald-600 text-white font-extrabold text-[9px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded shadow-xs">
                -{savingsPercent}%
              </span>
            )}
            {product.isWinningItem && (
              <span className="bg-amber-500 text-slate-950 font-bold text-[8px] sm:text-[9px] px-1 sm:px-1.5 py-0.2 rounded shadow-xs flex items-center gap-0.5">
                <Sparkles className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> WINNING
              </span>
            )}
          </div>

          {/* Express Symbol Stamp (Shown ONLY on Express items) */}
          {isExpress && (
            <div className="absolute bottom-1.5 left-1.5 sm:bottom-2 sm:left-2">
              <span
                title="Express Delivery — Available only in manually unlocked cities & sub-cities"
                className="inline-flex items-center gap-0.5 bg-slate-950/90 dark:bg-emerald-500 text-emerald-300 dark:text-slate-950 font-black text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded shadow-md border border-emerald-400/60"
              >
                <Zap className="w-3 h-3 fill-current shrink-0" />
                <span>EXPRESS</span>
              </span>
            </div>
          )}

          {/* Stock Alert Badge */}
          <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
            <span className={`text-[8px] sm:text-[10px] font-mono px-1.5 sm:px-2 py-0.5 rounded font-bold ${
              isUpcomingBlocked
                ? 'bg-purple-900/90 text-white'
                : product.stockQty <= product.minStockAlert
                ? 'bg-red-500 text-white'
                : 'bg-slate-900/80 text-white backdrop-blur-xs'
            }`}>
              {isUpcomingBlocked ? 'Expected Soon' : `${product.stockQty} in stock`}
            </span>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-2.5 sm:p-4 flex-1 flex flex-col justify-between space-y-2">
          <div>
            {/* Category kicker */}
            <span className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 block truncate">
              {product.category}
            </span>

            {/* Title */}
            <h3
              onClick={() => setSelectedDetailProduct(product)}
              className="text-[11px] sm:text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 line-clamp-2 mt-0.5 cursor-pointer leading-tight"
              title={product.name}
            >
              {product.name}
            </h3>

            {/* Urdu Name */}
            {product.urduName && (
              <p className="font-urdu text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate leading-snug">
                {product.urduName}
              </p>
            )}

            {/* Express Symbol Badge (ONLY Express items show symbol; remaining products show no symbols) */}
            {(isExpress || (product.variations && product.variations.length > 0)) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {isExpress && (
                  <span
                    title={dMeta.etaText}
                    className="inline-flex items-center gap-0.5 text-[9px] font-extrabold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800"
                  >
                    <Zap className="w-2.5 h-2.5 fill-current shrink-0" /> Express · Selected Cities
                  </span>
                )}
                {product.variations && product.variations.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    {product.variations.length} Options
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Pricing Block with Market Price, Our Price & Customer Savings */}
          <div className="pt-1.5 sm:pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white font-mono tabular-nums">
                {profile.currencySymbol}{product.ourPrice.toLocaleString('en-PK')}
              </span>
              <span className="text-[10px] sm:text-xs text-slate-400 line-through font-mono tabular-nums">
                {profile.currencySymbol}{product.marketPrice.toLocaleString('en-PK')}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between text-[9px] sm:text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
              <span className="truncate">بچت (Save):</span>
              <span className="font-mono font-bold shrink-0">
                {profile.currencySymbol}{savings.toLocaleString('en-PK')}
              </span>
            </div>

            {!isUpcomingBlocked && product.deliveryFeeType === 'free' && (
              <div className="mt-1 text-[9px] sm:text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                Free Delivery
              </div>
            )}
            {!isUpcomingBlocked &&
              product.deliveryFeeType === 'custom' &&
              typeof product.customDeliveryCharge === 'number' && (
                <div className="mt-1 text-[9px] sm:text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  Delivery: {profile.currencySymbol}{product.customDeliveryCharge.toLocaleString('en-PK')}
                </div>
              )}

            {!isCustomerView && !hideCostPrice && (
              <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400">
                <span>Cost: {profile.currencySymbol}{product.costPrice.toLocaleString('en-PK')}</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  +{profile.currencySymbol}{(product.ourPrice - product.costPrice).toLocaleString('en-PK')}
                </span>
              </div>
            )}
          </div>

          {/* Specs & Detailed Pictures Quick View Trigger */}
          <button
            type="button"
            onClick={() => setSelectedDetailProduct(product)}
            className="w-full inline-flex items-center justify-center gap-1 py-1 sm:py-1.5 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-200 text-[10px] sm:text-[11px] font-bold transition-colors cursor-pointer border border-amber-200/80 dark:border-amber-900 truncate"
          >
            <Eye className="w-3 h-3 text-amber-600 shrink-0" />
            <span className="truncate">Specs &amp; Photos (تفصیل)</span>
          </button>

          {product.websiteUrl && (
            <a
              href={product.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1 py-1 sm:py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer truncate"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="truncate">View on Website</span>
            </a>
          )}

          {/* Action Bar: Add to Cart / WhatsApp Ordering Options */}
          <div className="pt-0.5 space-y-1">
            {isUpcomingBlocked && product.expectedArrivalDate && (
              <div className="text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30 px-2 py-0.5 rounded text-center truncate">
                Arrival: {product.expectedArrivalDate}
              </div>
            )}
            {(() => {
              const invContact = resolveProductInvestorContact(
                product,
                effectiveInvestors,
                profile.phone || '03125256266'
              );
              const activeCustomerName =
                currentUser?.isAuthenticated ? currentUser.name : undefined;
              const handleInvestorInquiry = () => {
                const text = buildInvestorProductInquiryMessage(product, profile, {
                  customerName: activeCustomerName,
                  investorName: invContact.investorName,
                  imageUrl: product.imageUrl,
                });
                openWhatsAppDirect(invContact.whatsapp, text);
              };
              const handleDirectProductWhatsApp = () => {
                const text = buildDirectProductWhatsAppMessage(product, profile, {
                  customerName: activeCustomerName,
                  imageUrl: product.imageUrl,
                });
                openWhatsAppDirect(profile.phone || '03125256266', text);
              };
              const inquiryTitle = invContact.isInvestorAssigned
                ? `Product Inquiry to Investor (${invContact.investorName ? `${invContact.investorName} · ` : ''}${invContact.whatsapp})`
                : `Product Inquiry (${invContact.whatsapp})`;

              if (isUpcomingBlocked) {
                return (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled
                      className="flex-1 py-1.5 px-2 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] sm:text-[11px] font-bold rounded-lg cursor-not-allowed text-center truncate"
                    >
                      Coming Soon · View Only
                    </button>
                    <button
                      type="button"
                      onClick={handleDirectProductWhatsApp}
                      className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
                      title="WhatsApp Store Desk"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleInvestorInquiry}
                      className="p-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
                      title={inquiryTitle}
                      aria-label={inquiryTitle}
                    >
                      <Tag className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div className="flex items-center gap-1">
                  {inCart ? (
                    <div className="flex-1 flex items-center justify-between bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateCartQty(
                            product.id,
                            inCart.quantity - 1,
                            inCart.product.selectedSize
                          )
                        }
                        className="w-6 h-6 flex items-center justify-center bg-white dark:bg-slate-800 text-slate-800 dark:text-white rounded shadow-2xs hover:bg-slate-100 cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono font-bold text-[10px] sm:text-xs text-amber-900 dark:text-amber-200">
                        {totalQtyInCart} in cart
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateCartQty(
                            product.id,
                            inCart.quantity + 1,
                            inCart.product.selectedSize
                          )
                        }
                        className="w-6 h-6 flex items-center justify-center bg-amber-500 text-slate-950 rounded shadow-2xs hover:bg-amber-400 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  ) : isOutOfStock ? (
                    <button
                      type="button"
                      disabled
                      className="flex-1 py-1.5 sm:py-2 px-2 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] sm:text-[11px] font-bold rounded-lg cursor-not-allowed truncate"
                    >
                      Out of Stock
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddToCart(product, 1)}
                      className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 sm:py-2 px-2 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white text-[10px] sm:text-[11px] font-bold rounded-lg shadow-2xs transition-colors cursor-pointer truncate"
                    >
                      <ShoppingBag className="w-3 h-3 shrink-0" />
                      <span className="truncate">Add to Cart</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDirectProductWhatsApp}
                    className="p-1.5 sm:p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer transition-colors shrink-0 shadow-2xs"
                    title="Order directly on WhatsApp"
                    aria-label="Order directly on WhatsApp"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleInvestorInquiry}
                    className="p-1.5 sm:p-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg cursor-pointer transition-colors shrink-0 shadow-2xs"
                    title={inquiryTitle}
                    aria-label={inquiryTitle}
                  >
                    <Tag className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. BREADCRUMB & TOP BANNER */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">Home</span>
          <span>&gt;</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {selectedCategory || 'For you'}
          </span>
          {showWinningOnly && (
            <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
              Winning Items Only / وننگ پروڈکٹس
            </span>
          )}
        </div>
      </div>

      {/* Mobile Categories & Filters Drawer Trigger */}
      <div className="lg:hidden flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 shadow-2xs">
        <button
          type="button"
          onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
          className="flex-1 flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-amber-500" />
            <span>Categories &amp; Filter Options ({filteredProducts.length} items)</span>
          </div>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
            {isMobileFilterOpen ? 'Hide Filters ▲' : 'Browse Categories ▼'}
          </span>
        </button>
      </div>

      {/* 2. MAIN LAYOUT: LEFT SIDEBAR + FULL-WIDTH 5-COL PRODUCT GRID */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5 items-start">
        {/* LEFT SIDEBAR: CATEGORIES TREE */}
        <aside className={`${isMobileFilterOpen ? 'block' : 'hidden'} lg:block w-full lg:w-60 xl:w-64 shrink-0 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs space-y-4`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>Show All Categories</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </h2>
            <button
              onClick={() => onCategoryChange('All Categories')}
              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
            >
              Reset
            </button>
          </div>

          {/* Quick Filter: Winning Items Toggle */}
          <div className="bg-amber-50/80 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200/60 dark:border-amber-900/60">
            <button
              onClick={() => setShowWinningOnly(!showWinningOnly)}
              className="w-full flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>Winning Items (High Profit)</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] ${showWinningOnly ? 'bg-amber-500 text-white' : 'bg-amber-200 text-amber-800'}`}>
                {showWinningOnly ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* Manage Categories (Admin & Manager On-Time Editing) */}
          {(userRole === 'super_admin' || userRole === 'admin' || userRole === 'manager') && onOpenCategoryModal && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={onOpenCategoryModal}
                className="w-full flex items-center justify-between py-1.5 px-2.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5 text-amber-500" />
                  Manage Categories
                </span>
                <span className="text-[10px] text-amber-600 dark:text-amber-400">Edit On Time</span>
              </button>
              <p className="text-[10px] text-slate-400 px-1 leading-snug">
                Empty categories stay hidden to shoppers until a product is added.
              </p>
            </div>
          )}

          {/* 3-Level Category Hierarchy (Only Categories / Subcategories / Child Categories with >= 1 product are visible) */}
          <nav className="space-y-1 text-xs">
            <button
              onClick={() => onCategoryChange('All Categories')}
              className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left transition-colors cursor-pointer ${
                selectedCategory === 'All Categories' || selectedCategory === 'For you'
                  ? 'bg-[#FFD200]/20 text-slate-950 dark:text-white font-bold border-l-3 border-[#FFD200]'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="truncate">All Categories (تمام اشیاء)</span>
              <span className="text-[11px] text-slate-400 font-mono">
                ({products.length})
              </span>
            </button>

            {/* Dedicated Upcoming Viral Products | Coming Soon Category (Visible only when upcoming products exist) */}
            {upcomingCount > 0 && (
              <button
                onClick={() => onCategoryChange(UPCOMING_CATEGORY_NAME)}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left transition-colors cursor-pointer ${
                  selectedCategory === UPCOMING_CATEGORY_NAME || selectedCategory === UPCOMING_CATEGORY_ID
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-950 dark:text-purple-100 font-bold border-l-3 border-purple-500'
                    : 'bg-purple-50/60 dark:bg-purple-950/20 text-purple-800 dark:text-purple-300 hover:bg-purple-100/70 dark:hover:bg-purple-950/40'
                }`}
              >
                <span className="truncate flex items-center gap-1 font-semibold">
                  <Sparkles className="w-3 h-3 text-purple-500 shrink-0" />
                  <span className="truncate">{UPCOMING_CATEGORY_NAME}</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-200/70 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 shrink-0">
                  {upcomingCount}
                </span>
              </button>
            )}

            {/* Level 1 -> Level 2 -> Level 3 Categories (Hidden if 0 matching products) */}
            {mainCategoryNodes.map((mainCat) => {
              const count = products.filter((p) =>
                doesProductMatchCategoryFilter(p, mainCat.id, effectiveCatRecords)
              ).length;
              if (count === 0) return null;

              const visibleSubs = activeCatRecords
                .filter((c) => c.parentCategoryId === mainCat.id)
                .map((sub) => ({
                  sub,
                  subCount: products.filter((p) =>
                    doesProductMatchCategoryFilter(p, sub.id, effectiveCatRecords)
                  ).length,
                }))
                .filter((item) => item.subCount > 0);

              const isSelected =
                normalizeTextKey(selectedCategory) === normalizeTextKey(mainCat.name) ||
                selectedCategory === mainCat.id;
              const isExpanded = Boolean(expandedSidebarCats[mainCat.id] || isSelected);

              return (
                <div key={mainCat.id} className="space-y-0.5">
                  <div className="flex items-center gap-0.5">
                    {visibleSubs.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSidebarCats((prev) => ({
                            ...prev,
                            [mainCat.id]: !isExpanded,
                          }))
                        }
                        className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
                        aria-label="Toggle subcategories"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onCategoryChange(mainCat.name);
                        if (visibleSubs.length > 0) {
                          setExpandedSidebarCats((prev) => ({ ...prev, [mainCat.id]: true }));
                        }
                      }}
                      className={`flex-1 flex items-center justify-between py-1.5 px-2 rounded-lg text-left transition-colors cursor-pointer min-w-0 ${
                        isSelected
                          ? 'bg-[#FFD200]/20 text-slate-950 dark:text-white font-bold border-l-3 border-[#FFD200]'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="truncate">{mainCat.name}</span>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">
                        ({count})
                      </span>
                    </button>
                  </div>

                  {/* Level 2 Subcategories (only visible when subCount > 0) */}
                  {isExpanded && visibleSubs.length > 0 && (
                    <div className="pl-4 border-l border-slate-200 dark:border-slate-800 ml-2 space-y-0.5">
                      {visibleSubs.map(({ sub, subCount }) => {
                        const visibleChildCats = activeCatRecords
                          .filter((c) => c.parentCategoryId === sub.id)
                          .map((ch) => ({
                            ch,
                            chCount: products.filter((p) =>
                              doesProductMatchCategoryFilter(p, ch.id, effectiveCatRecords)
                            ).length,
                          }))
                          .filter((item) => item.chCount > 0);
                        const isSubSelected =
                          normalizeTextKey(selectedCategory) === normalizeTextKey(sub.name) ||
                          selectedCategory === sub.id;

                        return (
                          <div key={sub.id} className="space-y-0.5">
                            <button
                              onClick={() => onCategoryChange(sub.name)}
                              className={`w-full flex items-center justify-between py-1 px-2 rounded-md text-left text-[11px] transition-colors cursor-pointer ${
                                isSubSelected
                                  ? 'bg-amber-100/80 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200 font-bold'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                              }`}
                            >
                              <span className="truncate">└ {sub.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                ({subCount})
                              </span>
                            </button>

                            {/* Level 3 Child Subcategories (only visible when chCount > 0) */}
                            {visibleChildCats.length > 0 && (
                              <div className="pl-3 space-y-0.5">
                                {visibleChildCats.map(({ ch, chCount }) => {
                                  const isChSelected =
                                    normalizeTextKey(selectedCategory) === normalizeTextKey(ch.name) ||
                                    selectedCategory === ch.id;
                                  return (
                                    <button
                                      key={ch.id}
                                      onClick={() => onCategoryChange(ch.name)}
                                      className={`w-full flex items-center justify-between py-0.5 px-2 rounded text-left text-[10px] transition-colors cursor-pointer ${
                                        isChSelected
                                          ? 'bg-amber-200/70 dark:bg-amber-900/50 text-amber-950 dark:text-amber-100 font-bold'
                                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                      }`}
                                    >
                                      <span className="truncate">• {ch.name}</span>
                                      <span className="text-[9px] text-slate-400 font-mono shrink-0">
                                        ({chCount})
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Legacy / Custom Unmapped Categories from Existing Products */}
            {unmappedProductCategories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => onCategoryChange(cat.name)}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left transition-colors cursor-pointer ${
                  selectedCategory === cat.name
                    ? 'bg-[#FFD200]/20 text-slate-950 dark:text-white font-bold border-l-3 border-[#FFD200]'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ({cat.count})
                </span>
              </button>
            ))}
          </nav>

          {/* Quick Import from Website Button in Sidebar (USER DIRECTIVE: keep only visible import from website link for super admin hide for others) */}
          {(userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager') && onOpenImportModal && (
            <div className="pt-2">
              <button
                onClick={onOpenImportModal}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Import from Website Link</span>
              </button>
              <span className="text-[10px] text-slate-400 text-center block mt-1">
                ویب سائٹ لنک سے پراڈکٹ امپورٹ کریں (ایڈمن)
              </span>
            </div>
          )}

          {/* Customer Type Quick Selector (Admin Only) */}
          {!isCustomerView && (userRole === 'admin' || userRole === 'super_admin') && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-2">
                Customer Mode (کسٹمر کی قسم)
              </span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
                <button
                  onClick={() => setCustomerTypeFilter('individual')}
                  className={`py-1 px-2 rounded text-center font-medium cursor-pointer transition-colors ${
                    customerTypeFilter === 'individual'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Individual (انفرادی)
                </button>
                <button
                  onClick={() => setCustomerTypeFilter('retail')}
                  className={`py-1 px-2 rounded text-center font-medium cursor-pointer transition-colors ${
                    customerTypeFilter === 'retail'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Retail Store (ریٹیلر)
                </button>
              </div>
            </div>
          )}

          {/* Payment Terms Info Card */}
          <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-500" /> Payment Terms Policy:
            </span>
            <p>• Soft reminder before 3 days</p>
            <p>• Due date payment alert (1 week max grace)</p>
            <p>• Overdue reminder every 3 days until settled</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100 pt-1 text-[10px]">
              EasyPaisa · JazzCash · SadaPay · COD Available
            </p>
          </div>
        </aside>

        {/* RIGHT AREA: HEADER BAR + PRODUCT GRID + CART DRAWER TRIGGER */}
        <section className="w-full lg:flex-1 min-w-0 space-y-4">
          {/* Main Grid Header Row (Matching Screenshot) */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                {selectedCategory || 'For you'}
              </h1>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Showing 1–{filteredProducts.length} of {products.length} wholesale catalog items
              </span>
            </div>

            {/* Sorting & Filter Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[11px]">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs focus:outline-hidden cursor-pointer"
                >
                  <option value="default">Default sorting</option>
                  <option value="winning_profit">Winning items by Sale Profit ⭐</option>
                  <option value="highest_savings">Highest Customer Savings (زیادہ بچت)</option>
                  <option value="price_low">Price: Low to High</option>
                  <option value="price_high">Price: High to Low</option>
                </select>
              </div>

              <span className="text-slate-400 text-xs">|</span>

              <span className="text-slate-500 text-[11px] font-mono">
                All {filteredProducts.length} items loaded
              </span>
            </div>
          </div>

          {/* Two-Category Delivery Speed Bar: Express Group vs Standard (All Cities Open, 3-6 Working Days) */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2 shadow-2xs flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setDeliveryFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                deliveryFilter === 'all'
                  ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              All Products ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setDeliveryFilter('express')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                deliveryFilter === 'express'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
              }`}
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Express Group · Instant ({expressProductCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setDeliveryFilter('standard')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                deliveryFilter === 'standard'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200'
              }`}
            >
              <span>Standard · 3–6 Days Promised ({standardProductCount})</span>
            </button>
          </div>

          {/* Subcategory Quick Chips when a parent category is selected */}
          {selectedCatChildren.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 shadow-2xs">
              <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">
                Subcategories:
              </span>
              {selectedCatChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onCategoryChange(child.name)}
                  className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-[#FFD200] hover:text-slate-950 text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  {child.name}
                </button>
              ))}
            </div>
          )}

          {/* DEDICATED EXPRESS DELIVERY GROUP (All Express Items Together in One Place) */}
          {expressGroupProducts.length > 0 && deliveryFilter !== 'standard' && (
            <div className="rounded-2xl border-2 border-emerald-400/70 dark:border-emerald-700/80 bg-gradient-to-br from-emerald-50/80 via-white to-amber-50/30 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 p-3 sm:p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-emerald-200/80 dark:border-emerald-800/70">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
                    <Zap className="w-4 h-4 fill-current" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Express Delivery Group ({expressGroupProducts.length})</span>
                      <span className="font-urdu text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        ایکسپریس آئٹمز
                      </span>
                    </h2>
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-1 font-medium">
                      <Lock className="w-3 h-3 shrink-0" />
                      <span>
                        Instant Express delivery ONLY in manually selected cities &amp; sub-cities (others locked)
                      </span>
                    </p>
                  </div>
                </div>
                {deliveryFilter === 'all' ? (
                  <button
                    type="button"
                    onClick={() => setDeliveryFilter('express')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer"
                  >
                    Open Express Group Only
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeliveryFilter('all')}
                    className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-[11px] cursor-pointer"
                  >
                    Show All Products
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {expressGroupProducts.map(renderProductCard)}
              </div>
            </div>
          )}

          {/* REMAINING PRODUCTS GRID (Without Delivery Symbols; All Cities & Sub-Cities Open, 3-6 Working Days) */}
          {standardGroupProducts.length > 0 && deliveryFilter !== 'express' && (
            <div className="space-y-2.5">
              {(expressGroupProducts.length > 0 || deliveryFilter === 'standard') && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                    All Catalog Products ({standardGroupProducts.length})
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Open across all Provinces &amp; Kashmir (Cities, Sub-Cities, Child Cities &amp; Villages) · Standard 3 to 6 days promised delivery
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {standardGroupProducts.map(renderProductCard)}
              </div>
            </div>
          )}

          {filteredProducts.length === 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center text-slate-500">
              <ShoppingBag className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                No products found in category "{selectedCategory}"
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Try searching for another keyword or select "Show All Categories".
              </p>
              <button
                onClick={() => {
                  onCategoryChange('All Categories');
                  onSearchChange('');
                  setDeliveryFilter('all');
                  setShowWinningOnly(false);
                }}
                className="mt-4 px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-900 rounded-lg hover:bg-amber-400 cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          )}
        </section>
      </div>

      {/* 3. FLOATING POS DRAFT CART BAR (If cart has items) */}
      {cart.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 max-w-4xl mx-auto z-40 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md text-white border-2 border-amber-400 rounded-2xl p-4 shadow-2xl flex flex-wrap items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold font-mono">
              {totalCartItems}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Active Sale / POS Cart</span>
                <span className="text-[10px] font-bold bg-emerald-500 text-slate-950 px-2 py-0.5 rounded">
                  Customer Saves: {profile.currencySymbol}{totalCartSavings.toLocaleString('en-PK')}
                </span>
              </div>
              <span className="text-xs text-slate-300 font-mono">
                Total Our Price: <b className="text-amber-400 text-sm">{profile.currencySymbol}{totalCartAmount.toLocaleString('en-PK')}</b> (Market: <span className="line-through">{profile.currencySymbol}{totalCartMarket.toLocaleString('en-PK')}</span>)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsConfirmClearCartOpen(true)}
              className="px-3 py-2 text-xs text-slate-400 hover:text-red-400 cursor-pointer transition-colors"
            >
              Clear Cart
            </button>
            <button
              onClick={onOpenCheckout}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-transform hover:scale-102 cursor-pointer"
            >
              <span>Proceed to Checkout &amp; Payment Terms</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* CLEAR CART CONFIRMATION MODAL */}
      {isConfirmClearCartOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Clear All Items from Cart?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                کیا آپ کارٹ میں موجود تمام آئٹمز کو ہٹانا چاہتے ہیں؟
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmClearCartOpen(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearCart();
                  setIsConfirmClearCartOpen(false);
                }}
                className="flex-1 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-500 rounded-xl cursor-pointer shadow-xs"
              >
                Yes, Clear Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT DETAILS, PICTURES, SIZES & SPECS MODAL */}
      <ProductDetailsModal
        product={activeDetailProduct}
        isOpen={!!activeDetailProduct}
        onClose={() => setSelectedDetailProduct(null)}
        onAddToCart={onAddToCart}
        profile={profile}
        investors={effectiveInvestors}
        currentUser={currentUser}
        customers={customers}
        isCustomerView={isCustomerView}
        canEditProduct={canEditProductDetails}
        onUpdateProduct={onUpdateProduct}
      />
    </div>
  );
};
