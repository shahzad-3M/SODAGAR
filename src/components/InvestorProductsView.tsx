import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit3,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppUser,
  BusinessProfile,
  Investor,
  InvestorProductOffering,
  InvestorProductRequest,
  ProductItem,
  UserRole,
} from '../types/index.ts';
import {
  apiCreateInvestorRequest,
  apiDeleteInvestorOffering,
  apiFetchInvestorOfferings,
  apiReviewInvestorRequest,
  apiSaveInvestorOffering,
} from '../utils/storage.ts';
import {
  ConfirmDialogModal,
  ConfirmDialogState,
  InputPromptModal,
  InputPromptState,
  ToastBanner,
  ToastMessage,
} from './AppDialogs.tsx';

interface InvestorProductsViewProps {
  currentUser: AppUser;
  userRole: UserRole;
  offerings: InvestorProductOffering[];
  requests: InvestorProductRequest[];
  products: ProductItem[];
  investors: Investor[];
  profile: BusinessProfile;
  onRefreshData?: () => void;
  onBackToStore?: () => void;
}

export const InvestorProductsView: React.FC<InvestorProductsViewProps> = ({
  currentUser,
  userRole,
  offerings,
  requests,
  products,
  investors,
  profile,
  onRefreshData,
  onBackToStore,
}) => {
  const isAuthenticated = currentUser?.isAuthenticated === true;
  const isAdmin = isAuthenticated && (userRole === 'super_admin' || userRole === 'admin');
  const isAllowedRole =
    isAuthenticated &&
    (userRole === 'investor' ||
      userRole === 'admin' ||
      userRole === 'super_admin' ||
      userRole === 'manager');

  const [isLoading, setIsLoading] = useState(false);
  const [selectedQtyByOffering, setSelectedQtyByOffering] = useState<Record<string, number>>({});
  const [noteByOffering, setNoteByOffering] = useState<Record<string, string>>({});
  const [submittingOfferingId, setSubmittingOfferingId] = useState<string | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [offeringFilter, setOfferingFilter] = useState<'all' | 'active' | 'funded' | 'closed'>('all');

  // Admin Add / Edit Offering Modal state
  const [isOfferingModalOpen, setIsOfferingModalOpen] = useState(false);
  const [editingOffering, setEditingOffering] = useState<InvestorProductOffering | null>(null);
  const [formProductId, setFormProductId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formUrduTitle, setFormUrduTitle] = useState('');
  const [formCategory, setFormCategory] = useState('General');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formUnitPrice, setFormUnitPrice] = useState('1000');
  const [formMinQty, setFormMinQty] = useState('10');
  const [formMaxQty, setFormMaxQty] = useState('100');
  const [formOtherExpenses, setFormOtherExpenses] = useState('0');
  const [formOtherExpensesNote, setFormOtherExpensesNote] = useState('');
  const [formProfitSharePercent, setFormProfitSharePercent] = useState('25');
  const [formMonthlyReturnText, setFormMonthlyReturnText] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'funded' | 'closed'>('active');
  const [isSavingOffering, setIsSavingOffering] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [inputPrompt, setInputPrompt] = useState<InputPromptState | null>(null);

  const pushToast = (text: string, type: ToastMessage['type'] = 'info') => {
    const id = `toast_inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleSyncFromServer = async () => {
    if (!isAllowedRole) return;
    setIsLoading(true);
    const res = await apiFetchInvestorOfferings();
    setIsLoading(false);
    if (!res.ok && res.error) {
      pushToast(res.error, 'error');
    } else {
      onRefreshData?.();
    }
  };

  useEffect(() => {
    if (isAllowedRole) {
      void handleSyncFromServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllowedRole]);

  const matchedInvestor = useMemo(() => {
    const phoneDigits = (currentUser?.phone || '').replace(/\D/g, '');
    return investors.find(
      (inv) =>
        (currentUser?.investorId && inv.id === currentUser.investorId) ||
        (phoneDigits && inv.phone.replace(/\D/g, '') === phoneDigits)
    );
  }, [investors, currentUser?.investorId, currentUser?.phone]);

  // Guard: strictly hidden from guests, customers, resellers, and staff
  if (!isAllowedRole) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-10 text-center max-w-md mx-auto space-y-3 my-8 shadow-xs">
        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          Investor-Only Product Offerings
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This investment catalog is strictly private and visible only to registered investors and store administration.
        </p>
        {onBackToStore && (
          <button
            type="button"
            onClick={onBackToStore}
            className="px-4 py-2 bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 rounded-lg text-xs font-bold cursor-pointer"
          >
            Back to Store Catalog
          </button>
        )}
      </div>
    );
  }

  const currency = profile.currencySymbol || 'Rs.';

  const openAddOfferingModal = () => {
    setEditingOffering(null);
    setFormProductId('');
    setFormTitle('');
    setFormUrduTitle('');
    setFormCategory('General');
    setFormImageUrl('');
    setFormDescription('');
    setFormUnitPrice('1000');
    setFormMinQty('10');
    setFormMaxQty('100');
    setFormOtherExpenses('0');
    setFormOtherExpensesNote('');
    setFormProfitSharePercent('25');
    setFormMonthlyReturnText('');
    setFormStatus('active');
    setIsOfferingModalOpen(true);
  };

  const openEditOfferingModal = (off: InvestorProductOffering) => {
    setEditingOffering(off);
    setFormProductId(off.productId || '');
    setFormTitle(off.title);
    setFormUrduTitle(off.urduTitle || '');
    setFormCategory(off.category || 'General');
    setFormImageUrl(off.imageUrl || '');
    setFormDescription(off.description || '');
    setFormUnitPrice(String(off.unitPrice));
    setFormMinQty(String(off.minInvestQty));
    setFormMaxQty(String(off.maxAvailableQty));
    setFormOtherExpenses(String(off.otherExpenses || 0));
    setFormOtherExpensesNote(off.otherExpensesNote || '');
    setFormProfitSharePercent(String(off.expectedProfitSharePercent ?? 25));
    setFormMonthlyReturnText(off.estimatedMonthlyReturnText || '');
    setFormStatus(off.status || 'active');
    setIsOfferingModalOpen(true);
  };

  const handleSelectCatalogProduct = (pid: string) => {
    setFormProductId(pid);
    const prod = products.find((p) => p.id === pid);
    if (prod) {
      setFormTitle(prod.name);
      setFormUrduTitle(prod.urduName || '');
      setFormCategory(prod.category || 'General');
      setFormImageUrl(prod.imageUrl || prod.pictures?.[0] || '');
      setFormDescription(prod.description || '');
      const baseUnitCost = Number(prod.costPrice || prod.ourPrice || 0);
      if (baseUnitCost > 0) {
        setFormUnitPrice(String(baseUnitCost));
      }
    }
  };

  const handleSaveOfferingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const unitPrice = Math.max(0, Number(formUnitPrice));
    const minInvestQty = Math.max(1, Math.floor(Number(formMinQty) || 1));
    const maxAvailableQty = Math.max(minInvestQty, Math.floor(Number(formMaxQty) || minInvestQty));
    const otherExpenses = Math.max(0, Number(formOtherExpenses) || 0);
    const expectedProfitSharePercent =
      formProfitSharePercent.trim() !== '' ? Number(formProfitSharePercent) : undefined;

    if (!formTitle.trim()) {
      pushToast('Please enter a product offering title.', 'error');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      pushToast('Unit price must be greater than 0.', 'error');
      return;
    }

    setIsSavingOffering(true);
    const res = await apiSaveInvestorOffering(
      {
        productId: formProductId || undefined,
        title: formTitle.trim(),
        urduTitle: formUrduTitle.trim() || undefined,
        category: formCategory.trim() || 'General',
        imageUrl: formImageUrl.trim() || undefined,
        description: formDescription.trim() || undefined,
        unitPrice,
        minInvestQty,
        maxAvailableQty,
        otherExpenses,
        otherExpensesNote: formOtherExpensesNote.trim() || undefined,
        expectedProfitSharePercent,
        estimatedMonthlyReturnText: formMonthlyReturnText.trim() || undefined,
        status: formStatus,
      },
      editingOffering?.id
    );
    setIsSavingOffering(false);

    if (!res.ok) {
      pushToast(res.error || 'Failed to save investor product offering.', 'error');
      return;
    }

    pushToast(
      editingOffering ? 'Investor offering updated.' : 'Investor product offering published.',
      'success'
    );
    setIsOfferingModalOpen(false);
    onRefreshData?.();
  };

  const handleDeleteOffering = (off: InvestorProductOffering) => {
    setConfirmDialog({
      title: 'Delete Investor Product Offering',
      message: `Remove "${off.title}" from Investor Offers? Existing approved investments stay intact.`,
      confirmLabel: 'Delete Offering',
      danger: true,
      onConfirm: async () => {
        const res = await apiDeleteInvestorOffering(off.id);
        if (!res.ok) {
          pushToast(res.error || 'Failed to delete offering.', 'error');
          return;
        }
        pushToast('Investor offering removed.', 'info');
        onRefreshData?.();
      },
    });
  };

  const handleSubmitInvestmentRequest = async (off: InvestorProductOffering) => {
    const remainingQty = Math.max(0, off.maxAvailableQty - (off.reservedQty || 0));
    const currentQty = selectedQtyByOffering[off.id] ?? Math.min(off.minInvestQty, Math.max(1, remainingQty));

    if (off.status !== 'active' || remainingQty <= 0) {
      pushToast('This offering is no longer open for investment.', 'error');
      return;
    }
    if (currentQty < off.minInvestQty) {
      pushToast(`Minimum quantity to invest is ${off.minInvestQty} units.`, 'error');
      return;
    }
    if (currentQty > remainingQty) {
      pushToast(`Only ${remainingQty} units remain available in this lot.`, 'error');
      return;
    }

    setSubmittingOfferingId(off.id);
    const res = await apiCreateInvestorRequest({
      offeringId: off.id,
      requestedQty: currentQty,
      notes: (noteByOffering[off.id] || '').trim() || undefined,
      investorId: matchedInvestor?.id,
    });
    setSubmittingOfferingId(null);

    if (!res.ok) {
      pushToast(res.error || 'Failed to submit investment request.', 'error');
      return;
    }

    setNoteByOffering((prev) => ({ ...prev, [off.id]: '' }));
    pushToast(
      `Investment request for ${currentQty} units of "${off.title}" submitted for Admin approval.`,
      'success'
    );
    onRefreshData?.();
  };

  const handleApproveRequest = (reqItem: InvestorProductRequest) => {
    setConfirmDialog({
      title: 'Approve Investment Request',
      message: `Approve ${reqItem.investorName}'s investment of ${reqItem.requestedQty} units (${currency} ${reqItem.totalInvestment.toLocaleString('en-PK')}) in "${reqItem.offeringTitle}"? This reserves the units and updates investor capital & ledger.`,
      confirmLabel: 'Approve & Reserve Units',
      onConfirm: async () => {
        setReviewingRequestId(reqItem.id);
        const res = await apiReviewInvestorRequest(reqItem.id, 'approved');
        setReviewingRequestId(null);
        if (!res.ok) {
          pushToast(res.error || 'Approval failed.', 'error');
          return;
        }
        pushToast(`Approved investment request for ${reqItem.investorName}.`, 'success');
        onRefreshData?.();
      },
    });
  };

  const handleRejectRequest = (reqItem: InvestorProductRequest) => {
    setInputPrompt({
      title: 'Reject Investment Request',
      label: `Optional rejection note for ${reqItem.investorName} (${reqItem.offeringTitle}):`,
      initialValue: '',
      placeholder: 'e.g. Lot allocation full or terms revised',
      submitLabel: 'Reject Request',
      onSubmit: async (reason) => {
        setReviewingRequestId(reqItem.id);
        const res = await apiReviewInvestorRequest(reqItem.id, 'rejected', reason.trim() || undefined);
        setReviewingRequestId(null);
        if (!res.ok) {
          pushToast(res.error || 'Rejection failed.', 'error');
          return;
        }
        pushToast('Investment request rejected.', 'info');
        onRefreshData?.();
      },
    });
  };

  const filteredOfferings = offerings.filter((off) =>
    offeringFilter === 'all' ? true : off.status === offeringFilter
  );

  const visibleRequests = useMemo(() => {
    const base = isAdmin
      ? requests
      : requests.filter(
          (r) =>
            (matchedInvestor?.id && r.investorId === matchedInvestor.id) ||
            (currentUser.id && r.userId === currentUser.id) ||
            (currentUser.phone &&
              r.investorPhone.replace(/\D/g, '') === currentUser.phone.replace(/\D/g, ''))
        );
    return base
      .filter((r) => (requestStatusFilter === 'all' ? true : r.status === requestStatusFilter))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, isAdmin, matchedInvestor?.id, currentUser.id, currentUser.phone, requestStatusFilter]);

  const activeOfferingsCount = offerings.filter((o) => o.status === 'active').length;
  const totalRemainingUnits = offerings
    .filter((o) => o.status === 'active')
    .reduce((sum, o) => sum + Math.max(0, o.maxAvailableQty - (o.reservedQty || 0)), 0);
  const pendingRequestsCount = requests.filter((r) => r.status === 'pending').length;
  const approvedTotalCapital = visibleRequests
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + Number(r.totalInvestment || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                <Briefcase className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                  Investor-Only Product Offerings (انویسٹر پروڈکٹ آفرز)
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Private wholesale &amp; import product lots open exclusively to registered investors. Select your preferred quantity above the minimum threshold and submit for Admin approval.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSyncFromServer()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={openAddOfferingModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Investor Product
              </button>
            )}
          </div>
        </div>

        {/* 4 Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-xs text-slate-500">Active Product Lots</span>
            <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {activeOfferingsCount}
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Available Units Open</span>
            <p className="text-xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400 mt-0.5">
              {totalRemainingUnits.toLocaleString('en-PK')} units
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Pending Approvals</span>
            <p className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-0.5">
              {pendingRequestsCount} requests
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">
              {isAdmin ? 'Approved Lot Capital' : 'My Approved Investments'}
            </span>
            <p className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
              {currency} {approvedTotalCapital.toLocaleString('en-PK')}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Bar for Offerings */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold">
          {(['all', 'active', 'funded', 'closed'] as const).map((statusKey) => (
            <button
              key={statusKey}
              type="button"
              onClick={() => setOfferingFilter(statusKey)}
              className={`px-3 py-1.5 rounded-md capitalize transition-colors cursor-pointer ${
                offeringFilter === statusKey
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {statusKey}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 font-mono tabular-nums">
          Showing {filteredOfferings.length} of {offerings.length} offerings
        </span>
      </div>

      {/* Offerings Grid */}
      {filteredOfferings.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <Package className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            No investor product offerings available in this filter.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAdmin
              ? 'Click "Add Investor Product" above to list a product lot exclusively for registered investors.'
              : 'New investment product lots will appear here once published by Admin.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredOfferings.map((off) => {
            const remainingQty = Math.max(0, off.maxAvailableQty - (off.reservedQty || 0));
            const defaultQty = remainingQty > 0 ? Math.min(off.minInvestQty, remainingQty) : off.minInvestQty;
            const qty = selectedQtyByOffering[off.id] ?? defaultQty;
            const subtotal = qty * off.unitPrice;
            const expensesShare =
              off.maxAvailableQty > 0
                ? Math.round(((off.otherExpenses || 0) * qty) / off.maxAvailableQty)
                : 0;
            const totalInvestment = subtotal + expensesShare;
            const fundedPercent =
              off.maxAvailableQty > 0
                ? Math.min(100, Math.round(((off.reservedQty || 0) / off.maxAvailableQty) * 100))
                : 0;
            const isQtyValid =
              off.status === 'active' &&
              remainingQty >= off.minInvestQty &&
              qty >= off.minInvestQty &&
              qty <= remainingQty;

            return (
              <div
                key={off.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs flex flex-col justify-between"
              >
                <div>
                  {/* Image & Status Header */}
                  <div className="relative h-44 bg-slate-100 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden">
                    {off.imageUrl ? (
                      <img
                        src={off.imageUrl}
                        alt={off.title}
                        className="w-full h-full object-contain p-2 bg-white dark:bg-slate-900"
                      />
                    ) : (
                      <Package className="w-12 h-12 text-slate-300 dark:text-slate-600" />
                    )}

                    <span
                      className={`absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                        off.status === 'active'
                          ? 'bg-emerald-600 text-white'
                          : off.status === 'funded'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-700 text-white'
                      }`}
                    >
                      {off.status}
                    </span>

                    {isAdmin && (
                      <div className="absolute top-3 right-3 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditOfferingModal(off)}
                          className="p-1.5 rounded-md bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-amber-600 cursor-pointer"
                          title="Edit Offering"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteOffering(off)}
                          className="p-1.5 rounded-md bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-red-600 cursor-pointer"
                          title="Delete Offering"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4 space-y-3">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        {off.category}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                        {off.title}
                      </h3>
                      {off.urduTitle && (
                        <p className="text-xs text-slate-500 mt-0.5 font-sans">{off.urduTitle}</p>
                      )}
                      {off.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">
                          {off.description}
                        </p>
                      )}
                    </div>

                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs">
                      <div>
                        <span className="text-[11px] text-slate-500 block">Unit Price</span>
                        <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                          {currency} {off.unitPrice.toLocaleString('en-PK')}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Min Quantity</span>
                        <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                          {off.minInvestQty.toLocaleString('en-PK')} units
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Available / Total</span>
                        <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {remainingQty.toLocaleString('en-PK')} / {off.maxAvailableQty.toLocaleString('en-PK')}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Lot Other Expenses</span>
                        <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                          {currency} {(off.otherExpenses || 0).toLocaleString('en-PK')}
                        </span>
                      </div>
                    </div>

                    {(off.otherExpensesNote || off.expectedProfitSharePercent || off.estimatedMonthlyReturnText) && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                        {off.otherExpensesNote && (
                          <p>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">Expenses Note:</span>{' '}
                            {off.otherExpensesNote}
                          </p>
                        )}
                        {(off.expectedProfitSharePercent || off.estimatedMonthlyReturnText) && (
                          <p className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {off.expectedProfitSharePercent ? `${off.expectedProfitSharePercent}% Profit Share` : ''}
                              {off.expectedProfitSharePercent && off.estimatedMonthlyReturnText ? ' · ' : ''}
                              {off.estimatedMonthlyReturnText || ''}
                            </span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Allocation Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                        <span>Reserved: {off.reservedQty || 0} units</span>
                        <span>{fundedPercent}% funded</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all"
                          style={{ width: `${fundedPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quantity Selector & Investment Breakdown */}
                <div className="p-4 pt-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/40 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Select Qty:
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={off.status !== 'active' || qty <= off.minInvestQty}
                        onClick={() =>
                          setSelectedQtyByOffering((prev) => ({
                            ...prev,
                            [off.id]: Math.max(off.minInvestQty, qty - 1),
                          }))
                        }
                        className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={off.minInvestQty}
                        max={Math.max(off.minInvestQty, remainingQty)}
                        disabled={off.status !== 'active' || remainingQty <= 0}
                        value={qty}
                        onChange={(e) => {
                          const parsedVal = Math.max(0, Math.floor(Number(e.target.value) || 0));
                          setSelectedQtyByOffering((prev) => ({ ...prev, [off.id]: parsedVal }));
                        }}
                        className="w-20 px-2 py-1 text-center font-mono text-xs font-bold tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={off.status !== 'active' || qty >= remainingQty}
                        onClick={() =>
                          setSelectedQtyByOffering((prev) => ({
                            ...prev,
                            [off.id]: Math.min(remainingQty, qty + 1),
                          }))
                        }
                        className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Live Total Investment Calculation */}
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 text-xs font-mono tabular-nums">
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal ({qty} × {currency} {off.unitPrice.toLocaleString('en-PK')}):</span>
                      <span>{currency} {subtotal.toLocaleString('en-PK')}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Proportional Expenses Share:</span>
                      <span>{currency} {expensesShare.toLocaleString('en-PK')}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 dark:text-white pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Total Investment:</span>
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {currency} {totalInvestment.toLocaleString('en-PK')}
                      </span>
                    </div>
                  </div>

                  {off.status === 'active' && remainingQty > 0 && (qty < off.minInvestQty || qty > remainingQty) && (
                    <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                      {qty < off.minInvestQty
                        ? `Minimum quantity required is ${off.minInvestQty} units.`
                        : `Maximum available units remaining is ${remainingQty}.`}
                    </p>
                  )}

                  <input
                    type="text"
                    placeholder="Optional note for Admin (e.g. payout preference)"
                    value={noteByOffering[off.id] || ''}
                    disabled={off.status !== 'active' || remainingQty <= 0}
                    onChange={(e) =>
                      setNoteByOffering((prev) => ({ ...prev, [off.id]: e.target.value }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-50"
                  />

                  <button
                    type="button"
                    disabled={!isQtyValid || submittingOfferingId === off.id}
                    onClick={() => void handleSubmitInvestmentRequest(off)}
                    className="w-full py-2 px-3 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    {submittingOfferingId === off.id
                      ? 'Submitting Request...'
                      : off.status !== 'active' || remainingQty <= 0
                      ? 'Lot Unavailable'
                      : 'Submit Request (Pending Approval)'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending & Historical Investment Requests Ledger */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {isAdmin ? 'Investor Purchase Requests Queue (Admin Approval)' : 'My Investment Requests'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isAdmin
                ? 'Review submitted investor lot requests. Approving reserves units, logs a capital deposit transaction, and allocates the product to the investor.'
                : 'Track approval status of your submitted product investment requests.'}
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setRequestStatusFilter(st)}
                className={`px-2.5 py-1 rounded capitalize transition-colors cursor-pointer ${
                  requestStatusFilter === st
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {visibleRequests.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No investment requests found in this status filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                  <th className="py-2.5 px-3">Date</th>
                  {isAdmin && <th className="py-2.5 px-3">Investor</th>}
                  <th className="py-2.5 px-3">Product Offering</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Price</th>
                  <th className="py-2.5 px-3 text-right">Expenses</th>
                  <th className="py-2.5 px-3 text-right">Total Investment</th>
                  <th className="py-2.5 px-3">Status</th>
                  {isAdmin && <th className="py-2.5 px-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleRequests.map((reqItem) => (
                  <tr key={reqItem.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {reqItem.createdAt.slice(0, 10)}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-900 dark:text-white block">
                          {reqItem.investorName}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {reqItem.investorPhone}
                        </span>
                      </td>
                    )}
                    <td className="py-3 px-3">
                      <span className="font-semibold text-slate-900 dark:text-white block">
                        {reqItem.offeringTitle}
                      </span>
                      {reqItem.notes && (
                        <span className="text-[11px] text-slate-500 block">{reqItem.notes}</span>
                      )}
                      {reqItem.rejectionReason && (
                        <span className="text-[11px] text-red-600 dark:text-red-400 block">
                          Reason: {reqItem.rejectionReason}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold tabular-nums">
                      {reqItem.requestedQty.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {currency} {reqItem.unitPrice.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                      {currency} {(reqItem.otherExpensesShare || 0).toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {currency} {reqItem.totalInvestment.toLocaleString('en-PK')}
                    </td>
                    <td className="py-3 px-3">
                      {reqItem.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          <Clock className="w-3 h-3" /> Pending Approval
                        </span>
                      )}
                      {reqItem.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" /> Approved
                        </span>
                      )}
                      {reqItem.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-300">
                          <XCircle className="w-3 h-3" /> Rejected
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-3 text-right">
                        {reqItem.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={reviewingRequestId === reqItem.id}
                              onClick={() => handleApproveRequest(reqItem)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={reviewingRequestId === reqItem.id}
                              onClick={() => handleRejectRequest(reqItem)}
                              className="px-2.5 py-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-950 text-slate-700 dark:text-slate-300 hover:text-red-700 font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {reqItem.reviewedByName || 'Reviewed'}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admin Add / Edit Investor Offering Modal */}
      {isOfferingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingOffering ? 'Edit Investor Product Offering' : 'Add Investor-Only Product Offering'}
              </h3>
              <button
                type="button"
                onClick={() => setIsOfferingModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveOfferingSubmit(e)} className="space-y-4">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Link Existing Catalog Product (Optional — auto-fills fields)
                </label>
                <select
                  value={formProductId}
                  onChange={(e) => handleSelectCatalogProduct(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">-- Custom / New Import Lot --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.category} · Cost: {currency} {Number(p.costPrice || p.ourPrice || 0).toLocaleString('en-PK')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Offering Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. Thermal Bottle Import Lot #12"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Urdu Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={formUrduTitle}
                    onChange={(e) => setFormUrduTitle(e.target.value)}
                    placeholder="تھرمل بوتل امپورٹ لاٹ"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'active' | 'funded' | 'closed')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="active">Active (Open for Investors)</option>
                    <option value="funded">Funded</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Unit Price ({currency}) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formUnitPrice}
                    onChange={(e) => setFormUnitPrice(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Min Qty *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formMinQty}
                    onChange={(e) => setFormMinQty(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Max Available Qty *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formMaxQty}
                    onChange={(e) => setFormMaxQty(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Other Expenses ({currency})
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formOtherExpenses}
                    onChange={(e) => setFormOtherExpenses(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Other Expenses Breakdown Note
                  </label>
                  <input
                    type="text"
                    value={formOtherExpensesNote}
                    onChange={(e) => setFormOtherExpensesNote(e.target.value)}
                    placeholder="e.g. Freight, customs clearance, packaging"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Expected Profit Share (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={formProfitSharePercent}
                    onChange={(e) => setFormProfitSharePercent(e.target.value)}
                    className="w-full px-3 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Estimated Return Note
                  </label>
                  <input
                    type="text"
                    value={formMonthlyReturnText}
                    onChange={(e) => setFormMonthlyReturnText(e.target.value)}
                    placeholder="e.g. 4-6 weeks turnaround"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Product Image URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={formImageUrl}
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Lot Description / Terms
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsOfferingModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingOffering}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer disabled:opacity-60"
                >
                  {isSavingOffering ? 'Saving...' : editingOffering ? 'Save Changes' : 'Publish Offering'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastBanner
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <ConfirmDialogModal
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
      <InputPromptModal
        promptState={inputPrompt}
        onClose={() => setInputPrompt(null)}
      />
    </div>
  );
};
