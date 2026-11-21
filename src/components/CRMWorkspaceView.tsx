import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  HeartHandshake,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Target,
  Ticket,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  AppUser,
  BusinessProfile,
  CRMAutoSegmentName,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMDashboardKPIs,
  CRMFollowUpPriority,
  CRMFollowUpStatus,
  CRMFollowUpTask,
  CRMFollowUpTaskType,
  CRMLead,
  CRMLeadStage,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMReportKey,
  CRMSourceChannel,
  CRMSupportTicket,
  CRMTicketCategory,
  CRMTicketPriority,
  CRMTicketStatus,
  CRMWhatsAppTemplateType,
  Customer,
  Customer360Profile,
  ProductItem,
} from '../types/index.ts';
import {
  ALL_AUTO_SEGMENTS,
  CRM_REPORT_CATALOG,
  CRM_WHATSAPP_TEMPLATES,
  renderCrmWhatsAppTemplate,
} from '../utils/crmEngine.ts';
import {
  CRMStateBundle,
  apiConvertCrmLead,
  apiDeleteCrmCustomSegment,
  apiDeleteCrmTask,
  apiFetchCrmDashboard,
  apiFetchCrmReport,
  apiFetchCrmState,
  apiFetchCustomer360,
  apiLogCrmActivity,
  apiRedeemLoyaltyPoints,
  apiRunCrmAutomation,
  apiSaveCrmAutomationRule,
  apiSaveCrmCampaign,
  apiSaveCrmCoupon,
  apiSaveCrmLead,
  apiSaveCrmLoyaltyConfig,
  apiSaveCrmCustomSegment,
  apiSaveCrmTask,
  apiSaveCrmTicket,
  apiUpdateCrmCustomer,
  downloadCrmReportFile,
} from '../utils/storage.ts';
import { openWhatsAppDirect } from '../utils/whatsapp.ts';

interface CRMWorkspaceViewProps {
  currentUser: AppUser;
  profile: BusinessProfile;
  products: ProductItem[];
  initialCustomerId?: string;
  onClearInitialCustomer?: () => void;
  onOpenCustomerKhata?: (customerId: string) => void;
  onRefreshGlobalData?: () => void;
}

type CRMSubTab =
  | 'dashboard'
  | 'customers360'
  | 'followups'
  | 'leads'
  | 'whatsapp'
  | 'loyalty'
  | 'tickets'
  | 'automation'
  | 'reports';

const LEAD_STAGES: CRMLeadStage[] = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Lost'];
const LEAD_SOURCES: CRMSourceChannel[] = [
  'WhatsApp',
  'Website',
  'Facebook',
  'Instagram',
  'Walk-in',
  'Phone',
  'Referral',
  'Reseller Network',
];
const TICKET_CATEGORIES: CRMTicketCategory[] = [
  'Damaged product',
  'Wrong item',
  'Late delivery',
  'Payment issue',
  'Refund request',
  'Product quality',
  'Courier issue',
  'Staff complaint',
  'General inquiry',
  'Product Inquiry',
];

export const CRMWorkspaceView: React.FC<CRMWorkspaceViewProps> = ({
  currentUser,
  profile,
  products,
  initialCustomerId,
  onClearInitialCustomer,
  onOpenCustomerKhata,
  onRefreshGlobalData,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<CRMSubTab>(initialCustomerId ? 'customers360' : 'dashboard');
  const [crmState, setCrmState] = useState<CRMStateBundle | null>(null);
  const [filteredKpis, setFilteredKpis] = useState<CRMDashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const showNotice = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setBanner({ type, text });
    window.setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  }, []);

  // Permission helpers (Admins/Super Admins have full authority; managers/staff follow explicit CRMPermissions)
  const isAdmin = currentUser.role === 'super_admin' || currentUser.role === 'admin';
  const perms = currentUser.crmPermissions || {};
  const can = useCallback(
    (key: keyof NonNullable<AppUser['crmPermissions']>) => {
      if (isAdmin) return true;
      return perms[key] !== false;
    },
    [isAdmin, perms]
  );
  const canApproveBulk = isAdmin || Boolean(perms.canApproveBulkMessages);

  // Dashboard filters
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashCity, setDashCity] = useState('ALL');
  const [dashCustomerType, setDashCustomerType] = useState('ALL');
  const [dashSalesperson, setDashSalesperson] = useState('');

  // Customers 360 & Segmentation state
  const [custSearch, setCustSearch] = useState('');
  const [custSegmentFilter, setCustSegmentFilter] = useState<string>('ALL');
  const [custCityFilter, setCustCityFilter] = useState<string>('ALL');
  const [custTypeFilter, setCustTypeFilter] = useState<string>('ALL');
  const [custPage, setCustPage] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState<Customer360Profile | null>(null);
  const [profileEditNotes, setProfileEditNotes] = useState('');
  const [profileEditTags, setProfileEditTags] = useState('');
  const [profileEditSalesperson, setProfileEditSalesperson] = useState('');
  const [profileEditSource, setProfileEditSource] = useState('');
  const [profileEditEmail, setProfileEditEmail] = useState('');
  const [manualLogType, setManualLogType] = useState<'note_added' | 'call_logged' | 'whatsapp_opened'>('note_added');
  const [manualLogText, setManualLogText] = useState('');
  const [showCustomSegForm, setShowCustomSegForm] = useState(false);
  const [newSegName, setNewSegName] = useState('');
  const [newSegMinSpend, setNewSegMinSpend] = useState('');
  const [newSegMinOrders, setNewSegMinOrders] = useState('');
  const [newSegMinInactiveDays, setNewSegMinInactiveDays] = useState('');
  const [newSegCity, setNewSegCity] = useState('');
  const [newSegCategory, setNewSegCategory] = useState('');
  const [newSegOutstandingOnly, setNewSegOutstandingOnly] = useState(false);

  // Follow-ups state
  const [taskFilterBucket, setTaskFilterBucket] = useState<'all' | 'today' | 'overdue' | 'upcoming' | 'completed'>('all');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCustId, setTaskCustId] = useState('');
  const [taskType, setTaskType] = useState<CRMFollowUpTaskType>('Call');
  const [taskDate, setTaskDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [taskPriority, setTaskPriority] = useState<CRMFollowUpPriority>('Medium');
  const [taskAssignedName, setTaskAssignedName] = useState(currentUser.name || '');
  const [taskNotes, setTaskNotes] = useState('');

  // Leads state
  const [leadStageFilter, setLeadStageFilter] = useState<string>('ALL');
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadCity, setLeadCity] = useState('');
  const [leadSource, setLeadSource] = useState<CRMSourceChannel>('WhatsApp');
  const [leadProductId, setLeadProductId] = useState('');
  const [leadEstValue, setLeadEstValue] = useState('');
  const [leadFollowDate, setLeadFollowDate] = useState('');
  const [leadNotes, setLeadNotes] = useState('');

  // WhatsApp & Campaigns state
  const [waTemplateType, setWaTemplateType] = useState<CRMWhatsAppTemplateType>('welcome');
  const [waCustomerId, setWaCustomerId] = useState('');
  const [waProductName, setWaProductName] = useState('');
  const [waOrderNumber, setWaOrderNumber] = useState('');
  const [waCouponCode, setWaCouponCode] = useState('');
  const [waCustomBody, setWaCustomBody] = useState('');
  const [campName, setCampName] = useState('');
  const [campSegment, setCampSegment] = useState('');
  const [campCity, setCampCity] = useState('');
  const [campCoupon, setCampCoupon] = useState('');
  const [campApproveNow, setCampApproveNow] = useState(false);

  // Loyalty & Coupons state
  const [loyaltyCfgDraft, setLoyaltyCfgDraft] = useState<CRMLoyaltyConfig | null>(null);
  const [redeemCustId, setRedeemCustId] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('100');
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponDiscountType, setNewCouponDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [newCouponValue, setNewCouponValue] = useState('250');
  const [newCouponMinOrder, setNewCouponMinOrder] = useState('1500');

  // Support Tickets state
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>('ALL');
  const [ticketCustId, setTicketCustId] = useState('');
  const [ticketOrderNum, setTicketOrderNum] = useState('');
  const [ticketCategory, setTicketCategory] = useState<CRMTicketCategory>('Late delivery');
  const [ticketPriority, setTicketPriority] = useState<CRMTicketPriority>('Medium');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');

  // Automation state
  const [automationApproveBulk, setAutomationApproveBulk] = useState(false);
  const [automationPreview, setAutomationPreview] = useState<{
    ruleName: string;
    dryRun: boolean;
    summary: string;
    matches: Array<{
      ruleId: string;
      ruleName: string;
      customerId: string;
      customerName: string;
      customerPhone: string;
      alreadyExecuted: boolean;
      optedOut: boolean;
      renderedMessage: string;
    }>;
  } | null>(null);

  // Reports state
  const [selectedReportKey, setSelectedReportKey] = useState<CRMReportKey>('customer_lifetime_value');
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [reportData, setReportData] = useState<{
    title: string;
    columns: string[];
    rows: Array<Record<string, string | number>>;
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const loadCrmData = useCallback(async () => {
    setLoading(true);
    const res = await apiFetchCrmState();
    setLoading(false);
    if (!res.ok || !res.data) {
      showNotice(res.error || 'Failed to load CRM workspace data.', 'error');
      return;
    }
    setCrmState(res.data);
    setFilteredKpis(res.data.kpis);
    setLoyaltyCfgDraft(res.data.loyaltyConfig);

    if (initialCustomerId) {
      const target = res.data.profiles.find((p) => p.customer.id === initialCustomerId);
      if (target) {
        setSelectedProfile(target);
        setActiveSubTab('customers360');
      }
      onClearInitialCustomer?.();
    } else if (selectedProfile) {
      const refreshed = res.data.profiles.find((p) => p.customer.id === selectedProfile.customer.id);
      if (refreshed) setSelectedProfile(refreshed);
    } else if (res.data.profiles.length > 0 && !selectedProfile) {
      setSelectedProfile(res.data.profiles[0]);
    }
  }, [initialCustomerId, onClearInitialCustomer, selectedProfile, showNotice]);

  useEffect(() => {
    void loadCrmData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProfile) return;
    setProfileEditNotes(selectedProfile.customer.notes || '');
    setProfileEditTags((selectedProfile.customer.tags || []).join(', '));
    setProfileEditSalesperson(selectedProfile.customer.assignedSalespersonName || '');
    setProfileEditSource(selectedProfile.customer.customerSource || '');
    setProfileEditEmail(selectedProfile.customer.email || '');
  }, [selectedProfile]);

  const applyDashboardFilters = async () => {
    const res = await apiFetchCrmDashboard({
      dateFrom: dashDateFrom || undefined,
      dateTo: dashDateTo || undefined,
      city: dashCity,
      customerType: dashCustomerType,
      salesperson: dashSalesperson || undefined,
    });
    if (res.ok && res.kpis) {
      setFilteredKpis(res.kpis);
      showNotice('CRM dashboard metrics updated for active filters.', 'success');
    } else {
      showNotice(res.error || 'Could not apply dashboard filters.', 'error');
    }
  };

  const resetDashboardFilters = () => {
    setDashDateFrom('');
    setDashDateTo('');
    setDashCity('ALL');
    setDashCustomerType('ALL');
    setDashSalesperson('');
    if (crmState) setFilteredKpis(crmState.kpis);
  };

  const allCities = useMemo(() => {
    if (!crmState) return [];
    const set = new Set<string>();
    crmState.profiles.forEach((p) => {
      if (p.customer.city) set.add(p.customer.city.trim());
    });
    return Array.from(set).sort();
  }, [crmState]);

  const filteredProfiles = useMemo(() => {
    if (!crmState) return [];
    const q = custSearch.trim().toLowerCase();
    return crmState.profiles.filter((p) => {
      if (q) {
        const hit =
          p.customer.name.toLowerCase().includes(q) ||
          p.customer.phone.toLowerCase().includes(q) ||
          (p.customer.city || '').toLowerCase().includes(q) ||
          (p.customer.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (custSegmentFilter !== 'ALL') {
        const matchAuto = p.autoSegments.includes(custSegmentFilter as CRMAutoSegmentName);
        const matchCustom = p.customSegments.includes(custSegmentFilter);
        if (!matchAuto && !matchCustom) return false;
      }
      if (custCityFilter !== 'ALL' && (p.customer.city || '').toLowerCase() !== custCityFilter.toLowerCase()) {
        return false;
      }
      if (custTypeFilter !== 'ALL' && p.customer.customerType !== custTypeFilter) {
        return false;
      }
      return true;
    });
  }, [crmState, custSearch, custSegmentFilter, custCityFilter, custTypeFilter]);

  const PAGE_SIZE = 25;
  const totalCustPages = Math.max(1, Math.ceil(filteredProfiles.length / PAGE_SIZE));
  const safeCustPage = Math.min(custPage, totalCustPages);
  const paginatedProfiles = filteredProfiles.slice((safeCustPage - 1) * PAGE_SIZE, safeCustPage * PAGE_SIZE);

  const openProfile360 = async (custId: string) => {
    const localMatch = crmState?.profiles.find((p) => p.customer.id === custId);
    if (localMatch) setSelectedProfile(localMatch);
    const fresh = await apiFetchCustomer360(custId);
    if (fresh.ok && fresh.profile360) {
      setSelectedProfile(fresh.profile360);
    }
    setActiveSubTab('customers360');
  };

  const handleSaveCustomer360Meta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile) return;
    const tags = profileEditTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await apiUpdateCrmCustomer(selectedProfile.customer.id, {
      notes: profileEditNotes,
      tags,
      assignedSalespersonName: profileEditSalesperson,
      customerSource: profileEditSource,
      email: profileEditEmail,
    });
    if (!res.ok) {
      showNotice(res.error || 'Failed to update customer CRM details.', 'error');
      return;
    }
    showNotice('Customer CRM profile saved.', 'success');
    await loadCrmData();
    onRefreshGlobalData?.();
  };

  const handleToggleOptOut = async (cust: Customer) => {
    const nextOptOut = !cust.whatsappOptOut;
    const res = await apiUpdateCrmCustomer(cust.id, {
      whatsappOptOut: nextOptOut,
      whatsappConsent: !nextOptOut,
    });
    if (!res.ok) {
      showNotice(res.error || 'Could not update consent flag.', 'error');
      return;
    }
    showNotice(
      nextOptOut
        ? `${cust.name} marked as WhatsApp Opted-Out (blocked from bulk campaigns).`
        : `${cust.name} enabled for WhatsApp CRM updates.`,
      'success'
    );
    await loadCrmData();
  };

  const handleToggleVipManual = async (cust: Customer) => {
    const res = await apiUpdateCrmCustomer(cust.id, { isVipManual: !cust.isVipManual });
    if (!res.ok) {
      showNotice(res.error || 'Failed to toggle VIP flag.', 'error');
      return;
    }
    showNotice(`Updated VIP status for ${cust.name}.`, 'success');
    await loadCrmData();
  };

  const handleLogManualActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile || !manualLogText.trim()) return;
    await apiLogCrmActivity({
      customerId: selectedProfile.customer.id,
      phone: selectedProfile.customer.phone,
      eventType: manualLogType,
      notes: `${currentUser.name || 'CRM'}: ${manualLogText.trim()}`,
    });
    setManualLogText('');
    showNotice('Activity logged to Customer 360° timeline.', 'success');
    await openProfile360(selectedProfile.customer.id);
  };

  const handleSaveCustomSegmentRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegName.trim()) {
      showNotice('Enter a custom segment name.', 'error');
      return;
    }
    const res = await apiSaveCrmCustomSegment({
      name: newSegName.trim(),
      isActive: true,
      criteria: {
        minTotalSpend: newSegMinSpend ? Number(newSegMinSpend) : undefined,
        minOrders: newSegMinOrders ? Number(newSegMinOrders) : undefined,
        minDaysSinceLastOrder: newSegMinInactiveDays ? Number(newSegMinInactiveDays) : undefined,
        city: newSegCity.trim() || undefined,
        categoryKeyword: newSegCategory.trim() || undefined,
        hasOutstandingBalance: newSegOutstandingOnly ? true : undefined,
      },
    });
    if (!res.ok) {
      showNotice(res.error || 'Failed to create custom segment.', 'error');
      return;
    }
    setNewSegName('');
    setNewSegMinSpend('');
    setNewSegMinOrders('');
    setNewSegMinInactiveDays('');
    setNewSegCity('');
    setNewSegCategory('');
    setNewSegOutstandingOnly(false);
    setShowCustomSegForm(false);
    showNotice('Custom segmentation rule created.', 'success');
    await loadCrmData();
  };

  const handleDeleteCustomSegmentRule = async (id: string) => {
    const res = await apiDeleteCrmCustomSegment(id);
    if (!res.ok) {
      showNotice(res.error || 'Failed to delete segment rule.', 'error');
      return;
    }
    showNotice('Custom segment deleted.', 'info');
    await loadCrmData();
  };

  // Follow-up handlers
  const todayStr = new Date().toISOString().split('T')[0];
  const filteredFollowUps = useMemo(() => {
    const list = crmState?.followUps || [];
    if (taskFilterBucket === 'today') {
      return list.filter((t) => (t.status === 'Pending' || t.status === 'In Progress') && t.followUpDate === todayStr);
    }
    if (taskFilterBucket === 'overdue') {
      return list.filter((t) => (t.status === 'Pending' || t.status === 'In Progress') && t.followUpDate < todayStr);
    }
    if (taskFilterBucket === 'upcoming') {
      return list.filter((t) => (t.status === 'Pending' || t.status === 'In Progress') && t.followUpDate > todayStr);
    }
    if (taskFilterBucket === 'completed') {
      return list.filter((t) => t.status === 'Completed' || t.status === 'Cancelled');
    }
    return list;
  }, [crmState, taskFilterBucket, todayStr]);

  const employeeTaskPerformance = useMemo(() => {
    const map = new Map<string, { pending: number; inProgress: number; completed: number; total: number }>();
    for (const f of crmState?.followUps || []) {
      const name = f.assignedEmployeeName || 'Unassigned';
      const cur = map.get(name) || { pending: 0, inProgress: 0, completed: 0, total: 0 };
      cur.total++;
      if (f.status === 'Pending') cur.pending++;
      if (f.status === 'In Progress') cur.inProgress++;
      if (f.status === 'Completed') cur.completed++;
      map.set(name, cur);
    }
    return Array.from(map.entries()).map(([name, stats]) => ({ name, ...stats }));
  }, [crmState]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      showNotice('Task title is required.', 'error');
      return;
    }
    const cust = crmState?.profiles.find((p) => p.customer.id === taskCustId)?.customer;
    const res = await apiSaveCrmTask({
      title: taskTitle.trim(),
      customerId: cust?.id,
      customerName: cust?.name || 'Walk-in / Prospect',
      customerPhone: cust?.phone,
      taskType,
      followUpDate: taskDate,
      priority: taskPriority,
      assignedEmployeeName: taskAssignedName.trim() || currentUser.name,
      notes: taskNotes.trim() || undefined,
      status: 'Pending',
    });
    if (!res.ok) {
      showNotice(res.error || 'Could not create follow-up task.', 'error');
      return;
    }
    setTaskTitle('');
    setTaskNotes('');
    showNotice('Follow-up task added.', 'success');
    await loadCrmData();
  };

  const handleUpdateTaskStatus = async (task: CRMFollowUpTask, status: CRMFollowUpStatus, outcome?: string) => {
    const res = await apiSaveCrmTask({
      ...task,
      status,
      outcome: outcome ?? task.outcome,
    });
    if (!res.ok) {
      showNotice(res.error || 'Could not update task status.', 'error');
      return;
    }
    showNotice(`Task marked ${status}.`, 'success');
    await loadCrmData();
  };

  const handleDeleteTask = async (id: string) => {
    const res = await apiDeleteCrmTask(id);
    if (!res.ok) {
      showNotice(res.error || 'Delete failed.', 'error');
      return;
    }
    showNotice('Task deleted.', 'info');
    await loadCrmData();
  };

  // Leads handlers
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadName.trim() || !leadPhone.trim()) {
      showNotice('Lead name and phone are required.', 'error');
      return;
    }
    const prod = products.find((p) => p.id === leadProductId);
    const res = await apiSaveCrmLead({
      leadName: leadName.trim(),
      phone: leadPhone.trim(),
      city: leadCity.trim() || undefined,
      source: leadSource,
      interestedProductId: prod?.id,
      interestedProductName: prod?.name,
      estimatedValue: Number(leadEstValue || 0),
      followUpDate: leadFollowDate || undefined,
      notes: leadNotes.trim() || undefined,
      stage: 'New',
    });
    if (!res.ok) {
      showNotice(res.error || 'Could not create lead.', 'error');
      return;
    }
    setLeadName('');
    setLeadPhone('');
    setLeadCity('');
    setLeadEstValue('');
    setLeadNotes('');
    showNotice('Lead added to pipeline.', 'success');
    await loadCrmData();
  };

  const handleUpdateLeadStage = async (lead: CRMLead, stage: CRMLeadStage) => {
    const res = await apiSaveCrmLead({ ...lead, stage });
    if (!res.ok) {
      showNotice(res.error || 'Could not update lead stage.', 'error');
      return;
    }
    await loadCrmData();
  };

  const handleConvertLead = async (lead: CRMLead) => {
    const res = await apiConvertCrmLead(lead.id);
    if (!res.ok) {
      showNotice(res.error || 'Lead conversion failed.', 'error');
      return;
    }
    showNotice(
      res.reusedExisting
        ? `Lead "${lead.leadName}" matched an existing customer by phone and linked cleanly without creating a duplicate.`
        : `Lead "${lead.leadName}" converted to Customer ${res.customer?.name}.`,
      'success'
    );
    await loadCrmData();
    onRefreshGlobalData?.();
  };

  // WhatsApp composer + Campaign handlers
  const waTargetCustomer = useMemo(
    () => crmState?.profiles.find((p) => p.customer.id === waCustomerId) || crmState?.profiles[0],
    [crmState, waCustomerId]
  );

  const renderedWaPreview = useMemo(() => {
    return renderCrmWhatsAppTemplate(
      waTemplateType,
      {
        customerName: waTargetCustomer?.customer.name || 'Valued Customer',
        productName: waProductName || waTargetCustomer?.recommendedProducts[0]?.name || 'featured wholesale products',
        orderNumber: waOrderNumber || 'ORD-100D',
        amount: waTargetCustomer?.averageOrderValue || 0,
        balance: waTargetCustomer?.outstandingBalance || 0,
        city: waTargetCustomer?.customer.city || 'Muzaffarabad',
        couponCode: waCouponCode || 'MADINA-VIP',
        storeName: profile.name || '100DAGAR · Madina Market',
        websiteUrl: 'https://www.madinamarket.pk',
      },
      waCustomBody || undefined
    );
  }, [waTemplateType, waTargetCustomer, waProductName, waOrderNumber, waCouponCode, waCustomBody, profile.name]);

  const handleOpenWaClickToChat = async () => {
    if (!waTargetCustomer) {
      showNotice('Select a customer with a valid phone number.', 'error');
      return;
    }
    if (waTargetCustomer.customer.whatsappOptOut) {
      showNotice(
        `${waTargetCustomer.customer.name} has opted out of WhatsApp promotional messages.`,
        'error'
      );
      return;
    }
    openWhatsAppDirect(waTargetCustomer.customer.phone, renderedWaPreview);
    await apiLogCrmActivity({
      customerId: waTargetCustomer.customer.id,
      phone: waTargetCustomer.customer.phone,
      eventType: 'whatsapp_opened',
      notes: `Opened WhatsApp click-to-chat (${waTemplateType})`,
    });
    showNotice(
      `WhatsApp chat window prepared for ${waTargetCustomer.customer.name}. Please press Send inside WhatsApp to complete delivery.`,
      'info'
    );
  };

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campName.trim()) {
      showNotice('Campaign name is required.', 'error');
      return;
    }
    const status = campApproveNow && canApproveBulk ? 'Approved' : 'Draft';
    const res = await apiSaveCrmCampaign({
      name: campName.trim(),
      templateType: waTemplateType,
      segmentName: campSegment || undefined,
      targetCity: campCity.trim() || undefined,
      couponCode: campCoupon.trim().toUpperCase() || undefined,
      messageBody: renderedWaPreview,
      status,
    });
    if (!res.ok) {
      showNotice(res.error || 'Could not save campaign.', 'error');
      return;
    }
    setCampName('');
    setCampCity('');
    setCampCoupon('');
    setCampApproveNow(false);
    showNotice(
      status === 'Approved'
        ? 'Campaign created & Admin-approved for click-to-chat outreach.'
        : 'Campaign saved as Draft (requires Administrator approval before launch).',
      'success'
    );
    await loadCrmData();
  };

  const handleUpdateCampaignStatus = async (cmp: CRMCampaign, nextStatus: 'Approved' | 'Launched') => {
    const res = await apiSaveCrmCampaign({ ...cmp, status: nextStatus });
    if (!res.ok) {
      showNotice(res.error || 'Campaign update blocked.', 'error');
      return;
    }
    showNotice(`Campaign "${cmp.name}" updated to ${nextStatus}.`, 'success');
    await loadCrmData();
  };

  // Loyalty & Coupons handlers
  const handleSaveLoyaltyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loyaltyCfgDraft) return;
    const res = await apiSaveCrmLoyaltyConfig(loyaltyCfgDraft);
    if (!res.ok) {
      showNotice(res.error || 'Failed to update loyalty settings.', 'error');
      return;
    }
    showNotice('Loyalty program rules updated.', 'success');
    await loadCrmData();
  };

  const handleRedeemPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    const custId = redeemCustId || crmState?.profiles[0]?.customer.id;
    if (!custId) return;
    const res = await apiRedeemLoyaltyPoints({
      customerId: custId,
      points: Number(redeemPoints || 0),
    });
    if (!res.ok) {
      showNotice(res.error || 'Loyalty redemption failed.', 'error');
      return;
    }
    showNotice(
      `Redeemed ${redeemPoints} points into Coupon "${res.coupon?.code}" (Rs. ${res.coupon?.discountValue}).`,
      'success'
    );
    await loadCrmData();
  };

  const handleCreateManualCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCouponCode.trim()) {
      showNotice('Enter a coupon code.', 'error');
      return;
    }
    const res = await apiSaveCrmCoupon({
      code: newCouponCode.trim().toUpperCase(),
      discountType: newCouponDiscountType,
      discountValue: Number(newCouponValue || 100),
      minOrderAmount: Number(newCouponMinOrder || 0),
      reason: 'manual_campaign',
      status: 'active',
    });
    if (!res.ok) {
      showNotice(res.error || 'Coupon save failed.', 'error');
      return;
    }
    setNewCouponCode('');
    showNotice(`Coupon "${res.coupon?.code}" is now active at checkout.`, 'success');
    await loadCrmData();
  };

  // Tickets handlers
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim()) {
      showNotice('Ticket subject is required.', 'error');
      return;
    }
    const cust = crmState?.profiles.find((p) => p.customer.id === ticketCustId)?.customer;
    const res = await apiSaveCrmTicket({
      customerId: cust?.id,
      customerName: cust?.name || 'Customer',
      customerPhone: cust?.phone,
      orderNumber: ticketOrderNum.trim() || undefined,
      category: ticketCategory,
      priority: ticketPriority,
      subject: ticketSubject.trim(),
      description: ticketDesc.trim() || undefined,
      status: 'Open',
    });
    if (!res.ok) {
      showNotice(res.error || 'Ticket creation failed.', 'error');
      return;
    }
    setTicketSubject('');
    setTicketDesc('');
    setTicketOrderNum('');
    showNotice(`Support ticket ${res.ticket?.ticketNumber} created with auto SLA timer.`, 'success');
    await loadCrmData();
  };

  const handleUpdateTicketStatus = async (tkt: CRMSupportTicket, status: CRMTicketStatus) => {
    const res = await apiSaveCrmTicket({ ...tkt, status });
    if (!res.ok) {
      showNotice(res.error || 'Failed to update ticket.', 'error');
      return;
    }
    showNotice(`Ticket ${tkt.ticketNumber} marked ${status}.`, 'success');
    await loadCrmData();
  };

  // Automation handlers
  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    const res = await apiSaveCrmAutomationRule({ id: ruleId, enabled });
    if (!res.ok) {
      showNotice(res.error || 'Could not toggle rule.', 'error');
      return;
    }
    await loadCrmData();
  };

  const handleRunRule = async (ruleId: string | undefined, ruleName: string, dryRun: boolean) => {
    const res = await apiRunCrmAutomation(ruleId || '', {
      dryRun,
      approveBulk: automationApproveBulk,
    });
    if (!res.ok) {
      showNotice(res.error || 'Automation run failed.', 'error');
      return;
    }
    const summary = dryRun
      ? `Dry-Run matched ${res.previewMatches?.length || 0} customer(s) without modifying data.`
      : `Executed: ${res.executedCount || 0} | Skipped Duplicates: ${res.skippedDuplicate || 0} | Skipped Opt-Out: ${res.skippedOptOut || 0} | Blocked Approval: ${res.blockedBulkApproval || 0}`;
    setAutomationPreview({
      ruleName,
      dryRun,
      summary,
      matches: res.previewMatches || [],
    });
    showNotice(summary, dryRun ? 'info' : 'success');
    if (!dryRun) await loadCrmData();
  };

  // Report loader
  const handleLoadReport = async (key: CRMReportKey = selectedReportKey) => {
    setSelectedReportKey(key);
    setReportLoading(true);
    const res = await apiFetchCrmReport(key, {
      dateFrom: reportDateFrom || undefined,
      dateTo: reportDateTo || undefined,
    });
    setReportLoading(false);
    if (!res.ok || !res.report) {
      showNotice(res.error || 'Could not load report.', 'error');
      return;
    }
    setReportData({
      title: res.report.title,
      columns: res.report.columns,
      rows: res.report.rows,
    });
  };

  const handleExportReport = async (format: 'csv' | 'xls') => {
    const res = await downloadCrmReportFile(selectedReportKey, format, {
      dateFrom: reportDateFrom || undefined,
      dateTo: reportDateTo || undefined,
    });
    if (!res.ok) {
      showNotice(res.error || 'Export failed.', 'error');
      return;
    }
    showNotice(`Downloaded ${format.toUpperCase()} report for ${selectedReportKey}.`, 'success');
  };

  const curKpis = filteredKpis || crmState?.kpis;
  const subTabs: Array<{ id: CRMSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: 'CRM Dashboard', icon: BarChart3 },
    { id: 'customers360', label: 'Customer 360° & Segments', icon: Users },
    { id: 'followups', label: 'Follow-Ups', icon: CalendarClock },
    { id: 'leads', label: 'Leads Pipeline', icon: Target },
    { id: 'whatsapp', label: 'WhatsApp & Campaigns', icon: MessageCircle },
    { id: 'loyalty', label: 'Loyalty & Coupons', icon: Award },
    { id: 'tickets', label: 'Complaints & SLA', icon: LifeBuoy },
    { id: 'automation', label: 'Automation & Intelligence', icon: Bot },
    { id: 'reports', label: '17 Reports & Export', icon: FileSpreadsheet },
  ];

  if (loading && !crmState) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          Loading real-time CRM analytics, Customer 360° timelines, and SQLite retention tables...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  100DAGAR Integrated CRM &amp; Retention Suite
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Live SQLite Sync
                </span>
                {currentUser.crmRole && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Role: {currentUser.crmRole.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Unified Customer 360° timelines, leads conversion, follow-up tasks, loyalty tiers, SLA complaints, click-to-chat WhatsApp CRM, &amp; retention automation.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadCrmData()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync CRM Data</span>
          </button>
        </div>

        {/* Sub-Navigation Pills */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveSubTab(tab.id);
                  if (tab.id === 'reports' && !reportData) {
                    void handleLoadReport('customer_lifetime_value');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950 shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inline Status Notice */}
      {banner && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between border ${
            banner.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
              : banner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="ml-3 text-[11px] underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. CRM DASHBOARD */}
      {activeSubTab === 'dashboard' && curKpis && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">From Date</label>
              <input
                type="date"
                value={dashDateFrom}
                onChange={(e) => setDashDateFrom(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">To Date</label>
              <input
                type="date"
                value={dashDateTo}
                onChange={(e) => setDashDateTo(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">City</label>
              <select
                value={dashCity}
                onChange={(e) => setDashCity(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="ALL">All Cities</option>
                {allCities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Customer Type</label>
              <select
                value={dashCustomerType}
                onChange={(e) => setDashCustomerType(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="ALL">All Types</option>
                <option value="individual">Individual</option>
                <option value="wholesale">Wholesale</option>
                <option value="shopkeeper">Shopkeeper</option>
                <option value="reseller">Reseller</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Salesperson</label>
              <input
                type="text"
                placeholder="Filter salesperson..."
                value={dashSalesperson}
                onChange={(e) => setDashSalesperson(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void applyDashboardFilters()}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-xs font-bold cursor-pointer inline-flex items-center justify-center gap-1"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
              <button
                type="button"
                onClick={resetDashboardFilters}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Real-Time KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'Total Customers', value: curKpis.totalCustomers, sub: `Today: +${curKpis.newToday} | Week: +${curKpis.newThisWeek}`, tone: 'text-slate-900 dark:text-white' },
              { label: 'New This Month', value: curKpis.newThisMonth, sub: `Active (<30d): ${curKpis.activeCustomers}`, tone: 'text-blue-600 dark:text-blue-400' },
              { label: 'Repeat Customers', value: curKpis.repeatCustomers, sub: `Repeat Rate: ${curKpis.repeatPurchaseRate}%`, tone: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'VIP Customers', value: curKpis.vipCustomers, sub: `Retention: ${curKpis.retentionRate}%`, tone: 'text-amber-600 dark:text-amber-400' },
              { label: 'Inactive / Lost', value: `${curKpis.inactiveCustomers} / ${curKpis.lostCustomers}`, sub: '30-90d+ inactive vs 120d+ lost', tone: 'text-orange-600 dark:text-orange-400' },
              { label: 'Total Customer Revenue', value: `${profile.currencySymbol}${curKpis.totalCustomerRevenue.toLocaleString('en-PK')}`, sub: `Avg Order: ${profile.currencySymbol}${curKpis.averageOrderValue.toLocaleString('en-PK')}`, tone: 'text-emerald-700 dark:text-emerald-300' },
              { label: 'Avg Customer LTV', value: `${profile.currencySymbol}${curKpis.customerLifetimeValue.toLocaleString('en-PK')}`, sub: 'Net realized CLV', tone: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Leads & Conversion', value: `${curKpis.totalLeads} (${curKpis.leadConversionRate}%)`, sub: `Converted: ${curKpis.convertedLeads}`, tone: 'text-purple-600 dark:text-purple-400' },
              { label: "Today's / Overdue Tasks", value: `${curKpis.todaysFollowUps} / ${curKpis.overdueFollowUps}`, sub: `Open SLA Tickets: ${curKpis.openTickets}`, tone: curKpis.overdueFollowUps > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white' },
              { label: 'Outstanding Balances', value: `${profile.currencySymbol}${curKpis.outstandingBalances.toLocaleString('en-PK')}`, sub: 'Unpaid customer Khata', tone: 'text-rose-600 dark:text-rose-400' },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{kpi.label}</div>
                <div className={`text-lg font-black tabular-nums mt-1 ${kpi.tone}`}>{kpi.value}</div>
                <div className="text-[10px] text-slate-400 mt-1">{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* Quick Operational Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-amber-500" />
                  <span>Priority Follow-Ups (Today &amp; Overdue)</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('followups')}
                  className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>
              <div className="space-y-2">
                {(crmState?.followUps || [])
                  .filter((f) => f.status === 'Pending' || f.status === 'In Progress')
                  .slice(0, 5)
                  .map((f) => (
                    <div key={f.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white truncate">{f.title}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {f.customerName} · Due: {f.followUpDate} · {f.assignedEmployeeName || 'Team'}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          f.followUpDate < todayStr
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {f.followUpDate < todayStr ? 'Overdue' : f.status}
                      </span>
                    </div>
                  ))}
                {(crmState?.followUps || []).filter((f) => f.status === 'Pending' || f.status === 'In Progress').length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">No open follow-up tasks pending.</p>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span>Top VIP &amp; High-CLV Customers</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('customers360')}
                  className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
                >
                  Explore 360°
                </button>
              </div>
              <div className="space-y-2">
                {[...(crmState?.profiles || [])]
                  .sort((a, b) => b.customerLifetimeValue - a.customerLifetimeValue)
                  .slice(0, 5)
                  .map((p) => (
                    <div
                      key={p.customer.id}
                      onClick={() => void openProfile360(p.customer.id)}
                      className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 hover:bg-amber-50/70 dark:hover:bg-amber-950/30 flex items-center justify-between gap-2 text-xs cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white truncate">{p.customer.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {p.customer.city || 'Pakistan'} · {p.totalOrders} orders · {p.loyalty?.tier || 'Bronze'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {profile.currencySymbol}{p.customerLifetimeValue.toLocaleString('en-PK')}
                        </div>
                        {p.outstandingBalance > 0 && (
                          <div className="text-[10px] text-rose-600 font-semibold">
                            Due: {profile.currencySymbol}{p.outstandingBalance.toLocaleString('en-PK')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. CUSTOMER 360° & SEGMENTATION */}
      {activeSubTab === 'customers360' && crmState && (
        <div className="space-y-4">
          {/* Search & Segment Filter Toolbar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={custSearch}
                    onChange={(e) => {
                      setCustSearch(e.target.value);
                      setCustPage(1);
                    }}
                    placeholder="Search name, phone, city, tags..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <select
                  value={custSegmentFilter}
                  onChange={(e) => {
                    setCustSegmentFilter(e.target.value);
                    setCustPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="ALL">All 17 Auto &amp; Custom Segments</option>
                  <optgroup label="Automatic Segments">
                    {ALL_AUTO_SEGMENTS.map((seg) => (
                      <option key={seg} value={seg}>{seg}</option>
                    ))}
                  </optgroup>
                  {crmState.customSegments.length > 0 && (
                    <optgroup label="Custom Rules">
                      {crmState.customSegments.map((cs) => (
                        <option key={cs.id} value={cs.name}>{cs.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <select
                  value={custCityFilter}
                  onChange={(e) => {
                    setCustCityFilter(e.target.value);
                    setCustPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="ALL">All Cities</option>
                  {allCities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={custTypeFilter}
                  onChange={(e) => {
                    setCustTypeFilter(e.target.value);
                    setCustPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="ALL">All Types</option>
                  <option value="individual">Individual</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="shopkeeper">Shopkeeper</option>
                  <option value="reseller">Reseller</option>
                </select>
              </div>

              {can('canManageSegments') && (
                <button
                  type="button"
                  onClick={() => setShowCustomSegForm((s) => !s)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Custom Segment Rule</span>
                </button>
              )}
            </div>

            {showCustomSegForm && (
              <form onSubmit={handleSaveCustomSegmentRule} className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 gap-2 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Rule Name *</label>
                  <input
                    type="text"
                    value={newSegName}
                    onChange={(e) => setNewSegName(e.target.value)}
                    placeholder="e.g. Lahore High Value"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Min Spend</label>
                  <input type="number" value={newSegMinSpend} onChange={(e) => setNewSegMinSpend(e.target.value)} placeholder="10000" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Min Orders</label>
                  <input type="number" value={newSegMinOrders} onChange={(e) => setNewSegMinOrders(e.target.value)} placeholder="2" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Min Days Inactive</label>
                  <input type="number" value={newSegMinInactiveDays} onChange={(e) => setNewSegMinInactiveDays(e.target.value)} placeholder="30" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">City</label>
                  <input type="text" value={newSegCity} onChange={(e) => setNewSegCity(e.target.value)} placeholder="Muzaffarabad" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Category Keyword</label>
                  <input type="text" value={newSegCategory} onChange={(e) => setNewSegCategory(e.target.value)} placeholder="Kitchen" className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] font-semibold cursor-pointer">
                    <input type="checkbox" checked={newSegOutstandingOnly} onChange={(e) => setNewSegOutstandingOnly(e.target.checked)} />
                    <span>Due&gt;0</span>
                  </label>
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer">
                    Save
                  </button>
                </div>
              </form>
            )}

            {crmState.customSegments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-bold text-slate-500">Saved Custom Rules:</span>
                {crmState.customSegments.map((cs) => (
                  <span key={cs.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
                    <button type="button" onClick={() => setCustSegmentFilter(cs.name)} className="font-semibold cursor-pointer">
                      {cs.name}
                    </button>
                    {can('canManageSegments') && (
                      <button type="button" onClick={() => void handleDeleteCustomSegmentRule(cs.id)} className="text-red-500 cursor-pointer" title="Delete Rule">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Master-Detail Customer 360 Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Customer List */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                <span>Customers ({filteredProfiles.length})</span>
                <span>Page {safeCustPage}/{totalCustPages}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
                {paginatedProfiles.map((p) => {
                  const isSel = selectedProfile?.customer.id === p.customer.id;
                  return (
                    <div
                      key={p.customer.id}
                      onClick={() => void openProfile360(p.customer.id)}
                      className={`p-3 cursor-pointer transition-colors ${
                        isSel
                          ? 'bg-amber-50/80 dark:bg-amber-950/40 border-l-4 border-amber-500'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                            <span>{p.customer.name}</span>
                            {p.autoSegments.includes('VIP Customer') && (
                              <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-amber-100 text-amber-800">VIP</span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{p.customer.phone} · {p.customer.city || 'Pakistan'}</div>
                        </div>
                        <div className="text-right text-xs shrink-0">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {profile.currencySymbol}{p.customerLifetimeValue.toLocaleString('en-PK')}
                          </div>
                          <div className="text-[10px] text-slate-400">{p.totalOrders} orders</div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.autoSegments.slice(0, 3).map((seg) => (
                          <span key={seg} className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {seg}
                          </span>
                        ))}
                        {p.outstandingBalance > 0 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            Due {profile.currencySymbol}{p.outstandingBalance.toLocaleString('en-PK')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {paginatedProfiles.length === 0 && (
                  <p className="p-6 text-center text-xs text-slate-400">No customers matched your segment filters.</p>
                )}
              </div>
              {totalCustPages > 1 && (
                <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    disabled={safeCustPage <= 1}
                    onClick={() => setCustPage((n) => Math.max(1, n - 1))}
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </button>
                  <button
                    type="button"
                    disabled={safeCustPage >= totalCustPages}
                    onClick={() => setCustPage((n) => Math.min(totalCustPages, n + 1))}
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Detailed 360 Profile */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
              {selectedProfile ? (
                <>
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-black text-slate-900 dark:text-white">{selectedProfile.customer.name}</h2>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          ID: {selectedProfile.customer.id}
                        </span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                          {selectedProfile.loyalty?.tier || 'Bronze'} ({selectedProfile.loyalty?.pointsBalance || 0} pts)
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                        <div>Phone/WhatsApp: <strong className="font-mono text-slate-800 dark:text-slate-200">{selectedProfile.customer.phone}</strong> · Type: <strong>{selectedProfile.customer.customerType}</strong></div>
                        <div>Location: {selectedProfile.customer.city || '-'} {selectedProfile.customer.area ? `(${selectedProfile.customer.area})` : ''} — {selectedProfile.customer.address}</div>
                        <div>
                          Registered: {selectedProfile.customer.createdAt || '-'} · Source: <strong>{selectedProfile.customer.customerSource || 'Direct'}</strong> · Referred By: <strong>{selectedProfile.customer.referredBy || 'None'}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleToggleVipManual(selectedProfile.customer)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          selectedProfile.customer.isVipManual
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {selectedProfile.customer.isVipManual ? '★ Manual VIP' : 'Mark VIP'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleOptOut(selectedProfile.customer)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          selectedProfile.customer.whatsappOptOut
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {selectedProfile.customer.whatsappOptOut ? 'WhatsApp Opted-Out' : 'WhatsApp Consented'}
                      </button>
                      {onOpenCustomerKhata && (
                        <button
                          type="button"
                          onClick={() => onOpenCustomerKhata(selectedProfile.customer.id)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 cursor-pointer"
                        >
                          Open Khata
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Financial & Behavior Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                      <div className="text-[10px] text-slate-500">Total Purchases ({selectedProfile.totalOrders} orders)</div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">{profile.currencySymbol}{selectedProfile.totalPurchaseValue.toLocaleString('en-PK')}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                      <div className="text-[10px] text-slate-500">Total Paid / Net CLV</div>
                      <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {profile.currencySymbol}{selectedProfile.totalPaid.toLocaleString('en-PK')} / {profile.currencySymbol}{selectedProfile.customerLifetimeValue.toLocaleString('en-PK')}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                      <div className="text-[10px] text-slate-500">Outstanding / Refunds</div>
                      <div className="font-mono font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                        {profile.currencySymbol}{selectedProfile.outstandingBalance.toLocaleString('en-PK')} / {profile.currencySymbol}{selectedProfile.refundsTotal.toLocaleString('en-PK')}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70">
                      <div className="text-[10px] text-slate-500">AOV / Frequency / COD</div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                        {profile.currencySymbol}{selectedProfile.averageOrderValue.toLocaleString('en-PK')} · {selectedProfile.orderFrequencyDays ? `${selectedProfile.orderFrequencyDays}d` : '-'} · {selectedProfile.deliveredCodCount}/{selectedProfile.totalCodCount}
                      </div>
                    </div>
                  </div>

                  {/* Segments */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Segments:</span>
                    {selectedProfile.autoSegments.map((seg) => (
                      <span key={seg} className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        {seg}
                      </span>
                    ))}
                    {selectedProfile.customSegments.map((seg) => (
                      <span key={seg} className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                        {seg}
                      </span>
                    ))}
                  </div>

                  {/* Purchased & Recommended Products */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                      <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Purchased Products &amp; Preferences</div>
                      <div className="text-[11px] text-slate-500 mb-1.5">
                        Payment: <strong>{selectedProfile.paymentPreference}</strong> · Categories: <strong>{selectedProfile.preferredCategories.join(', ') || 'General'}</strong>
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {selectedProfile.purchasedProducts.map((pp, i) => (
                          <div key={i} className="flex justify-between text-[11px]">
                            <span className="truncate">{pp.name} ×{pp.quantity}</span>
                            <span className="font-mono font-semibold">{profile.currencySymbol}{pp.totalSpent.toLocaleString('en-PK')}</span>
                          </div>
                        ))}
                        {selectedProfile.purchasedProducts.length === 0 && <span className="text-[11px] text-slate-400">No items purchased yet.</span>}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                      <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Cross-Sell Recommendations</div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {selectedProfile.recommendedProducts.map((rp) => (
                          <div key={rp.id} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate">{rp.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setWaCustomerId(selectedProfile.customer.id);
                                setWaTemplateType('product_recommendation');
                                setWaProductName(rp.name);
                                setActiveSubTab('whatsapp');
                              }}
                              className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold cursor-pointer shrink-0"
                            >
                              Pitch WhatsApp
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions from 360 Profile: Save CRM Fields, Follow-Up, Ticket */}
                  {can('canEditCustomers') && (
                    <form onSubmit={handleSaveCustomer360Meta} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <input type="text" value={profileEditSalesperson} onChange={(e) => setProfileEditSalesperson(e.target.value)} placeholder="Assigned Salesperson" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input type="text" value={profileEditTags} onChange={(e) => setProfileEditTags(e.target.value)} placeholder="Tags (comma separated)" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input type="text" value={profileEditSource} onChange={(e) => setProfileEditSource(e.target.value)} placeholder="Source (WhatsApp / Walk-in...)" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <input type="email" value={profileEditEmail} onChange={(e) => setProfileEditEmail(e.target.value)} placeholder="Email Address" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                      <div className="sm:col-span-2 flex gap-2">
                        <input type="text" value={profileEditNotes} onChange={(e) => setProfileEditNotes(e.target.value)} placeholder="CRM Customer Notes..." className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                        <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer">
                          Save CRM Info
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Quick Jump + Activity Timeline */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-amber-500" />
                        <span>Complete Activity Timeline ({selectedProfile.timeline.length})</span>
                      </h3>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setTaskCustId(selectedProfile.customer.id);
                            setTaskTitle(`Follow-up: ${selectedProfile.customer.name}`);
                            setActiveSubTab('followups');
                          }}
                          className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-[11px] font-bold cursor-pointer"
                        >
                          + Follow-Up
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTicketCustId(selectedProfile.customer.id);
                            setActiveSubTab('tickets');
                          }}
                          className="px-2 py-1 rounded bg-rose-50 text-rose-700 text-[11px] font-bold cursor-pointer"
                        >
                          + Ticket
                        </button>
                      </div>
                    </div>

                    <form onSubmit={handleLogManualActivity} className="flex gap-1.5 text-xs">
                      <select
                        value={manualLogType}
                        onChange={(e) => setManualLogType(e.target.value as 'note_added' | 'call_logged' | 'whatsapp_opened')}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      >
                        <option value="note_added">Note</option>
                        <option value="call_logged">Call Logged</option>
                        <option value="whatsapp_opened">WhatsApp Outreach</option>
                      </select>
                      <input
                        type="text"
                        value={manualLogText}
                        onChange={(e) => setManualLogText(e.target.value)}
                        placeholder="Add interaction note to timeline..."
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      />
                      <button type="submit" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                        Log
                      </button>
                    </form>

                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {selectedProfile.timeline.map((ev) => (
                        <div key={ev.id} className="p-2 rounded-lg border border-slate-100 dark:border-slate-800 flex items-start justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-200">{ev.title}</div>
                            <div className="text-[11px] text-slate-500">{ev.description}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] font-mono text-slate-400">{ev.timestamp.slice(0, 10)}</div>
                            {ev.amount !== undefined && (
                              <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
                                {profile.currencySymbol}{ev.amount.toLocaleString('en-PK')}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-12">Select a customer on the left to inspect their 360° profile.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. FOLLOW-UP TASKS MANAGEMENT */}
      {activeSubTab === 'followups' && crmState && (
        <div className="space-y-4">
          {can('canManageFollowUps') && (
            <form onSubmit={handleCreateTask} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end text-xs">
              <div className="lg:col-span-2">
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Task Title *</label>
                <input type="text" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Call for monthly restock order" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Customer</label>
                <select value={taskCustId} onChange={(e) => setTaskCustId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <option value="">General / Prospect</option>
                  {crmState.profiles.map((p) => (
                    <option key={p.customer.id} value={p.customer.id}>{p.customer.name} ({p.customer.phone})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Type &amp; Priority</label>
                <div className="flex gap-1">
                  <select value={taskType} onChange={(e) => setTaskType(e.target.value as CRMFollowUpTaskType)} className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <option value="Call">Call</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Visit">Visit</option>
                    <option value="Payment Collection">Payment Collection</option>
                    <option value="Order Check">Order Check</option>
                  </select>
                  <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as CRMFollowUpPriority)} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Follow-Up Date &amp; Assignee</label>
                <div className="flex gap-1">
                  <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <input type="text" value={taskAssignedName} onChange={(e) => setTaskAssignedName(e.target.value)} placeholder="Assignee" className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
              </div>
              <div className="flex gap-1.5">
                <input type="text" value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} placeholder="Notes..." className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </form>
          )}

          {/* Task Filter Buckets & Employee Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'today', 'overdue', 'upcoming', 'completed'] as const).map((bucket) => (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => setTaskFilterBucket(bucket)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold capitalize cursor-pointer ${
                      taskFilterBucket === bucket
                        ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {bucket}
                  </button>
                ))}
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto">
                {filteredFollowUps.map((t) => (
                  <div key={t.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{t.title}</span>
                        <span className="px-1.5 py-0.2 text-[10px] rounded bg-slate-100 dark:bg-slate-800">{t.taskType}</span>
                        <span className="px-1.5 py-0.2 text-[10px] rounded bg-amber-100 text-amber-800">{t.priority}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {t.customerName} {t.customerPhone ? `(${t.customerPhone})` : ''} · Date: <strong>{t.followUpDate}</strong> · Assigned: <strong>{t.assignedEmployeeName || 'Team'}</strong>
                      </div>
                      {t.notes && <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{t.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        value={t.status}
                        onChange={(e) => void handleUpdateTaskStatus(t, e.target.value as CRMFollowUpStatus)}
                        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                      >
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                      {t.customerPhone && (
                        <button
                          type="button"
                          onClick={() => openWhatsAppDirect(t.customerPhone!, `Assalam-o-Alaikum ${t.customerName}, following up regarding: ${t.title} - 100DAGAR Madina Market`)}
                          className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 cursor-pointer"
                          title="Open WhatsApp Chat"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {can('canManageFollowUps') && (
                        <button type="button" onClick={() => void handleDeleteTask(t.id)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 cursor-pointer" title="Delete Task">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {filteredFollowUps.length === 0 && (
                  <p className="text-center text-xs text-slate-400 py-8">No follow-up tasks in this bucket.</p>
                )}
              </div>
            </div>

            {/* Employee Performance */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-500" />
                <span>Employee Follow-Up Performance</span>
              </h3>
              <div className="space-y-2 text-xs">
                {employeeTaskPerformance.map((ep) => (
                  <div key={ep.name} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{ep.name}</div>
                      <div className="text-[11px] text-slate-500">Pending: {ep.pending} · In Progress: {ep.inProgress}</div>
                    </div>
                    <div className="text-right font-mono font-bold text-emerald-600">
                      {ep.completed}/{ep.total} Done
                    </div>
                  </div>
                ))}
                {employeeTaskPerformance.length === 0 && <p className="text-xs text-slate-400">No tasks assigned yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. LEADS PIPELINE */}
      {activeSubTab === 'leads' && crmState && (
        <div className="space-y-4">
          {can('canManageLeads') && (
            <form onSubmit={handleCreateLead} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 items-end text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Lead Name *</label>
                <input type="text" value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Prospect Name" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Phone *</label>
                <input type="text" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder="03XX-XXXXXXX" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Source Channel</label>
                <select value={leadSource} onChange={(e) => setLeadSource(e.target.value as CRMSourceChannel)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Interested Product</label>
                <select value={leadProductId} onChange={(e) => setLeadProductId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <option value="">General Inquiry</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Est. Value &amp; City</label>
                <div className="flex gap-1">
                  <input type="number" value={leadEstValue} onChange={(e) => setLeadEstValue(e.target.value)} placeholder="PKR" className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <input type="text" value={leadCity} onChange={(e) => setLeadCity(e.target.value)} placeholder="City" className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Follow-Up Date &amp; Notes</label>
                <div className="flex gap-1">
                  <input type="date" value={leadFollowDate} onChange={(e) => setLeadFollowDate(e.target.value)} className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <input type="text" value={leadNotes} onChange={(e) => setLeadNotes(e.target.value)} placeholder="Notes" className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
              </div>
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer inline-flex items-center justify-center gap-1">
                <UserPlus className="w-3.5 h-3.5" /> Add Lead
              </button>
            </form>
          )}

          {/* Pipeline Filter & Cards */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setLeadStageFilter('ALL')} className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${leadStageFilter === 'ALL' ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                All ({crmState.leads.length})
              </button>
              {LEAD_STAGES.map((st) => {
                const cnt = crmState.leads.filter((l) => l.stage === st).length;
                return (
                  <button key={st} type="button" onClick={() => setLeadStageFilter(st)} className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${leadStageFilter === st ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                    {st} ({cnt})
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3">Lead &amp; Phone</th>
                    <th className="py-2 px-3">Source</th>
                    <th className="py-2 px-3">Interest / Est. Value</th>
                    <th className="py-2 px-3">Stage</th>
                    <th className="py-2 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {crmState.leads
                    .filter((l) => leadStageFilter === 'ALL' || l.stage === leadStageFilter)
                    .map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white">{lead.leadName}</div>
                          <div className="text-[11px] font-mono text-slate-500">{lead.phone} · {lead.city || 'Pakistan'}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-semibold text-[11px]">
                            {lead.source}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{lead.interestedProductName || 'General Catalog'}</div>
                          <div className="font-mono text-[11px] text-emerald-600">{profile.currencySymbol}{lead.estimatedValue.toLocaleString('en-PK')}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={lead.stage}
                            disabled={lead.stage === 'Converted' || !can('canManageLeads')}
                            onChange={(e) => void handleUpdateLeadStage(lead, e.target.value as CRMLeadStage)}
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                          >
                            {LEAD_STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                          {lead.stage !== 'Converted' && can('canManageLeads') && (
                            <button
                              type="button"
                              onClick={() => void handleConvertLead(lead)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                            >
                              Convert to Customer
                            </button>
                          )}
                          {lead.convertedCustomerId && (
                            <button
                              type="button"
                              onClick={() => void openProfile360(lead.convertedCustomerId!)}
                              className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-bold cursor-pointer"
                            >
                              View Customer 360°
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5. WHATSAPP CRM & CAMPAIGN MANAGEMENT */}
      {activeSubTab === 'whatsapp' && crmState && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>WhatsApp CRM Click-to-Chat Composer (13 Templates)</span>
              </h3>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
              Honest Compliance Notice: Clicking "Open in WhatsApp" opens WhatsApp Web/App via <code>wa.me</code> with your personalized template pre-filled so you verify and send directly. Bulk messages require customer opt-in consent and Administrator approval.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Template (13 Scenarios)</label>
                <select value={waTemplateType} onChange={(e) => setWaTemplateType(e.target.value as CRMWhatsAppTemplateType)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  {CRM_WHATSAPP_TEMPLATES.map((t) => (
                    <option key={t.type} value={t.type}>{t.label} ({t.urduLabel})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Recipient Customer</label>
                <select value={waCustomerId} onChange={(e) => setWaCustomerId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  {crmState.profiles.map((p) => (
                    <option key={p.customer.id} value={p.customer.id}>
                      {p.customer.name} ({p.customer.phone}) {p.customer.whatsappOptOut ? '[OPTED OUT]' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <input type="text" value={waProductName} onChange={(e) => setWaProductName(e.target.value)} placeholder="Product Name variable" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              <div className="flex gap-1.5">
                <input type="text" value={waOrderNumber} onChange={(e) => setWaOrderNumber(e.target.value)} placeholder="Order #" className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <input type="text" value={waCouponCode} onChange={(e) => setWaCouponCode(e.target.value)} placeholder="Coupon Code" className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
            </div>

            <textarea
              rows={4}
              value={waCustomBody || renderedWaPreview}
              onChange={(e) => setWaCustomBody(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-sans text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              {waCustomBody && (
                <button type="button" onClick={() => setWaCustomBody('')} className="text-[11px] underline text-slate-500 cursor-pointer">
                  Reset to Template Default
                </button>
              )}
              <button
                type="button"
                disabled={!can('canSendWhatsAppCrm')}
                onClick={() => void handleOpenWaClickToChat()}
                className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Click-to-Chat in WhatsApp</span>
              </button>
            </div>
          </div>

          {/* Campaigns Builder & Approval Ledger */}
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Megaphone className="w-4 h-4 text-amber-500" />
              <span>Marketing Campaigns &amp; Admin Consent Guard</span>
            </h3>

            {can('canManageCampaigns') && (
              <form onSubmit={handleSaveCampaign} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                <input type="text" value={campName} onChange={(e) => setCampName(e.target.value)} placeholder="Campaign Title *" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                <select value={campSegment} onChange={(e) => setCampSegment(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <option value="">All Consented Customers</option>
                  {ALL_AUTO_SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="text" value={campCity} onChange={(e) => setCampCity(e.target.value)} placeholder="Target City (Optional)" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                <input type="text" value={campCoupon} onChange={(e) => setCampCoupon(e.target.value)} placeholder="Linked Coupon Code (Optional)" className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
                <div className="sm:col-span-2 flex items-center justify-between gap-2">
                  {canApproveBulk ? (
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                      <input type="checkbox" checked={campApproveNow} onChange={(e) => setCampApproveNow(e.target.checked)} />
                      <span>Admin Approve Now (Consent verified)</span>
                    </label>
                  ) : (
                    <span className="text-[11px] text-amber-600">Saved as Draft for Admin Approval</span>
                  )}
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer">
                    Save Campaign
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {crmState.campaigns.map((c) => (
                <div key={c.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{c.name}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        c.status === 'Approved' || c.status === 'Launched'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Segment: {c.segmentName || 'All'} · Matched Consented Recipients: <strong>{c.recipientsCount}</strong> {c.adminApprovedBy ? `· Approved by ${c.adminApprovedBy}` : ''}
                    </div>
                  </div>
                  {canApproveBulk && (c.status === 'Draft' || c.status === 'draft') && (
                    <button type="button" onClick={() => void handleUpdateCampaignStatus(c, 'Approved')} className="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer shrink-0">
                      Approve
                    </button>
                  )}
                  {canApproveBulk && (c.status === 'Approved' || c.status === 'approved') && (
                    <button type="button" onClick={() => void handleUpdateCampaignStatus(c, 'Launched')} className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold cursor-pointer shrink-0">
                      Mark Launched
                    </button>
                  )}
                </div>
              ))}
              {crmState.campaigns.length === 0 && <p className="text-center text-slate-400 py-6">No campaigns created yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* 6. LOYALTY & COUPONS */}
      {activeSubTab === 'loyalty' && crmState && loyaltyCfgDraft && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Loyalty Config */}
            <form onSubmit={handleSaveLoyaltyConfig} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                <span>Loyalty Rules &amp; Tier Configuration</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Pts per Rs. 1,000</label>
                  <input type="number" value={loyaltyCfgDraft.pointsPerThousandPkr} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, pointsPerThousandPkr: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">PKR per Point</label>
                  <input type="number" value={loyaltyCfgDraft.pkrPerPoint} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, pkrPerPoint: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Silver Pts</label>
                  <input type="number" value={loyaltyCfgDraft.silverThresholdPoints} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, silverThresholdPoints: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Gold Pts</label>
                  <input type="number" value={loyaltyCfgDraft.goldThresholdPoints} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, goldThresholdPoints: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">VIP Platinum Pts</label>
                  <input type="number" value={loyaltyCfgDraft.vipThresholdPoints} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, vipThresholdPoints: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Coupon Days Valid</label>
                  <input type="number" value={loyaltyCfgDraft.couponValidityDays} onChange={(e) => setLoyaltyCfgDraft({ ...loyaltyCfgDraft, couponValidityDays: Number(e.target.value) })} className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
              </div>
              {can('canManageLoyalty') && (
                <button type="submit" className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer">
                  Save Loyalty Rules
                </button>
              )}
            </form>

            {/* Redeem Points + Manual Coupon */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-emerald-500" />
                <span>Redeem Points &amp; Issue Checkout Coupons</span>
              </h3>
              <form onSubmit={handleRedeemPoints} className="flex flex-wrap gap-2 items-end">
                <select value={redeemCustId} onChange={(e) => setRedeemCustId(e.target.value)} className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <option value="">Select Customer...</option>
                  {crmState.profiles.map((p) => (
                    <option key={p.customer.id} value={p.customer.id}>
                      {p.customer.name} ({p.loyalty?.pointsBalance || 0} pts - {p.loyalty?.tier || 'Bronze'})
                    </option>
                  ))}
                </select>
                <input type="number" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} placeholder="Pts" className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <button type="submit" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer">
                  Redeem into Coupon
                </button>
              </form>

              {can('canManageLoyalty') && (
                <form onSubmit={handleCreateManualCoupon} className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 items-end">
                  <input type="text" value={newCouponCode} onChange={(e) => setNewCouponCode(e.target.value)} placeholder="Code (EID500)" className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 uppercase" />
                  <select value={newCouponDiscountType} onChange={(e) => setNewCouponDiscountType(e.target.value as 'fixed' | 'percent')} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <option value="fixed">Fixed PKR</option>
                    <option value="percent">% Off</option>
                  </select>
                  <input type="number" value={newCouponValue} onChange={(e) => setNewCouponValue(e.target.value)} placeholder="Value" className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <input type="number" value={newCouponMinOrder} onChange={(e) => setNewCouponMinOrder(e.target.value)} placeholder="Min Order" className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer">
                    Create Coupon
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Active Coupons & Loyalty Accounts Table */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <h4 className="font-bold text-slate-900 dark:text-white mb-2">Customer Loyalty Balances ({crmState.loyaltyAccounts.length})</h4>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {crmState.loyaltyAccounts.map((acc) => {
                  const cust = crmState.profiles.find((p) => p.customer.id === acc.customerId)?.customer;
                  return (
                    <div key={acc.customerId} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">{cust?.name || acc.customerId}</div>
                        <div className="text-[11px] text-slate-500">Tier: <strong>{acc.tier}</strong> · Lifetime: {acc.lifetimePointsEarned} pts</div>
                      </div>
                      <div className="font-mono font-bold text-amber-600">{acc.pointsBalance} pts</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <h4 className="font-bold text-slate-900 dark:text-white mb-2">Coupons Ledger ({crmState.coupons.length})</h4>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {crmState.coupons.map((cp) => (
                  <div key={cp.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white">{cp.code}</div>
                      <div className="text-[11px] text-slate-500">
                        {cp.discountType === 'fixed' ? `Rs. ${cp.discountValue}` : `${cp.discountValue}%`} off {cp.minOrderAmount ? `(Min Rs. ${cp.minOrderAmount})` : ''} · {cp.reason || cp.rewardType || 'campaign'}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cp.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {cp.status}
                    </span>
                  </div>
                ))}
                {crmState.coupons.length === 0 && <p className="text-slate-400 py-6 text-center">No coupons issued yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. SUPPORT & COMPLAINT TICKETS */}
      {activeSubTab === 'tickets' && crmState && (
        <div className="space-y-4 text-xs">
          {can('canManageTickets') && (
            <form onSubmit={handleCreateTicket} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Customer</label>
                <select value={ticketCustId} onChange={(e) => setTicketCustId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <option value="">Walk-in / General</option>
                  {crmState.profiles.map((p) => (
                    <option key={p.customer.id} value={p.customer.id}>{p.customer.name} ({p.customer.phone})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Category &amp; Priority</label>
                <div className="flex gap-1">
                  <select value={ticketCategory} onChange={(e) => setTicketCategory(e.target.value as CRMTicketCategory)} className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={ticketPriority} onChange={(e) => setTicketPriority(e.target.value as CRMTicketPriority)} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <option value="Low">Low (48h)</option>
                    <option value="Medium">Medium (24h)</option>
                    <option value="High">High (12h)</option>
                    <option value="Urgent">Urgent (4h)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Order # (Optional)</label>
                <input type="text" value={ticketOrderNum} onChange={(e) => setTicketOrderNum(e.target.value)} placeholder="COD-100D-..." className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject *</label>
                <input type="text" value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} placeholder="Short issue summary" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Details</label>
                <input type="text" value={ticketDesc} onChange={(e) => setTicketDesc(e.target.value)} placeholder="Complaint notes" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold cursor-pointer inline-flex items-center justify-center gap-1">
                <Ticket className="w-3.5 h-3.5" /> Open Ticket
              </button>
            </form>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'Open', 'Investigating', 'Escalated', 'Resolved', 'Closed'] as const).map((st) => (
                <button key={st} type="button" onClick={() => setTicketStatusFilter(st)} className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${ticketStatusFilter === st ? 'bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                  {st}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {crmState.tickets
                .filter((t) => ticketStatusFilter === 'ALL' || t.status === ticketStatusFilter)
                .map((t) => {
                  const isSlaBreached = t.status !== 'Resolved' && t.status !== 'Closed' && new Date(t.dueAt).getTime() < Date.now();
                  return (
                    <div key={t.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-amber-600">{t.ticketNumber}</span>
                          <span>{t.subject}</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">{t.category}</span>
                          {isSlaBreached && (
                            <span className="px-1.5 py-0.2 rounded bg-red-100 text-red-700 text-[10px] font-bold">SLA BREACHED</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Customer: <strong>{t.customerName}</strong> {t.orderNumber ? `· Order #${t.orderNumber}` : ''} · Priority: <strong>{t.priority}</strong> · SLA Due: {t.dueAt.slice(0, 16).replace('T', ' ')}
                        </div>
                        {t.description && <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{t.description}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select value={t.status} onChange={(e) => void handleUpdateTicketStatus(t, e.target.value as CRMTicketStatus)} className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
                          <option value="Open">Open</option>
                          <option value="Investigating">Investigating</option>
                          <option value="Escalated">Escalated</option>
                          <option value="Resolved">Resolved</option>
                          <option value="Closed">Closed</option>
                        </select>
                        {t.customerPhone && (
                          <button type="button" onClick={() => openWhatsAppDirect(t.customerPhone!, `Assalam-o-Alaikum ${t.customerName}, update on Ticket ${t.ticketNumber} (${t.subject}): `)} className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 cursor-pointer" title="WhatsApp Customer">
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              {crmState.tickets.length === 0 && <p className="text-center text-slate-400 py-8">No complaints or tickets recorded.</p>}
            </div>
          </div>
        </div>
      )}

      {/* 8. RETENTION AUTOMATION & PRODUCT INTELLIGENCE */}
      {activeSubTab === 'automation' && crmState && (
        <div className="space-y-4 text-xs">
          {/* Controls Header */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-amber-500" />
                <span>13 Retention Automation Rules (Dry-Run + Idempotency + Consent Guards)</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Always run Dry-Run first to inspect matched customers. Bulk WhatsApp rules require explicit Administrator approval and skip opted-out customers.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canApproveBulk && (
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 font-bold text-[11px] cursor-pointer">
                  <input type="checkbox" checked={automationApproveBulk} onChange={(e) => setAutomationApproveBulk(e.target.checked)} />
                  <span>Admin Approve Bulk Runs</span>
                </label>
              )}
              <button type="button" onClick={() => void handleRunRule(undefined, 'All Active Rules', true)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                Dry-Run All Active
              </button>
              <button type="button" onClick={() => void handleRunRule(undefined, 'All Active Rules', false)} className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer inline-flex items-center gap-1">
                <Play className="w-3.5 h-3.5" /> Execute Active Rules
              </button>
            </div>
          </div>

          {/* Preview Banner */}
          {automationPreview && (
            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-bold text-blue-900 dark:text-blue-200">
                  {automationPreview.ruleName} — {automationPreview.summary}
                </div>
                <button type="button" onClick={() => setAutomationPreview(null)} className="underline text-[11px] cursor-pointer">Close</button>
              </div>
              {automationPreview.matches.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {automationPreview.matches.map((m, idx) => (
                    <div key={idx} className="p-2 rounded bg-white dark:bg-slate-900 flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <strong>{m.customerName}</strong> ({m.customerPhone}) — <span className="text-slate-500">{m.ruleName}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {m.alreadyExecuted && <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-bold">Already Executed (Idempotent Skip)</span>}
                        {m.optedOut && <span className="px-1.5 py-0.2 rounded bg-red-100 text-red-700 font-bold">Opted Out</span>}
                        {!m.alreadyExecuted && !m.optedOut && <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-bold">Eligible</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {crmState.automationRules.map((rule) => (
              <div key={rule.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">{rule.name}</span>
                    <label className="flex items-center gap-1 font-semibold text-[11px] cursor-pointer">
                      <input type="checkbox" checked={rule.enabled} disabled={!can('canManageAutomation')} onChange={(e) => void handleToggleRule(rule.id, e.target.checked)} />
                      <span>{rule.enabled ? 'Enabled' : 'Paused'}</span>
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{rule.description}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400">
                    Runs: <strong>{rule.totalTriggeredCount}</strong> {rule.requiresAdminApproval ? '· Bulk Approval Req.' : ''}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => void handleRunRule(rule.id, rule.name, true)} className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-semibold cursor-pointer">
                      Dry-Run
                    </button>
                    <button type="button" onClick={() => void handleRunRule(rule.id, rule.name, false)} className="px-2 py-1 rounded bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 text-[11px] font-bold cursor-pointer">
                      Run Now
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Product & Customer Intelligence Panel */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Product &amp; Customer Intelligence</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Best Repeat Products</div>
                {crmState.intelligence.bestRepeatProducts.slice(0, 4).map((it) => (
                  <div key={it.productId} className="flex justify-between py-0.5"><span className="truncate">{it.name}</span><span className="font-mono font-bold">{it.repeatBuyers} repeat</span></div>
                ))}
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Inquired / Cart Abandoned</div>
                {crmState.intelligence.inquiredNotOrdered.slice(0, 2).map((it) => (
                  <div key={it.productId} className="flex justify-between py-0.5"><span className="truncate">Inq: {it.name}</span><span className="font-mono">{it.inquiries}</span></div>
                ))}
                {crmState.intelligence.cartAbandonedProducts.slice(0, 2).map((it) => (
                  <div key={it.productId} className="flex justify-between py-0.5"><span className="truncate">Cart: {it.name}</span><span className="font-mono">{it.cartAdds}</span></div>
                ))}
                {crmState.intelligence.inquiredNotOrdered.length === 0 && crmState.intelligence.cartAbandonedProducts.length === 0 && (
                  <div className="text-slate-400">Logged automatically as shoppers view &amp; add to cart.</div>
                )}
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Complaints &amp; Returns Watch</div>
                {crmState.intelligence.highestComplaintProducts.slice(0, 4).map((it, i) => (
                  <div key={i} className="flex justify-between py-0.5"><span className="truncate">{it.name}</span><span className="font-mono text-rose-600">{it.ticketsCount + it.returnedOrders}</span></div>
                ))}
                {crmState.intelligence.highestComplaintProducts.length === 0 && <div className="text-slate-400">Zero complaints/returns logged.</div>}
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Price Sensitivity &amp; Co-Buys</div>
                <div>Discounted Orders: <strong>{crmState.intelligence.priceSensitivity.discountedSavingsOrders}</strong></div>
                <div>Full-Price Orders: <strong>{crmState.intelligence.priceSensitivity.fullPriceOrders}</strong></div>
                <div>Avg Discount Saved: <strong>{crmState.intelligence.priceSensitivity.averageDiscountPercent}%</strong></div>
                {crmState.intelligence.frequentlyBoughtTogether[0] && (
                  <div className="mt-1 text-emerald-700 dark:text-emerald-300">
                    Top Combo: {crmState.intelligence.frequentlyBoughtTogether[0].productA} + {crmState.intelligence.frequentlyBoughtTogether[0].productB}
                  </div>
                )}
              </div>
            </div>

            {crmState.automationLogs.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">Recent Automation Execution Audit Logs</div>
                <div className="max-h-40 overflow-y-auto space-y-1 text-[11px]">
                  {crmState.automationLogs.slice(0, 15).map((lg) => (
                    <div key={lg.id} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span><strong>{lg.ruleName || lg.triggerType}</strong> → {lg.customerName || lg.customerId} ({lg.actionSummary})</span>
                      <span className="font-mono text-slate-400">{lg.createdAt.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 9. 17 CRM & BUSINESS REPORTS + EXPORTS */}
      {activeSubTab === 'reports' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Select CRM / Business Report (17 Available)</label>
              <select value={selectedReportKey} onChange={(e) => void handleLoadReport(e.target.value as CRMReportKey)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
                {CRM_REPORT_CATALOG.map((r) => (
                  <option key={r.key} value={r.key}>{r.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">From Date</label>
              <input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">To Date</label>
              <input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void handleLoadReport(selectedReportKey)} className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-bold cursor-pointer">
                Run
              </button>
              <button type="button" disabled={!can('canExportReports')} onClick={() => void handleExportReport('csv')} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button type="button" disabled={!can('canExportReports')} onClick={() => void handleExportReport('xls')} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1 cursor-pointer">
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            {reportLoading ? (
              <div className="py-10 text-center text-slate-500">Generating report from SQLite...</div>
            ) : reportData ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{reportData.title}</h3>
                  <span className="text-[11px] font-mono text-slate-500">{reportData.rows.length} rows</span>
                </div>
                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        {reportData.columns.map((col) => (
                          <th key={col} className="py-2 px-3 font-bold whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportData.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          {reportData.columns.map((col) => (
                            <td key={col} className="py-2 px-3 whitespace-nowrap font-mono">{String(row[col] ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                      {reportData.rows.length === 0 && (
                        <tr>
                          <td colSpan={reportData.columns.length} className="py-8 text-center text-slate-400">
                            No matching records found for this report &amp; date range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="py-10 text-center text-slate-400">Select a report above and click Run.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
