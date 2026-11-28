import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  RotateCcw,
  Search,
  Truck,
  X,
} from 'lucide-react';
import type {
  BusinessProfile,
  PublicOrderTrackingResult,
  RecentGuestOrderRef,
} from '../types/index.ts';
import { apiTrackPublicOrder, getRecentGuestOrders } from '../utils/storage.ts';
import {
  buildOrderSupportWhatsAppMessage,
  openWhatsAppDirect,
} from '../utils/whatsapp.ts';

interface TrackOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: BusinessProfile;
  initialOrderNumber?: string;
  initialPhone?: string;
}

export const TrackOrderModal: React.FC<TrackOrderModalProps> = ({
  isOpen,
  onClose,
  profile,
  initialOrderNumber = '',
  initialPhone = '',
}) => {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState(initialPhone);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<PublicOrderTrackingResult | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentGuestOrderRef[]>([]);

  const supportPhone = profile.phone || '03125256266';

  const runLookup = async (targetOrderNo: string, targetPhone: string) => {
    const cleanOrd = targetOrderNo.trim();
    const cleanPh = targetPhone.trim();
    if (!cleanOrd || cleanPh.replace(/\D/g, '').length < 7) {
      setErrorMsg('Please enter both your Order / Tracking Number and your WhatsApp / Phone Number.');
      return;
    }
    setErrorMsg('');
    setIsSearching(true);
    const res = await apiTrackPublicOrder(cleanOrd, cleanPh);
    setIsSearching(false);
    if (!res.ok || !res.order) {
      setTrackedOrder(null);
      setErrorMsg(
        res.error ||
          'No matching order found. Please double-check your Order # and WhatsApp/Phone number, or contact Customer Support.'
      );
      return;
    }
    setTrackedOrder(res.order);
  };

  useEffect(() => {
    if (!isOpen) return;
    setRecentOrders(getRecentGuestOrders());
    setErrorMsg('');
    if (initialOrderNumber) {
      setOrderNumber(initialOrderNumber);
    }
    if (initialPhone) {
      setPhone(initialPhone);
    }
    if (initialOrderNumber && initialPhone) {
      void runLookup(initialOrderNumber, initialPhone);
    } else {
      setTrackedOrder(null);
    }
  }, [isOpen, initialOrderNumber, initialPhone]);

  if (!isOpen) return null;

  const currency = profile.currencySymbol || 'Rs.';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runLookup(orderNumber, phone);
  };

  const handleOpenSupport = (ordNo?: string, custPhone?: string) => {
    const msg = buildOrderSupportWhatsAppMessage(
      ordNo ?? orderNumber,
      custPhone ?? phone,
      profile
    );
    openWhatsAppDirect(supportPhone, msg);
  };

  const handleSendTrackingCopyToWhatsApp = (ord: PublicOrderTrackingResult) => {
    const lines = [
      `Order Status Update — *${profile.name || '100DAGAR'}*`,
      `Order #: *${ord.orderNumber}*`,
      ...(ord.trackingNumber ? [`Tracking ID: *${ord.trackingNumber}*`] : []),
      `Status: *${ord.statusLabel}*`,
      `Total: ${currency}${Number(ord.totalAmount || 0).toLocaleString('en-PK')}`,
      `Delivery City: ${ord.city}${ord.area ? ` (${ord.area})` : ''}`,
      `Address: ${ord.address}`,
      ``,
      `Support Helpline: ${ord.supportPhone || supportPhone}`,
    ].join('\n');
    openWhatsAppDirect(ord.whatsapp || ord.phone, lines);
  };

  const isReturned = trackedOrder?.status === 'returned';
  const stepIndex = !trackedOrder
    ? 0
    : trackedOrder.status === 'delivered' || trackedOrder.status === 'completed'
    ? 3
    : trackedOrder.status === 'dispatched'
    ? 2
    : 1;

  const steps =
    trackedOrder?.orderKind === 'prepaid'
      ? [
          { key: 'placed', label: 'Order Placed', icon: Package },
          { key: 'confirmed', label: 'Payment Recorded', icon: CheckCircle2 },
          { key: 'dispatch', label: 'Fulfillment', icon: Truck },
        ]
      : [
          { key: 'placed', label: 'Order Placed', icon: Package },
          { key: 'dispatched', label: 'Dispatched', icon: Truck },
          { key: 'delivered', label: isReturned ? 'Returned' : 'Delivered', icon: isReturned ? RotateCcw : CheckCircle2 },
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#FFD200] px-4 py-3 flex items-center justify-between text-slate-900 shrink-0">
          <div className="flex items-center gap-2.5">
            <Truck className="w-5 h-5" />
            <div>
              <h2 className="text-base font-extrabold tracking-tight leading-tight">
                Track Your Order (آرڈر ٹریک کریں)
              </h2>
              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                No Sign-In Required · Guest &amp; Customer Order Lookup
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close track order modal"
            className="p-1 text-slate-800 hover:text-black rounded-lg hover:bg-amber-400/50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto text-xs">
          {/* Lookup Form */}
          <form onSubmit={handleSubmit} className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Order # or Tracking # *
                </label>
                <input
                  type="text"
                  required
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="e.g. COD-100D-482 or INV-100D-1024"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono uppercase focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  WhatsApp / Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0300 1234567"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Enter the Order # and WhatsApp/Phone used at checkout.
              </span>
              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#FFD200] dark:hover:bg-amber-400 text-white dark:text-slate-950 font-bold rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{isSearching ? 'Checking...' : 'Track Order'}</span>
              </button>
            </div>
          </form>

          {/* Recent Orders on This Device */}
          {recentOrders.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span>Recent Orders Placed on This Device</span>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recentOrders.slice(0, 4).map((ref) => (
                  <button
                    key={ref.orderNumber}
                    type="button"
                    onClick={() => {
                      setOrderNumber(ref.orderNumber);
                      setPhone(ref.whatsapp || ref.phone);
                      void runLookup(ref.orderNumber, ref.whatsapp || ref.phone);
                    }}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-400 text-left transition-colors cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-slate-900 dark:text-white truncate">
                        #{ref.orderNumber}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {ref.customerName} · {new Date(ref.createdAt).toLocaleDateString('en-PK')}
                      </div>
                    </div>
                    <span className="font-mono font-bold tabular-nums text-amber-700 dark:text-amber-300 shrink-0">
                      {currency}{Number(ref.totalAmount || 0).toLocaleString('en-PK')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error + Customer Support Fallback */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 space-y-2.5">
              <div className="flex items-start gap-2 text-red-800 dark:text-red-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenSupport(orderNumber, phone)}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Contact Customer Support on WhatsApp ({supportPhone})</span>
              </button>
            </div>
          )}

          {/* Order Result Card */}
          {trackedOrder && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
              {/* Top Status Summary */}
              <div className="px-4 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
                    Order #{trackedOrder.orderNumber}
                    {trackedOrder.trackingNumber ? ` · Tracking: ${trackedOrder.trackingNumber}` : ''}
                  </div>
                  <div className="text-sm font-extrabold text-[#FFD200] mt-0.5">
                    {trackedOrder.statusLabel}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 font-mono font-bold text-[11px] text-slate-100">
                  {trackedOrder.courierPartner || (trackedOrder.orderKind === 'prepaid' ? 'Prepaid Order' : 'WASAL delivery')}
                </span>
              </div>

              {/* 3-Step Visual Progress */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60">
                <div className="grid grid-cols-3 gap-2">
                  {steps.map((st, idx) => {
                    const active = idx + 1 <= stepIndex;
                    const Icon = st.icon;
                    return (
                      <div
                        key={st.key}
                        className={`p-2 rounded-lg border text-center space-y-1 ${
                          active
                            ? isReturned && idx === 2
                              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                              : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="w-4 h-4 mx-auto" />
                        <div className="font-bold text-[11px] leading-tight">{st.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delivery & Contact Info */}
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-0.5">
                    <div className="text-slate-500 dark:text-slate-400 font-semibold">Recipient &amp; WhatsApp</div>
                    <div className="font-bold text-slate-900 dark:text-white">{trackedOrder.customerName}</div>
                    <div className="font-mono text-slate-700 dark:text-slate-300">
                      {trackedOrder.whatsapp || trackedOrder.phone}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-0.5">
                    <div className="text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-amber-500" />
                      <span>Delivery Destination</span>
                    </div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {trackedOrder.city}{trackedOrder.area ? ` (${trackedOrder.area})` : ''}
                    </div>
                    <div className="text-slate-700 dark:text-slate-300 line-clamp-2">
                      {trackedOrder.address}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                  {trackedOrder.items.map((it, i) => (
                    <div key={`${it.description}-${i}`} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                        {it.description} <span className="text-slate-500 font-mono">×{it.quantity}</span>
                      </span>
                      <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white shrink-0">
                        {currency}{Number(it.amount || 0).toLocaleString('en-PK')}
                      </span>
                    </div>
                  ))}
                  <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Delivery Charges</span>
                    <span className="font-mono font-bold tabular-nums text-slate-800 dark:text-slate-200">
                      {trackedOrder.deliveryFee > 0
                        ? `${currency}${Number(trackedOrder.deliveryFee).toLocaleString('en-PK')}`
                        : 'FREE'}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between font-extrabold text-slate-900 dark:text-white">
                    <span>Total Order Amount</span>
                    <span className="font-mono text-sm tabular-nums">
                      {currency}{Number(trackedOrder.totalAmount || 0).toLocaleString('en-PK')}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSendTrackingCopyToWhatsApp(trackedOrder)}
                    className="py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Open WhatsApp Receipt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenSupport(trackedOrder.orderNumber, trackedOrder.whatsapp || trackedOrder.phone)}
                    className="py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Customer Support ({supportPhone})</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Always-visible Support Line */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Can&apos;t find your Order # or need address changes?</span>
            <button
              type="button"
              onClick={() => handleOpenSupport(orderNumber, phone)}
              className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Support ({supportPhone})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
