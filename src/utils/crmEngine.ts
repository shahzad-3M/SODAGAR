import type {
  CODOrder,
  CRMActivityEvent,
  CRMAutoSegmentName,
  CRMCampaign,
  CRMCustomSegmentRule,
  CRMDashboardKPIs,
  CRMFollowUpTask,
  CRMLead,
  CRMBuyerSignal,
  CRMGroupSignalSummary,
  CRMLoyaltyAccount,
  CRMLoyaltyConfig,
  CRMLoyaltyCoupon,
  CRMLoyaltyLedgerEntry,
  CRMSupportTicket,
  CRMWhatsAppTemplateType,
  Customer,
  Customer360Profile,
  ProductItem,
  Reseller,
  ReviewRewardSubmission,
  Transaction,
} from '../types/index.ts';

export const ALL_AUTO_SEGMENTS: CRMAutoSegmentName[] = [
  'New Customer',
  'First Order',
  'Repeat Customer',
  'Regular Customer',
  'VIP Customer',
  'Wholesale Customer',
  'Reseller',
  'High Value',
  'Inactive 30 Days',
  'Inactive 60 Days',
  'Inactive 90 Days',
  'Lost Customer',
  'COD Risk',
  'Outstanding Payment',
  'Garments Customer',
  'Cosmetics Customer',
  'Kitchen Products Customer',
];

export interface CRMWhatsAppTemplateDefinition {
  type: CRMWhatsAppTemplateType;
  label: string;
  urduLabel: string;
  body: string;
}

export const CRM_WHATSAPP_TEMPLATES: CRMWhatsAppTemplateDefinition[] = [
  {
    type: 'welcome',
    label: 'Welcome',
    urduLabel: 'خوش آمدید',
    body: 'Assalam-o-Alaikum {{customerName}}! Welcome to {{storeName}}. We appreciate your trust. For super best prices, express Muzaffarabad delivery & nationwide dispatch, browse {{websiteUrl}} anytime.',
  },
  {
    type: 'order_confirmation',
    label: 'Order Confirmation',
    urduLabel: 'آرڈر کی تصدیق',
    body: 'Assalam-o-Alaikum {{customerName}}, your order #{{orderNumber}} for {{productName}} (Rs. {{amount}}) to {{city}} has been received by {{storeName}}. Thank you for shopping at {{websiteUrl}}!',
  },
  {
    type: 'delivery_confirmation',
    label: 'Delivery Confirmation',
    urduLabel: 'ڈیلیوری کی تصدیق',
    body: 'Assalam-o-Alaikum {{customerName}}! Your order #{{orderNumber}} has been delivered safely. Hope you loved {{productName}}. Reply anytime if you need assistance. - {{storeName}}',
  },
  {
    type: 'feedback_request',
    label: 'Feedback Request',
    urduLabel: 'فیڈبیک درخواست',
    body: 'Dear {{customerName}}, how was your experience with {{productName}} (Order #{{orderNumber}})? Share an honest review on our page or WhatsApp and unlock a Rs. 500 reward voucher! - {{storeName}}',
  },
  {
    type: 'product_recommendation',
    label: 'Product Recommendation',
    urduLabel: 'پراڈکٹ تجویز',
    body: 'Salam {{customerName}}! Based on your previous choices at {{storeName}}, we picked {{productName}} at a super best price just for you. View details: {{websiteUrl}}',
  },
  {
    type: 'new_arrivals',
    label: 'New Arrivals',
    urduLabel: 'نیا اسٹاک آمد',
    body: 'New Arrival Alert for {{customerName}}! Fresh stock of {{productName}} has arrived at {{storeName}}. Limited quantities available at super best prices: {{websiteUrl}}',
  },
  {
    type: 'discount_offer',
    label: 'Discount Offer',
    urduLabel: 'خصوصی ڈسکاؤنٹ',
    body: 'Special Offer for {{customerName}}! Enjoy exclusive savings on {{productName}} using code {{couponCode}} at {{storeName}} ({{websiteUrl}}). Valid for a limited time!',
  },
  {
    type: 'payment_reminder',
    label: 'Payment Reminder',
    urduLabel: 'ادائیگی کی یاددہانی',
    body: 'Assalam-o-Alaikum {{customerName}}, polite reminder from {{storeName}} regarding your pending Khata balance of Rs. {{balance}}. Please clear at your convenience via EasyPaisa/JazzCash/Bank. JazakAllah!',
  },
  {
    type: 'abandoned_cart',
    label: 'Abandoned Cart',
    urduLabel: 'نامکمل کارٹ یاددہانی',
    body: 'Salam {{customerName}}, we noticed you checked {{productName}} at {{storeName}}. It is still available in stock! Complete your order easily at {{websiteUrl}}.',
  },
  {
    type: 'repeat_purchase_reminder',
    label: 'Repeat Purchase Reminder',
    urduLabel: 'دوبارہ خریداری',
    body: 'Salam {{customerName}}! Time to restock your favorites like {{productName}}? Visit {{storeName}} ({{websiteUrl}}) for super best prices and priority dispatch.',
  },
  {
    type: 'inactive_recovery',
    label: 'Inactive Customer Recovery',
    urduLabel: 'پرانے کسٹمر کی واپسی',
    body: 'We miss you at {{storeName}}, {{customerName}}! Use code {{couponCode}} on your next order at {{websiteUrl}} to enjoy a special welcome-back saving on super best prices.',
  },
  {
    type: 'vip_offer',
    label: 'VIP Customer Offer',
    urduLabel: 'وی آئی پی آفر',
    body: 'Dear VIP Member {{customerName}}, as a valued top buyer at {{storeName}}, you receive priority dispatch & VIP code {{couponCode}} for your next order at {{websiteUrl}}!',
  },
  {
    type: 'referral_invitation',
    label: 'Referral Invitation',
    urduLabel: 'ریفرل دعوت نامہ',
    body: 'Assalam-o-Alaikum {{customerName}}! Share {{storeName}} ({{websiteUrl}}) with friends & earn Rs. 30 per Rs. 1,000 paid sales through our Reseller/Referral program!',
  },
];

export function renderCrmWhatsAppTemplate(
  templateType: CRMWhatsAppTemplateType,
  vars: {
    customerName?: string;
    productName?: string;
    orderNumber?: string;
    amount?: number | string;
    balance?: number | string;
    city?: string;
    couponCode?: string;
    storeName?: string;
    websiteUrl?: string;
  },
  customBody?: string
): string {
  const def = CRM_WHATSAPP_TEMPLATES.find((t) => t.type === templateType) || CRM_WHATSAPP_TEMPLATES[0];
  let text = customBody?.trim() || def.body;
  const replacements: Record<string, string> = {
    '{{customerName}}': vars.customerName || 'Valued Customer',
    '{{productName}}': vars.productName || 'featured products',
    '{{orderNumber}}': vars.orderNumber || 'N/A',
    '{{amount}}': String(vars.amount ?? 0),
    '{{balance}}': String(vars.balance ?? 0),
    '{{city}}': vars.city || 'Pakistan',
    '{{couponCode}}': vars.couponCode || 'MADINA-VIP',
    '{{storeName}}': vars.storeName || '100DAGAR · Madina Market',
    '{{websiteUrl}}':
      vars.websiteUrl ||
      (typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '/'),
  };
  for (const [token, val] of Object.entries(replacements)) {
    text = text.split(token).join(val);
  }
  return text;
}

export function normalizeDigits(val?: string | null): string {
  return (val || '').replace(/\D/g, '');
}

export interface Customer360TimelineItem {
  id: string;
  timestamp: string;
  kind:
    | 'order'
    | 'payment'
    | 'refund'
    | 'return'
    | 'complaint'
    | 'message'
    | 'follow_up'
    | 'referral'
    | 'reward'
    | 'note'
    | 'activity';
  title: string;
  description: string;
  amount?: number;
  status?: string;
}

export interface Customer360Summary {
  customer: Customer;
  totalOrders: number;
  totalPurchaseValue: number;
  totalPaid: number;
  outstandingBalance: number;
  refundsTotal: number;
  returnsTotal: number;
  returnedOrdersCount: number;
  deliveredCodCount: number;
  totalCodCount: number;
  averageOrderValue: number;
  customerLifetimeValue: number;
  orderFrequencyDays: number | null;
  daysSinceLastOrder: number | null;
  lastOrderDate?: string;
  lastActivityDate?: string;
  purchasedProducts: Array<{ productId?: string; name: string; quantity: number; totalSpent: number; category?: string }>;
  preferredCategories: string[];
  paymentPreference: string;
  autoSegments: CRMAutoSegmentName[];
  customSegments: string[];
  loyalty?: CRMLoyaltyAccount;
  loyaltyLedger: CRMLoyaltyLedgerEntry[];
  followUps: CRMFollowUpTask[];
  tickets: CRMSupportTicket[];
  coupons: CRMLoyaltyCoupon[];
  recommendedProducts: ProductItem[];
  timeline: Customer360TimelineItem[];
}

function daysBetween(isoOrDate: string, nowMs: number): number | null {
  const ts = new Date(isoOrDate).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((nowMs - ts) / (1000 * 60 * 60 * 24)));
}

export function buildCustomer360Profile(params: {
  customer: Customer;
  transactions: Transaction[];
  codOrders: CODOrder[];
  products: ProductItem[];
  resellers?: Reseller[];
  loyaltyAccounts?: CRMLoyaltyAccount[];
  loyaltyLedger?: CRMLoyaltyLedgerEntry[];
  followUps?: CRMFollowUpTask[];
  tickets?: CRMSupportTicket[];
  coupons?: CRMLoyaltyCoupon[];
  activityEvents?: CRMActivityEvent[];
  reviewRewards?: ReviewRewardSubmission[];
  customRules?: CRMCustomSegmentRule[];
  nowIso?: string;
}): Customer360Summary {
  const {
    customer,
    transactions,
    codOrders,
    products,
    resellers = [],
    loyaltyAccounts = [],
    loyaltyLedger = [],
    followUps = [],
    tickets = [],
    coupons = [],
    activityEvents = [],
    reviewRewards = [],
    customRules = [],
    nowIso = new Date().toISOString(),
  } = params;

  const nowMs = new Date(nowIso).getTime();
  const custPhoneDigits = normalizeDigits(customer.phone);
  const productById = new Map(products.map((p) => [p.id, p]));

  const custTxs = transactions.filter(
    (t) => t.customerId === customer.id && t.status !== 'cancelled'
  );
  const custOrders = codOrders.filter(
    (o) =>
      o.customerId === customer.id ||
      (custPhoneDigits && normalizeDigits(o.phone) === custPhoneDigits)
  );
  const custLoyalty = loyaltyAccounts.find((l) => l.customerId === customer.id);
  const custLedger = loyaltyLedger.filter((l) => l.customerId === customer.id);
  const custFollowUps = followUps.filter(
    (f) =>
      f.customerId === customer.id ||
      (custPhoneDigits && normalizeDigits(f.customerPhone) === custPhoneDigits)
  );
  const custTickets = tickets.filter(
    (t) =>
      t.customerId === customer.id ||
      (custPhoneDigits && normalizeDigits(t.customerPhone) === custPhoneDigits)
  );
  const custCoupons = coupons.filter((cp) => !cp.customerId || cp.customerId === customer.id);
  const custEvents = activityEvents.filter(
    (e) =>
      e.customerId === customer.id ||
      (custPhoneDigits && normalizeDigits(e.phone) === custPhoneDigits)
  );
  const custReviews = reviewRewards.filter(
    (r) =>
      r.customerId === customer.id ||
      (custPhoneDigits && normalizeDigits(r.phone) === custPhoneDigits)
  );

  // Orders & Purchase Totals
  const creditTxs = custTxs.filter((t) => t.type === 'credit');
  const debitTxs = custTxs.filter((t) => t.type === 'debit');
  const orderDatesSet = new Set<string>();
  const orderNumsInTxs = new Set<string>();

  let totalPurchaseValue = 0;
  let totalPaidFromCredits = 0;

  for (const tx of creditTxs) {
    totalPurchaseValue += Number(tx.amount || 0);
    if (tx.saleType !== 'time_credit') {
      totalPaidFromCredits += Number(tx.paidAmount || 0);
    } else {
      totalPaidFromCredits += Number(tx.paidAmount || 0);
    }
    orderDatesSet.add(tx.createdAt || tx.date);
    if (tx.invoiceNumber) orderNumsInTxs.add(tx.invoiceNumber);
  }

  // Include COD orders not already covered in transactions
  let extraCodTotal = 0;
  for (const ord of custOrders) {
    if (ord.status !== 'returned' && !orderNumsInTxs.has(ord.orderNumber)) {
      extraCodTotal += Number(ord.totalAmount || 0);
    }
    orderDatesSet.add(ord.createdAt);
  }
  totalPurchaseValue += extraCodTotal;

  const totalDebitPayments = debitTxs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalPaid = Math.min(totalPurchaseValue, totalPaidFromCredits + totalDebitPayments);
  const outstandingBalance = Math.max(0, Number(customer.balance ?? (totalPurchaseValue - totalPaid)));

  const returnedOrders = custOrders.filter((o) => o.status === 'returned');
  const deliveredOrders = custOrders.filter((o) => o.status === 'delivered');
  const returnsTotal = returnedOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  const refundsTotal = custTxs
    .filter((t) => t.status === 'cancelled' || /refund/i.test(t.notes || ''))
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const uniqueOrderKeys = new Set<string>();
  for (const tx of creditTxs) uniqueOrderKeys.add(tx.invoiceNumber || tx.id);
  for (const ord of custOrders) {
    if (ord.status !== 'returned') uniqueOrderKeys.add(ord.orderNumber || ord.id);
  }
  const totalOrders = Math.max(uniqueOrderKeys.size, Number(customer.ordersCount || 0));
  const averageOrderValue = totalOrders > 0 ? Math.round(totalPurchaseValue / totalOrders) : 0;

  // CLV = net historical realized purchases - returns + loyalty multiplier engagement bonus
  const netRealized = Math.max(0, totalPurchaseValue - returnsTotal - refundsTotal);
  const customerLifetimeValue = Math.round(netRealized);

  // Order frequency & recency
  const sortedDates = Array.from(orderDatesSet)
    .map((d) => new Date(d).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  let orderFrequencyDays: number | null = null;
  if (sortedDates.length >= 2) {
    const spanDays = (sortedDates[sortedDates.length - 1] - sortedDates[0]) / (1000 * 60 * 60 * 24);
    orderFrequencyDays = Math.max(1, Math.round(spanDays / (sortedDates.length - 1)));
  }

  const lastOrderTs = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;
  const lastOrderDate =
    (lastOrderTs ? new Date(lastOrderTs).toISOString().split('T')[0] : undefined) ||
    customer.lastPurchaseDate;
  const daysSinceLastOrder = lastOrderDate ? daysBetween(lastOrderDate, nowMs) : null;

  // Purchased products & preferred categories
  const prodStatsMap = new Map<
    string,
    { productId?: string; name: string; quantity: number; totalSpent: number; category?: string }
  >();
  const categoryScore = new Map<string, number>();

  const collectItems = (items?: Transaction['items']) => {
    for (const it of items || []) {
      const p = it.productId ? productById.get(it.productId) : undefined;
      const key = it.productId || it.description.toLowerCase();
      const prev = prodStatsMap.get(key) || {
        productId: it.productId,
        name: p?.name || it.description,
        quantity: 0,
        totalSpent: 0,
        category: p?.category,
      };
      prev.quantity += Number(it.quantity || 1);
      prev.totalSpent += Number(it.amount || 0);
      prodStatsMap.set(key, prev);

      if (p?.category) {
        const topCat = p.category.split('>')[0].trim();
        categoryScore.set(topCat, (categoryScore.get(topCat) || 0) + Number(it.quantity || 1));
      }
    }
  };

  for (const tx of creditTxs) collectItems(tx.items);
  for (const ord of custOrders) {
    if (!orderNumsInTxs.has(ord.orderNumber)) collectItems(ord.items);
  }
  for (const cat of customer.interestedCategories || []) {
    if (cat) categoryScore.set(cat, (categoryScore.get(cat) || 0) + 1);
  }
  for (const ev of custEvents) {
    if (ev.category) {
      const topCat = ev.category.split('>')[0].trim();
      categoryScore.set(topCat, (categoryScore.get(topCat) || 0) + 1);
    }
  }

  const purchasedProducts = Array.from(prodStatsMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  const preferredCategories = Array.from(categoryScore.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  // Payment mode preference
  const modeCounts = new Map<string, number>();
  for (const tx of custTxs) {
    if (tx.paymentMode) {
      modeCounts.set(tx.paymentMode, (modeCounts.get(tx.paymentMode) || 0) + 1);
    }
  }
  const topMode = Array.from(modeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const paymentPreference =
    customer.paymentPreference ||
    (topMode ? topMode.toUpperCase() : custOrders.length > 0 ? 'COD' : 'CASH');

  // Automatic 17 Segments Evaluation
  const autoSegments: CRMAutoSegmentName[] = [];
  const daysSinceCreated = daysBetween(customer.createdAt || nowIso, nowMs) ?? 999;

  if (daysSinceCreated <= 14 || totalOrders === 0) autoSegments.push('New Customer');
  if (totalOrders === 1) autoSegments.push('First Order');
  if (totalOrders >= 2) autoSegments.push('Repeat Customer');
  if (totalOrders >= 3) autoSegments.push('Regular Customer');
  if (
    customer.isVipManual ||
    totalPurchaseValue >= 25000 ||
    totalOrders >= 5 ||
    custLoyalty?.tier === 'VIP Platinum'
  ) {
    autoSegments.push('VIP Customer');
  }
  if (customer.customerType === 'wholesale' || customer.customerType === 'shopkeeper') {
    autoSegments.push('Wholesale Customer');
  }
  const isResellerMatch =
    customer.customerType === 'reseller' ||
    resellers.some((r) => custPhoneDigits && normalizeDigits(r.phone) === custPhoneDigits);
  if (isResellerMatch) autoSegments.push('Reseller');

  if (totalPurchaseValue >= 15000 || averageOrderValue >= 5000) {
    autoSegments.push('High Value');
  }
  if (daysSinceLastOrder !== null) {
    if (daysSinceLastOrder >= 120) autoSegments.push('Lost Customer');
    else if (daysSinceLastOrder >= 90) autoSegments.push('Inactive 90 Days');
    else if (daysSinceLastOrder >= 60) autoSegments.push('Inactive 60 Days');
    else if (daysSinceLastOrder >= 30) autoSegments.push('Inactive 30 Days');
  }
  const codReturnRate = custOrders.length > 0 ? returnedOrders.length / custOrders.length : 0;
  if (returnedOrders.length >= 2 || (returnedOrders.length >= 1 && codReturnRate >= 0.4)) {
    autoSegments.push('COD Risk');
  }
  if (outstandingBalance > 0) autoSegments.push('Outstanding Payment');

  const allCategoryText = [
    ...preferredCategories,
    ...purchasedProducts.map((p) => `${p.name} ${p.category || ''}`),
  ]
    .join(' ')
    .toLowerCase();

  if (/(garment|fashion|apparel|shirt|suit|kurta|dress|trouser|cloth)/.test(allCategoryText)) {
    autoSegments.push('Garments Customer');
  }
  if (/(cosmetic|beauty|makeup|skin|serum|perfume|cream|lipstick|hair)/.test(allCategoryText)) {
    autoSegments.push('Cosmetics Customer');
  }
  if (/(kitchen|home|living|cook|blender|mixer|utensil|pan|flask|jar|home & kitchen)/.test(allCategoryText)) {
    autoSegments.push('Kitchen Products Customer');
  }

  // Evaluate Custom Segmentation Rules
  const customSegments: string[] = [];
  for (const rule of customRules) {
    if (!rule.isActive) continue;
    const c = rule.criteria;
    if (c.minTotalSpend !== undefined && totalPurchaseValue < c.minTotalSpend) continue;
    if (c.maxTotalSpend !== undefined && totalPurchaseValue > c.maxTotalSpend) continue;
    if (c.minOrders !== undefined && totalOrders < c.minOrders) continue;
    if (c.maxOrders !== undefined && totalOrders > c.maxOrders) continue;
    if (c.minDaysSinceLastOrder !== undefined && (daysSinceLastOrder === null || daysSinceLastOrder < c.minDaysSinceLastOrder)) continue;
    if (c.maxDaysSinceLastOrder !== undefined && (daysSinceLastOrder === null || daysSinceLastOrder > c.maxDaysSinceLastOrder)) continue;
    if (c.city && !(customer.city || '').toLowerCase().includes(c.city.toLowerCase())) continue;
    if (c.referralSource && !(customer.customerSource || customer.referredBy || '').toLowerCase().includes(c.referralSource.toLowerCase())) continue;
    if (c.customerType && customer.customerType !== c.customerType) continue;
    if (c.hasOutstandingBalance === true && outstandingBalance <= 0) continue;
    if (c.hasOutstandingBalance === false && outstandingBalance > 0) continue;
    if (c.categoryKeyword && !allCategoryText.includes(c.categoryKeyword.toLowerCase())) continue;
    customSegments.push(rule.name);
  }

  // Recommend cross-sell products in preferred categories not recently bought
  const boughtIds = new Set(purchasedProducts.map((p) => p.productId).filter(Boolean));
  const recommendedProducts = products
    .filter((p) => !p.isUpcoming && p.stockQty > 0 && !boughtIds.has(p.id))
    .sort((a, b) => {
      const aMatch = preferredCategories.some((cat) => a.category.toLowerCase().includes(cat.toLowerCase())) ? 1 : 0;
      const bMatch = preferredCategories.some((cat) => b.category.toLowerCase().includes(cat.toLowerCase())) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return (b.salesCount || 0) - (a.salesCount || 0);
    })
    .slice(0, 4);

  // Build Complete Chronological Activity Timeline
  const timeline: Customer360TimelineItem[] = [];

  for (const tx of custTxs) {
    timeline.push({
      id: `tl_tx_${tx.id}`,
      timestamp: tx.createdAt || tx.date,
      kind: tx.type === 'debit' ? 'payment' : /refund/i.test(tx.notes || '') ? 'refund' : 'order',
      title:
        tx.type === 'debit'
          ? `Payment Received (${(tx.paymentMode || 'cash').toUpperCase()})`
          : `Order / Invoice #${tx.invoiceNumber || tx.id}`,
      description: tx.notes || `${tx.items?.length || 0} item(s)`,
      amount: tx.amount,
      status: tx.status || 'completed',
    });
  }

  for (const ord of custOrders) {
    if (ord.status === 'returned') {
      timeline.push({
        id: `tl_ret_${ord.id}`,
        timestamp: ord.returnedAt || ord.createdAt,
        kind: 'return',
        title: `COD Parcel Returned #${ord.orderNumber}`,
        description: `${ord.courierPartner} · ${ord.city}`,
        amount: ord.totalAmount,
        status: 'returned',
      });
    } else if (!orderNumsInTxs.has(ord.orderNumber)) {
      timeline.push({
        id: `tl_cod_${ord.id}`,
        timestamp: ord.createdAt,
        kind: 'order',
        title: `COD Order #${ord.orderNumber}`,
        description: `${ord.courierPartner} · ${ord.city} ${ord.area || ''}`,
        amount: ord.totalAmount,
        status: ord.status,
      });
    }
  }

  for (const tkt of custTickets) {
    timeline.push({
      id: `tl_tkt_${tkt.id}`,
      timestamp: tkt.createdAt,
      kind: 'complaint',
      title: `Support Ticket #${tkt.ticketNumber} (${tkt.category})`,
      description: tkt.subject,
      status: tkt.status,
    });
  }

  for (const fu of custFollowUps) {
    timeline.push({
      id: `tl_fu_${fu.id}`,
      timestamp: fu.updatedAt || fu.createdAt,
      kind: 'follow_up',
      title: `Follow-up (${fu.taskType}): ${fu.title}`,
      description: fu.outcome || fu.notes || `Scheduled for ${fu.followUpDate}`,
      status: fu.status,
    });
  }

  for (const lyr of custLedger) {
    timeline.push({
      id: `tl_lyl_${lyr.id}`,
      timestamp: lyr.createdAt,
      kind: 'reward',
      title: `Loyalty Points ${lyr.type === 'redeemed' ? 'Redeemed' : 'Earned'}: ${lyr.points} pts`,
      description: lyr.notes || lyr.orderNumber || lyr.couponCode || 'Loyalty activity',
    });
  }

  for (const rev of custReviews) {
    timeline.push({
      id: `tl_rev_${rev.id}`,
      timestamp: rev.createdAt,
      kind: 'reward',
      title: `Social Review (${rev.platform})`,
      description: rev.reviewText,
      status: rev.status,
    });
  }

  for (const ev of custEvents) {
    timeline.push({
      id: `tl_ev_${ev.id}`,
      timestamp: ev.createdAt,
      kind:
        ev.eventType === 'note_added'
          ? 'note'
          : ev.eventType === 'whatsapp_opened'
          ? 'message'
          : ev.eventType === 'lead_converted'
          ? 'referral'
          : 'activity',
      title: `${ev.eventType.replace(/_/g, ' ').toUpperCase()}${ev.productName ? ` · ${ev.productName}` : ''}`,
      description: ev.notes || ev.category || 'Customer engagement recorded',
      amount: ev.amount,
    });
  }

  if (customer.notes) {
    timeline.push({
      id: `tl_cust_note_${customer.id}`,
      timestamp: customer.createdAt || nowIso,
      kind: 'note',
      title: 'Customer Profile Note',
      description: customer.notes,
    });
  }

  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const lastActivityDate = timeline[0]?.timestamp || lastOrderDate || customer.lastActivityAt;

  return {
    customer,
    totalOrders,
    totalPurchaseValue,
    totalPaid,
    outstandingBalance,
    refundsTotal,
    returnsTotal,
    returnedOrdersCount: returnedOrders.length,
    deliveredCodCount: deliveredOrders.length,
    totalCodCount: custOrders.length,
    averageOrderValue,
    customerLifetimeValue,
    orderFrequencyDays,
    daysSinceLastOrder,
    lastOrderDate,
    lastActivityDate,
    purchasedProducts,
    preferredCategories,
    paymentPreference,
    autoSegments,
    customSegments,
    loyalty: custLoyalty,
    loyaltyLedger: custLedger,
    followUps: custFollowUps,
    tickets: custTickets,
    coupons: custCoupons,
    recommendedProducts,
    timeline,
  };
}

export function computeCrmDashboardKPIs(params: {
  profiles: Customer360Summary[];
  leads: CRMLead[];
  followUps: CRMFollowUpTask[];
  tickets: CRMSupportTicket[];
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    city?: string;
    customerType?: string;
    salesperson?: string;
  };
  nowIso?: string;
}): CRMDashboardKPIs {
  const { profiles, leads, followUps, tickets, filters = {}, nowIso = new Date().toISOString() } = params;
  const now = new Date(nowIso);
  const todayStr = nowIso.split('T')[0];
  const weekAgoStr = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  const filteredProfiles = profiles.filter((p) => {
    const c = p.customer;
    if (filters.city && !(c.city || '').toLowerCase().includes(filters.city.toLowerCase())) return false;
    if (filters.customerType && c.customerType !== filters.customerType) return false;
    if (
      filters.salesperson &&
      !(c.assignedSalespersonName || c.assignedSalespersonId || '')
        .toLowerCase()
        .includes(filters.salesperson.toLowerCase())
    ) {
      return false;
    }
    if (filters.dateFrom && (p.lastOrderDate || c.createdAt) < filters.dateFrom) return false;
    if (filters.dateTo && (p.lastOrderDate || c.createdAt) > filters.dateTo) return false;
    return true;
  });

  const totalCustomers = filteredProfiles.length;
  const newToday = filteredProfiles.filter((p) => (p.customer.createdAt || '').slice(0, 10) === todayStr).length;
  const newThisWeek = filteredProfiles.filter((p) => (p.customer.createdAt || '').slice(0, 10) >= weekAgoStr).length;
  const newThisMonth = filteredProfiles.filter((p) => (p.customer.createdAt || '').slice(0, 10) >= monthStartStr).length;

  const activeCustomers = filteredProfiles.filter(
    (p) => p.daysSinceLastOrder !== null && p.daysSinceLastOrder < 30
  ).length;
  const repeatCustomers = filteredProfiles.filter((p) => p.totalOrders >= 2).length;
  const vipCustomers = filteredProfiles.filter((p) => p.autoSegments.includes('VIP Customer')).length;
  const inactiveCustomers = filteredProfiles.filter(
    (p) =>
      p.autoSegments.includes('Inactive 30 Days') ||
      p.autoSegments.includes('Inactive 60 Days') ||
      p.autoSegments.includes('Inactive 90 Days')
  ).length;
  const lostCustomers = filteredProfiles.filter((p) => p.autoSegments.includes('Lost Customer')).length;

  const totalCustomerRevenue = filteredProfiles.reduce((s, p) => s + p.totalPurchaseValue, 0);
  const totalOrdersCount = filteredProfiles.reduce((s, p) => s + p.totalOrders, 0);
  const averageOrderValue = totalOrdersCount > 0 ? Math.round(totalCustomerRevenue / totalOrdersCount) : 0;
  const customerLifetimeValue =
    totalCustomers > 0
      ? Math.round(filteredProfiles.reduce((s, p) => s + p.customerLifetimeValue, 0) / totalCustomers)
      : 0;
  const buyersWithOrders = filteredProfiles.filter((p) => p.totalOrders >= 1).length;
  const repeatPurchaseRate =
    buyersWithOrders > 0 ? Math.round((repeatCustomers / buyersWithOrders) * 1000) / 10 : 0;
  const retentionRate =
    totalCustomers > 0 ? Math.round(((totalCustomers - lostCustomers) / totalCustomers) * 1000) / 10 : 0;

  const filteredLeads = leads.filter((l) => {
    if (filters.city && !(l.city || '').toLowerCase().includes(filters.city.toLowerCase())) return false;
    if (
      filters.salesperson &&
      !(l.assignedSalespersonName || l.assignedSalespersonId || '')
        .toLowerCase()
        .includes(filters.salesperson.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const totalLeads = filteredLeads.length;
  const convertedLeads = filteredLeads.filter((l) => l.stage === 'Converted').length;
  const leadConversionRate =
    totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 1000) / 10 : 0;

  const openFollowUps = followUps.filter(
    (f) => f.status === 'Pending' || f.status === 'In Progress'
  );
  const todaysFollowUps = openFollowUps.filter((f) => f.followUpDate === todayStr).length;
  const overdueFollowUps = openFollowUps.filter((f) => f.followUpDate < todayStr).length;

  const outstandingBalances = filteredProfiles.reduce((s, p) => s + p.outstandingBalance, 0);
  const openTickets = tickets.filter((t) => t.status !== 'Resolved' && t.status !== 'Closed').length;

  return {
    totalCustomers,
    newToday,
    newThisWeek,
    newThisMonth,
    activeCustomers,
    repeatCustomers,
    vipCustomers,
    inactiveCustomers,
    lostCustomers,
    totalCustomerRevenue,
    averageOrderValue,
    customerLifetimeValue,
    repeatPurchaseRate,
    retentionRate,
    totalLeads,
    convertedLeads,
    leadConversionRate,
    todaysFollowUps,
    overdueFollowUps,
    outstandingBalances,
    openTickets,
  };
}

export interface ProductCustomerIntelligence {
  mostViewedProducts: Array<{ productId: string; name: string; views: number; orders: number; stockQty: number }>;
  inquiredNotOrdered: Array<{ productId: string; name: string; inquiries: number; orders: number }>;
  cartAbandonedProducts: Array<{ productId: string; name: string; cartAdds: number; orders: number }>;
  bestRepeatProducts: Array<{ productId: string; name: string; repeatBuyers: number; totalUnits: number }>;
  highestComplaintProducts: Array<{ productId?: string; name: string; ticketsCount: number; returnedOrders: number }>;
  categoryRepeatSummary: Array<{ category: string; uniqueBuyers: number; repeatBuyers: number; repeatRatePercent: number }>;
  frequentlyBoughtTogether: Array<{ productA: string; productB: string; coOccurrences: number }>;
  priceSensitivity: { fullPriceOrders: number; discountedSavingsOrders: number; averageDiscountPercent: number };
}

export function computeProductCustomerIntelligence(params: {
  products: ProductItem[];
  transactions: Transaction[];
  codOrders: CODOrder[];
  tickets: CRMSupportTicket[];
  activityEvents: CRMActivityEvent[];
}): ProductCustomerIntelligence {
  const { products, transactions, codOrders, tickets, activityEvents } = params;
  const prodById = new Map(products.map((p) => [p.id, p]));

  const viewCounts = new Map<string, number>();
  const inquiryCounts = new Map<string, number>();
  const cartAddCounts = new Map<string, number>();
  const orderCounts = new Map<string, number>();

  for (const ev of activityEvents) {
    if (!ev.productId) continue;
    if (ev.eventType === 'product_view') viewCounts.set(ev.productId, (viewCounts.get(ev.productId) || 0) + 1);
    if (ev.eventType === 'product_inquiry') inquiryCounts.set(ev.productId, (inquiryCounts.get(ev.productId) || 0) + 1);
    if (ev.eventType === 'cart_add' || ev.eventType === 'cart_abandon') {
      cartAddCounts.set(ev.productId, (cartAddCounts.get(ev.productId) || 0) + 1);
    }
  }

  // Track buyers per product & per category
  const productBuyers = new Map<string, Map<string, number>>();
  const productUnits = new Map<string, number>();
  const categoryBuyers = new Map<string, Map<string, number>>();
  const coBuyPairs = new Map<string, number>();

  let fullPriceOrders = 0;
  let discountedSavingsOrders = 0;
  let discountPercentSum = 0;

  for (const tx of transactions) {
    if (tx.type !== 'credit' || tx.status === 'cancelled') continue;
    const custKey = tx.customerId || tx.id;
    const items = tx.items || [];
    const totalMarket = items.reduce((s, it) => s + Number(it.marketPrice || it.unitPrice || 0) * Number(it.quantity || 1), 0);
    if (Number(tx.totalSavings || 0) > 0 && totalMarket > 0) {
      discountedSavingsOrders++;
      discountPercentSum += (Number(tx.totalSavings || 0) / totalMarket) * 100;
    } else {
      fullPriceOrders++;
    }

    const itemNames: string[] = [];
    for (const it of items) {
      const pid = it.productId;
      if (pid) {
        orderCounts.set(pid, (orderCounts.get(pid) || 0) + 1);
        productUnits.set(pid, (productUnits.get(pid) || 0) + Number(it.quantity || 1));
        const bm = productBuyers.get(pid) || new Map<string, number>();
        bm.set(custKey, (bm.get(custKey) || 0) + 1);
        productBuyers.set(pid, bm);

        const p = prodById.get(pid);
        if (p?.category) {
          const topCat = p.category.split('>')[0].trim();
          const cm = categoryBuyers.get(topCat) || new Map<string, number>();
          cm.set(custKey, (cm.get(custKey) || 0) + 1);
          categoryBuyers.set(topCat, cm);
        }
        itemNames.push(p?.name || it.description);
      }
    }

    for (let i = 0; i < itemNames.length; i++) {
      for (let j = i + 1; j < itemNames.length; j++) {
        if (itemNames[i] === itemNames[j]) continue;
        const pair = [itemNames[i], itemNames[j]].sort().join(' || ');
        coBuyPairs.set(pair, (coBuyPairs.get(pair) || 0) + 1);
      }
    }
  }

  const mostViewedProducts = Array.from(viewCounts.entries())
    .map(([pid, views]) => ({
      productId: pid,
      name: prodById.get(pid)?.name || pid,
      views,
      orders: orderCounts.get(pid) || prodById.get(pid)?.salesCount || 0,
      stockQty: prodById.get(pid)?.stockQty || 0,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const inquiredNotOrdered = Array.from(inquiryCounts.entries())
    .map(([pid, inquiries]) => ({
      productId: pid,
      name: prodById.get(pid)?.name || pid,
      inquiries,
      orders: orderCounts.get(pid) || 0,
    }))
    .filter((r) => r.inquiries > r.orders)
    .sort((a, b) => b.inquiries - a.inquiries)
    .slice(0, 10);

  const cartAbandonedProducts = Array.from(cartAddCounts.entries())
    .map(([pid, cartAdds]) => ({
      productId: pid,
      name: prodById.get(pid)?.name || pid,
      cartAdds,
      orders: orderCounts.get(pid) || 0,
    }))
    .filter((r) => r.cartAdds > r.orders)
    .sort((a, b) => b.cartAdds - a.cartAdds)
    .slice(0, 10);

  const bestRepeatProducts = Array.from(productBuyers.entries())
    .map(([pid, buyers]) => {
      const repeatBuyers = Array.from(buyers.values()).filter((cnt) => cnt >= 2).length;
      return {
        productId: pid,
        name: prodById.get(pid)?.name || pid,
        repeatBuyers,
        totalUnits: productUnits.get(pid) || 0,
      };
    })
    .sort((a, b) => b.repeatBuyers - a.repeatBuyers || b.totalUnits - a.totalUnits)
    .slice(0, 10);

  // Complaint + Return counts
  const complaintsByProd = new Map<string, { name: string; ticketsCount: number; returnedOrders: number }>();
  for (const tkt of tickets) {
    const key = tkt.orderNumber || tkt.category;
    const prev = complaintsByProd.get(key) || { name: tkt.subject || tkt.category, ticketsCount: 0, returnedOrders: 0 };
    prev.ticketsCount++;
    complaintsByProd.set(key, prev);
  }
  for (const ord of codOrders) {
    if (ord.status !== 'returned') continue;
    for (const it of ord.items || []) {
      const pid = it.productId || it.description;
      const prev = complaintsByProd.get(pid) || {
        name: (pid && prodById.get(pid)?.name) || it.description,
        ticketsCount: 0,
        returnedOrders: 0,
      };
      prev.returnedOrders++;
      complaintsByProd.set(pid, prev);
    }
  }

  const highestComplaintProducts = Array.from(complaintsByProd.entries())
    .map(([productId, val]) => ({ productId, ...val }))
    .sort((a, b) => b.ticketsCount + b.returnedOrders - (a.ticketsCount + a.returnedOrders))
    .slice(0, 10);

  const categoryRepeatSummary = Array.from(categoryBuyers.entries())
    .map(([category, buyers]) => {
      const uniqueBuyers = buyers.size;
      const repeatBuyers = Array.from(buyers.values()).filter((cnt) => cnt >= 2).length;
      return {
        category,
        uniqueBuyers,
        repeatBuyers,
        repeatRatePercent: uniqueBuyers > 0 ? Math.round((repeatBuyers / uniqueBuyers) * 100) : 0,
      };
    })
    .sort((a, b) => b.repeatRatePercent - a.repeatRatePercent);

  const frequentlyBoughtTogether = Array.from(coBuyPairs.entries())
    .map(([key, coOccurrences]) => {
      const [productA, productB] = key.split(' || ');
      return { productA, productB, coOccurrences };
    })
    .sort((a, b) => b.coOccurrences - a.coOccurrences)
    .slice(0, 10);

  return {
    mostViewedProducts,
    inquiredNotOrdered,
    cartAbandonedProducts,
    bestRepeatProducts,
    highestComplaintProducts,
    categoryRepeatSummary,
    frequentlyBoughtTogether,
    priceSensitivity: {
      fullPriceOrders,
      discountedSavingsOrders,
      averageDiscountPercent:
        discountedSavingsOrders > 0 ? Math.round((discountPercentSum / discountedSavingsOrders) * 10) / 10 : 0,
    },
  };
}

export type CRMReportKey =
  | 'customer_lifetime_value'
  | 'repeat_purchase_report'
  | 'inactive_customers_report'
  | 'vip_customers_report'
  | 'outstanding_khata_report'
  | 'city_sales_report'
  | 'category_customer_report'
  | 'lead_conversion_report'
  | 'salesperson_crm_performance'
  | 'followup_completion_report'
  | 'complaint_resolution_report'
  | 'cod_return_risk_customers'
  | 'reseller_retention_report'
  | 'campaign_performance_report'
  | 'loyalty_points_report'
  | 'daily_sales_report'
  | 'monthly_profit_loss_report';

export const CRM_REPORT_CATALOG: Array<{ key: CRMReportKey; title: string; description: string }> = [
  { key: 'customer_lifetime_value', title: '1. Customer Lifetime Value (CLV)', description: 'Orders, total spend, returns, and net CLV per customer' },
  { key: 'repeat_purchase_report', title: '2. Repeat Purchase Report', description: 'Repeat buyers, order count, and reorder frequency days' },
  { key: 'inactive_customers_report', title: '3. Inactive Customers Report', description: 'Customers with 30+, 60+, 90+ or 120+ days since last order' },
  { key: 'vip_customers_report', title: '4. VIP Customers Report', description: 'Top spenders, manual VIPs, and VIP Platinum loyalty members' },
  { key: 'outstanding_khata_report', title: '5. Outstanding Payment / Khata Report', description: 'Customers with unpaid Khata / time-credit balances' },
  { key: 'city_sales_report', title: '6. City-Wise Sales Report', description: 'Revenue, customer count, and orders grouped by city' },
  { key: 'category_customer_report', title: '7. Category-Wise Customer Report', description: 'Unique buyers and repeat purchase rates by category' },
  { key: 'lead_conversion_report', title: '8. Lead Conversion Report', description: 'Leads by source channel, pipeline stage, and conversion rate' },
  { key: 'salesperson_crm_performance', title: '9. Salesperson CRM Performance', description: 'Leads, conversions, and follow-up tasks by team member' },
  { key: 'followup_completion_report', title: '10. Follow-Up Completion Report', description: 'Pending, Overdue, In Progress, and Completed CRM tasks' },
  { key: 'complaint_resolution_report', title: '11. Complaint Resolution Report', description: 'Support tickets, SLA deadlines, and resolution turnaround' },
  { key: 'cod_return_risk_customers', title: '12. COD Return Risk Customers', description: 'Buyers with returned COD parcels and return rate %' },
  { key: 'reseller_retention_report', title: '13. Reseller Retention Report', description: 'Reseller partner orders, paid sales, and earned commission' },
  { key: 'campaign_performance_report', title: '14. Campaign Performance Report', description: 'Campaign reach, messages queued, conversions, and revenue' },
  { key: 'loyalty_points_report', title: '15. Loyalty Points Report', description: 'Customer tiers, active balances, earned & redeemed points' },
  { key: 'daily_sales_report', title: '16. Daily Sales Report', description: 'Date-wise orders, revenue, paid cash, and credit outstanding' },
  { key: 'monthly_profit_loss_report', title: '17. Monthly Profit & Loss Report', description: 'Monthly gross revenue, COGS, commissions, expenses & net profit' },
];

export function generateCrmReportDataset(params: {
  reportKey: CRMReportKey;
  profiles: Customer360Summary[];
  leads: CRMLead[];
  followUps: CRMFollowUpTask[];
  tickets: CRMSupportTicket[];
  campaigns: CRMCampaign[];
  resellers: Reseller[];
  transactions: Transaction[];
  products: ProductItem[];
  monthlyExpenses: Array<{ month: string; amount: number }>;
  dateFrom?: string;
  dateTo?: string;
}): { columns: string[]; rows: Array<Record<string, string | number>> } {
  const {
    reportKey,
    profiles,
    leads,
    followUps,
    tickets,
    campaigns,
    resellers,
    transactions,
    products,
    monthlyExpenses,
    dateFrom,
    dateTo,
  } = params;

  const inDateRange = (dateStr?: string) => {
    if (!dateStr) return true;
    const d = dateStr.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  switch (reportKey) {
    case 'customer_lifetime_value':
      return {
        columns: ['Customer', 'Phone', 'City', 'Orders', 'Total Purchases', 'Returns', 'Net CLV', 'AOV', 'Tier'],
        rows: profiles
          .sort((a, b) => b.customerLifetimeValue - a.customerLifetimeValue)
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            Orders: p.totalOrders,
            'Total Purchases': p.totalPurchaseValue,
            Returns: p.returnsTotal,
            'Net CLV': p.customerLifetimeValue,
            AOV: p.averageOrderValue,
            Tier: p.loyalty?.tier || 'Bronze',
          })),
      };

    case 'repeat_purchase_report':
      return {
        columns: ['Customer', 'Phone', 'City', 'Orders', 'Frequency (Days)', 'Last Order', 'Total Purchases'],
        rows: profiles
          .filter((p) => p.totalOrders >= 2)
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            Orders: p.totalOrders,
            'Frequency (Days)': p.orderFrequencyDays ?? '-',
            'Last Order': p.lastOrderDate || '-',
            'Total Purchases': p.totalPurchaseValue,
          })),
      };

    case 'inactive_customers_report':
      return {
        columns: ['Customer', 'Phone', 'City', 'Last Order Date', 'Days Inactive', 'Segment', 'Lifetime Spend'],
        rows: profiles
          .filter((p) => (p.daysSinceLastOrder ?? 0) >= 30)
          .sort((a, b) => (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0))
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            'Last Order Date': p.lastOrderDate || 'Never',
            'Days Inactive': p.daysSinceLastOrder ?? 0,
            Segment:
              (p.daysSinceLastOrder ?? 0) >= 120
                ? 'Lost Customer'
                : (p.daysSinceLastOrder ?? 0) >= 90
                ? 'Inactive 90 Days'
                : (p.daysSinceLastOrder ?? 0) >= 60
                ? 'Inactive 60 Days'
                : 'Inactive 30 Days',
            'Lifetime Spend': p.totalPurchaseValue,
          })),
      };

    case 'vip_customers_report':
      return {
        columns: ['Customer', 'Phone', 'City', 'Orders', 'Total Spend', 'Loyalty Tier', 'Points'],
        rows: profiles
          .filter((p) => p.autoSegments.includes('VIP Customer'))
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            Orders: p.totalOrders,
            'Total Spend': p.totalPurchaseValue,
            'Loyalty Tier': p.loyalty?.tier || 'VIP Platinum',
            Points: p.loyalty?.pointsBalance || 0,
          })),
      };

    case 'outstanding_khata_report':
      return {
        columns: ['Customer', 'Phone', 'City', 'Total Purchases', 'Total Paid', 'Outstanding Balance', 'Last Order'],
        rows: profiles
          .filter((p) => p.outstandingBalance > 0)
          .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            'Total Purchases': p.totalPurchaseValue,
            'Total Paid': p.totalPaid,
            'Outstanding Balance': p.outstandingBalance,
            'Last Order': p.lastOrderDate || '-',
          })),
      };

    case 'city_sales_report': {
      const byCity = new Map<string, { customers: number; orders: number; revenue: number }>();
      for (const p of profiles) {
        const city = p.customer.city || 'Unspecified';
        const prev = byCity.get(city) || { customers: 0, orders: 0, revenue: 0 };
        prev.customers++;
        prev.orders += p.totalOrders;
        prev.revenue += p.totalPurchaseValue;
        byCity.set(city, prev);
      }
      return {
        columns: ['City', 'Customers', 'Orders', 'Revenue'],
        rows: Array.from(byCity.entries())
          .map(([City, s]) => ({ City, Customers: s.customers, Orders: s.orders, Revenue: s.revenue }))
          .sort((a, b) => b.Revenue - a.Revenue),
      };
    }

    case 'category_customer_report': {
      const intel = computeProductCustomerIntelligence({
        products,
        transactions,
        codOrders: [],
        tickets,
        activityEvents: [],
      });
      return {
        columns: ['Category', 'Unique Buyers', 'Repeat Buyers', 'Repeat Rate (%)'],
        rows: intel.categoryRepeatSummary.map((c) => ({
          Category: c.category,
          'Unique Buyers': c.uniqueBuyers,
          'Repeat Buyers': c.repeatBuyers,
          'Repeat Rate (%)': c.repeatRatePercent,
        })),
      };
    }

    case 'lead_conversion_report':
      return {
        columns: ['Lead Name', 'Phone', 'Source', 'Interested Product', 'Est Value', 'Stage', 'Salesperson', 'Created'],
        rows: leads
          .filter((l) => inDateRange(l.createdAt))
          .map((l) => ({
            'Lead Name': l.leadName,
            Phone: l.phone,
            Source: l.source,
            'Interested Product': l.interestedProductName || '-',
            'Est Value': l.estimatedValue,
            Stage: l.stage,
            Salesperson: l.assignedSalespersonName || '-',
            Created: l.createdAt.slice(0, 10),
          })),
      };

    case 'salesperson_crm_performance': {
      const map = new Map<string, { leads: number; converted: number; tasks: number; completedTasks: number }>();
      for (const l of leads) {
        const sp = l.assignedSalespersonName || 'Unassigned';
        const cur = map.get(sp) || { leads: 0, converted: 0, tasks: 0, completedTasks: 0 };
        cur.leads++;
        if (l.stage === 'Converted') cur.converted++;
        map.set(sp, cur);
      }
      for (const t of followUps) {
        const sp = t.assignedEmployeeName || 'Unassigned';
        const cur = map.get(sp) || { leads: 0, converted: 0, tasks: 0, completedTasks: 0 };
        cur.tasks++;
        if (t.status === 'Completed') cur.completedTasks++;
        map.set(sp, cur);
      }
      return {
        columns: ['Team Member', 'Leads Assigned', 'Converted', 'Tasks Assigned', 'Tasks Completed'],
        rows: Array.from(map.entries()).map(([name, s]) => ({
          'Team Member': name,
          'Leads Assigned': s.leads,
          Converted: s.converted,
          'Tasks Assigned': s.tasks,
          'Tasks Completed': s.completedTasks,
        })),
      };
    }

    case 'followup_completion_report':
      return {
        columns: ['Title', 'Customer', 'Type', 'Follow-Up Date', 'Assigned To', 'Priority', 'Status', 'Outcome'],
        rows: followUps
          .filter((f) => inDateRange(f.followUpDate))
          .map((f) => ({
            Title: f.title,
            Customer: f.customerName,
            Type: f.taskType,
            'Follow-Up Date': f.followUpDate,
            'Assigned To': f.assignedEmployeeName || '-',
            Priority: f.priority,
            Status: f.status,
            Outcome: f.outcome || '-',
          })),
      };

    case 'complaint_resolution_report':
      return {
        columns: ['Ticket #', 'Customer', 'Category', 'Priority', 'Status', 'SLA Due', 'Assigned To', 'Created'],
        rows: tickets
          .filter((t) => inDateRange(t.createdAt))
          .map((t) => ({
            'Ticket #': t.ticketNumber,
            Customer: t.customerName,
            Category: t.category,
            Priority: t.priority,
            Status: t.status,
            'SLA Due': t.dueAt.slice(0, 16).replace('T', ' '),
            'Assigned To': t.assignedEmployeeName || '-',
            Created: t.createdAt.slice(0, 10),
          })),
      };

    case 'cod_return_risk_customers':
      return {
        columns: ['Customer', 'Phone', 'City', 'Total COD', 'Delivered COD', 'Returned COD', 'Return Value'],
        rows: profiles
          .filter((p) => p.returnedOrdersCount > 0)
          .sort((a, b) => b.returnedOrdersCount - a.returnedOrdersCount)
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            City: p.customer.city || '-',
            'Total COD': p.totalCodCount,
            'Delivered COD': p.deliveredCodCount,
            'Returned COD': p.returnedOrdersCount,
            'Return Value': p.returnsTotal,
          })),
      };

    case 'reseller_retention_report':
      return {
        columns: ['Reseller', 'Referral Code', 'City', 'Referred Orders', 'Paid Sales', 'Earned Commission', 'Paid Commission', 'Status'],
        rows: resellers.map((r) => ({
          Reseller: r.name,
          'Referral Code': r.referralCode,
          City: r.city,
          'Referred Orders': r.totalReferredOrders,
          'Paid Sales': r.totalPaidSales,
          'Earned Commission': r.earnedCommission,
          'Paid Commission': r.paidCommission,
          Status: r.status,
        })),
      };

    case 'campaign_performance_report':
      return {
        columns: ['Campaign', 'Segment', 'Status', 'Recipients', 'Queued/Sent', 'Conversions', 'Revenue Generated'],
        rows: campaigns.map((c) => ({
          Campaign: c.name,
          Segment: c.segmentName || 'All',
          Status: c.status,
          Recipients: c.recipientsCount,
          'Queued/Sent': c.sentCount,
          Conversions: c.conversionsCount,
          'Revenue Generated': c.revenueGenerated,
        })),
      };

    case 'loyalty_points_report':
      return {
        columns: ['Customer', 'Phone', 'Tier', 'Available Points', 'Lifetime Earned', 'Lifetime Redeemed'],
        rows: profiles
          .sort((a, b) => (b.loyalty?.lifetimePointsEarned || 0) - (a.loyalty?.lifetimePointsEarned || 0))
          .map((p) => ({
            Customer: p.customer.name,
            Phone: p.customer.phone,
            Tier: p.loyalty?.tier || 'Bronze',
            'Available Points': p.loyalty?.pointsBalance || 0,
            'Lifetime Earned': p.loyalty?.lifetimePointsEarned || 0,
            'Lifetime Redeemed': p.loyalty?.lifetimePointsRedeemed || 0,
          })),
      };

    case 'daily_sales_report': {
      const byDay = new Map<string, { orders: number; grossSales: number; paidCash: number; creditDue: number }>();
      for (const tx of transactions) {
        if (tx.type !== 'credit' || tx.status === 'cancelled' || !inDateRange(tx.date)) continue;
        const prev = byDay.get(tx.date) || { orders: 0, grossSales: 0, paidCash: 0, creditDue: 0 };
        prev.orders++;
        prev.grossSales += Number(tx.amount || 0);
        prev.paidCash += Number(tx.paidAmount || 0);
        prev.creditDue += Number(tx.dueBalance || 0);
        byDay.set(tx.date, prev);
      }
      return {
        columns: ['Date', 'Orders', 'Gross Sales', 'Paid Amount', 'Credit Due'],
        rows: Array.from(byDay.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([DateStr, v]) => ({
            Date: DateStr,
            Orders: v.orders,
            'Gross Sales': v.grossSales,
            'Paid Amount': v.paidCash,
            'Credit Due': v.creditDue,
          })),
      };
    }

    case 'monthly_profit_loss_report': {
      const prodById = new Map(products.map((p) => [p.id, p]));
      const byMonth = new Map<string, { revenue: number; cogs: number; expenses: number }>();
      for (const tx of transactions) {
        if (tx.type !== 'credit' || tx.status === 'cancelled') continue;
        const m = (tx.date || '').slice(0, 7) || 'Unknown';
        const cur = byMonth.get(m) || { revenue: 0, cogs: 0, expenses: 0 };
        cur.revenue += Number(tx.amount || 0);
        for (const it of tx.items || []) {
          const p = it.productId ? prodById.get(it.productId) : undefined;
          cur.cogs += Number(p?.costPrice || 0) * Number(it.quantity || 1);
        }
        byMonth.set(m, cur);
      }
      for (const exp of monthlyExpenses) {
        const m = exp.month || 'Unknown';
        const cur = byMonth.get(m) || { revenue: 0, cogs: 0, expenses: 0 };
        cur.expenses += Number(exp.amount || 0);
        byMonth.set(m, cur);
      }
      return {
        columns: ['Month', 'Gross Revenue', 'Estimated COGS', 'Operating Expenses', 'Estimated Net Profit'],
        rows: Array.from(byMonth.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([Month, v]) => ({
            Month,
            'Gross Revenue': v.revenue,
            'Estimated COGS': v.cogs,
            'Operating Expenses': v.expenses,
            'Estimated Net Profit': v.revenue - v.cogs - v.expenses,
          })),
      };
    }
  }
}

export function buildCsvContent(columns: string[], rows: Array<Record<string, string | number>>): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map(esc).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export function buildExcelHtmlContent(title: string, columns: string[], rows: Array<Record<string, string | number>>): string {
  const escHtml = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const ths = columns.map((c) => `<th style="background:#f8fafc;font-weight:bold;border:1px solid #cbd5e1;padding:6px;">${escHtml(c)}</th>`).join('');
  const trs = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td style="border:1px solid #cbd5e1;padding:6px;">${escHtml(r[c])}</td>`)
          .join('')}</tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><h3>${escHtml(
    title
  )}</h3><table border="1" cellspacing="0" cellpadding="4"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

export function computeCrmCampaignSignals(params: {
  profiles: Customer360Profile[];
  products: ProductItem[];
}): CRMGroupSignalSummary[] {
  const { profiles, products } = params;
  const activeProducts = products.filter((p) => p.status !== 'draft' && !p.isUpcoming);
  const topCatalogProduct =
    [...activeProducts].sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))[0] ||
    activeProducts[0] ||
    products[0];

  const pickBestProductForProfile = (profile: Customer360Profile): ProductItem | undefined => {
    if (profile.recommendedProducts && profile.recommendedProducts.length > 0) {
      return profile.recommendedProducts[0];
    }
    const boughtIds = new Set(profile.purchasedProducts.map((p) => p.productId).filter(Boolean));
    for (const cat of profile.preferredCategories) {
      const catMatch = activeProducts.find(
        (p) => p.category.toLowerCase().includes(cat.toLowerCase()) && !boughtIds.has(p.id)
      );
      if (catMatch) return catMatch;
    }
    return topCatalogProduct;
  };

  const recentBuyers: CRMBuyerSignal[] = [];
  const coldBuyers: CRMBuyerSignal[] = [];
  const repeatBuyers: CRMBuyerSignal[] = [];
  const regularBuyers: CRMBuyerSignal[] = [];
  const vipBuyers: CRMBuyerSignal[] = [];
  const dueBuyers: CRMBuyerSignal[] = [];
  const byCategoryMap = new Map<string, CRMBuyerSignal[]>();

  for (const prof of profiles) {
    if (prof.customer.status === 'archived' || prof.customer.whatsappOptOut) continue;
    const phone = (prof.customer.phone || '').trim();
    if (!phone) continue;

    const bestProd = pickBestProductForProfile(prof);
    const prodName = bestProd?.name || 'New Arrival Wholesale Lot';
    const prodId = bestProd?.id;
    const prodPrice = bestProd?.ourPrice;
    const prefCat = prof.preferredCategories[0] || bestProd?.category || 'General';
    const dSince = prof.daysSinceLastOrder ?? undefined;

    // 1. VIP Customers
    if (prof.autoSegments.includes('VIP Customer')) {
      vipBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'vip_customers',
        groupLabel: 'VIP Customers',
        actionType: 'Offer',
        templateType: 'vip_offer',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `VIP buyer (${prof.totalOrders} orders, Rs. ${prof.totalPurchaseValue.toLocaleString('en-PK')}) — send exclusive VIP offer on ${prodName}`,
        priorityScore: 95,
      });
    }

    // 2. Cold / Inactive Customers (30+ days)
    if (
      (dSince !== undefined && dSince >= 30) ||
      prof.autoSegments.includes('Inactive 30 Days') ||
      prof.autoSegments.includes('Inactive 60 Days') ||
      prof.autoSegments.includes('Inactive 90 Days') ||
      prof.autoSegments.includes('Lost Customer')
    ) {
      coldBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'cold_customers',
        groupLabel: 'Cold / Inactive Customers',
        actionType: 'Win-Back',
        templateType: 'inactive_recovery',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `${dSince ?? 30}+ days inactive in ${prefCat} — send win-back discount offer on ${prodName}`,
        priorityScore: 90,
      });
    }

    // 3. Recent Buyers (last 14 days)
    if (dSince !== undefined && dSince <= 14 && prof.totalOrders >= 1) {
      recentBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'recent_buyers',
        groupLabel: 'Recent Buyers (0-14 Days)',
        actionType: 'New Arrival',
        templateType: 'product_recommendation',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `Ordered ${dSince}d ago in ${prefCat} — send cross-sell recommendation for ${prodName}`,
        priorityScore: 85,
      });
    }

    // 4. Repeat Buyers
    if (prof.autoSegments.includes('Repeat Customer') || prof.totalOrders >= 2) {
      repeatBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'repeat_buyers',
        groupLabel: 'Repeat Buyers',
        actionType: 'Reminder',
        templateType: 'repeat_purchase_reminder',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `Repeat buyer (${prof.totalOrders} orders) — send restock reminder & bundle offer for ${prodName}`,
        priorityScore: 82,
      });
    }

    // 5. Regular Customers
    if (prof.autoSegments.includes('Regular Customer') || prof.totalOrders >= 3) {
      regularBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'regular_customers',
        groupLabel: 'Regular Customers',
        actionType: 'Offer',
        templateType: 'discount_offer',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `Consistent buyer in ${prefCat} — send monthly loyalty offer on ${prodName}`,
        priorityScore: 80,
      });
    }

    // 6. Payment Due Reminder
    if (prof.outstandingBalance > 0) {
      dueBuyers.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'payment_due',
        groupLabel: 'Outstanding Khata Reminders',
        actionType: 'Payment Reminder',
        templateType: 'payment_reminder',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `Pending balance Rs. ${prof.outstandingBalance.toLocaleString('en-PK')} — send polite Khata payment reminder`,
        priorityScore: 98,
      });
    }

    // 7. Category-wise Affinity Groups
    if (prefCat && prefCat !== 'General') {
      const catList = byCategoryMap.get(prefCat) || [];
      catList.push({
        customerId: prof.customer.id,
        customerName: prof.customer.name,
        phone,
        city: prof.customer.city,
        groupKey: 'category_affinity',
        groupLabel: `${prefCat} Buyers`,
        actionType: 'Offer',
        templateType: 'product_recommendation',
        recommendedProductId: prodId,
        recommendedProductName: prodName,
        recommendedProductPrice: prodPrice,
        preferredCategory: prefCat,
        daysSinceLastOrder: dSince,
        totalOrders: prof.totalOrders,
        totalSpend: prof.totalPurchaseValue,
        outstandingBalance: prof.outstandingBalance,
        reason: `Active interest in ${prefCat} — send targeted offer for ${prodName}`,
        priorityScore: 75,
      });
      byCategoryMap.set(prefCat, catList);
    }
  }

  const pickTopProdForGroup = (list: CRMBuyerSignal[]) => {
    const freq = new Map<string, { count: number; sample: CRMBuyerSignal }>();
    for (const b of list) {
      const key = b.recommendedProductId || b.recommendedProductName;
      const cur = freq.get(key) || { count: 0, sample: b };
      cur.count += 1;
      freq.set(key, cur);
    }
    const best = Array.from(freq.values()).sort((a, b) => b.count - a.count)[0]?.sample;
    return {
      id: best?.recommendedProductId || topCatalogProduct?.id,
      name: best?.recommendedProductName || topCatalogProduct?.name || 'Featured Product',
      price: best?.recommendedProductPrice ?? topCatalogProduct?.ourPrice,
    };
  };

  const summaries: CRMGroupSignalSummary[] = [];
  const pushSummary = (
    id: string,
    groupKey: CRMGroupSignalSummary['groupKey'],
    groupLabel: string,
    actionType: CRMGroupSignalSummary['actionType'],
    templateType: CRMWhatsAppTemplateType,
    buyers: CRMBuyerSignal[],
    reason: string,
    categoryName?: string
  ) => {
    if (buyers.length === 0) return;
    const topP = pickTopProdForGroup(buyers);
    summaries.push({
      id,
      groupKey,
      groupLabel,
      categoryName,
      actionType,
      templateType,
      recommendedProductId: topP.id,
      recommendedProductName: topP.name,
      recommendedProductPrice: topP.price,
      buyerCount: buyers.length,
      buyers: [...buyers].sort((a, b) => b.priorityScore - a.priorityScore || b.totalSpend - a.totalSpend),
      reason,
    });
  };

  pushSummary(
    'sig_vip',
    'vip_customers',
    'VIP Customers',
    'Offer',
    'vip_offer',
    vipBuyers,
    'High-spend loyal buyers ready for exclusive VIP bundle offers and priority stock access.'
  );
  pushSummary(
    'sig_recent',
    'recent_buyers',
    'Recent Buyers (0-14 Days)',
    'New Arrival',
    'product_recommendation',
    recentBuyers,
    'Bought recently — high open rate for complementary product offers and feedback vouchers.'
  );
  pushSummary(
    'sig_repeat',
    'repeat_buyers',
    'Repeat Buyers',
    'Reminder',
    'repeat_purchase_reminder',
    repeatBuyers,
    'Customers with 2+ orders — ideal for restock reminders and multi-unit bundle discounts.'
  );
  pushSummary(
    'sig_regular',
    'regular_customers',
    'Regular Customers',
    'Offer',
    'discount_offer',
    regularBuyers,
    'Steady monthly buyers — nurture with seasonal category offers and loyalty coupons.'
  );
  pushSummary(
    'sig_cold',
    'cold_customers',
    'Cold / Inactive Customers (30+ Days)',
    'Win-Back',
    'inactive_recovery',
    coldBuyers,
    'Haven’t ordered in 30+ days — send win-back coupon and top-selling product reminder.'
  );
  pushSummary(
    'sig_due',
    'payment_due',
    'Outstanding Khata / Payment Due',
    'Payment Reminder',
    'payment_reminder',
    dueBuyers,
    'Active receivable balances — send polite payment recovery reminder via WhatsApp.'
  );

  for (const [catName, list] of Array.from(byCategoryMap.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
    pushSummary(
      `sig_cat_${catName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      'category_affinity',
      `Category: ${catName}`,
      'Offer',
      'product_recommendation',
      list,
      `Buyers with proven purchase history in ${catName} — promote matching products or new arrivals.`,
      catName
    );
  }

  return summaries;
}

