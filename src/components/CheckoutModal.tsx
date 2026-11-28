import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  ShoppingBag,
  Percent,
  User,
  Phone,
  MapPin,
  ShieldCheck,
  Smartphone,
  FileText,
  CalendarClock,
  AlertCircle,
  RotateCcw,
  Plus,
  Settings2,
  Zap,
  Lock,
  Trash2,
  Minus,
  CheckCircle2,
  MessageCircle,
  Truck,
  UserPlus,
  Copy,
} from 'lucide-react';
import type {
  AppUser,
  BusinessProfile,
  CartItem,
  CheckoutOrderSummary,
  Customer,
  DeliveryCityConfig,
  GuestRegistrationPrefill,
  PaymentMode,
  SalePaymentType,
  WhatsAppNotificationStatus,
} from '../types/index.ts';
import { defaultDeliveryCities } from '../utils/defaultData.ts';
import {
  DEFAULT_CITY_CENTER_DELIVERY_CHARGE,
  ensureCityAreasShape,
  findFirstUnlockedExpressCityAndArea,
  getOrderedProvincesFromCities,
  getProductDeliveryMeta,
  inferProvinceForCity,
  isMuzaffarabadCity,
  PAKISTAN_PROVINCES,
  resolveExpressAreaAvailability,
  resolveProductOrCartDeliveryCharge,
  slugifyId,
} from '../utils/locationCategoryHelpers.ts';
import { apiAddCity, apiDeleteCity, apiToggleOtherCities, apiUpdateCity } from '../utils/storage.ts';
import {
  buildGuestOrderWhatsAppConfirmation,
  buildOrderSupportWhatsAppMessage,
  openWhatsAppDirect,
} from '../utils/whatsapp.ts';
import { AddressFieldsGroup } from './AddressFieldsGroup.tsx';

export interface CheckoutSalePayload {
  customerId: string;
  buyerDetails: {
    name: string;
    phone: string;
    whatsapp: string;
    whatsappSameAsPhone: boolean;
    city: string;
    area?: string;
    mohalla?: string;
    landmark?: string;
    address: string;
  };
  saleType: SalePaymentType;
  paidAmount: number;
  dueBalance: number;
  deliveryFee: number;
  paymentMode: PaymentMode;
  paymentTermsDays: number;
  dueDate: string;
  notes: string;
  sendWhatsApp: boolean;
  resellerCode?: string;
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  customers: Customer[];
  profile: BusinessProfile;
  isCustomerView?: boolean;
  isAdmin?: boolean;
  currentUser?: AppUser;
  onSaveProfile?: (profile: BusinessProfile) => void;
  onUpdateCartQty?: (productId: string, qty: number, selectedSize?: string) => void;
  onRemoveFromCart?: (productId: string, selectedSize?: string) => void;
  onClearCart?: () => void;
  onOpenTrackOrder?: (orderNumber?: string, phone?: string) => void;
  onOpenOptionalRegister?: (prefill: GuestRegistrationPrefill) => void;
  onCompleteSale: (
    saleData: CheckoutSalePayload
  ) =>
    | Promise<{
        ok: boolean;
        error?: string;
        order?: CheckoutOrderSummary;
        guestClaimToken?: string;
        whatsappNotification?: WhatsAppNotificationStatus;
      } | void>
    | void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cart,
  customers,
  profile,
  isCustomerView = false,
  isAdmin = false,
  currentUser,
  onSaveProfile,
  onUpdateCartQty,
  onRemoveFromCart,
  onClearCart,
  onOpenTrackOrder,
  onOpenOptionalRegister,
  onCompleteSale,
}) => {
  const cityConfigs: DeliveryCityConfig[] = ensureCityAreasShape(
    profile.deliveryCities && profile.deliveryCities.length > 0
      ? profile.deliveryCities
      : defaultDeliveryCities
  );
  const hasExpressInCart = cart.some((it) => getProductDeliveryMeta(it.product).isExpress);
  const checkoutDeliveryMode: 'express_locked' | 'all_open' = hasExpressInCart
    ? 'express_locked'
    : 'all_open';

  const allowedCities = hasExpressInCart
    ? cityConfigs.filter((c) => isMuzaffarabadCity(c.name) || c.allowed)
    : cityConfigs;
  const expressFallback = findFirstUnlockedExpressCityAndArea(cityConfigs);
  const defaultActiveCity = hasExpressInCart
    ? expressFallback.city
    : cityConfigs.find((c) => isMuzaffarabadCity(c.name))?.name ||
      cityConfigs[0]?.name ||
      'Muzaffarabad';
  const defaultActiveArea = hasExpressInCart
    ? expressFallback.area
    : isMuzaffarabadCity(defaultActiveCity)
    ? 'City Center'
    : '';

  const canManageCities =
    Boolean(onSaveProfile) &&
    (isAdmin ||
      currentUser?.role === 'super_admin' ||
      currentUser?.role === 'admin' ||
      currentUser?.role === 'manager');

  const [showCityManager, setShowCityManager] = useState(false);
  const [citySetupProvinceFilter, setCitySetupProvinceFilter] = useState<string>('ALL');
  const [citySetupSearch, setCitySetupSearch] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newCityProvince, setNewCityProvince] = useState<string>('Azad Kashmir (AJK)');
  const [newCityFee, setNewCityFee] = useState('');
  const [includeDeliveryForPosFull, setIncludeDeliveryForPosFull] = useState(false);
  const isAuthenticatedCustomer =
    currentUser?.isAuthenticated === true && Boolean(currentUser.customerId);

  const matchedLoggedCustomer = isAuthenticatedCustomer
    ? customers.find(
        (c) =>
          c.id === currentUser?.customerId ||
          (currentUser?.phone &&
            c.phone.replace(/\D/g, '') === currentUser.phone.replace(/\D/g, ''))
      )
    : undefined;

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => {
    if (!isCustomerView && customers[0]?.id) {
      return customers[0].id;
    }
    if (matchedLoggedCustomer) {
      return matchedLoggedCustomer.id;
    }
    return 'new_checkout_buyer';
  });

  // Basic Checkout Form States
  const [buyerName, setBuyerName] = useState<string>(
    () => matchedLoggedCustomer?.name || (currentUser?.isAuthenticated ? currentUser.name : '') || ''
  );
  const [buyerPhone, setBuyerPhone] = useState<string>(
    () => matchedLoggedCustomer?.phone || (currentUser?.isAuthenticated ? currentUser.phone || '' : '') || ''
  );
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState<boolean>(
    () => matchedLoggedCustomer?.whatsappSameAsPhone ?? currentUser?.whatsappSameAsPhone ?? true
  );
  const [buyerWhatsapp, setBuyerWhatsapp] = useState<string>(
    () =>
      matchedLoggedCustomer?.whatsapp ||
      (currentUser?.isAuthenticated ? currentUser.whatsapp || currentUser.phone || '' : '') ||
      ''
  );
  const [buyerCity, setBuyerCity] = useState<string>(defaultActiveCity);
  const [buyerArea, setBuyerArea] = useState<string>(() => {
    if (matchedLoggedCustomer?.area) return matchedLoggedCustomer.area;
    return isMuzaffarabadCity(defaultActiveCity) ? 'City Center' : '';
  });
  const [buyerMohalla, setBuyerMohalla] = useState<string>(() => matchedLoggedCustomer?.mohalla || '');
  const [buyerLandmark, setBuyerLandmark] = useState<string>(() => matchedLoggedCustomer?.landmark || '');
  const [buyerAddress, setBuyerAddress] = useState<string>(
    () => matchedLoggedCustomer?.address || matchedLoggedCustomer?.area || ''
  );
  const [notes, setNotes] = useState<string>('');
  const [resellerCode, setResellerCode] = useState<string>('');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);
  const [confirmedCheckout, setConfirmedCheckout] = useState<{
    order: CheckoutOrderSummary;
    guestClaimToken?: string;
    whatsappNotification?: WhatsAppNotificationStatus;
  } | null>(null);
  const [copiedOrderNo, setCopiedOrderNo] = useState(false);

  const isCreditAuthorizedSeller =
    !isCustomerView &&
    Boolean(
      currentUser?.isAuthenticated &&
        (currentUser.role === 'super_admin' ||
          currentUser.role === 'admin' ||
          ((currentUser.role === 'manager' || currentUser.role === 'staff') &&
            (currentUser.canAuthorizeCreditSale ||
              currentUser.managerAuthorities?.canAuthorizeCreditSale)))
    );

  // Payment States (Customers/Guests: COD or Full Payment only. Credit Sale ONLY for authorized sellers.)
  const [saleType, setSaleType] = useState<SalePaymentType>(isCustomerView ? 'cod' : 'full');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(isCustomerView ? 'cod' : 'easypaisa');
  const [creditTermsDays, setCreditTermsDays] = useState<number>(7);
  const [creditDueDate, setCreditDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [formError, setFormError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync POS selection into basic checkout form
  useEffect(() => {
    if (!isOpen) {
      setConfirmedCheckout(null);
      setCopiedOrderNo(false);
      return;
    }
    setFormError('');
    if (isCustomerView || !isCreditAuthorizedSeller) {
      if (saleType === 'time_credit' || saleType === 'partial') {
        setSaleType(isCustomerView ? 'cod' : 'full');
      }
    }
    const resolvePreferredCityAndArea = (candidateCity?: string, candidateArea?: string) => {
      if (hasExpressInCart) {
        const check = resolveExpressAreaAvailability(cityConfigs, candidateCity, candidateArea, true);
        if (check.allowed && candidateCity) {
          return { city: candidateCity, area: candidateArea || '' };
        }
        if (check.cityUnlocked && candidateCity) {
          const cityObj = cityConfigs.find(
            (c) => c.name.toLowerCase() === candidateCity.toLowerCase()
          );
          const firstUnlockedArea = (cityObj?.areas || []).find((a) => a.allowed)?.name || '';
          return { city: candidateCity, area: firstUnlockedArea };
        }
        return { city: expressFallback.city, area: expressFallback.area };
      }

      if (candidateCity && cityConfigs.some((c) => c.name.toLowerCase() === candidateCity.toLowerCase())) {
        const cityObj = cityConfigs.find(
          (c) => c.name.toLowerCase() === candidateCity.toLowerCase()
        );
        return {
          city: cityObj?.name || candidateCity,
          area:
            candidateArea ||
            cityObj?.areas?.[0]?.name ||
            (isMuzaffarabadCity(candidateCity) ? 'City Center' : ''),
        };
      }
      return { city: defaultActiveCity, area: defaultActiveArea };
    };

    if (isCustomerView) {
      if (matchedLoggedCustomer) {
        setSelectedCustomerId(matchedLoggedCustomer.id);
        setBuyerName(matchedLoggedCustomer.name || '');
        setBuyerPhone(matchedLoggedCustomer.phone || '');
        const same = matchedLoggedCustomer.whatsappSameAsPhone ?? true;
        setWhatsappSameAsPhone(same);
        setBuyerWhatsapp(matchedLoggedCustomer.whatsapp || matchedLoggedCustomer.phone || '');
        const resolvedLoc = resolvePreferredCityAndArea(
          matchedLoggedCustomer.city,
          matchedLoggedCustomer.area
        );
        setBuyerCity(resolvedLoc.city);
        setBuyerArea(resolvedLoc.area);
        setBuyerMohalla(matchedLoggedCustomer.mohalla || '');
        setBuyerLandmark(matchedLoggedCustomer.landmark || '');
        setBuyerAddress(matchedLoggedCustomer.address || matchedLoggedCustomer.area || '');
      } else {
        setSelectedCustomerId('new_checkout_buyer');
        if (currentUser?.isAuthenticated) {
          setBuyerName(currentUser.name || '');
          setBuyerPhone(currentUser.phone || '');
          setWhatsappSameAsPhone(currentUser.whatsappSameAsPhone ?? true);
          setBuyerWhatsapp(currentUser.whatsapp || currentUser.phone || '');
        }
        setBuyerCity(defaultActiveCity);
        setBuyerArea(defaultActiveArea);
      }
    } else if (selectedCustomerId && selectedCustomerId !== 'new_checkout_buyer') {
      const cust = customers.find((c) => c.id === selectedCustomerId);
      if (cust) {
        setBuyerName(cust.name || '');
        setBuyerPhone(cust.phone || '');
        setWhatsappSameAsPhone(cust.whatsappSameAsPhone ?? true);
        setBuyerWhatsapp(cust.whatsapp || cust.phone || '');
        const resolvedLoc = resolvePreferredCityAndArea(cust.city, cust.area);
        setBuyerCity(resolvedLoc.city);
        setBuyerArea(resolvedLoc.area);
        setBuyerMohalla(cust.mohalla || '');
        setBuyerLandmark(cust.landmark || '');
        setBuyerAddress(cust.address || cust.area || '');
      }
    } else {
      setBuyerCity(defaultActiveCity);
      setBuyerArea(defaultActiveArea);
    }
  }, [isOpen, isCustomerView, isCreditAuthorizedSeller, selectedCustomerId, matchedLoggedCustomer, currentUser, customers, hasExpressInCart]);

  if (!isOpen) return null;

  const supportPhone = profile.phone || '03125256266';

  if (confirmedCheckout) {
    const ord = confirmedCheckout.order;
    const waStatus = confirmedCheckout.whatsappNotification;
    const currency = profile.currencySymbol || 'Rs.';
    const isGuestUser = currentUser?.isAuthenticated !== true;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl my-6 max-h-[92vh] flex flex-col">
          <div className="bg-emerald-600 px-4 py-3.5 flex items-center justify-between text-white shrink-0">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <h2 className="text-base font-extrabold tracking-tight leading-tight">
                  Order Placed Successfully!
                </h2>
                <span className="text-[11px] font-semibold text-emerald-100 block">
                  آپ کا آرڈر درج ہو گیا ہے · Thank you, {ord.customerName}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfirmedCheckout(null);
                onClose();
              }}
              aria-label="Close confirmation dialog"
              className="p-1 text-emerald-100 hover:text-white rounded-lg hover:bg-emerald-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto text-xs">
            {/* Order # & Tracking Summary */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Order Number:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                    #{ord.orderNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(ord.orderNumber);
                      setCopiedOrderNo(true);
                      setTimeout(() => setCopiedOrderNo(false), 1800);
                    }}
                    className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedOrderNo ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedOrderNo ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {ord.trackingNumber && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">Courier Tracking ID:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {ord.trackingNumber}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Total Payable:</span>
                <span className="font-mono font-black text-sm tabular-nums text-amber-700 dark:text-amber-300">
                  {currency}{Number(ord.totalAmount || 0).toLocaleString('en-PK')}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Delivering To:</span>
                <span className="text-right font-semibold text-slate-800 dark:text-slate-200 max-w-[260px]">
                  {ord.address}, {ord.city}{ord.area ? ` (${ord.area})` : ''}
                </span>
              </div>
            </div>

            {/* Truthful WhatsApp Confirmation Box */}
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2.5">
              <div className="flex items-start gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-extrabold text-emerald-900 dark:text-emerald-200">
                    {waStatus?.automatedSent
                      ? `WhatsApp Confirmation Sent to ${ord.whatsapp}`
                      : 'WhatsApp Order Confirmation'}
                  </div>
                  <p className="text-[11px] text-emerald-800/90 dark:text-emerald-200/80 leading-relaxed">
                    {waStatus?.automatedSent
                      ? `An automated confirmation was dispatched to ${ord.whatsapp}. You can also open your WhatsApp receipt below.`
                      : waStatus?.error
                      ? `${waStatus.error} Tap below to open your confirmation directly on WhatsApp (${ord.whatsapp}).`
                      : `Open your instant order confirmation receipt on WhatsApp (${ord.whatsapp || ord.phone}) or message Customer Support anytime.`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openWhatsAppDirect(
                      ord.whatsapp || ord.phone,
                      buildGuestOrderWhatsAppConfirmation(ord, profile)
                    )
                  }
                  className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Open WhatsApp Receipt</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ordNo = ord.orderNumber;
                    const ph = ord.whatsapp || ord.phone;
                    setConfirmedCheckout(null);
                    onClose();
                    onOpenTrackOrder?.(ordNo, ph);
                  }}
                  className="py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-[#FFD200] dark:hover:bg-amber-400 text-white dark:text-slate-950 font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>Track Order</span>
                </button>
              </div>
            </div>

            {/* Optional Account Registration Offer (Strictly Optional for Guests) */}
            {isGuestUser && onOpenOptionalRegister && (
              <div className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-white text-xs">
                      Save Address &amp; Order History? (Optional)
                    </h3>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                      No account is needed to buy or track orders. Create an optional customer account to save delivery addresses and view past orders anytime.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const prefill: GuestRegistrationPrefill = {
                      fullName: ord.customerName,
                      phone: ord.phone,
                      whatsapp: ord.whatsapp,
                      whatsappSameAsPhone: ord.whatsappSameAsPhone ?? true,
                      city: ord.city,
                      address: ord.address,
                      guestClaimToken: confirmedCheckout.guestClaimToken,
                      orderNumber: ord.orderNumber,
                    };
                    setConfirmedCheckout(null);
                    onClose();
                    onOpenOptionalRegister(prefill);
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-[#FFD200] hover:bg-amber-400 text-slate-950 font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Create Optional Customer Account</span>
                </button>
              </div>
            )}

            {/* Support Alternative Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() =>
                  openWhatsAppDirect(
                    supportPhone,
                    buildOrderSupportWhatsAppMessage(ord.orderNumber, ord.whatsapp || ord.phone, profile)
                  )
                }
                className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Phone className="w-3 h-3" />
                <span>Customer Support ({supportPhone})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmedCheckout(null);
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold whitespace-nowrap cursor-pointer"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
          <div className="bg-[#FFD200] px-4 py-3 flex items-center justify-between text-slate-900">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              <h2 className="text-base font-extrabold tracking-tight">Shopping Cart</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-800 hover:text-black rounded-lg hover:bg-amber-400/50 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Your Cart is Empty
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                آپ کی ٹوکری خالی ہے — Add products from the store catalog to place a Cash on Delivery or online order.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-xs cursor-pointer"
            >
              Browse Store Catalog
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Cart totals & dynamic city/area delivery fee
  const totalMarketPrice = cart.reduce((acc, it) => acc + it.marketPrice * it.quantity, 0);
  const totalOurPrice = cart.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
  const totalSavings = totalMarketPrice - totalOurPrice;
  const savingsPercent = totalMarketPrice > 0 ? Math.round((totalSavings / totalMarketPrice) * 100) : 0;

  const activeBuyerCity = hasExpressInCart
    ? allowedCities.some((c) => c.name === buyerCity)
      ? buyerCity
      : defaultActiveCity
    : buyerCity || defaultActiveCity;
  const currentLocationCheck = resolveExpressAreaAvailability(
    cityConfigs,
    activeBuyerCity,
    buyerArea,
    hasExpressInCart
  );
  const resolvedDelivery = resolveProductOrCartDeliveryCharge(
    cityConfigs,
    cart,
    activeBuyerCity,
    buyerArea,
    profile.defaultCityCenterDeliveryCharge ?? DEFAULT_CITY_CENTER_DELIVERY_CHARGE
  );
  const shouldApplyDeliveryFee =
    saleType === 'cod' ||
    (isCustomerView && paymentMode !== 'cash') ||
    (!isCustomerView && saleType === 'full' && includeDeliveryForPosFull);
  const deliveryFee = shouldApplyDeliveryFee ? resolvedDelivery.charge : 0;
  const grandTotal = totalOurPrice + deliveryFee;

  const todayStr = new Date().toISOString().split('T')[0];

  const computeOffsetDate = (baseDateStr: string, offsetDays: number): string => {
    const d = new Date(baseDateStr || todayStr);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  };

  const softReminderPreviewDate = computeOffsetDate(creditDueDate, -3);
  const maxGracePreviewDate = computeOffsetDate(creditDueDate, 7);

  const otherCities = cityConfigs.filter((c) => !isMuzaffarabadCity(c.name));
  const otherCitiesOn = otherCities.some((c) => c.allowed);

  const handleToggleCityAllowed = (cityName: string) => {
    if (!onSaveProfile) return;
    if (isMuzaffarabadCity(cityName)) return; // Muzaffarabad stays active
    const target = cityConfigs.find((c) => c.name === cityName);
    const updatedCities = cityConfigs.map((c) =>
      c.name === cityName ? { ...c, allowed: !c.allowed } : c
    );
    onSaveProfile({ ...profile, deliveryCities: updatedCities });
    if (target) {
      void apiUpdateCity(target.id || target.name, { allowed: !target.allowed });
    }
    const nextAllowed = updatedCities.filter((c) => c.allowed);
    if (!nextAllowed.some((c) => c.name === buyerCity)) {
      const nextCity =
        nextAllowed.find((c) => isMuzaffarabadCity(c.name))?.name || nextAllowed[0]?.name || '';
      setBuyerCity(nextCity);
      setBuyerArea(isMuzaffarabadCity(nextCity) ? 'City Center' : '');
    }
  };

  const handleDeleteCityInCheckout = async (city: DeliveryCityConfig) => {
    if (!onSaveProfile || isMuzaffarabadCity(city.name)) return;
    const updatedCities = cityConfigs.filter(
      (c) => (c.id || c.name) !== (city.id || city.name)
    );
    onSaveProfile({ ...profile, deliveryCities: updatedCities });
    if (buyerCity.toLowerCase() === city.name.toLowerCase()) {
      setBuyerCity(defaultActiveCity);
      setBuyerArea(defaultActiveArea);
    }
    await apiDeleteCity(city.id || city.name);
  };

  const handleToggleOtherCitiesInCheckout = async (allowOther: boolean) => {
    if (!onSaveProfile) return;
    const updatedCities = cityConfigs.map((c) =>
      isMuzaffarabadCity(c.name) ? { ...c, allowed: true } : { ...c, allowed: allowOther }
    );
    onSaveProfile({ ...profile, deliveryCities: updatedCities });
    if (!allowOther && !isMuzaffarabadCity(buyerCity)) {
      setBuyerCity('Muzaffarabad');
      setBuyerArea('City Center');
    }
    await apiToggleOtherCities(allowOther);
  };

  const handleQuickCityChargeChange = (cityName: string, rawVal: string) => {
    if (!onSaveProfile) return;
    const trimmed = rawVal.trim();
    const numeric = trimmed === '' ? undefined : Math.max(0, Math.round(Number(trimmed) || 0));
    const updatedCities = cityConfigs.map((c) =>
      c.name === cityName ? { ...c, deliveryCharge: numeric } : c
    );
    onSaveProfile({ ...profile, deliveryCities: updatedCities });
    const target = cityConfigs.find((c) => c.name === cityName);
    if (target?.id || target?.name) {
      void apiUpdateCity(target.id || target.name, { deliveryCharge: numeric ?? null });
    }
  };

  const handleResetCities = () => {
    if (!onSaveProfile) return;
    const freshCities = ensureCityAreasShape(defaultDeliveryCities);
    onSaveProfile({
      ...profile,
      defaultCityCenterDeliveryCharge: DEFAULT_CITY_CENTER_DELIVERY_CHARGE,
      deliveryCities: freshCities,
    });
    setBuyerCity('Muzaffarabad');
    setBuyerArea('City Center');
  };

  const handleAddDeliveryCity = () => {
    if (!onSaveProfile || !newCityName.trim()) return;
    const trimmed = newCityName.trim();
    if (cityConfigs.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewCityName('');
      return;
    }
    const parsedFee =
      newCityFee.trim() !== '' && Number.isFinite(Number(newCityFee)) && Number(newCityFee) >= 0
        ? Math.round(Number(newCityFee))
        : undefined;
    const resolvedProv = newCityProvince || inferProvinceForCity(trimmed);
    const newId = `${slugifyId('city', trimmed)}_${Date.now().toString(36).slice(-4)}`;
    const updatedCities = [
      ...cityConfigs,
      {
        id: newId,
        name: trimmed,
        province: resolvedProv,
        allowed: true,
        ...(parsedFee !== undefined ? { deliveryCharge: parsedFee } : {}),
        areas: [],
      },
    ];
    onSaveProfile({ ...profile, deliveryCities: updatedCities });
    void apiAddCity(trimmed, true, parsedFee ?? null, resolvedProv);
    setBuyerCity(trimmed);
    setBuyerArea('');
    setNewCityName('');
    setNewCityFee('');
  };

  const handleSelectExistingCustomer = (val: string) => {
    setSelectedCustomerId(val);
    if (val === 'new_checkout_buyer') {
      setBuyerName('');
      setBuyerPhone('');
      setWhatsappSameAsPhone(true);
      setBuyerWhatsapp('');
      setBuyerCity(defaultActiveCity);
      setBuyerArea('');
      setBuyerMohalla('');
      setBuyerLandmark('');
      setBuyerAddress('');
    } else {
      const cust = customers.find((c) => c.id === val);
      if (cust) {
        setBuyerName(cust.name);
        setBuyerPhone(cust.phone);
        setWhatsappSameAsPhone(cust.whatsappSameAsPhone ?? true);
        setBuyerWhatsapp(cust.whatsapp || cust.phone);
        const custCityAllowed = allowedCities.some(
          (c) => c.name.toLowerCase() === (cust.city || '').toLowerCase()
        );
        setBuyerCity(custCityAllowed && cust.city ? cust.city : defaultActiveCity);
        setBuyerArea(cust.area || '');
        setBuyerMohalla(cust.mohalla || '');
        setBuyerLandmark(cust.landmark || '');
        setBuyerAddress(cust.address || cust.area || '');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError('');

    if (cart.length === 0) {
      setFormError('Your cart is empty. Please add at least one product before placing an order.');
      return;
    }

    const resolvedWhatsapp = whatsappSameAsPhone ? buyerPhone.trim() : buyerWhatsapp.trim();
    if (!buyerName.trim() || !buyerPhone.trim()) {
      setFormError('Please enter your Full Name and WhatsApp / Mobile Number to proceed with checkout.');
      return;
    }
    if (!whatsappSameAsPhone && resolvedWhatsapp.replace(/\D/g, '').length < 10) {
      setFormError('Please enter a valid WhatsApp number (at least 10 digits) for order confirmation.');
      return;
    }

    if (hasExpressInCart && allowedCities.length === 0) {
      setFormError('No Express delivery cities are currently unlocked. Please ask store admin to enable Express cities & sub-cities.');
      return;
    }

    const submitAvail = resolveExpressAreaAvailability(
      cityConfigs,
      activeBuyerCity,
      buyerArea,
      hasExpressInCart
    );
    if (!submitAvail.allowed) {
      setFormError(
        submitAvail.reason ||
          'Selected city or sub-city is locked for Express delivery. Please choose a manually unlocked city & sub-city.'
      );
      return;
    }

    if ((saleType === 'cod' || isCustomerView) && !buyerAddress.trim()) {
      setFormError('Please enter your complete Delivery Address.');
      return;
    }

    const effectiveSaleType: SalePaymentType =
      saleType === 'time_credit' && isCreditAuthorizedSeller ? 'time_credit' : saleType === 'cod' ? 'cod' : 'full';

    setIsSubmitting(true);
    try {
      const result = await onCompleteSale({
        customerId: selectedCustomerId,
        buyerDetails: {
          name: buyerName.trim(),
          phone: buyerPhone.trim(),
          whatsapp: resolvedWhatsapp || buyerPhone.trim(),
          whatsappSameAsPhone,
          city: buyerCity.trim() || defaultActiveCity,
          area: buyerArea.trim() || undefined,
          mohalla: buyerMohalla.trim() || undefined,
          landmark: buyerLandmark.trim() || undefined,
          address: buyerAddress.trim() || 'Counter Pickup / Direct Delivery',
        },
        saleType: effectiveSaleType,
        paidAmount: effectiveSaleType === 'full' ? grandTotal : 0,
        dueBalance: effectiveSaleType === 'time_credit' ? totalOurPrice : 0,
        deliveryFee,
        paymentMode: effectiveSaleType === 'cod' ? 'cod' : effectiveSaleType === 'time_credit' ? 'other' : paymentMode,
        paymentTermsDays: effectiveSaleType === 'time_credit' ? creditTermsDays : 0,
        dueDate: effectiveSaleType === 'time_credit' ? creditDueDate : todayStr,
        notes:
          notes.trim() ||
          `Order: ${cart.map((c) => `${c.product.name} (${c.quantity}x)`).join(', ')}`,
        sendWhatsApp,
        resellerCode: resellerCode.trim() || undefined,
      });

      if (result && result.ok === false) {
        setFormError(result.error || 'Order could not be placed. Please check your details and try again.');
      } else if (result && result.ok && result.order) {
        setConfirmedCheckout({
          order: result.order,
          guestClaimToken: result.guestClaimToken,
          whatsappNotification: result.whatsappNotification,
        });
      } else {
        onClose();
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unexpected error while submitting your order.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#FFD200] px-4 py-3 flex items-center justify-between text-slate-900 shrink-0">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5" />
            <div>
              <h2 className="text-base font-extrabold tracking-tight">
                {isCustomerView && !currentUser?.isAuthenticated
                  ? 'Checkout as Guest'
                  : 'Checkout & Order Confirmation'}
              </h2>
              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                100DAGAR · WE BUY WE SELL |{' '}
                {isCustomerView
                  ? currentUser?.isAuthenticated
                    ? 'Customer Checkout'
                    : 'No Sign-In Required'
                  : 'POS Terminal'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-800 hover:text-black rounded-lg hover:bg-amber-400/50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5 text-xs overflow-y-auto">
          {formError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          {/* 1. POS Customer Quick Lookup (Only shown to Admin/Manager/Staff) */}
          {!isCustomerView && (
            <div className="space-y-1.5">
              <label className="font-bold text-slate-800 dark:text-slate-200 block">
                Select Existing Customer or Enter New Buyer Below
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => handleSelectExistingCustomer(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
              >
                <option value="new_checkout_buyer">+ New Buyer / Walk-in Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.urduName ? `(${c.urduName})` : ''} - {c.phone} [{c.city || 'Lahore'}]
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 2. BASIC CHECKOUT FORM (Name, WhatsApp/Mobile, City, Delivery Address, Notes) */}
          <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
              <h3 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 text-xs">
                <User className="w-4 h-4 text-amber-500" />
                <span>Name, WhatsApp &amp; Delivery Details (بنیادی آرڈر فارم)</span>
              </h3>
              <span className="text-[10px] font-semibold text-slate-500">Required *</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="e.g. Muhammad Ali"
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  WhatsApp / Mobile Number *
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="0300 1234567"
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Dedicated WhatsApp confirmation toggle / secondary number */}
            <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={whatsappSameAsPhone}
                  onChange={(e) => {
                    setWhatsappSameAsPhone(e.target.checked);
                    if (e.target.checked) setBuyerWhatsapp('');
                  }}
                  className="w-3.5 h-3.5 rounded text-emerald-600 cursor-pointer"
                />
                <span>Receive WhatsApp order confirmation on this same number</span>
              </label>
              {!whatsappSameAsPhone && (
                <div className="relative">
                  <MessageCircle className="w-3.5 h-3.5 absolute left-3 top-2.5 text-emerald-600" />
                  <input
                    type="tel"
                    required
                    value={buyerWhatsapp}
                    onChange={(e) => setBuyerWhatsapp(e.target.value)}
                    placeholder="Enter separate WhatsApp number (03xx xxxxxxx)"
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                {hasExpressInCart ? (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>
                      Express Mode: {allowedCities.length} unlocked {allowedCities.length === 1 ? 'city' : 'cities'} &amp; selected sub-cities only (others locked)
                    </span>
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold">
                    Open across all Provinces &amp; Kashmir ({cityConfigs.length} cities, sub-cities &amp; villages) · Standard 3–6 working days promised
                  </span>
                )}
                {canManageCities && (
                  <button
                    type="button"
                    onClick={() => setShowCityManager(!showCityManager)}
                    className="text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5 cursor-pointer shrink-0"
                  >
                    <Settings2 className="w-3 h-3" />
                    <span>{showCityManager ? 'Hide Cities' : 'Cities Setup'}</span>
                  </button>
                )}
              </div>

              {cityConfigs.length > 0 ? (
                <div className="space-y-2.5">
                  <AddressFieldsGroup
                    cities={cityConfigs}
                    city={activeBuyerCity}
                    area={buyerArea}
                    mohalla={buyerMohalla}
                    landmark={buyerLandmark}
                    address={buyerAddress}
                    filterActiveCitiesOnly={false}
                    deliveryMode={checkoutDeliveryMode}
                    showCompleteAddress={true}
                    required={saleType === 'cod'}
                    compact={true}
                    onChange={(patch) => {
                      if (patch.city !== undefined) setBuyerCity(patch.city);
                      if (patch.area !== undefined) setBuyerArea(patch.area);
                      if (patch.mohalla !== undefined) setBuyerMohalla(patch.mohalla);
                      if (patch.landmark !== undefined) setBuyerLandmark(patch.landmark);
                      if (patch.address !== undefined) setBuyerAddress(patch.address);
                    }}
                  />

                  {hasExpressInCart && !currentLocationCheck.allowed && (
                    <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-[11px] font-semibold text-rose-800 dark:text-rose-200 flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>{currentLocationCheck.reason}</span>
                    </div>
                  )}

                  {/* Live Customer Visibility Banner for Delivery Charges */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-[11px]">
                    <div className="flex items-center gap-1.5 text-amber-950 dark:text-amber-200 font-semibold">
                      <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        Delivery Charges for <b>{resolvedDelivery.label}</b>:
                      </span>
                    </div>
                    {resolvedDelivery.isFree ? (
                      <span className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700">
                        FREE (Rs. 0)
                      </span>
                    ) : (
                      <span className="font-mono font-black text-xs text-slate-900 dark:text-white bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                        {profile.currencySymbol}{resolvedDelivery.charge.toLocaleString('en-PK')}
                      </span>
                    )}
                  </div>

                  {!isCustomerView && saleType === 'full' && (
                    <label className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeDeliveryForPosFull}
                        onChange={(e) => setIncludeDeliveryForPosFull(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-amber-500 cursor-pointer"
                      />
                      <span>
                        Add Home Delivery Charges ({profile.currencySymbol}{resolvedDelivery.charge}) to this POS invoice
                      </span>
                    </label>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 text-[11px] font-semibold">
                  Delivery paused for all cities. Please enable at least one city in settings.
                </div>
              )}
            </div>

            {/* Admin / Manager City Checkmark Allow/Disallow, Other Cities ON/OFF & City Fee Setup */}
            {canManageCities && showCityManager && (
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white text-[11px] block">
                      Express Delivery Cities &amp; Fees (Unlock Cities / Enter Rs. Fee)
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Locked cities &amp; sub-cities stay restricted 🔒 for Express items. Standard delivery (3–6 working days promised) stays open across all provinces, Kashmir, cities &amp; villages.
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleToggleOtherCitiesInCheckout(!otherCitiesOn)}
                      className={`px-2 py-1 rounded-lg font-bold text-[10px] cursor-pointer ${
                        otherCitiesOn
                          ? 'bg-emerald-600 text-white'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200'
                      }`}
                    >
                      Other Cities: {otherCitiesOn ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetCities}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-200 font-bold text-[10px] cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* Quick Province Filter & Search */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <select
                    value={citySetupProvinceFilter}
                    onChange={(e) => setCitySetupProvinceFilter(e.target.value)}
                    className="px-2 py-1 text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="ALL">All Provinces &amp; Kashmir ({cityConfigs.length})</option>
                    {getOrderedProvincesFromCities(cityConfigs).map((prov) => (
                      <option key={prov} value={prov}>
                        {prov}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={citySetupSearch}
                    onChange={(e) => setCitySetupSearch(e.target.value)}
                    placeholder="Filter cities / villages..."
                    className="px-2.5 py-1 text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {cityConfigs
                    .filter((c) => {
                      const prov = inferProvinceForCity(c.name, c.province);
                      if (citySetupProvinceFilter !== 'ALL' && prov !== citySetupProvinceFilter) {
                        return false;
                      }
                      const q = citySetupSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        c.name.toLowerCase().includes(q) ||
                        prov.toLowerCase().includes(q) ||
                        (c.areas || []).some((a) => a.name.toLowerCase().includes(q))
                      );
                    })
                    .map((c) => {
                      const isMzd = isMuzaffarabadCity(c.name);
                      const provLabel = inferProvinceForCity(c.name, c.province);
                      return (
                        <div
                          key={c.id || c.name}
                          className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] ${
                            isMzd || c.allowed
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 font-semibold'
                              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400'
                          }`}
                        >
                          <label className="flex items-center gap-1.5 min-w-0 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isMzd ? true : c.allowed}
                              disabled={isMzd}
                              onChange={() => handleToggleCityAllowed(c.name)}
                              className="w-3.5 h-3.5 rounded text-emerald-600 cursor-pointer shrink-0"
                            />
                            <div className="min-w-0">
                              <span className={`truncate block ${!isMzd && !c.allowed ? 'line-through' : ''}`}>
                                {c.name}
                              </span>
                              <span className="text-[9px] text-slate-500 dark:text-slate-400 truncate block">
                                {provLabel} · {(c.areas || []).length} areas
                              </span>
                            </div>
                          </label>
                          <div className="flex items-center gap-1 shrink-0">
                            {!isMzd ? (
                              <button
                                type="button"
                                onClick={() => handleToggleCityAllowed(c.name)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                                  c.allowed
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                                }`}
                                title={c.allowed ? 'Click to Lock city' : 'Click to Allow city'}
                              >
                                {c.allowed ? 'Allowed' : 'Locked'}
                              </button>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white">
                                Default ON
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500">Rs.</span>
                            <input
                              type="number"
                              min={0}
                              value={c.deliveryCharge ?? ''}
                              placeholder={isMzd ? '50' : '250'}
                              onChange={(e) => handleQuickCityChargeChange(c.name, e.target.value)}
                              className="w-12 px-1 py-0.5 text-[10px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            />
                            {!isMzd && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteCityInCheckout(c)}
                                className="p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                                title="Remove city"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 pt-1">
                  <select
                    value={newCityProvince}
                    onChange={(e) => setNewCityProvince(e.target.value)}
                    className="sm:col-span-4 px-2 py-1.5 text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {PAKISTAN_PROVINCES.map((prov) => (
                      <option key={prov} value={prov}>
                        {prov}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newCityName}
                    onChange={(e) => setNewCityName(e.target.value)}
                    placeholder="Add new city name..."
                    className="sm:col-span-4 px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    min={0}
                    value={newCityFee}
                    onChange={(e) => setNewCityFee(e.target.value)}
                    placeholder="Fee Rs."
                    className="sm:col-span-2 px-2 py-1.5 text-[11px] font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddDeliveryCity}
                    className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold text-[11px] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Order Notes / Delivery Instructions (Optional)
              </label>
              <div className="relative">
                <FileText className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Deliver between 2 PM - 6 PM, call before arrival"
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* 3. Cart Summary & Customer Savings Banner */}
          <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white text-xs pb-2 border-b border-slate-200 dark:border-slate-700">
              <span>{cart.length} Products in Cart</span>
              <div className="flex items-center gap-2">
                {onClearCart && (
                  <button
                    type="button"
                    onClick={onClearCart}
                    className="text-[10px] font-semibold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
                <span className="font-mono">
                  {profile.currencySymbol}{totalOurPrice.toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
              {cart.map((it, idx) => {
                const itemDelivery = getProductDeliveryMeta(it.product);
                return (
                  <div
                    key={`${it.product.id}-${it.product.selectedSize || idx}`}
                    className="flex items-center justify-between text-slate-600 dark:text-slate-300 gap-2 py-0.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate max-w-[180px] font-medium text-slate-800 dark:text-slate-100">
                        {it.product.name}
                        {it.product.selectedSize ? ` (${it.product.selectedSize})` : ''}
                      </span>
                      {itemDelivery.isExpress && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800">
                          <Zap className="w-2.5 h-2.5 fill-emerald-600 text-emerald-600" />
                          <span>EXPRESS</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {onUpdateCartQty && (
                        <div className="inline-flex items-center border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateCartQty(it.product.id, it.quantity - 1, it.product.selectedSize)
                            }
                            className="px-1.5 py-0.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                            title="Decrease quantity"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <span className="px-1.5 font-mono font-bold text-[10px] text-slate-900 dark:text-white">
                            {it.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateCartQty(it.product.id, it.quantity + 1, it.product.selectedSize)
                            }
                            className="px-1.5 py-0.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                            title="Increase quantity"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 font-mono tabular-nums">
                        <span className="text-slate-400 line-through">
                          {profile.currencySymbol}
                          {(it.marketPrice * it.quantity).toLocaleString('en-PK')}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {profile.currencySymbol}
                          {(it.unitPrice * it.quantity).toLocaleString('en-PK')}
                        </span>
                      </div>
                      {onRemoveFromCart && (
                        <button
                          type="button"
                          onClick={() => onRemoveFromCart(it.product.id, it.product.selectedSize)}
                          className="p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Remove from cart"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {(() => {
              const expressCount = cart.filter((it) => getProductDeliveryMeta(it.product).isExpress).length;
              const standardCount = cart.length - expressCount;
              if (cart.length === 0) return null;
              if (standardCount === 0) {
                return (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200 font-semibold">
                    <Zap className="w-3.5 h-3.5 text-emerald-600 fill-emerald-500 shrink-0" />
                    <span>⚡ Express Delivery: Instant dispatch ONLY in manually unlocked cities &amp; sub-cities (others locked)</span>
                  </div>
                );
              }
              if (expressCount === 0) {
                return (
                  <div className="px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                    <span>
                      Standard 3 to 6 working days promised delivery · Open across all provinces, Kashmir, cities, sub-cities &amp; villages
                    </span>
                  </div>
                );
              }
              return (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-950 dark:text-amber-200 font-semibold">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Mixed Cart: {expressCount} ⚡ Express item(s) (unlocked cities &amp; sub-cities only) · {standardCount} Standard item(s) (3–6 working days promised delivery)
                  </span>
                </div>
              );
            })()}

            {(resolvedDelivery.isFree || deliveryFee > 0) && (
              <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-200 pt-1">
                <span>Delivery Charges ({resolvedDelivery.label}):</span>
                {resolvedDelivery.isFree ? (
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    FREE (Rs. 0)
                  </span>
                ) : (
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                    +{profile.currencySymbol}{deliveryFee.toLocaleString('en-PK')}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-sm font-black text-slate-900 dark:text-white pt-1.5 border-t border-slate-200 dark:border-slate-700">
              <span>Total Payable Amount:</span>
              <span className="font-mono text-base tabular-nums">
                {profile.currencySymbol}{grandTotal.toLocaleString('en-PK')}
              </span>
            </div>

            {/* Total Customer Savings Highlight */}
            {totalSavings > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 px-3 py-1.5 rounded-lg font-bold">
                <div className="flex items-center gap-1.5">
                  <Percent className="w-4 h-4 text-emerald-600" />
                  <span>Total Customer Savings (کسٹمر بچت):</span>
                </div>
                <span className="font-mono text-sm">
                  {profile.currencySymbol}{totalSavings.toLocaleString('en-PK')} ({savingsPercent}% OFF)
                </span>
              </div>
            )}
          </div>

          {/* 4. Payment Mode (Customers/Guests: COD or Full Payment only. Credit Sale ONLY for authorized seller roles) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label className="font-bold text-slate-800 dark:text-slate-200 block">
                Select Payment Method (ادائیگی کا طریقہ منتخب کریں)
              </label>
              {isCreditAuthorizedSeller && (
                <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 rounded">
                  Authorized Credit Seller: {currentUser?.name}
                </span>
              )}
            </div>

            <div className={`grid grid-cols-1 ${isCreditAuthorizedSeller ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
              {/* Cash on Delivery (COD) */}
              <button
                type="button"
                onClick={() => {
                  setSaleType('cod');
                  setPaymentMode('cod');
                }}
                className={`py-3 px-3 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                  saleType === 'cod'
                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 ring-2 ring-rose-400'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span className="text-sm block">Cash on Delivery (COD)</span>
                <span className="block text-[11px] font-normal mt-0.5">
                  پارسل وصول کرتے وقت نقد ادائیگی کریں
                </span>
              </button>

              {/* Full Payment (Online / Advance / Cash) */}
              <button
                type="button"
                onClick={() => {
                  setSaleType('full');
                  if (paymentMode === 'cod') setPaymentMode('easypaisa');
                }}
                className={`py-3 px-3 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                  saleType === 'full'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 ring-2 ring-emerald-400'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span className="text-sm block">Full Payment (Instant Paid)</span>
                <span className="block text-[11px] font-normal mt-0.5">
                  مکمل آن لائن یا نقد ادائیگی
                </span>
              </button>

              {/* Seller Credit Sale (Strictly ONLY visible to authorized seller roles) */}
              {isCreditAuthorizedSeller && (
                <button
                  type="button"
                  onClick={() => {
                    setSaleType('time_credit');
                    setPaymentMode('other');
                  }}
                  className={`py-3 px-3 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                    saleType === 'time_credit'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 ring-2 ring-amber-400'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="text-sm block">Credit Sale (ادھار فروخت)</span>
                  <span className="block text-[11px] font-normal mt-0.5">
                    مجاز سیلر اتھارٹی · 3-Day Alert Cycle
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Seller Credit Authorization & 3-Stage Reminder Cycle Configuration */}
          {saleType === 'time_credit' && isCreditAuthorizedSeller && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl space-y-3 text-xs">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-extrabold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-amber-600" />
                  Authorized Seller Credit Terms &amp; Reminder Schedule
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-100">
                  Role Authorized: {currentUser?.role?.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Quick Credit Term:
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[7, 14, 30].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => {
                          setCreditTermsDays(days);
                          setCreditDueDate(computeOffsetDate(todayStr, days));
                        }}
                        className={`px-2.5 py-1.5 rounded-lg font-bold border cursor-pointer ${
                          creditTermsDays === days
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {days} Days
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Payment Due Date:
                  </label>
                  <input
                    type="date"
                    min={todayStr}
                    value={creditDueDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCreditDueDate(val);
                      const diff = Math.max(
                        1,
                        Math.round(
                          (new Date(val).getTime() - new Date(todayStr).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      );
                      setCreditTermsDays(diff);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="bg-white/80 dark:bg-slate-900/60 p-3 rounded-lg border border-amber-200 dark:border-amber-800/80 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                <div className="font-bold text-amber-900 dark:text-amber-300">
                  Automated 3-Stage Collection Cycle:
                </div>
                <div>• Soft reminder before 3 days: <span className="font-mono font-bold">{softReminderPreviewDate}</span></div>
                <div>• Due date payment alert (1 week max grace): <span className="font-mono font-bold">{creditDueDate}</span> (Grace ends <span className="font-mono">{maxGracePreviewDate}</span>)</div>
                <div>• Overdue reminder every 3 days until settled</div>
              </div>
            </div>
          )}

          {/* COD Policy Notice */}
          {saleType === 'cod' && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl space-y-1 text-xs">
              <span className="font-bold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-rose-600" /> Cash on Delivery (COD) Confirmation:
              </span>
              <p className="text-slate-700 dark:text-slate-300 text-[11px] leading-relaxed">
                Pay cash directly to the courier rider upon parcel delivery: <b>Rs. {grandTotal.toLocaleString('en-PK')}</b> (includes Rs. {deliveryFee} shipping).
              </p>
            </div>
          )}

          {/* Payment Channel Selector when Full Payment is chosen */}
          {saleType === 'full' && (
            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Select Payment Channel
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden cursor-pointer"
                >
                  <option value="easypaisa">EasyPaisa</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="sadapay">SadaPay</option>
                  <option value="bank_transfer">Meezan Bank Ltd (Islamic Banking)</option>
                  <option value="cash">Counter Cash (دکان پر نقد ادائیگی)</option>
                </select>
              </div>

              {(paymentMode === 'easypaisa' || paymentMode === 'jazzcash' || paymentMode === 'sadapay') && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl p-3.5 space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      Unified Mobile Wallet (EasyPaisa · JazzCash · SadaPay)
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-md">
                      ایک ہی نمبر برائے تمام ادائیگیاں
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                    <div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-urdu">
                        اکاؤنٹ نمبر برائے ایزی پیسہ، جاز کیش اور سادا پے:
                      </span>
                      <span className="font-mono text-base font-black text-slate-900 dark:text-white tracking-wider">
                        0312 5256 266
                      </span>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-urdu">
                        اکاؤنٹ ٹائٹل:
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        100DAGAR · Shahzad Malik
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 border-t border-amber-200 dark:border-amber-800/60 pt-1.5">
                    💡 نوٹ: رقم کی منتقلی کے بعد تصدیقی رسید / اسکرین شاٹ واٹس ایپ کر دیں۔
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Optional Reseller / Salesperson Referral Code */}
          <div className="p-3 bg-purple-50/60 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800 space-y-1">
            <label className="font-bold text-purple-900 dark:text-purple-200 block text-xs">
              Referral Code (Optional / ریفرل کوڈ):
            </label>
            <input
              type="text"
              value={resellerCode}
              onChange={(e) => setResellerCode(e.target.value)}
              placeholder="e.g. RES-100D-01 or SP-SHAHALAM-01"
              className="w-full px-3 py-1.5 rounded-lg border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono uppercase text-xs"
            />
          </div>

          {/* WhatsApp Instant Confirmation Checkbox */}
          <div className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg">
            <input
              type="checkbox"
              id="sendWhatsApp"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 cursor-pointer"
            />
            <label
              htmlFor="sendWhatsApp"
              className="text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
            >
              Send instant order confirmation via WhatsApp ({(whatsappSameAsPhone ? buyerPhone : buyerWhatsapp) || buyerPhone || 'Your WhatsApp'})
            </label>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl shadow-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isSubmitting
                  ? 'Placing Order...'
                  : `${isCustomerView && !currentUser?.isAuthenticated ? 'Place Guest Order' : 'Place Order'} (${profile.currencySymbol}${grandTotal.toLocaleString('en-PK')})`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
