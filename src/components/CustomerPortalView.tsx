import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  ShoppingBag,
  Clock,
  BarChart3,
  CreditCard,
  KeyRound,
  LogOut,
  Phone,
  CheckCircle2,
  AlertCircle,
  Key,
  Calendar,
  DollarSign,
  TrendingUp,
  Percent,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  ExternalLink,
  MapPin,
  Edit2,
  Ticket,
  RotateCcw,
  Send,
} from 'lucide-react';
import type {
  AppUser,
  BusinessProfile,
  CODOrder,
  CRMSupportTicket,
  CRMTicketCategory,
  CRMTicketPriority,
  Customer,
  Transaction,
} from '../types/index.ts';
import { defaultDeliveryCities } from '../utils/defaultData.ts';
import { AddressFieldsGroup } from './AddressFieldsGroup.tsx';
import {
  apiChangeOwnPassword,
  apiFetchCrmTickets,
  apiSaveCrmTicket,
  apiUpdateUsername,
  createUserAccount,
  getUserAccounts,
  updateCustomerPin,
  updateUserAccount,
} from '../utils/storage.ts';
import { createPasswordRecord, verifyPassword } from '../utils/security.ts';
import { openWhatsAppDirect } from '../utils/whatsapp.ts';

const CUSTOMER_TICKET_CATEGORIES: CRMTicketCategory[] = [
  'Product Inquiry',
  'General inquiry',
  'Late delivery',
  'Damaged product',
  'Wrong item',
  'Payment issue',
  'Refund request',
  'Product quality',
  'Courier issue',
  'Staff complaint',
];

export type CustomerPortalTab = 'dashboard' | 'orders' | 'tickets' | 'reports' | 'payments' | 'security';

interface CustomerPortalViewProps {
  currentUser: AppUser;
  customer?: Customer;
  transactions: Transaction[];
  codOrders?: CODOrder[];
  profile: BusinessProfile;
  initialTab?: CustomerPortalTab;
  onLogout: () => void;
  onOpenCart?: () => void;
  onNavigateTab: (tab: string) => void;
  onPasswordChanged?: () => void;
  onUsernameChanged?: (newUsername: string) => void;
  onUpdateCustomer?: (updated: Customer) => void;
}

export const CustomerPortalView: React.FC<CustomerPortalViewProps> = ({
  currentUser,
  customer,
  transactions,
  codOrders = [],
  profile,
  initialTab = 'dashboard',
  onLogout,
  onOpenCart,
  onNavigateTab,
  onPasswordChanged,
  onUsernameChanged,
  onUpdateCustomer,
}) => {
  const [activeTab, setActiveTab] = useState<CustomerPortalTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Delivery Address & Notification WhatsApp Edit State
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addrCity, setAddrCity] = useState(customer?.city || 'Muzaffarabad');
  const [addrArea, setAddrArea] = useState(customer?.area || '');
  const [addrMohalla, setAddrMohalla] = useState(customer?.mohalla || '');
  const [addrLandmark, setAddrLandmark] = useState(customer?.landmark || '');
  const [addrLine, setAddrLine] = useState(customer?.address || '');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(
    customer?.whatsappSameAsPhone ?? (!customer?.whatsapp || customer.whatsapp === customer.phone)
  );
  const [whatsappNumber, setWhatsappNumber] = useState(customer?.whatsapp || customer?.phone || '');
  const [addrSavedMsg, setAddrSavedMsg] = useState('');

  // Change Password & Username State
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [usernameInput, setUsernameInput] = useState(currentUser.username || '');
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');

  useEffect(() => {
    setUsernameInput(currentUser.username || '');
  }, [currentUser.username]);

  // Scoped customer data: strictly filter by customerId or phone
  const customerId = currentUser.customerId || customer?.id;
  const myTransactions = transactions.filter(
    (tx) =>
      tx.customerId === customerId ||
      (customer && tx.customerId === customer.id)
  );

  const totalPurchases = myTransactions
    .filter((tx) => tx.type === 'credit')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalPaid = myTransactions
    .filter((tx) => tx.type === 'debit')
    .reduce((sum, tx) => sum + tx.amount, 0) +
    myTransactions
      .filter((tx) => tx.type === 'credit' && tx.paidAmount)
      .reduce((sum, tx) => sum + (tx.paidAmount || 0), 0);

  const totalSavings = myTransactions.reduce(
    (sum, tx) => sum + (tx.totalSavings || 0),
    0
  );

  const currentBalance =
    customer !== undefined ? customer.balance : Math.max(0, totalPurchases - totalPaid);

  // Customer Support Tickets State (strictly scoped to signed-in customer)
  const [myTickets, setMyTickets] = useState<CRMSupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [ticketCategory, setTicketCategory] = useState<CRMTicketCategory>('Product Inquiry');
  const [ticketPriority, setTicketPriority] = useState<CRMTicketPriority>('Medium');
  const [ticketOrderNumber, setTicketOrderNumber] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const [ticketSuccess, setTicketSuccess] = useState('');
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);

  const cleanCustPhone = (customer?.phone || currentUser.phone || '').replace(/\D/g, '');
  const myCodOrders = codOrders.filter(
    (o) =>
      (customerId && o.customerId === customerId) ||
      (cleanCustPhone && (o.phone || '').replace(/\D/g, '') === cleanCustPhone)
  );

  const loadMyTickets = useCallback(async () => {
    if (!currentUser.isAuthenticated) return;
    setTicketsLoading(true);
    const res = await apiFetchCrmTickets();
    setTicketsLoading(false);
    if (res.ok && res.tickets) {
      setMyTickets(res.tickets);
    }
  }, [currentUser.isAuthenticated]);

  useEffect(() => {
    void loadMyTickets();
  }, [loadMyTickets]);

  const handleCreateCustomerTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setTicketError('');
    setTicketSuccess('');
    if (!currentUser.isAuthenticated) {
      setTicketError('Please sign in first to create a support ticket.');
      return;
    }
    if (!ticketSubject.trim()) {
      setTicketError('Please enter a ticket subject.');
      return;
    }
    setTicketSubmitting(true);
    const matchedCod = myCodOrders.find((o) => o.orderNumber === ticketOrderNumber.trim());
    const res = await apiSaveCrmTicket({
      customerId: customerId,
      customerName: customer?.name || currentUser.name,
      customerPhone: customer?.phone || currentUser.phone,
      orderId: matchedCod?.id,
      orderNumber: ticketOrderNumber.trim() || undefined,
      category: ticketCategory,
      priority: ticketPriority,
      subject: ticketSubject.trim(),
      description: ticketDescription.trim() || undefined,
      status: 'Open',
    });
    setTicketSubmitting(false);
    if (!res.ok) {
      setTicketError(res.error || 'Could not submit support ticket.');
      return;
    }
    if (res.tickets) {
      setMyTickets(res.tickets);
    } else {
      await loadMyTickets();
    }
    setTicketSubject('');
    setTicketDescription('');
    setTicketOrderNumber('');
    setTicketSuccess(
      `Ticket ${res.ticket?.ticketNumber || ''} created and kept Open for support follow-up.`
    );
  };

  const handleCustomerTicketFollowUp = async (
    ticket: CRMSupportTicket,
    options: { keepOpen?: boolean; closeTicket?: boolean }
  ) => {
    const note = (followUpDrafts[ticket.id] || '').trim();
    if (!options.keepOpen && !options.closeTicket && !note) return;

    setTicketError('');
    setTicketSuccess('');
    setUpdatingTicketId(ticket.id);
    const res = await apiSaveCrmTicket({
      id: ticket.id,
      status: options.keepOpen ? 'Open' : options.closeTicket ? 'Closed' : ticket.status,
      customerFollowUpNote: note || (options.keepOpen ? 'Customer requested to keep ticket open.' : undefined),
    });
    setUpdatingTicketId(null);
    if (!res.ok) {
      setTicketError(res.error || 'Could not update ticket.');
      return;
    }
    if (res.tickets) {
      setMyTickets(res.tickets);
    } else {
      await loadMyTickets();
    }
    setFollowUpDrafts((prev) => ({ ...prev, [ticket.id]: '' }));
    setTicketSuccess(
      options.keepOpen
        ? `Ticket ${ticket.ticketNumber} is Open for further assistance.`
        : options.closeTicket
        ? `Ticket ${ticket.ticketNumber} marked Closed.`
        : `Update added to ticket ${ticket.ticketNumber}.`
    );
  };

  const openTicketsCount = myTickets.filter(
    (t) => t.status !== 'Resolved' && t.status !== 'Closed'
  ).length;

  // Handle password change with salted hashing synced across UserAccount + Customer
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityError('');
    setSecuritySuccess('');
    setIsUpdatingPassword(true);

    const curPass = currentPasswordInput.trim();
    const nextPass = newPasswordInput.trim();
    const confPass = confirmPasswordInput.trim();

    if (!curPass) {
      setSecurityError('Please enter your current password / PIN.');
      setIsUpdatingPassword(false);
      return;
    }

    if (nextPass.length < 4) {
      setSecurityError('New password must be at least 4 digits/characters long.');
      setIsUpdatingPassword(false);
      return;
    }

    if (nextPass !== confPass) {
      setSecurityError('New password and confirm password do not match.');
      setIsUpdatingPassword(false);
      return;
    }

    if (currentUser.isAuthenticated) {
      const serverRes = await apiChangeOwnPassword(curPass, nextPass);
      if (!serverRes.ok) {
        setSecurityError(serverRes.error || 'Current password is incorrect. Please check and try again.');
        setIsUpdatingPassword(false);
        return;
      }
      onPasswordChanged?.();
      setIsUpdatingPassword(false);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setSecuritySuccess('Password changed successfully.');
      return;
    }

    const userAccounts = getUserAccounts();
    const cleanUserPhone = (customer?.phone || currentUser.phone || '').replace(/\D/g, '');
    const matchedUserAcc = userAccounts.find(
      (u) =>
        u.id === currentUser.id ||
        (customer && u.linkedCustomerId === customer.id) ||
        (u.role === 'customer' && cleanUserPhone && u.phone.replace(/\D/g, '') === cleanUserPhone)
    );

    const isAccMatch = matchedUserAcc
      ? await verifyPassword(curPass, matchedUserAcc.passwordHash, matchedUserAcc.passwordSalt)
      : false;
    const isCustomerPinMatch = customer?.pin ? await verifyPassword(curPass, customer.pin) : false;

    if (!isAccMatch && !isCustomerPinMatch) {
      setSecurityError('Current password is incorrect. Please check and try again.');
      setIsUpdatingPassword(false);
      return;
    }

    const newPassRecord = await createPasswordRecord(nextPass);

    if (matchedUserAcc) {
      updateUserAccount(matchedUserAcc.id, {
        passwordHash: newPassRecord.hash,
        passwordSalt: newPassRecord.salt,
        mustChangePassword: false,
        isTemporaryPassword: false,
      });
    } else {
      createUserAccount({
        username: (customer?.phone || currentUser.phone || currentUser.id).replace(/[\s-]/g, ''),
        fullName: customer?.name || currentUser.name,
        urduName: customer?.urduName || currentUser.urduName,
        phone: customer?.phone || currentUser.phone || '',
        email: customer?.email || currentUser.email,
        role: 'customer',
        status: 'active',
        passwordHash: newPassRecord.hash,
        passwordSalt: newPassRecord.salt,
        mustChangePassword: false,
        isTemporaryPassword: false,
        linkedCustomerId: customer?.id || currentUser.customerId,
      });
    }

    if (customer) {
      updateCustomerPin(customer.id, nextPass);
    }

    onPasswordChanged?.();
    setIsUpdatingPassword(false);
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setSecuritySuccess('Password changed successfully.');
  };

  return (
    <div className="space-y-6">
      {/* Top Welcome Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#FFD200] text-slate-950 flex items-center justify-center font-black text-lg shadow-xs">
              <User className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  {customer?.name || currentUser.name}
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 rounded uppercase">
                  Verified Customer Khata
                </span>
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                {currentUser.username ? `@${currentUser.username} · ` : ''}Phone: {customer?.phone || currentUser.phone} · Credit Limit: {profile.currencySymbol}{(customer?.creditLimit || 5000).toLocaleString('en-PK')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigateTab('store')}
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
              <span>Browse Catalog</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>

        {/* Portal Sub-Navigation Tabs */}
        <div className="flex items-center gap-1 mt-5 border-t border-slate-100 dark:border-slate-800 pt-3 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'dashboard'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>My Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'orders'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>My Orders &amp; Khata ({myTransactions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tickets')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'tickets'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Support Tickets ({openTicketsCount > 0 ? `${openTicketsCount} Open` : myTickets.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'reports'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>My Reports &amp; Savings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'payments'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Payment Instructions</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'security'
                ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Change Password / PIN</span>
          </button>
        </div>
      </div>

      {/* 1. DASHBOARD OVERVIEW TAB */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Key Metric Strips */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Current Due Balance
              </span>
              <div
                className={`text-xl font-black font-mono mt-1 ${
                  currentBalance > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {profile.currencySymbol}{currentBalance.toLocaleString('en-PK')}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {currentBalance > 0 ? 'باقی واجب الادا رقم' : 'کھاتہ کلیئر ہے'}
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Total Purchases
              </span>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                {profile.currencySymbol}{totalPurchases.toLocaleString('en-PK')}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {myTransactions.filter((tx) => tx.type === 'credit').length} Orders Delivered
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Total Cash Saved
              </span>
              <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {profile.currencySymbol}{totalSavings.toLocaleString('en-PK')}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                مارکیٹ ریٹ سے بچت
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Payment Terms
              </span>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                {customer?.paymentTermsDays || 7} Days
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                ادائیگی کی مدت
              </span>
            </div>
          </div>

          {/* Customer Delivery Address Profile Card */}
          {customer && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Saved Delivery Address (پتہ برائے ڈلیوری)
                  </h3>
                </div>
                {onUpdateCustomer && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddrSavedMsg('');
                      if (!isEditingAddress) {
                        setAddrCity(customer.city || 'Muzaffarabad');
                        setAddrArea(customer.area || '');
                        setAddrMohalla(customer.mohalla || '');
                        setAddrLandmark(customer.landmark || '');
                        setAddrLine(customer.address || '');
                        const same =
                          customer.whatsappSameAsPhone ??
                          (!customer.whatsapp || customer.whatsapp === customer.phone);
                        setWhatsappSameAsPhone(same);
                        setWhatsappNumber(customer.whatsapp || customer.phone || '');
                      }
                      setIsEditingAddress(!isEditingAddress);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>{isEditingAddress ? 'Cancel' : 'Update Address & WhatsApp'}</span>
                  </button>
                )}
              </div>

              {addrSavedMsg && (
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{addrSavedMsg}</span>
                </div>
              )}

              {!isEditingAddress ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">WhatsApp Notification</span>
                    <span className="font-bold font-mono text-emerald-700 dark:text-emerald-300">
                      {customer.whatsapp || customer.phone}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">City</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{customer.city || 'Not set'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Area</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{customer.area || 'Not set'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Mohalla / Neighborhood</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{customer.mohalla || 'Not set'}</span>
                  </div>
                  {customer.landmark && (
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Nearby Landmark</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100">{customer.landmark}</span>
                    </div>
                  )}
                  {customer.address && (
                    <div className="sm:col-span-2 lg:col-span-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Complete Address</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{customer.address}</span>
                    </div>
                  )}
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!onUpdateCustomer) return;
                    const resolvedWa = whatsappSameAsPhone
                      ? customer.phone
                      : whatsappNumber.trim() || customer.phone;
                    onUpdateCustomer({
                      ...customer,
                      city: addrCity.trim() || undefined,
                      area: addrArea.trim() || undefined,
                      mohalla: addrMohalla.trim() || undefined,
                      landmark: addrLandmark.trim() || undefined,
                      address: addrLine.trim() || undefined,
                      whatsappSameAsPhone,
                      whatsapp: resolvedWa,
                      whatsappConsent: true,
                    });
                    setIsEditingAddress(false);
                    setAddrSavedMsg('Delivery address & WhatsApp notification number saved.');
                  }}
                  className="space-y-3 pt-1"
                >
                  <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={whatsappSameAsPhone}
                        onChange={(e) => {
                          setWhatsappSameAsPhone(e.target.checked);
                          if (e.target.checked) {
                            setWhatsappNumber(customer.phone);
                          }
                        }}
                        className="w-4 h-4 rounded text-emerald-600"
                      />
                      <span>My mobile number ({customer.phone}) is my WhatsApp number for notifications</span>
                    </label>
                    {!whatsappSameAsPhone && (
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                          WhatsApp Number for Notifications (نوٹیفکیشن کے لیے واٹس ایپ نمبر):
                        </label>
                        <input
                          type="tel"
                          required
                          placeholder="0300 1234567"
                          value={whatsappNumber}
                          onChange={(e) => setWhatsappNumber(e.target.value)}
                          className="w-full sm:w-72 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                  <AddressFieldsGroup
                    cities={
                      profile.deliveryCities && profile.deliveryCities.length > 0
                        ? profile.deliveryCities
                        : defaultDeliveryCities
                    }
                    city={addrCity}
                    area={addrArea}
                    mohalla={addrMohalla}
                    landmark={addrLandmark}
                    address={addrLine}
                    filterActiveCitiesOnly={false}
                    deliveryMode="all_open"
                    showCompleteAddress={true}
                    onChange={(patch) => {
                      if (patch.city !== undefined) setAddrCity(patch.city);
                      if (patch.area !== undefined) setAddrArea(patch.area);
                      if (patch.mohalla !== undefined) setAddrMohalla(patch.mohalla);
                      if (patch.landmark !== undefined) setAddrLandmark(patch.landmark);
                      if (patch.address !== undefined) setAddrLine(patch.address);
                    }}
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                    >
                      Save Address &amp; WhatsApp
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Quick Action: "Add My Product" Link direct to WhatsApp */}
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-black text-emerald-950 dark:text-emerald-200">
                  Want to sell or supply products on 100DAGAR? (اپنی پراڈکٹ شامل کروائیں)
                </h3>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                  Send your product catalog, wholesale wholesale lot details, or samples directly to our procurement admin.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const text = `السلام علیکم! میں مدینہ مارکیٹ کسٹمر ${customer?.name || currentUser.name} ہوں۔ میں اپنی نئی پراڈکٹ کی تفصیلات اور قیمت شامل کروانا چاہتا ہوں۔ براہ کرم رہنمائی فرمائیں۔`;
                openWhatsAppDirect('03125256266', text);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Add My Product</span>
            </button>
          </div>

          {/* Quick Action: Customer Support Tickets */}
          <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
                <Ticket className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-black text-amber-950 dark:text-amber-200">
                  Customer Support &amp; Order Tickets ({openTicketsCount} Open · {myTickets.length} Total)
                </h3>
                <p className="text-[11px] text-amber-900/80 dark:text-amber-300/80 mt-0.5">
                  Need help with an order, delivery, product, or refund? Create a support ticket or follow up on open tickets anytime.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('tickets')}
              className="px-4 py-2 bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-black text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
            >
              <Ticket className="w-3.5 h-3.5" />
              <span>Open Support Tickets</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. ORDERS & KHATA HISTORY TAB */}
      {activeTab === 'orders' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              My Transaction &amp; Purchase History
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              {myTransactions.length} Total Entries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Invoice / Details</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Market Rate</th>
                  <th className="py-3 px-4">You Paid / Bill</th>
                  <th className="py-3 px-4 text-right">Your Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No transactions recorded for this account yet.
                    </td>
                  </tr>
                ) : (
                  myTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">
                        {tx.date}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {tx.invoiceNumber || 'Sale Invoice'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {tx.items?.map((it) => `${it.quantity}x ${it.description}`).join(', ') || tx.notes || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            tx.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : tx.status === 'partially_paid'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          }`}
                        >
                          {tx.status?.replace('_', ' ') || 'Completed'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 line-through">
                        {tx.items && tx.items[0]?.marketPrice
                          ? `${profile.currencySymbol}${(tx.items.reduce((s, i) => s + (i.marketPrice || i.unitPrice) * i.quantity, 0)).toLocaleString('en-PK')}`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {profile.currencySymbol}{tx.amount.toLocaleString('en-PK')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {tx.totalSavings ? `+${profile.currencySymbol}${tx.totalSavings.toLocaleString('en-PK')}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2B. CUSTOMER SUPPORT TICKETS TAB (Signed-in Only) */}
      {activeTab === 'tickets' && (
        <div className="space-y-5">
          {/* Create Support Ticket Form */}
          <form
            onSubmit={handleCreateCustomerTicket}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4 shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-amber-500" />
                  <span>Open a New Support Ticket (شکایت یا مدد کے لیے ٹکٹ بنائیں)</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Signed in as <strong>{customer?.name || currentUser.name}</strong> ({customer?.phone || currentUser.phone}). Tickets stay Open until your issue is resolved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadMyTickets()}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer self-start sm:self-auto"
              >
                {ticketsLoading ? 'Refreshing...' : 'Refresh Tickets'}
              </button>
            </div>

            {ticketError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{ticketError}</span>
              </div>
            )}

            {ticketSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{ticketSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Category (قسم)
                </label>
                <select
                  value={ticketCategory}
                  onChange={(e) => setTicketCategory(e.target.value as CRMTicketCategory)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {CUSTOMER_TICKET_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Priority (ترجیح)
                </label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value as CRMTicketPriority)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="Low">Low (48h SLA)</option>
                  <option value="Medium">Medium (24h SLA)</option>
                  <option value="High">High (12h SLA)</option>
                  <option value="Urgent">Urgent (4h SLA)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Related Order # (اختیاری)
                </label>
                <input
                  type="text"
                  list="customer-portal-orders-list"
                  value={ticketOrderNumber}
                  onChange={(e) => setTicketOrderNumber(e.target.value)}
                  placeholder="Select or type COD-100D-..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <datalist id="customer-portal-orders-list">
                  {myCodOrders.map((o) => (
                    <option key={o.id} value={o.orderNumber}>
                      {o.orderNumber} ({o.status} - {profile.currencySymbol}{o.totalAmount})
                    </option>
                  ))}
                  {myTransactions
                    .filter((tx) => tx.invoiceNumber)
                    .map((tx) => (
                      <option key={tx.id} value={tx.invoiceNumber!}>
                        {tx.invoiceNumber} ({tx.date})
                      </option>
                    ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Subject * (موضوع)
                </label>
                <input
                  type="text"
                  required
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="Brief issue summary"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                Issue Details (تفصیلات)
              </label>
              <textarea
                rows={3}
                value={ticketDescription}
                onChange={(e) => setTicketDescription(e.target.value)}
                placeholder="Describe your question, order issue, or request in detail..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={ticketSubmitting}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-black text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{ticketSubmitting ? 'Submitting...' : 'Create Support Ticket'}</span>
              </button>
            </div>
          </form>

          {/* My Tickets List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                My Support Tickets ({myTickets.length})
              </h3>
              <div className="flex items-center gap-1.5 text-xs">
                {(['all', 'open', 'resolved'] as const).map((flt) => (
                  <button
                    key={flt}
                    type="button"
                    onClick={() => setTicketFilter(flt)}
                    className={`px-3 py-1 rounded-lg font-bold capitalize cursor-pointer ${
                      ticketFilter === flt
                        ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {flt === 'all'
                      ? `All (${myTickets.length})`
                      : flt === 'open'
                      ? `Open (${openTicketsCount})`
                      : `Resolved / Closed (${myTickets.length - openTicketsCount})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {myTickets
                .filter((t) => {
                  const isDone = t.status === 'Resolved' || t.status === 'Closed';
                  if (ticketFilter === 'open') return !isDone;
                  if (ticketFilter === 'resolved') return isDone;
                  return true;
                })
                .map((t) => {
                  const isClosedOrResolved = t.status === 'Resolved' || t.status === 'Closed';
                  return (
                    <div
                      key={t.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                            {t.ticketNumber}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white text-sm">
                            {t.subject}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-bold">
                            {t.category}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-[10px] font-bold">
                            {t.priority}
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider self-start sm:self-auto ${
                            t.status === 'Open'
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                              : t.status === 'Investigating' || t.status === 'Escalated'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-3">
                        <span>Created: {t.createdAt.slice(0, 16).replace('T', ' ')}</span>
                        {t.orderNumber && <span>Order #: <strong>{t.orderNumber}</strong></span>}
                        <span>Target Response: {t.dueAt.slice(0, 16).replace('T', ' ')}</span>
                      </div>

                      {t.description && (
                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-line">
                          {t.description}
                        </div>
                      )}

                      {t.resolutionNotes && (
                        <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200">
                          <strong>Support Team Note:</strong> {t.resolutionNotes}
                        </div>
                      )}

                      {/* Customer follow-up & Keep Open / Reopen controls */}
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={followUpDrafts[t.id] || ''}
                          onChange={(e) =>
                            setFollowUpDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                          }
                          placeholder="Add a follow-up message or reply for support..."
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={updatingTicketId === t.id || !(followUpDrafts[t.id] || '').trim()}
                            onClick={() => void handleCustomerTicketFollowUp(t, {})}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            Send Reply
                          </button>
                          {isClosedOrResolved ? (
                            <button
                              type="button"
                              disabled={updatingTicketId === t.id}
                              onClick={() => void handleCustomerTicketFollowUp(t, { keepOpen: true })}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reopen / Keep Open</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={updatingTicketId === t.id}
                              onClick={() => void handleCustomerTicketFollowUp(t, { closeTicket: true })}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs cursor-pointer"
                            >
                              Mark Resolved
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

              {myTickets.filter((t) => {
                const isDone = t.status === 'Resolved' || t.status === 'Closed';
                if (ticketFilter === 'open') return !isDone;
                if (ticketFilter === 'resolved') return isDone;
                return true;
              }).length === 0 && (
                <p className="py-8 text-center text-slate-400">
                  {ticketsLoading
                    ? 'Loading your support tickets...'
                    : 'No support tickets found. Use the form above anytime you need help.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. REPORTS & SAVINGS TAB */}
      {activeTab === 'reports' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5 shadow-xs">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Personal Savings Report (ذاتی بچت کا خلاصہ)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Comparison between regular retail market prices and your Super Best rates on Madina Market.
            </p>
          </div>

          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  Lifetime Cumulative Savings
                </span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  {profile.currencySymbol}{totalSavings.toLocaleString('en-PK')} Saved
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('monthly_statement')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
              >
                View Full Monthly Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. PAYMENT INSTRUCTIONS TAB (Account numbers shown strictly on Checkout page) */}
      {activeTab === 'payments' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5 shadow-xs">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Accepted Payment Methods (رقم ادائیگی کے محفوظ ذرائع)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              For security, our unified EasyPaisa / JazzCash / SadaPay account number is revealed exclusively on the Checkout page when placing an order. Cash on Delivery (COD) is also available.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/20">
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block">
                EasyPaisa / JazzCash / SadaPay
              </span>
              <div className="text-xs font-bold text-slate-900 dark:text-white mt-1.5">
                Single Unified Wallet Number
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                Shown securely at Checkout when confirming an order.
              </span>
            </div>

            <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/50 dark:bg-blue-950/20">
              <span className="text-xs font-bold text-blue-800 dark:text-blue-300 block">
                Cash on Delivery (COD)
              </span>
              <div className="text-xs font-bold text-slate-900 dark:text-white mt-1.5">
                Pay Cash to Rider upon Delivery
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                Active for Muzaffarabad &amp; approved delivery cities.
              </span>
            </div>

            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 block">
                  Ready to Place an Order?
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-1">
                  Proceed to Checkout from your cart to view full payment details.
                </span>
              </div>
              {onOpenCart && (
                <button
                  type="button"
                  onClick={onOpenCart}
                  className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-lg cursor-pointer self-start"
                >
                  Open Cart &amp; Checkout
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. CHANGE PASSWORD / PIN & USERNAME TAB */}
      {activeTab === 'security' && (
        <div className="space-y-5 max-w-lg">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setUsernameError('');
              setUsernameSuccess('');
              const clean = usernameInput.trim().replace(/^@+/, '').toLowerCase();
              if (!/^[a-z0-9_.-]{3,32}$/.test(clean)) {
                setUsernameError('Username must be 3 to 32 characters (letters, numbers, _, ., or -).');
                return;
              }
              setIsUpdatingUsername(true);
              const res = await apiUpdateUsername(clean);
              setIsUpdatingUsername(false);
              if (!res.ok || !res.username) {
                setUsernameError(res.error || 'Could not update username.');
                return;
              }
              setUsernameInput(res.username);
              setUsernameSuccess(`Username saved: @${res.username}`);
              onUsernameChanged?.(res.username);
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-3 shadow-xs"
          >
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <User className="w-4 h-4 text-amber-500" />
                Username / Login Handle (یوزرنیم)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sign in with your custom username alongside your mobile number.
              </p>
            </div>

            {usernameError && (
              <div className="p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{usernameError}</span>
              </div>
            )}

            {usernameSuccess && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{usernameSuccess}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2 text-xs font-mono font-bold text-slate-400">@</span>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="your_username"
                  className="w-full pl-7 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>
              <button
                type="submit"
                disabled={isUpdatingUsername}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer shrink-0 disabled:opacity-60"
              >
                {isUpdatingUsername ? 'Saving...' : 'Save Username'}
              </button>
            </div>
          </form>

          <form onSubmit={handleChangePassword} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4 shadow-xs">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-500" />
                Change Security Password / PIN
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                اپنے کھاتے کا سیکیورٹی پاس ورڈ یا پن کوڈ تبدیل کریں (محفوظ سالٹڈ اینکرپشن)
              </p>
            </div>

            {securityError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{securityError}</span>
              </div>
            )}

            {securitySuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{securitySuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Current Password / PIN (موجودہ پن):
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={currentPasswordInput}
                onChange={(e) => setCurrentPasswordInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                placeholder="••••••"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                New Password / PIN (نیا پن):
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={4}
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                placeholder="Min 4 to 6 digits"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Confirm New Password (تصدیق نیا پن):
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={4}
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                placeholder="Repeat new PIN"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPassword ? 'Hide password' : 'Show password'}</span>
              </button>

              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isUpdatingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
