import {
  BusinessProfile,
  Customer,
  Investor,
  LuckyDrawWinner,
  MonthlyCustomerStatement,
  PakistaniPaymentChannels,
  ProductBroadcast,
  ProductItem,
  ReminderTemplate,
  Transaction,
} from '../types';

export function cleanPhoneNumber(rawPhone: string): string {
  // Strip non-digits
  let digits = rawPhone.replace(/\D/g, '');

  // If Pakistani 11-digit mobile starting with 03 (e.g. 03125256266 or 03001234567), change leading 0 to 92
  if (digits.startsWith('03') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  } else if (digits.length === 10 && digits.startsWith('3')) {
    // 3125256266 -> 923125256266
    digits = `92${digits}`;
  }

  return digits;
}

export function generateWhatsAppLink(phone: string, message: string): string {
  const cleanPhone = cleanPhoneNumber(phone);
  const encodedText = encodeURIComponent(message);
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

export function openWhatsAppDirect(phone: string, message: string): void {
  const url = generateWhatsAppLink(phone, message);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('WhatsApp link error:', err);
  }
}

export function formatPaymentChannelsText(profileOrChannels: BusinessProfile | PakistaniPaymentChannels): string {
  const ch = 'paymentChannels' in profileOrChannels ? profileOrChannels.paymentChannels : profileOrChannels;
  const lines: string[] = [];

  if (ch.easyPaisa?.enabled && ch.easyPaisa.accountNumber) {
    lines.push(`• *EasyPaisa:* ${ch.easyPaisa.accountNumber} (${ch.easyPaisa.accountTitle})`);
  }
  if (ch.jazzCash?.enabled && ch.jazzCash.accountNumber) {
    lines.push(`• *JazzCash:* ${ch.jazzCash.accountNumber} (${ch.jazzCash.accountTitle})`);
  }
  if (ch.sadaPay?.enabled && (ch.sadaPay.accountNumber || ch.sadaPay.sadaTag)) {
    const tag = ch.sadaPay.sadaTag ? ` | Tag: ${ch.sadaPay.sadaTag}` : '';
    const iban = ch.sadaPay.iban ? ` | IBAN: ${ch.sadaPay.iban}` : '';
    lines.push(`• *SadaPay:* ${ch.sadaPay.accountNumber} (${ch.sadaPay.accountTitle}${tag}${iban})`);
  }
  if (ch.bankDetails?.enabled && ch.bankDetails.accountNumber) {
    lines.push(
      `• *Bank Account:* ${ch.bankDetails.bankName}\n  A/C Title: ${ch.bankDetails.accountTitle}\n  A/C No: ${ch.bankDetails.accountNumber}\n  IBAN: ${ch.bankDetails.iban}`
    );
  }

  return lines.length > 0 ? lines.join('\n') : 'Payment details available on request: 03125256266';
}

export function formatTemplateMessage(
  templateContent: string,
  variables: {
    customerName: string;
    amount: number;
    currency: string;
    dueDate?: string;
    daysOverdue?: number;
    businessName: string;
    paymentChannelsText?: string;
    paymentTerms?: number;
    invoiceNo?: string;
    invoiceTitle?: string;
    paymentMode?: string;
    remainingBalance?: number;
    date?: string;
    productName?: string;
    productDescription?: string;
    price?: number;
    productLink?: string;
    savings?: number;
    marketPrice?: number;
    voucherCode?: string;
    prizeTitle?: string;
  }
): string {
  const todayStr = new Date().toISOString().split('T')[0];

  let formatted = templateContent;
  formatted = formatted.replace(/{CUSTOMER_NAME}/g, variables.customerName || 'Valued Customer');
  formatted = formatted.replace(/{AMOUNT}/g, variables.amount?.toLocaleString('en-PK') || '0');
  formatted = formatted.replace(/{CURRENCY}/g, variables.currency || 'Rs.');
  formatted = formatted.replace(/{DUE_DATE}/g, variables.dueDate || 'Immediate');
  formatted = formatted.replace(/{DAYS_OVERDUE}/g, String(variables.daysOverdue ?? 0));
  formatted = formatted.replace(/{BUSINESS_NAME}/g, variables.businessName || '100DAGAR · مدینہ مارکیٹ');
  formatted = formatted.replace(/{PAYMENT_CHANNELS}/g, variables.paymentChannelsText || '');
  formatted = formatted.replace(/{PAYMENT_TERMS}/g, String(variables.paymentTerms ?? 14));
  formatted = formatted.replace(/{CURRENT_DATE}/g, todayStr);
  formatted = formatted.replace(/{INVOICE_NO}/g, variables.invoiceNo || 'INV-100D');
  formatted = formatted.replace(/{INVOICE_TITLE}/g, variables.invoiceTitle || 'Wholesale Order');
  formatted = formatted.replace(/{PAYMENT_MODE}/g, variables.paymentMode?.toUpperCase() || 'ONLINE');
  formatted = formatted.replace(/{REMAINING_BALANCE}/g, variables.remainingBalance?.toLocaleString('en-PK') || '0');
  formatted = formatted.replace(/{DATE}/g, variables.date || todayStr);

  // Customer savings & pricing tags
  formatted = formatted.replace(/{SAVINGS}/g, variables.savings ? variables.savings.toLocaleString('en-PK') : '0');
  formatted = formatted.replace(/{MARKET_PRICE}/g, variables.marketPrice ? variables.marketPrice.toLocaleString('en-PK') : '0');

  // Product broadcast tags
  formatted = formatted.replace(/{PRODUCT_NAME}/g, variables.productName || 'New Arrival');
  formatted = formatted.replace(/{PRODUCT_DESCRIPTION}/g, variables.productDescription || '');
  formatted = formatted.replace(/{PRICE}/g, variables.price ? variables.price.toLocaleString('en-PK') : '0');
  formatted = formatted.replace(/{PRODUCT_LINK}/g, variables.productLink || '');

  // Lucky Draw tags
  formatted = formatted.replace(/{VOUCHER_CODE}/g, variables.voucherCode || '');
  formatted = formatted.replace(/{PRIZE}/g, variables.prizeTitle || '');

  return formatted;
}

export function calculateDaysOverdue(dueDateStr?: string): number {
  if (!dueDateStr) return 0;
  const dueDate = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - dueDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Generate payment reminder message for a customer based on overdue status
export function buildCustomerPaymentReminderMessage(
  customer: Customer,
  profile: BusinessProfile,
  templates: ReminderTemplate[],
  options?: { customDueDate?: string; customNote?: string; preferredTemplateId?: string }
): string {
  const daysOverdue = calculateDaysOverdue(options?.customDueDate);
  let template = options?.preferredTemplateId
    ? templates.find((t) => t.id === options.preferredTemplateId)
    : undefined;

  if (!template) {
    if (daysOverdue > 0) {
      template = templates.find((t) => t.type === 'overdue_3days') || templates.find((t) => t.type === 'overdue') || templates[0];
    } else {
      template = templates.find((t) => t.type === 'weekly_due') || templates[0];
    }
  }

  const paymentChannelsText = formatPaymentChannelsText(profile);

  let message = formatTemplateMessage(template.content, {
    customerName: customer.name + (customer.urduName ? ` (${customer.urduName})` : ''),
    amount: Math.abs(customer.balance),
    currency: profile.currencySymbol,
    dueDate: options?.customDueDate,
    daysOverdue,
    businessName: profile.name,
    paymentChannelsText,
    paymentTerms: customer.paymentTermsDays,
  });

  if (options?.customNote) {
    message += `\n\n*Note:* ${options.customNote}`;
  }

  return message;
}

// Generate sale invoice with clear savings calculation
export function buildSaleInvoiceMessage(
  customer: Customer,
  tx: Transaction,
  profile: BusinessProfile
): string {
  const paymentChannelsText = formatPaymentChannelsText(profile);
  const isCredit = tx.type === 'credit';
  const totalSavings = tx.totalSavings || 0;

  let msg = `*${profile.name} · مدینہ مارکیٹ*\n`;
  msg += `🧾 *${isCredit ? 'Sale Invoice / نیا بل' : 'Payment Receipt / وصولی رسید'}*\n`;
  msg += `Invoice #: *${tx.invoiceNumber || 'INV-100D'}*\n`;
  msg += `Date: ${tx.date}\n`;
  msg += `Customer: *${customer.name}* ${customer.urduName ? `(${customer.urduName})` : ''} [${customer.customerType === 'retail' ? 'ریٹیلر' : 'انفرادی'}]\n\n`;

  if (tx.items && tx.items.length > 0) {
    msg += `*Items Ordered / سامان کی تفصیل:*\n`;
    tx.items.forEach((item, idx) => {
      const itemSave = item.customerSavings ? ` (بچت: ${profile.currencySymbol}${item.customerSavings.toLocaleString('en-PK')})` : '';
      msg += `${idx + 1}. ${item.description} - ${item.quantity}x @ ${profile.currencySymbol}${item.unitPrice.toLocaleString('en-PK')}${itemSave}\n`;
    });
    msg += `\n`;
  }

  msg += `Total Amount / کل رقم: *${profile.currencySymbol}${tx.amount.toLocaleString('en-PK')}*\n`;

  if (totalSavings > 0) {
    msg += `🌟 *Your Total Savings / آپ کی کل بچت:* *${profile.currencySymbol}${totalSavings.toLocaleString('en-PK')}* 🌟\n`;
  }

  const isCOD = tx.saleType === 'cod' || tx.paymentMode === 'cod' || (tx.paymentMode === 'cash' && tx.saleType !== 'partial' && tx.saleType !== 'time_credit');

  if (isCOD) {
    msg += `\n🚚 *Order Mode / طریقہ آرڈر:* Cash on Delivery (COD / کیش آن ڈلیوری)\n`;
    msg += `💵 *Pay to Rider upon Delivery / رائیڈر کو نقد ادائیگی:* *${profile.currencySymbol}${tx.amount.toLocaleString('en-PK')}*\n`;
    msg += `(نوٹ: کیش آن ڈلیوری کے لیے اکاؤنٹ ٹرانسفر کی ضرورت نہیں ہے، رقم پارسل موصول ہونے پر رائیڈر کو نقد ادا فرمائیں۔)\n\n`;
  } else {
    if (tx.saleType === 'partial') {
      msg += `Advance Paid / ادا کردہ پیشگی: *${profile.currencySymbol}${(tx.paidAmount || 0).toLocaleString('en-PK')}*\n`;
      msg += `Due Balance / باقی واجب الادا: *${profile.currencySymbol}${(tx.dueBalance || 0).toLocaleString('en-PK')}*\n`;
      msg += `Payment Terms Due Date: *${tx.dueDate}*\n`;
    } else if (tx.saleType === 'time_credit') {
      msg += `Sale Mode: *Time-Based Credit (ادھار کھاتہ)*\n`;
      msg += `Due Date / آخری تاریخ ادائیگی: *${tx.dueDate}* (${tx.paymentTermsDays || 14} Days Terms)\n`;
    }

    msg += `\n*Payment Accounts (EasyPaisa / JazzCash / SadaPay: 03125256266):*\n${paymentChannelsText}\n\n`;
  }

  msg += `کاروبار کرنے کا بہت شکریہ! جزاک اللہ۔`;

  return msg;
}

// Generate Lucky Draw Winner Announcement
export function buildLuckyDrawWinnerMessage(
  winner: LuckyDrawWinner,
  profile: BusinessProfile,
  templates: ReminderTemplate[]
): string {
  const tpl = templates.find((t) => t.type === 'lucky_draw_winner') || templates[0];

  const rewardValueStr = winner.lastPurchaseAmount && winner.rank === 1
    ? `${profile.currencySymbol}${winner.lastPurchaseAmount.toLocaleString('en-PK')} (پچھلے آرڈر کی مکمل رقم کیش بیک)`
    : winner.isUpcomingGift
    ? `تحفہ: نئے آنے والے آئٹم کا تحفہ (${winner.prizeTitle})`
    : winner.discountValue;

  return formatTemplateMessage(tpl.content, {
    customerName: winner.customerName,
    amount: winner.lastPurchaseAmount || 0,
    currency: profile.currencySymbol,
    businessName: profile.name,
    productName: winner.prizeTitle,
    productLink: winner.voucherCode,
    price: winner.lastPurchaseAmount || 0,
    voucherCode: winner.voucherCode,
    prizeTitle: `${winner.prizeTitle} [${rewardValueStr}]`,
  });
}

// Generate Product Broadcast message
export function buildProductBroadcastMessage(
  customer: Customer,
  product: ProductBroadcast,
  profile: BusinessProfile,
  templates: ReminderTemplate[]
): string {
  const template = templates.find((t) => t.type === 'product_broadcast') || templates[0];

  return formatTemplateMessage(template.content, {
    customerName: customer.name,
    amount: 0,
    currency: profile.currencySymbol,
    businessName: profile.name,
    productName: product.productName + (product.urduName ? ` (${product.urduName})` : ''),
    productDescription: product.description,
    price: product.price,
    productLink: product.productLink,
  });
}

// Generate Monthly Customer Statement message with Lucky Draw Winnings
// USER DIRECTIVE: "keep monthly statement for all customers who purchase in entire month and if get wining amount"
export function buildMonthlyStatementWhatsAppMessage(
  statement: MonthlyCustomerStatement,
  profile: BusinessProfile
): string {
  const cust = statement.customer;
  const curr = profile.currencySymbol;

  let msg = `*📊 ماہانہ کسٹمر اسٹیٹمنٹ - ${profile.name} · مدینہ مارکیٹ*\n`;
  msg += `*Monthly Customer Account Statement - ${statement.monthName}*\n\n`;

  msg += `محترم *${cust.name}*${cust.urduName ? ` (${cust.urduName})` : ''} صاحب،\n`;
  if (cust.city) msg += `شہر / علاقہ: ${cust.city}${cust.area ? `, ${cust.area}` : ''}\n`;
  msg += `امید ہے آپ بخیریت ہوں گے۔ پورے مہینے میں آپ کے خریداری و ادائیگی کا خلاصہ درج ذیل ہے:\n\n`;

  msg += `📋 *خریداری تفصیل (Purchases Summary):*\n`;
  msg += `• کل آرڈرز / بل: *${statement.invoicesCount}*\n`;
  msg += `• پورے مہینے کی کل خریداری: *${curr} ${statement.totalPurchases.toLocaleString('en-PK')}*\n`;
  msg += `• وصول شدہ / ادا کردہ رقم: *${curr} ${statement.totalPaid.toLocaleString('en-PK')}*\n`;
  msg += `• کسٹمر بچت (Your Savings): *${curr} ${statement.totalSavings.toLocaleString('en-PK')}*\n`;
  msg += `• موجودہ بقایا بیلنس (Balance Due): *${curr} ${statement.closingBalance.toLocaleString('en-PK')}*\n\n`;

  // IF CUSTOMER WON IN LUCKY DRAW (User directive!)
  if (statement.luckyDrawWinnings?.hasWon) {
    const win = statement.luckyDrawWinnings;
    msg += `🎉 *🏆 مبارکباد! آپ اس مہینے کے لکی ڈرا فاتح ہیں!* 🏆\n`;
    msg += `*Congratulations! You Won in ${profile.name} Lucky Draw:*\n`;
    msg += `🎁 انعام / Prize: *${win.prizeTitle}*\n`;
    msg += `🎟️ انعامی واؤچر کوڈ: *${win.voucherCode}*\n`;
    msg += `💰 انعام کی مالیت: *${win.discountValue}*\n`;
    msg += `_(یہ واؤچر آپ کے اگلے ہول سیل آرڈر پر فلیٹ کیش بیک یا ڈسکاؤنٹ کے طور پر لاگو ہوگا)_\n\n`;
  }

  // Payment Accounts if balance is positive
  if (statement.closingBalance > 0) {
    msg += `*ادائیگی کے ذرائع (EasyPaisa / JazzCash / SadaPay: 03125256266):*\n`;
    msg += `${formatPaymentChannelsText(profile.paymentChannels)}\n\n`;
    msg += `براہ کرم بقایا رقم بروقت منتقل فرما کر سکرین شاٹ بھیج دیں۔\n`;
  } else {
    msg += `✅ *آپ کا کھاتہ مکمل طور پر کلیئر ہے۔ بروقت ادائیگی اور بھروسے پر ہم آپ کے شکر گزار ہیں۔*\n\n`;
  }

  msg += `*100DAGAR مدینہ مارکیٹ* کے ساتھ خریداری پر شکریہ!\nجزاک اللہ خیراً۔`;

  return msg;
}

export function extractCustomerLastName(fullName?: string): string {
  const cleaned = (fullName || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const lower = cleaned.toLowerCase();
  const genericNames = new Set([
    'guest',
    'guest customer',
    'customer',
    'valued customer',
    'online customer',
    'walk-in customer',
    'walk in customer',
    'buyer',
  ]);
  if (genericNames.has(lower)) return '';

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 0) return '';

  const rawLast = parts[parts.length - 1];
  if (!rawLast || genericNames.has(rawLast.toLowerCase())) return '';

  return rawLast.charAt(0).toUpperCase() + rawLast.slice(1);
}

export function getCurrentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

export function buildCurrentOriginUrl(pathOrQuery = ''): string {
  const origin = getCurrentOrigin();
  if (!pathOrQuery) return origin || '/';
  const suffix = pathOrQuery.startsWith('/') || pathOrQuery.startsWith('?') ? pathOrQuery : `/${pathOrQuery}`;
  return origin ? `${origin}${suffix}` : suffix;
}

export function resolvePublicProductImageUrl(imageUrl?: string): string {
  const trimmed = (imageUrl || '').trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (typeof window !== 'undefined' && trimmed.startsWith('/')) {
    return `${window.location.origin}${trimmed}`;
  }

  return '';
}

export function buildProductPageUrl(productId: string): string {
  if (typeof window === 'undefined') {
    return `/?product=${encodeURIComponent(productId)}`;
  }
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('product', productId);
    return url.toString();
  } catch {
    return `${window.location.origin}/?product=${encodeURIComponent(productId)}`;
  }
}

export interface ResolvedProductInvestor {
  whatsapp: string;
  investorName?: string;
  investorId?: string;
  isInvestorAssigned: boolean;
  coOwners: Array<{
    investorId: string;
    investorName: string;
    whatsapp: string;
  }>;
}

/**
 * Resolves which Investor's WhatsApp should receive a Product Inquiry.
 * Prioritizes active linked Investor records (so edits in Backend -> Investor Details take effect immediately),
 * then falls back to manual product.investorWhatsApp, and finally business fallback phone.
 */
export function resolveProductInvestorContact(
  product: ProductItem,
  investors: Investor[] = [],
  fallbackPhone: string = '03125256266'
): ResolvedProductInvestor {
  const matched = investors.filter((inv) => {
    if (inv.status === 'inactive') return false;
    const isDirectId = Boolean(product.investorId && inv.id === product.investorId);
    const isAssigned = Array.isArray(inv.assignedProductIds) && inv.assignedProductIds.includes(product.id);
    const isAllocated =
      Array.isArray(inv.productAllocations) && inv.productAllocations.some((a) => a.productId === product.id);
    return isDirectId || isAssigned || isAllocated;
  });

  const coOwners = matched
    .map((inv) => ({
      investorId: inv.id,
      investorName: inv.name,
      whatsapp: (inv.whatsapp || inv.phone || '').trim(),
    }))
    .filter((entry) => entry.whatsapp.length > 0);

  const primaryCoOwner = coOwners[0];
  const manualProdWhatsapp = (product.investorWhatsApp || '').trim();

  if (primaryCoOwner) {
    return {
      whatsapp: primaryCoOwner.whatsapp,
      investorName: primaryCoOwner.investorName,
      investorId: primaryCoOwner.investorId,
      isInvestorAssigned: true,
      coOwners,
    };
  }

  if (manualProdWhatsapp) {
    const namedInv = product.investorId ? investors.find((i) => i.id === product.investorId) : undefined;
    return {
      whatsapp: manualProdWhatsapp,
      investorName: namedInv?.name,
      investorId: namedInv?.id || product.investorId,
      isInvestorAssigned: true,
      coOwners: [
        {
          investorId: namedInv?.id || product.investorId || 'manual',
          investorName: namedInv?.name || 'Product Investor',
          whatsapp: manualProdWhatsapp,
        },
      ],
    };
  }

  return {
    whatsapp: (fallbackPhone || '03125256266').trim(),
    isInvestorAssigned: false,
    coOwners: [],
  };
}

export interface ProductMessageOptions {
  customerName?: string;
  investorName?: string;
  selectedSize?: string;
  quantity?: number;
  activePrice?: number;
  activeMarketPrice?: number;
  productUrl?: string;
  imageUrl?: string;
}

export function buildProfessionalCustomerProductShareMessage(
  product: ProductItem,
  profile: BusinessProfile,
  options?: ProductMessageOptions
): string {
  const price = options?.activePrice ?? product.ourPrice;
  const market = options?.activeMarketPrice ?? product.marketPrice;
  const savings = Math.max(0, market - price);
  const savingsPct = market > 0 ? Math.round((savings / market) * 100) : 0;
  const qty = options?.quantity && options.quantity > 1 ? options.quantity : 1;
  const productUrl = options?.productUrl || buildProductPageUrl(product.id);
  const currency = profile.currencySymbol || 'Rs.';
  const lastName = extractCustomerLastName(options?.customerName);
  const greeting = lastName ? `Dear *Mr./Ms. ${lastName}*,` : 'Dear *Valued Customer*,';

  const lines: string[] = [
    greeting,
    ``,
    `Thank you for reaching out to me! How can I help you today?`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `*${product.name}*`,
  ];

  if (product.urduName) {
    lines.push(`_${product.urduName}_`);
  }

  lines.push(`*SKU:* ${product.sku || product.id}  |  *Category:* ${product.category}`);

  if (options?.selectedSize) {
    lines.push(`*Selected Option:* ${options.selectedSize}`);
  }
  if (qty > 1) {
    lines.push(`*Quantity:* ${qty} units`);
  }

  lines.push(``);
  lines.push(`*PRICE & VALUE SUMMARY*`);
  lines.push(`• *Our Super Best Price:* ${currency}${price.toLocaleString('en-PK')}`);
  if (market > price) {
    lines.push(`• *Market Retail Price:* ~${currency}${market.toLocaleString('en-PK')}~`);
    lines.push(`• *Your Instant Savings:* ${currency}${savings.toLocaleString('en-PK')} (${savingsPct}% OFF)`);
  }

  if (product.isUpcoming || product.upcomingStatus === 'coming_soon') {
    lines.push(
      `• *Availability:* Upcoming / Coming Soon${product.expectedArrivalDate ? ` (Expected: ${product.expectedArrivalDate})` : ''}`
    );
  } else {
    lines.push(`• *Availability:* ${product.stockQty > 0 ? `In Stock (${product.stockQty} units ready)` : 'Confirming latest stock'}`);
  }

  lines.push(``);
  lines.push(`*Product Link:*`);
  lines.push(productUrl);

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Please let me know your preferred quantity or delivery city so I can assist you right away.`);
  lines.push(``);
  lines.push(`Warm regards,`);
  lines.push(`*${profile.name}*`);

  return lines.join('\n');
}

export function buildDirectProductWhatsAppMessage(
  product: ProductItem,
  profile: BusinessProfile,
  options?: ProductMessageOptions
): string {
  const price = options?.activePrice ?? product.ourPrice;
  const market = options?.activeMarketPrice ?? product.marketPrice;
  const savings = Math.max(0, market - price);
  const savingsPct = market > 0 ? Math.round((savings / market) * 100) : 0;
  const qty = options?.quantity && options.quantity > 0 ? options.quantity : 1;
  const productUrl = options?.productUrl || buildProductPageUrl(product.id);
  const currency = profile.currencySymbol || 'Rs.';
  const lastName = extractCustomerLastName(options?.customerName);
  const isUpcoming = product.isUpcoming || product.upcomingStatus === 'coming_soon';

  const lines: string[] = [
    `*${isUpcoming ? 'UPCOMING PRODUCT INQUIRY' : 'DIRECT ORDER INQUIRY'} — ${profile.name}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    lastName
      ? `Hello *${profile.name}*, this is *${lastName}*.`
      : `Assalam-o-Alaikum *${profile.name}*,`,
    isUpcoming
      ? `I would like arrival updates and pricing details for this upcoming item:`
      : `I would like to order and confirm availability for the following product:`,
    ``,
    `*Product:* ${product.name}`,
  ];

  if (product.urduName) {
    lines.push(`_${product.urduName}_`);
  }
  lines.push(`*SKU:* ${product.sku || product.id}`);
  if (options?.selectedSize) {
    lines.push(`*Selected Option:* ${options.selectedSize}`);
  }
  if (!isUpcoming) {
    lines.push(`*Quantity:* ${qty} ${qty > 1 ? 'units' : 'unit'}`);
  }

  lines.push(``);
  lines.push(`*PRICE DETAILS*`);
  lines.push(`• *Our Super Best Price:* ${currency}${(price * qty).toLocaleString('en-PK')}${qty > 1 ? ` (${currency}${price.toLocaleString('en-PK')}/unit)` : ''}`);
  if (market > price) {
    lines.push(`• *Market Price:* ~${currency}${(market * qty).toLocaleString('en-PK')}~`);
    lines.push(`• *Savings:* ${currency}${(savings * qty).toLocaleString('en-PK')} (${savingsPct}% OFF)`);
  }

  lines.push(``);
  lines.push(`*Product Link:*`);
  lines.push(productUrl);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Thank you for reaching out — please share how you can help with dispatch & payment details.`);

  return lines.join('\n');
}

export function buildInvestorProductInquiryMessage(
  product: ProductItem,
  profile: BusinessProfile,
  options?: ProductMessageOptions
): string {
  const productUrl = options?.productUrl || buildProductPageUrl(product.id);
  const storeTitle = (profile.name || '100DAGAR').split('·')[0].trim() || '100DAGAR';
  const investorGreeting = options?.investorName
    ? `Dear ${options.investorName},`
    : 'Dear Investor Partner,';

  const lines: string[] = [
    `*PRODUCT INQUIRY — ${storeTitle}*`,
    ``,
    investorGreeting,
    ``,
    `I’m interested in the following product:`,
    ``,
    `*Product:* ${product.name}`,
  ];

  if (product.urduName?.trim()) {
    lines.push(product.urduName.trim());
  }

  lines.push(`*SKU:* ${product.sku || product.id}`);

  if (options?.selectedSize && options.selectedSize !== 'Standard') {
    lines.push(`*Option:* ${options.selectedSize}`);
  }

  lines.push(``);
  lines.push(`*Product Link:* ${productUrl}`);
  lines.push(``);
  lines.push(`I have a question before confirming my order.`);

  return lines.join('\n');
}

export function buildAddMyProductInvestorMessage(
  product: ProductItem,
  profile: BusinessProfile,
  options?: ProductMessageOptions
): string {
  const productUrl = options?.productUrl || buildProductPageUrl(product.id);
  const storeTitle = (profile.name || '100DAGAR').split('·')[0].trim() || '100DAGAR';
  const investorGreeting = options?.investorName
    ? `Dear ${options.investorName},`
    : 'Dear Investor Partner,';
  const lastName = extractCustomerLastName(options?.customerName);

  const lines: string[] = [
    `*ADD MY PRODUCT & INVESTOR CONTACT — ${storeTitle}*`,
    ``,
    investorGreeting,
    ``,
    lastName
      ? `My name is *${lastName}*. I saw your listing on ${storeTitle} and would like to add my product / connect directly with you for full details:`
      : `I saw your listing on ${storeTitle} and would like to add my product / connect directly with you for full details:`,
    ``,
    `*Referenced Product:* ${product.name}`,
    `*SKU:* ${product.sku || product.id}`,
    `*Product Link:* ${productUrl}`,
    ``,
    `Please share how I can submit my product details and connect with you directly.`,
  ];

  return lines.join('\n');
}

export function openExternalLinkSafe(rawUrl: string): void {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return;
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('External link error:', err);
  }
}

function loadCorsImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

/**
 * Renders a crisp, high-resolution Product Image & Price Card PNG for sharing via WhatsApp / Web Share.
 */
export async function generateProductPriceCardFile(
  product: ProductItem,
  profile: BusinessProfile,
  options?: ProductMessageOptions
): Promise<File | null> {
  if (typeof document === 'undefined') return null;

  try {
    const width = 1080;
    const height = 1240;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const price = options?.activePrice ?? product.ourPrice;
    const market = options?.activeMarketPrice ?? product.marketPrice;
    const savings = Math.max(0, market - price);
    const savingsPct = market > 0 ? Math.round((savings / market) * 100) : 0;
    const currency = profile.currencySymbol || 'Rs.';
    const lastName = extractCustomerLastName(options?.customerName);

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, width, height);

    // Top Header Band
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, width, 150);

    // Gold Brand Accent Strip
    ctx.fillStyle = '#FFD200';
    ctx.fillRect(0, 150, width, 10);

    // Brand Title
    ctx.fillStyle = '#FFD200';
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
    ctx.fillText((profile.name || '100DAGAR').toUpperCase(), 54, 66);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      lastName
        ? `Prepared for Mr./Ms. ${lastName}  ·  Official Super Best Price Quote`
        : 'Official Super Best Price & Product Card',
      54,
      110
    );

    // Product Image Frame
    const frameX = 54;
    const frameY = 192;
    const frameW = width - 108;
    const frameH = 540;

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(frameX, frameY, frameW, frameH, 24);
    ctx.fill();
    ctx.stroke();

    const imgSrc = options?.imageUrl || product.imageUrl || product.pictures?.[0] || '';
    const loadedImg = await loadCorsImage(imgSrc);
    if (loadedImg && loadedImg.naturalWidth > 0) {
      const pad = 20;
      const availW = frameW - pad * 2;
      const availH = frameH - pad * 2;
      const scale = Math.min(availW / loadedImg.naturalWidth, availH / loadedImg.naturalHeight);
      const drawW = loadedImg.naturalWidth * scale;
      const drawH = loadedImg.naturalHeight * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(frameX + pad, frameY + pad, availW, availH, 16);
      ctx.clip();
      ctx.drawImage(loadedImg, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(product.name.slice(0, 32), width / 2, frameY + frameH / 2);
      ctx.textAlign = 'left';
    }

    // Savings Pill Overlay on Image Top-Left
    if (savingsPct > 0) {
      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.roundRect(frameX + 24, frameY + 24, 220, 52, 12);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
      ctx.fillText(`SAVE ${savingsPct}% OFF`, frameX + 44, frameY + 58);
    }

    // Product Title & SKU
    let cursorY = 790;
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
    const metaLabel = `${product.category || 'Catalog'}  ·  SKU: ${product.sku || product.id}${
      options?.selectedSize ? `  ·  Option: ${options.selectedSize}` : ''
    }`;
    ctx.fillText(metaLabel.slice(0, 72), 54, cursorY);

    cursorY += 46;
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 38px system-ui, -apple-system, sans-serif';
    const titleLines = wrapCanvasText(ctx, product.name, width - 108, 2);
    for (const line of titleLines) {
      ctx.fillText(line, 54, cursorY);
      cursorY += 46;
    }

    // Price Highlight Box
    const priceBoxY = Math.max(cursorY + 12, 910);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#FFD200';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(54, priceBoxY, width - 108, 155, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.font = '900 58px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${currency} ${price.toLocaleString('en-PK')}`, 86, priceBoxY + 78);

    if (market > price) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
      const marketText = `${currency} ${market.toLocaleString('en-PK')}`;
      ctx.fillText(marketText, 86, priceBoxY + 126);
      const textWidth = ctx.measureText(marketText).width;
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(84, priceBoxY + 116);
      ctx.lineTo(88 + textWidth, priceBoxY + 116);
      ctx.stroke();

      ctx.fillStyle = '#059669';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        `Instant Savings: ${currency} ${savings.toLocaleString('en-PK')}`,
        420,
        priceBoxY + 126
      );
    }

    // Bottom Greeting Footer
    const footerY = 1105;
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(54, footerY, width - 108, 96, 18);
    ctx.fill();

    ctx.fillStyle = '#FFD200';
    ctx.font = 'bold 25px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      lastName
        ? `Dear ${lastName}, thanks for reaching out! How can I help you?`
        : 'Thank you for reaching out! How can I help you today?',
      84,
      footerY + 42
    );

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `WhatsApp: ${profile.phone || '03125256266'}  ·  ${profile.name}`,
      84,
      footerY + 76
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 0.95)
    );
    if (!blob) return null;

    const safeSlug = (product.sku || product.id || 'product')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .toLowerCase();
    return new File([blob], `${safeSlug}-price-card.png`, { type: 'image/png' });
  } catch {
    return null;
  }
}

export interface ParsedVideoEmbed {
  kind: 'youtube' | 'vimeo' | 'direct' | 'external';
  src: string;
  originalUrl: string;
}

export function parseProductVideoUrl(rawUrl?: string): ParsedVideoEmbed | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    // YouTube watch / shorts / youtu.be / embed
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) {
        return {
          kind: 'youtube',
          src: `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
          originalUrl: normalized,
        };
      }
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname.startsWith('/embed/')) {
        return { kind: 'youtube', src: normalized, originalUrl: normalized };
      }
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.replace('/shorts/', '').split('/')[0];
        if (id) {
          return {
            kind: 'youtube',
            src: `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
            originalUrl: normalized,
          };
        }
      }
      const v = u.searchParams.get('v');
      if (v) {
        return {
          kind: 'youtube',
          src: `https://www.youtube.com/embed/${encodeURIComponent(v)}`,
          originalUrl: normalized,
        };
      }
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) {
        return {
          kind: 'vimeo',
          src: `https://player.vimeo.com/video/${encodeURIComponent(id)}`,
          originalUrl: normalized,
        };
      }
    }

    // Direct HTML5 video file
    if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(u.pathname)) {
      return { kind: 'direct', src: normalized, originalUrl: normalized };
    }

    // TikTok, Instagram, Facebook Reels, Google Drive, etc.
    return { kind: 'external', src: normalized, originalUrl: normalized };
  } catch {
    return null;
  }
}
