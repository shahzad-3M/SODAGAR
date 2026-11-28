import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  ShoppingBag,
  Check,
  Percent,
  Sparkles,
  Phone,
  ShieldCheck,
  Truck,
  RotateCcw,
  Tag,
  Video,
  MessageSquare,
  Save,
  Share2,
  Copy,
  Zap,
  Lock,
  CheckCircle2,
  Pencil,
  Link2,
  PlusCircle,
  Ruler,
} from 'lucide-react';
import type { AppUser, BusinessProfile, Customer, Investor, ProductItem } from '../types/index.ts';
import { ProductSpecSizingShowcase } from './ProductSpecSizingShowcase.tsx';
import {
  buildAddMyProductInvestorMessage,
  buildDirectProductWhatsAppMessage,
  buildInvestorProductInquiryMessage,
  buildProductPageUrl,
  buildProfessionalCustomerProductShareMessage,
  generateProductPriceCardFile,
  generateWhatsAppLink,
  openExternalLinkSafe,
  openWhatsAppDirect,
  parseProductVideoUrl,
  resolveProductInvestorContact,
} from '../utils/whatsapp.ts';
import { defaultDeliveryCities } from '../utils/defaultData.ts';
import { getInvestors } from '../utils/storage.ts';
import {
  DEFAULT_CITY_CENTER_DELIVERY_CHARGE,
  ensureCityAreasShape,
  findFirstUnlockedExpressCityAndArea,
  getOrderedProvincesFromCities,
  getProductDeliveryMeta,
  inferProvinceForCity,
  isMuzaffarabadCity,
  isProductPurchaseBlocked,
  normalizeTextKey,
  resolveExpressAreaAvailability,
  resolveProductOrCartDeliveryCharge,
} from '../utils/locationCategoryHelpers.ts';

interface ProductDetailsModalProps {
  product: ProductItem | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: ProductItem, qty: number, selectedSize?: string) => void;
  onBuyNowGuest?: (product: ProductItem, qty: number, selectedSize?: string) => void;
  profile: BusinessProfile;
  investors?: Investor[];
  currentUser?: AppUser;
  customers?: Customer[];
  isCustomerView?: boolean;
  canEditProduct?: boolean;
  onUpdateProduct?: (updatedProduct: ProductItem) => void;
}

const getVariationLabel = (v: NonNullable<ProductItem['variations']>[number]) =>
  v.title ||
  [v.size, v.color, ...Object.values(v.attributes || {})].filter(Boolean).join(' · ') ||
  v.sku ||
  'Variant';

export const ProductDetailsModal: React.FC<ProductDetailsModalProps> = ({
  product,
  isOpen,
  onClose,
  onAddToCart,
  onBuyNowGuest,
  profile,
  investors,
  currentUser,
  isCustomerView = false,
  canEditProduct = false,
  onUpdateProduct,
}) => {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [manualGalleryOverride, setManualGalleryOverride] = useState(false);
  const [selectedVariationIndex, setSelectedVariationIndex] = useState<number | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>('Standard');
  const [quantity, setQuantity] = useState(1);
  const [addedAnimation, setAddedAnimation] = useState(false);
  const [videoLinkInput, setVideoLinkInput] = useState('');
  const [videoSavedToast, setVideoSavedToast] = useState(false);
  const [estimateCity, setEstimateCity] = useState('Muzaffarabad');
  const [estimateArea, setEstimateArea] = useState('City Center');
  const [customEstimateVillageMode, setCustomEstimateVillageMode] = useState(false);
  const [isSharingCard, setIsSharingCard] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [addProductLinkInput, setAddProductLinkInput] = useState('');
  const [isEditingAddProductLink, setIsEditingAddProductLink] = useState(false);

  const cityConfigs = ensureCityAreasShape(
    profile.deliveryCities && profile.deliveryCities.length > 0
      ? profile.deliveryCities
      : defaultDeliveryCities
  );
  const firstExpressLocation = findFirstUnlockedExpressCityAndArea(cityConfigs);
  const defaultStandardCity =
    cityConfigs.find((c) => isMuzaffarabadCity(c.name))?.name ||
    cityConfigs[0]?.name ||
    'Muzaffarabad';

  useEffect(() => {
    if (!isOpen || !product) return;
    setActiveImageIndex(0);
    setManualGalleryOverride(false);
    setQuantity(1);
    setAddedAnimation(false);
    setVideoLinkInput(product.videoUrl || '');
    setVideoSavedToast(false);
    setShareFeedback(null);
    setAddProductLinkInput(product.addMyProductUrl || '');
    setIsEditingAddProductLink(false);
    setCustomEstimateVillageMode(false);
    const isExpress = product.deliveryType === 'express';
    if (isExpress) {
      setEstimateCity(firstExpressLocation.city);
      setEstimateArea(firstExpressLocation.area);
    } else {
      setEstimateCity(defaultStandardCity);
      const stdCityObj = cityConfigs.find(
        (c) => normalizeTextKey(c.name) === normalizeTextKey(defaultStandardCity)
      );
      setEstimateArea(
        stdCityObj?.areas?.[0]?.name || (isMuzaffarabadCity(defaultStandardCity) ? 'City Center' : '')
      );
    }
    if (product.variations && product.variations.length > 0) {
      setSelectedVariationIndex(0);
      setSelectedSize(getVariationLabel(product.variations[0]));
    } else {
      setSelectedVariationIndex(null);
      setSelectedSize(
        product.selectedSize || (product.sizes && product.sizes.length > 0 ? product.sizes[0] : 'Standard')
      );
    }
  }, [isOpen, product?.id, product?.videoUrl, product?.addMyProductUrl, product?.deliveryType, firstExpressLocation.city, firstExpressLocation.area, defaultStandardCity]);

  if (!isOpen || !product) return null;

  const effectiveInvestors = investors && investors.length > 0 ? investors : getInvestors();
  const investorContact = resolveProductInvestorContact(
    product,
    effectiveInvestors,
    profile.phone || '03125256266'
  );
  const parsedVideo = parseProductVideoUrl(product.videoUrl);
  const deliveryMeta = getProductDeliveryMeta(product);

  const pictures = Array.from(
    new Set(
      [
        ...(product.pictures || []),
        ...(product.imageUrl ? [product.imageUrl] : []),
        ...((product.variations || []).map((v) => v.image).filter(Boolean) as string[]),
      ].filter(Boolean)
    )
  );

  const activeVariation =
    selectedVariationIndex !== null && product.variations && product.variations[selectedVariationIndex]
      ? product.variations[selectedVariationIndex]
      : null;

  const activePrice = activeVariation?.salePrice || product.ourPrice;
  const activeMarketPrice = activeVariation?.originalPrice || product.marketPrice;

  const activeImage =
    (!manualGalleryOverride && activeVariation?.image) ||
    pictures[activeImageIndex] ||
    activeVariation?.image ||
    product.imageUrl;

  const savings = Math.max(0, activeMarketPrice - activePrice);
  const savingsPercent = activeMarketPrice > 0 ? Math.round((savings / activeMarketPrice) * 100) : 50;

  const handleAdd = () => {
    if (Number(product.stockQty ?? 0) <= 0) return;
    const productWithVariant: ProductItem = {
      ...product,
      ourPrice: activePrice,
      marketPrice: activeMarketPrice,
      selectedSize,
      imageUrl: activeImage || product.imageUrl,
    };
    onAddToCart(productWithVariant, quantity, selectedSize);
    setAddedAnimation(true);
    setTimeout(() => {
      setAddedAnimation(false);
      onClose();
    }, 400);
  };

  const resolvedCustomerName =
    currentUser?.isAuthenticated && currentUser.name ? currentUser.name : undefined;

  const isExpressProduct = deliveryMeta.isExpress;
  const selectedEstimateCityObj =
    cityConfigs.find((c) => normalizeTextKey(c.name) === normalizeTextKey(estimateCity)) ||
    cityConfigs[0];
  const selectedEstimateProvince = inferProvinceForCity(
    selectedEstimateCityObj?.name || estimateCity,
    selectedEstimateCityObj?.province
  );
  const estimatorProvinces = getOrderedProvincesFromCities(cityConfigs);
  const citiesInEstimateProvince = cityConfigs.filter(
    (c) => inferProvinceForCity(c.name, c.province) === selectedEstimateProvince
  );
  const estimateCityAreas = selectedEstimateCityObj?.areas || [];
  const estimateAvailability = resolveExpressAreaAvailability(
    cityConfigs,
    selectedEstimateCityObj?.name || estimateCity,
    estimateArea,
    isExpressProduct
  );
  const resolvedEstimateDelivery = resolveProductOrCartDeliveryCharge(
    cityConfigs,
    product,
    selectedEstimateCityObj?.name || estimateCity,
    estimateArea,
    profile.defaultCityCenterDeliveryCharge ?? DEFAULT_CITY_CENTER_DELIVERY_CHARGE
  );
  const estimatedOrderTotal = activePrice * quantity + resolvedEstimateDelivery.charge;

  const handleDirectWhatsAppOrder = () => {
    const text = buildDirectProductWhatsAppMessage(product, profile, {
      customerName: resolvedCustomerName,
      selectedSize,
      quantity,
      activePrice,
      activeMarketPrice,
      imageUrl: activeImage,
    });
    openWhatsAppDirect(profile.phone || '03125256266', text);
  };

  const handleRaiseInvestorInquiry = (targetWhatsapp?: string, targetInvestorName?: string) => {
    const text = buildInvestorProductInquiryMessage(product, profile, {
      customerName: resolvedCustomerName,
      investorName: targetInvestorName || investorContact.investorName,
      selectedSize,
      quantity,
      activePrice,
      activeMarketPrice,
      imageUrl: activeImage,
    });
    openWhatsAppDirect(targetWhatsapp || investorContact.whatsapp, text);
  };

  const getProfessionalShareMessage = () =>
    buildProfessionalCustomerProductShareMessage(product, profile, {
      customerName: resolvedCustomerName,
      selectedSize,
      quantity,
      activePrice,
      activeMarketPrice,
      imageUrl: activeImage,
    });

  const handleSharePriceImageCard = async () => {
    setIsSharingCard(true);
    setShareFeedback(null);
    const shareText = getProfessionalShareMessage();
    try {
      const cardFile = await generateProductPriceCardFile(product, profile, {
        customerName: resolvedCustomerName,
        selectedSize,
        quantity,
        activePrice,
        activeMarketPrice,
        imageUrl: activeImage,
      });

      if (
        cardFile &&
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [cardFile] })
      ) {
        await navigator.share({
          title: `${product.name} — ${profile.currencySymbol}${activePrice.toLocaleString('en-PK')}`,
          text: shareText,
          files: [cardFile],
        });
        setShareFeedback('Product price card shared.');
        return;
      }

      if (cardFile) {
        const blobUrl = URL.createObjectURL(cardFile);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = cardFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
      }
      setShareFeedback('Product price card downloaded & link copied.');
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareText);
          }
          setShareFeedback('Product details copied to clipboard.');
        } catch {
          setShareFeedback('Unable to share right now.');
        }
      }
    } finally {
      setIsSharingCard(false);
    }
  };

  const handleCopyProductLink = async () => {
    const url = buildProductPageUrl(product.id);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
      setShareFeedback('Direct product link copied.');
    } catch {
      setShareFeedback('Unable to copy link automatically.');
    }
  };

  const handleSaveInlineVideoLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateProduct) return;
    const trimmed = videoLinkInput.trim();
    onUpdateProduct({
      ...product,
      videoUrl: trimmed || undefined,
      updatedAt: new Date().toISOString(),
    });
    setVideoSavedToast(true);
    setTimeout(() => setVideoSavedToast(false), 3000);
  };

  const handleAddMyProductDirectInvestor = () => {
    const addMsg = buildAddMyProductInvestorMessage(product, profile, {
      customerName: resolvedCustomerName,
      investorName: investorContact.investorName,
      selectedSize,
      imageUrl: activeImage,
    });
    const customTarget = (product.addMyProductUrl || '').trim();
    if (customTarget) {
      if (/^[\d+\-\s()]{8,18}$/.test(customTarget)) {
        openWhatsAppDirect(customTarget, addMsg);
      } else {
        openExternalLinkSafe(customTarget);
      }
      return;
    }
    openWhatsAppDirect(investorContact.whatsapp, addMsg);
  };

  const handleSaveAddProductLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateProduct) return;
    const trimmed = addProductLinkInput.trim();
    onUpdateProduct({
      ...product,
      addMyProductUrl: trimmed || undefined,
      updatedAt: new Date().toISOString(),
    });
    setIsEditingAddProductLink(false);
    setShareFeedback(
      trimmed
        ? 'Add My Product direct investor link saved.'
        : 'Add My Product reset to product investor WhatsApp.'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-6 flex flex-col max-h-[90vh]">
        {/* Top Header */}
        <div className="bg-[#FFD200] px-4 py-2.5 flex items-center justify-between text-slate-900 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs uppercase tracking-wider bg-slate-900 text-amber-300 px-2 py-0.5 rounded">
              100DAGAR Details
            </span>
            <span className="text-xs font-semibold truncate max-w-xs sm:max-w-md">
              {product.name}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-amber-400 text-slate-900 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* LEFT: PICTURES GALLERY */}
            <div className="space-y-3">
              <div className="relative bg-white dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 aspect-square flex items-center justify-center">
                {activeImage ? (
                  <img
                    src={activeImage}
                    alt={product.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <ShoppingBag className="w-16 h-16 text-slate-300" />
                )}

                {/* Savings & Express Symbol Badge */}
                <div className="absolute top-3 left-3 flex flex-col gap-1 items-start">
                  <span className="bg-emerald-600 text-white font-extrabold text-xs px-2.5 py-1 rounded shadow-md">
                    -{savingsPercent}% OFF
                  </span>
                  {isExpressProduct && !isProductPurchaseBlocked(product) && (
                    <span className="bg-emerald-950/90 text-emerald-200 border border-emerald-400/50 font-extrabold text-[10px] px-2 py-0.5 rounded shadow-xs flex items-center gap-1">
                      <Zap className="w-3 h-3 fill-emerald-300 text-emerald-300" /> EXPRESS
                    </span>
                  )}
                  {product.isWinningItem && (
                    <span className="bg-amber-500 text-slate-950 font-bold text-[10px] px-2 py-0.5 rounded shadow-xs flex items-center gap-1">
                      <Sparkles className="w-3 h-3 fill-slate-950" /> WINNING ITEM
                    </span>
                  )}
                </div>

                <div className="absolute top-3 right-3">
                  <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded shadow-xs ${
                    product.stockQty <= product.minStockAlert
                      ? 'bg-red-500 text-white'
                      : 'bg-slate-900/80 text-white backdrop-blur-xs'
                  }`}>
                    {product.stockQty > 0 ? `${product.stockQty} in stock` : 'Out of Stock'}
                  </span>
                </div>
              </div>

              {/* Thumbnails Row */}
              {pictures.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {pictures.map((pic, idx) => {
                    const isThumbActive = activeImage === pic;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveImageIndex(idx);
                          setManualGalleryOverride(true);
                        }}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 bg-white dark:bg-slate-900 shrink-0 transition-all cursor-pointer ${
                          isThumbActive
                            ? 'border-amber-500 ring-2 ring-amber-400/50 scale-105'
                            : 'border-slate-200 dark:border-slate-700 opacity-75 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={pic}
                          alt={`View ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain p-0.5"
                        />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Trust Badges */}
              <div className="grid grid-cols-3 gap-2 pt-2 text-[10px] text-slate-500 dark:text-slate-400 text-center">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 flex flex-col items-center gap-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>100% Original Lot</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 flex flex-col items-center gap-1">
                  <Truck className="w-4 h-4 text-blue-600" />
                  <span>Cash on Delivery</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 flex flex-col items-center gap-1">
                  <RotateCcw className="w-4 h-4 text-amber-600" />
                  <span>Easy Return Policy</span>
                </div>
              </div>

              {/* PRODUCT VIDEO PLAYER & ADMIN PASTE LINK AREA */}
              {(parsedVideo || (canEditProduct && onUpdateProduct)) && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-amber-500" />
                      <span>Product Video (پراڈکٹ ویڈیو)</span>
                    </span>
                    {parsedVideo && (
                      <a
                        href={parsedVideo.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open Video</span>
                      </a>
                    )}
                  </div>

                  {parsedVideo && (
                    parsedVideo.kind === 'youtube' || parsedVideo.kind === 'vimeo' ? (
                      <div className="aspect-video w-full rounded-lg overflow-hidden bg-slate-950 border border-slate-200 dark:border-slate-700">
                        <iframe
                          src={parsedVideo.src}
                          title={`${product.name} Video`}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : parsedVideo.kind === 'direct' ? (
                      <video
                        src={parsedVideo.src}
                        controls
                        playsInline
                        className="w-full rounded-lg bg-slate-950 max-h-56 border border-slate-200 dark:border-slate-700"
                      />
                    ) : (
                      <a
                        href={parsedVideo.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Video className="w-4 h-4 text-amber-400" />
                        <span>Watch Product Video</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                      </a>
                    )
                  )}

                  {canEditProduct && onUpdateProduct && (
                    <form onSubmit={handleSaveInlineVideoLink} className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-700">
                      <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        Paste Product Video Link (YouTube, TikTok, Reels, MP4):
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="url"
                          value={videoLinkInput}
                          onChange={(e) => setVideoLinkInput(e.target.value)}
                          placeholder="Paste video URL here..."
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] rounded-lg inline-flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                      </div>
                      {videoSavedToast && (
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 block">
                          Product video link saved.
                        </span>
                      )}
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT: DETAILS, SPECS, SIZES, AND ACTIONS */}
            <div className="space-y-4">
              <div>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider block">
                  {product.category} · SKU: {product.sku}
                </span>
                <h1 className="text-lg font-extrabold text-slate-900 dark:text-white leading-snug mt-1">
                  {product.name}
                </h1>
                {product.urduName && (
                  <p className="font-urdu text-sm text-slate-600 dark:text-slate-300 mt-1 font-semibold">
                    {product.urduName}
                  </p>
                )}
              </div>

              {/* PRICING & SAVINGS (Strictly Customer Safe) */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                    {profile.currencySymbol}{activePrice.toLocaleString('en-PK')}
                  </span>
                  <span className="text-sm text-slate-400 line-through font-mono">
                    {profile.currencySymbol}{activeMarketPrice.toLocaleString('en-PK')}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
                    -{savingsPercent}% Save
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 p-2 rounded-lg border border-emerald-200 dark:border-emerald-900">
                  <span className="flex items-center gap-1">
                    <Percent className="w-3.5 h-3.5 text-emerald-600" />
                    <span>کسٹمر بچت (Your Instant Savings):</span>
                  </span>
                  <span className="font-mono font-bold text-sm">
                    {profile.currencySymbol}{savings.toLocaleString('en-PK')}
                  </span>
                </div>

                {/* Internal Wholesale Margin ONLY shown to merchant when not in customer view */}
                {!isCustomerView && (
                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span>Merchant Cost: {profile.currencySymbol}{product.costPrice.toLocaleString('en-PK')}</span>
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                      Profit Margin: {profile.currencySymbol}{(activePrice - product.costPrice).toLocaleString('en-PK')}/unit
                    </span>
                  </div>
                )}
              </div>

              {/* VARIATION SELECTOR (Sizes, Colors, Options + Separate Details) */}
              {product.variations && product.variations.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-amber-500" />
                      <span>Select Variation / Option (ویریئنٹ منتخب کریں):</span>
                    </label>
                    {(product.sizeChart || (product.sizes && product.sizes.length > 0)) && (
                      <button
                        type="button"
                        onClick={() => {
                          document.getElementById('product-dossier-section')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer shrink-0"
                      >
                        <Ruler className="w-3 h-3" />
                        <span>Size Guide</span>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {product.variations.map((v, vIdx) => {
                      const isSelected = selectedVariationIndex === vIdx;
                      const label = getVariationLabel(v);
                      return (
                        <button
                          key={v.id || vIdx}
                          type="button"
                          onClick={() => {
                            setSelectedVariationIndex(vIdx);
                            setSelectedSize(label);
                            setManualGalleryOverride(false);
                          }}
                          className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex items-center gap-2 ${
                            isSelected
                              ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/40 ring-2 ring-amber-400'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                          }`}
                        >
                          {v.image && (
                            <img
                              src={v.image}
                              alt={label}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-slate-900 dark:text-white block truncate">
                              {label}
                            </span>
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold block">
                              {profile.currencySymbol}{(v.salePrice || product.ourPrice).toLocaleString('en-PK')}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Separate Selected Variant Details Panel */}
                  {activeVariation && (
                    <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 text-[11px] space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          Option: {getVariationLabel(activeVariation)}
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          {activeVariation.sku && (
                            <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              SKU: {activeVariation.sku}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              (activeVariation.stockQty ?? 0) > 0
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            }`}
                          >
                            {(activeVariation.stockQty ?? 0) > 0
                              ? `${activeVariation.stockQty} available`
                              : 'Check availability'}
                          </span>
                        </div>
                      </div>
                      {activeVariation.attributes && Object.keys(activeVariation.attributes).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {Object.entries(activeVariation.attributes).map(([attrK, attrV]) => (
                            <span
                              key={attrK}
                              className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900/70 border border-amber-200/70 dark:border-amber-800/50 text-[10px] text-slate-700 dark:text-slate-300"
                            >
                              <b>{attrK}:</b> {attrV}
                            </span>
                          ))}
                        </div>
                      )}
                      {activeVariation.details && (
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">
                          {activeVariation.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : product.sizes && product.sizes.length > 0 ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-amber-500" />
                    <span>Select Size / Package (سائز یا پیکج منتخب کریں):</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSelectedSize(s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          selectedSize === s
                            ? 'bg-[#FFD200] text-slate-950 font-bold ring-2 ring-amber-400 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* QUANTITY & ACTIONS */}
              <div className="space-y-2 pt-1">
                {isProductPurchaseBlocked(product) ? (
                  <div className="space-y-2">
                    <div className="p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl text-center">
                      <span className="text-xs font-black text-purple-900 dark:text-purple-200 uppercase tracking-wider block">
                        ✨ Coming Soon / Expected Soon (جلد دستیاب)
                      </span>
                      {product.expectedArrivalDate && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded bg-purple-200/70 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100 text-[11px] font-bold font-mono">
                          Expected Arrival Date: {product.expectedArrivalDate}
                        </span>
                      )}
                      <p className="text-[11px] text-purple-700 dark:text-purple-300 mt-1">
                        This product is informational only until an authorized Admin or Stock Manager confirms physical arrival. Add to Cart &amp; Checkout are disabled.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRaiseInvestorInquiry()}
                      className="w-full py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>
                        Product Inquiry to Investor
                        {investorContact.isInvestorAssigned
                          ? ` (${investorContact.investorName || investorContact.whatsapp})`
                          : ''}
                      </span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <span className="px-3 py-1.5 font-mono font-bold text-xs text-slate-900 dark:text-white min-w-[2.5rem] text-center">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setQuantity(
                              product.stockQty > 0 ? Math.min(product.stockQty, quantity + 1) : quantity + 1
                            )
                          }
                          className="px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>

                      {/* Option 1: Add to Cart */}
                      <button
                        type="button"
                        disabled={Number(product.stockQty ?? 0) <= 0}
                        onClick={handleAdd}
                        className="flex-1 py-2.5 px-4 bg-[#FFD200] hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed dark:disabled:bg-slate-800 text-slate-950 font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        {Number(product.stockQty ?? 0) <= 0 ? (
                          <span>Out of Stock · Confirm via WhatsApp</span>
                        ) : addedAnimation ? (
                          <>
                            <Check className="w-4 h-4 stroke-[3]" />
                            <span>Added to Cart!</span>
                          </>
                        ) : (
                          <>
                            <ShoppingBag className="w-4 h-4" />
                            <span>Add to Cart ({profile.currencySymbol}{(activePrice * quantity).toLocaleString('en-PK')})</span>
                          </>
                        )}
                      </button>
                    </div>

                    {onBuyNowGuest && Number(product.stockQty ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const effectiveProd = {
                            ...product,
                            ourPrice: activePrice,
                            marketPrice: activeMarketPrice,
                            imageUrl: activeImage || product.imageUrl,
                          };
                          onBuyNowGuest(effectiveProd, quantity, selectedSize || undefined);
                          onClose();
                        }}
                        className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-slate-950 font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>
                          {currentUser?.isAuthenticated
                            ? 'Buy Now (Instant Checkout)'
                            : 'Buy Now · Checkout as Guest'}
                        </span>
                      </button>
                    )}

                    {/* Option 2: Direct Business WhatsApp Order */}
                    <button
                      type="button"
                      onClick={handleDirectWhatsAppOrder}
                      className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Order on WhatsApp (واٹس ایپ فوری آرڈر)</span>
                    </button>

                    {/* Option 3: Product Inquiry sent directly to Investor WhatsApp with Product Link */}
                    <button
                      type="button"
                      onClick={() => handleRaiseInvestorInquiry()}
                      className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      <span>
                        Product Inquiry to Investor
                        {investorContact.isInvestorAssigned
                          ? ` (${investorContact.investorName ? `${investorContact.investorName} · ` : ''}${investorContact.whatsapp})`
                          : ''}
                      </span>
                    </button>

                    {investorContact.coOwners.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                          Other Co-Owner Investors:
                        </span>
                        {investorContact.coOwners.slice(1).map((co) => (
                          <button
                            key={co.investorId}
                            type="button"
                            onClick={() => handleRaiseInvestorInquiry(co.whatsapp, co.investorName)}
                            className="px-2 py-0.5 text-[10px] font-bold rounded bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800 cursor-pointer"
                          >
                            {co.investorName} ({co.whatsapp})
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* PRODUCT DELIVERY ESTIMATOR & 1-CLICK SHARE (CUSTOMER-FRIENDLY PRODUCT INFO) */}
              <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    {isExpressProduct && <Zap className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />}
                    <span>Delivery &amp; Dispatch Estimate</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {profile.shippingPartner?.name || 'WASAL Delivery'} · Cash on Delivery
                  </span>
                </div>

                {cityConfigs.length > 0 && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                          Province / Kashmir
                        </label>
                        <select
                          value={selectedEstimateProvince}
                          onChange={(e) => {
                            const nextProv = e.target.value;
                            const provCities = cityConfigs.filter(
                              (c) => inferProvinceForCity(c.name, c.province) === nextProv
                            );
                            const pickedCity =
                              (isExpressProduct
                                ? provCities.find((c) => isMuzaffarabadCity(c.name) || c.allowed)
                                : undefined) || provCities[0];
                            if (pickedCity) {
                              setEstimateCity(pickedCity.name);
                              setCustomEstimateVillageMode(false);
                              const areas = pickedCity.areas || [];
                              const nextArea = isExpressProduct
                                ? areas.find((a) => a.allowed)?.name || ''
                                : areas[0]?.name || '';
                              setEstimateArea(
                                nextArea || (isMuzaffarabadCity(pickedCity.name) ? 'City Center' : '')
                              );
                            }
                          }}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {estimatorProvinces.map((prov) => (
                            <option key={prov} value={prov}>
                              {prov}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                          Delivery City / District
                        </label>
                        <select
                          value={selectedEstimateCityObj?.name || estimateCity}
                          onChange={(e) => {
                            const nextCity = e.target.value;
                            setEstimateCity(nextCity);
                            setCustomEstimateVillageMode(false);
                            const cObj = cityConfigs.find(
                              (c) => normalizeTextKey(c.name) === normalizeTextKey(nextCity)
                            );
                            const areas = cObj?.areas || [];
                            const nextArea = isExpressProduct
                              ? areas.find((a) => a.allowed)?.name || ''
                              : areas[0]?.name || '';
                            setEstimateArea(
                              nextArea || (isMuzaffarabadCity(nextCity) ? 'City Center' : '')
                            );
                          }}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {(citiesInEstimateProvince.length > 0 ? citiesInEstimateProvince : cityConfigs).map((c) => {
                            const cityUnlocked = isMuzaffarabadCity(c.name) || c.allowed;
                            const lockedForExpress = isExpressProduct && !cityUnlocked;
                            return (
                              <option
                                key={c.id || c.name}
                                value={c.name}
                                disabled={lockedForExpress}
                              >
                                {lockedForExpress ? `🔒 ${c.name} (Locked)` : c.name}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          Sub-City / Child City / Village {!isExpressProduct ? '(Optional)' : ''}
                        </label>
                        {!isExpressProduct && estimateCityAreas.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setCustomEstimateVillageMode((prev) => !prev)}
                            className="text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            {customEstimateVillageMode ? 'Pick from list' : '+ Type Exact Village'}
                          </button>
                        )}
                      </div>
                      {!isExpressProduct && (customEstimateVillageMode || estimateCityAreas.length === 0) ? (
                        <input
                          type="text"
                          value={estimateArea}
                          onChange={(e) => setEstimateArea(e.target.value)}
                          placeholder={`Enter village, town or tehsil in ${selectedEstimateCityObj?.name || estimateCity}...`}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        />
                      ) : estimateCityAreas.length > 0 ? (
                        <select
                          value={estimateArea}
                          onChange={(e) => setEstimateArea(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {!isExpressProduct && (
                            <option value="">-- Optional: Select Sub-City / Village --</option>
                          )}
                          {estimateCityAreas.map((a) => {
                            const lockedForExpress = isExpressProduct && !a.allowed;
                            return (
                              <option
                                key={a.id}
                                value={a.name}
                                disabled={lockedForExpress}
                              >
                                {lockedForExpress ? `🔒 ${a.name} (Locked)` : a.name}
                                {typeof a.deliveryCharge === 'number' ? ` (Rs. ${a.deliveryCharge})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <div className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                          All areas &amp; villages in unlocked city covered
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/80 text-xs">
                  <div className="text-slate-600 dark:text-slate-300">
                    <span>Shipping ({resolvedEstimateDelivery.label}): </span>
                    {resolvedEstimateDelivery.isFree ? (
                      <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                        FREE (Rs. 0)
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {profile.currencySymbol}{resolvedEstimateDelivery.charge.toLocaleString('en-PK')}
                      </span>
                    )}
                  </div>
                  {!isProductPurchaseBlocked(product) && (
                    <div className="text-slate-700 dark:text-slate-200 font-semibold">
                      <span>Est. Total ({quantity}x + Delivery): </span>
                      <span className="font-mono tabular-nums font-black text-slate-900 dark:text-white">
                        {profile.currencySymbol}{estimatedOrderTotal.toLocaleString('en-PK')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Delivery Conditions Banner: Refined two-tier presentation */}
                {!isProductPurchaseBlocked(product) && (
                  isExpressProduct ? (
                    <div
                      className={`p-3 rounded-xl border border-l-4 shadow-2xs space-y-1.5 ${
                        estimateAvailability.allowed
                          ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 border-l-emerald-600 text-emerald-950 dark:text-emerald-100'
                          : 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 border-l-rose-600 text-rose-950 dark:text-rose-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-current/10">
                        <span className="font-extrabold text-[11px] inline-flex items-center gap-1.5">
                          {estimateAvailability.allowed ? (
                            <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-500 shrink-0" />
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          )}
                          <span>⚡ {deliveryMeta.badgeLabel}</span>
                          {estimateAvailability.allowed && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                        </span>
                        <span className="font-urdu text-[11px] font-bold shrink-0 text-right leading-none">
                          {deliveryMeta.urduLabel}
                        </span>
                      </div>
                      <p className="text-[11px] font-medium leading-relaxed opacity-95">
                        {estimateAvailability.allowed
                          ? 'Instant Express delivery is active ONLY in manually selected cities & sub-cities (others remain locked).'
                          : estimateAvailability.reason}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 border-l-4 border-l-amber-500 bg-white dark:bg-slate-900 shadow-2xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Delivery Schedule
                        </span>
                        <span className="font-urdu text-[11px] font-bold text-slate-700 dark:text-slate-200 shrink-0 text-right leading-none">
                          {deliveryMeta.urduLabel}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                          Standard · 3 to 6 Working Days Promised Delivery
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                          Open across all Provinces &amp; Kashmir (Cities, Sub-Cities, Child Cities &amp; Villages)
                        </p>
                      </div>
                    </div>
                  )
                )}

                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    {isProductPurchaseBlocked(product)
                      ? 'Pre-arrival informational item · Delivery charges apply once stocked'
                      : product.stockQty > 0
                      ? `${product.stockQty} units ready in stock`
                      : 'Temporarily out of stock · Confirm restock via WhatsApp'}
                  </span>
                </div>

                <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isSharingCard}
                      onClick={handleSharePriceImageCard}
                      className="flex-1 min-w-[130px] py-1.5 px-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 font-semibold text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <Share2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>{isSharingCard ? 'Preparing Card...' : 'Share Product Card'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyProductLink}
                      className="py-1.5 px-3 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-semibold text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddMyProductDirectInvestor}
                      title={
                        product.addMyProductUrl
                          ? `Open Add My Product link (${product.addMyProductUrl})`
                          : `Add My Product — Contact ${investorContact.investorName || 'Investor'} (${investorContact.whatsapp}) for details`
                      }
                      className="py-1.5 px-3 bg-teal-600 hover:bg-teal-700 text-white font-bold text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Add My Product</span>
                    </button>
                    {canEditProduct && onUpdateProduct && (
                      <button
                        type="button"
                        onClick={() => setIsEditingAddProductLink((prev) => !prev)}
                        title="Edit manual direct investor contact link for Add My Product"
                        className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                          isEditingAddProductLink
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit Link</span>
                      </button>
                    )}
                  </div>

                  {/* Concise helper line showing who the Add My Product button directs to */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 truncate">
                      <Link2 className="w-3 h-3 text-teal-600 shrink-0" />
                      <span className="truncate">
                        {product.addMyProductUrl
                          ? `Manual Link: ${product.addMyProductUrl}`
                          : `Direct Investor Contact: ${
                              investorContact.investorName
                                ? `${investorContact.investorName} (${investorContact.whatsapp})`
                                : investorContact.whatsapp
                            }`}
                      </span>
                    </span>
                    <span className="text-teal-700 dark:text-teal-400 font-semibold shrink-0">
                      Contact Investor for Details
                    </span>
                  </div>

                  {/* Manual Editable Link Panel for Admin / Manager */}
                  {canEditProduct && onUpdateProduct && isEditingAddProductLink && (
                    <form
                      onSubmit={handleSaveAddProductLink}
                      className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[10px] font-bold text-slate-700 dark:text-slate-200">
                          Manual Editable Link (Direct Investor URL or WhatsApp Number):
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setAddProductLinkInput(
                              generateWhatsAppLink(
                                investorContact.whatsapp,
                                buildAddMyProductInvestorMessage(product, profile, {
                                  customerName: resolvedCustomerName,
                                  investorName: investorContact.investorName,
                                  selectedSize,
                                  imageUrl: activeImage,
                                })
                              )
                            )
                          }
                          className="text-[10px] font-bold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer shrink-0"
                        >
                          Auto-Fill Investor WhatsApp
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          value={addProductLinkInput}
                          onChange={(e) => setAddProductLinkInput(e.target.value)}
                          placeholder={`https://wa.me/92... or ${investorContact.whatsapp} or custom URL`}
                          className="flex-1 min-w-[180px] px-2.5 py-1.5 text-[11px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-teal-500"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-[11px] rounded-lg inline-flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save Link</span>
                        </button>
                        {product.addMyProductUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setAddProductLinkInput('');
                              onUpdateProduct({
                                ...product,
                                addMyProductUrl: undefined,
                                updatedAt: new Date().toISOString(),
                              });
                              setIsEditingAddProductLink(false);
                              setShareFeedback('Reverted to default Investor WhatsApp.');
                            }}
                            className="px-2 py-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>

                {shareFeedback && (
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {shareFeedback}
                  </p>
                )}
              </div>

              {/* External Website Link */}
              {product.websiteUrl && (
                <a
                  href={product.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>See More Details on Website (ویب سائٹ پر دیکھیں)</span>
                </a>
              )}
            </div>
          </div>

          {/* ARCHITECTURAL SPECS, INTERACTIVE SIZING CHART & EDITORIAL DESCRIPTION */}
          <ProductSpecSizingShowcase
            product={product}
            selectedSize={selectedSize}
            activeVariation={activeVariation}
            onSelectSizeOrVariant={(sizeLabel) => {
              const targetKey = normalizeTextKey(sizeLabel.replace(/\s*\([^)]*\)/g, ''));
              const parenCode = sizeLabel.match(/\(([^)]+)\)/)?.[1];
              const codeKey = parenCode ? normalizeTextKey(parenCode) : '';
              if (product.variations && product.variations.length > 0) {
                const matchIdx = product.variations.findIndex((v) => {
                  const vKeys = [v.size, v.title].filter(Boolean).map((s) => normalizeTextKey(String(s)));
                  return vKeys.some(
                    (k) => k === targetKey || k.includes(targetKey) || (codeKey && k === codeKey)
                  );
                });
                if (matchIdx >= 0) {
                  setSelectedVariationIndex(matchIdx);
                  setSelectedSize(getVariationLabel(product.variations[matchIdx]));
                  setManualGalleryOverride(false);
                  return;
                }
              }
              setSelectedSize(sizeLabel);
            }}
          />
        </div>
      </div>
    </div>
  );
};
