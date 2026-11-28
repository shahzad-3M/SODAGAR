export type TransactionType = 'credit' | 'debit'; // credit = You gave (Udhaar / Receivable), debit = You got (Jama / Payment received)

export type PaymentMode = 'cash' | 'easypaisa' | 'jazzcash' | 'sadapay' | 'bank_transfer' | 'cheque' | 'cod' | 'other';

export type CustomerType = 'individual' | 'retail' | 'wholesale' | 'shopkeeper' | 'reseller';

export type GenderType = 'male' | 'female' | 'unspecified';

export type AgeGroupType = '18-25' | '26-35' | '36-50' | '50+';

export interface Customer {
  id: string;
  name: string;
  urduName?: string;
  customerType: CustomerType; // Individual or Retail Store
  phone: string;
  email?: string;
  address?: string;
  city?: string; // City for delivery & segmentation
  area?: string; // Area / Sector within city
  mohalla?: string; // Mohalla / Neighborhood
  landmark?: string; // Nearby Landmark
  gender?: GenderType;
  ageGroup?: AgeGroupType;
  ntnNumber?: string; // National Tax Number in Pakistan
  cnic?: string; // Pakistani Computerized National Identity Card
  creditLimit: number;
  paymentTermsDays: number; // e.g. 7, 14, 21, 30 days
  pin?: string; // 6-digit security PIN (default: last 6 digits of mobile number)
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  balance: number; // positive: customer owes you (receivable); negative: you owe customer
  status: 'active' | 'archived';
  lastReminderSentAt?: string;
  totalPurchases?: number;
  ordersCount?: number;
  lastPurchaseAmount?: number;
  lastPaidAmount?: number; // Total paid amount of last purchase items (used for dynamic 1st prize in lucky draw)
  lastPurchaseDate?: string;
  // Optional CRM 360 & Segmentation Metadata
  whatsapp?: string;
  whatsappSameAsPhone?: boolean;
  customerSource?: CRMSourceChannel | string;
  referralCode?: string;
  referredBy?: string;
  tags?: string[];
  assignedSalespersonId?: string;
  assignedSalespersonName?: string;
  lastActivityAt?: string;
  interestedCategories?: string[];
  paymentPreference?: PaymentMode;
  whatsappOptOut?: boolean;
  whatsappConsent?: boolean;
  birthday?: string;
  isVipManual?: boolean;
}

export type SalePaymentType = 'full' | 'partial' | 'time_credit' | 'cod';

export interface TransactionItem {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  marketPrice?: number;
  amount: number;
  customerSavings?: number;
}

export interface TransactionAuditEntry {
  id: string;
  timestamp: string; // ISO string e.g. 2026-11-11T12:00:00Z
  action: 'created' | 'status_updated' | 'amount_edited' | 'payment_received' | 'correction' | 'cancelled';
  previousStatus?: string;
  newStatus?: string;
  previousAmount?: number;
  newAmount?: number;
  changedBy: string; // User or Staff member responsible
  notes?: string;
}

export interface Transaction {
  id: string;
  customerId: string;
  type: TransactionType;
  amount: number;
  paidAmount?: number;
  dueBalance?: number;
  saleType?: SalePaymentType;
  date: string; // ISO date YYYY-MM-DD
  dueDate?: string; // ISO date YYYY-MM-DD
  paymentTermsDays?: number;
  softReminderDate?: string; // 3 days before dueDate
  maxGraceDate?: string; // 1 week after dueDate
  lastOverdueReminderSent?: string;
  invoiceNumber?: string;
  notes?: string;
  paymentMode?: PaymentMode;
  items?: TransactionItem[];
  totalSavings?: number; // Total amount saved by customer compared to market price
  status?: 'completed' | 'pending' | 'partially_paid' | 'overdue' | 'cancelled';
  responsibleStaff?: string; // User/staff member responsible
  auditTrail?: TransactionAuditEntry[];
  createdAt: string;
}

export interface ProductVariation {
  id: string;
  title?: string; // Display name for variant e.g. "Rose Gold · Standard"
  sku?: string;
  attributes: Record<string, string>; // e.g. { "Size": "Medium", "Color": "Black" }
  size?: string;
  color?: string;
  details?: string; // Separate specifications, weight, or notes for this variant
  image?: string;
  originalPrice?: number;
  salePrice?: number;
  stockQty: number;
}

export type DeliverySpeedCategory = 'express' | 'standard';
export type ProductDeliveryFeeType = 'default' | 'free' | 'custom';

export interface ProductSizeChartRow {
  label: string;
  values: string[];
}

export interface ProductSizeChart {
  columns: string[]; // e.g. ['Small (S)', 'Medium (M)', 'Large (L)', 'XL']
  rows: ProductSizeChartRow[]; // e.g. [{ label: 'Chest', values: ['36 in', '38 in', '40 in', '42 in'] }]
  unit?: string; // e.g. 'in' | 'cm'
  note?: string;
}

export interface ProductItem {
  id: string;
  name: string;
  urduName?: string;
  category: string;
  parentCategoryId?: string;
  subcategoryId?: string;
  childSubcategoryId?: string;
  deliveryType?: DeliverySpeedCategory; // 'express' = Instant delivery available; 'standard' (default) = 3 to 6 working days depending on logistics
  deliveryFeeType?: ProductDeliveryFeeType; // 'default' = city/area delivery fee; 'free' = Rs. 0 free delivery; 'custom' = fixed per-product delivery charge
  customDeliveryCharge?: number; // Applied when deliveryFeeType === 'custom'
  isUpcoming?: boolean; // When true: informational / viral product, purchasing disabled ("Coming Soon" badge)
  upcomingStatus?: 'coming_soon' | 'available';
  expectedArrivalDate?: string;
  activatedAt?: string;
  activatedBy?: string;
  updatedAt?: string;
  sku: string;
  costPrice: number; // For wholesale profit calculation (hidden in customer view)
  marketPrice: number; // Retail market price (strike-through)
  ourPrice: number; // Our selling/wholesale price
  stockQty: number; // Inventory available
  minStockAlert: number; // Low stock threshold
  salesCount: number; // Units sold
  totalRevenue: number;
  totalProfit: number; // (ourPrice - costPrice) * salesCount (hidden in customer view)
  isWinningItem: boolean; // Winning item based on profit & velocity
  badgeText?: string; // e.g. '-50%', 'HOT DEAL', 'TOP SELLER', 'COMING SOON'
  imageUrl?: string;
  pictures?: string[]; // Multiple high-res images / gallery
  sizes?: string[]; // Available sizes or dimensions (e.g. Standard, Small, Medium, Large)
  sizeChart?: ProductSizeChart; // Structured multi-size measurement chart
  selectedSize?: string;
  variations?: ProductVariation[]; // Extracted & editable variations (size, color, SKU, price, stock, image, details)
  shortDescription?: string;
  brand?: string;
  tags?: string[];
  status?: 'draft' | 'published';
  sourceWebsiteName?: string;
  specifications?: Record<string, string>; // Full specs (Material, Power, Voltage, Dimensions, Warranty, Origin)
  details?: string; // Comprehensive description
  features?: string[]; // Bulleted feature highlights
  websiteUrl?: string; // Link to see more details on external/store website
  videoUrl?: string; // Optional pasted video link (YouTube, TikTok, Instagram, Facebook, MP4)
  sourceUrl?: string; // Imported from link
  description?: string;
  rating?: number;
  investorId?: string; // Assigned investor
  investorWhatsApp?: string; // Optional direct WhatsApp number for investor-supplied product
  addMyProductUrl?: string; // Manual editable link for "Add My Product" directing to investor contact/details
  createdAt: string;
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
  unitPrice: number; // ourPrice by default
  marketPrice: number;
  unitSavings: number; // marketPrice - ourPrice
  totalAmount: number;
  totalSavings: number; // unitSavings * quantity
}

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export interface RecurringInvoice {
  id: string;
  customerId: string;
  title: string;
  frequency: RecurringFrequency;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  totalAmount: number;
  startDate: string; // YYYY-MM-DD
  nextBillingDate: string; // YYYY-MM-DD
  lastGeneratedDate?: string;
  status: 'active' | 'paused' | 'completed';
  autoSendWhatsApp: boolean;
  notes?: string;
  createdAt: string;
}

export type NotificationType =
  | 'scheduled_date'
  | 'weekly_due'
  | 'monthly_auto'
  | 'pre_due_soft' // Soft reminder 3 days before terms day
  | 'due_date' // Payment due today
  | 'overdue_3days' // Overdue reminder every 3 days until settled
  | 'payment_reminder'
  | 'product_broadcast'
  | 'recurring_invoice'
  | 'payment_receipt'
  | 'lucky_draw_winner';

export type NotificationStatus = 'pending' | 'sent' | 'cancelled';

export interface WhatsAppNotification {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  amount: number;
  dueDate?: string;
  scheduledFor: string; // YYYY-MM-DD
  type: NotificationType;
  status: NotificationStatus;
  messageText: string;
  sentAt?: string;
  notes?: string;
  createdAt: string;
  productLink?: string;
  voucherCode?: string;
  daysOverdue?: number;
}

export interface PakistaniPaymentChannels {
  easyPaisa: {
    enabled: boolean;
    accountTitle: string;
    accountNumber: string;
  };
  jazzCash: {
    enabled: boolean;
    accountTitle: string;
    accountNumber: string;
  };
  sadaPay: {
    enabled: boolean;
    accountTitle: string;
    sadaTag: string;
    accountNumber: string;
    iban?: string;
  };
  bankDetails: {
    enabled: boolean;
    bankName: string;
    accountTitle: string;
    accountNumber: string;
    iban: string;
    branchName?: string;
  };
}

export interface ShippingPartnerSettings {
  name: string; // Default: 'WASAL delivery'
  apiKey: string; // Shipday API Key
  shipperPhone: string; // '0312 5256 266'
  helpline: string; // '0312 5256 266'
  originAddress: string;
  enabled: boolean;
  autoSync: boolean;
}

export interface LoginFormConfig {
  title: string;
  description: string;
  allowMobileLogin: boolean;
  allowUsernameLogin: boolean;
  allowEmailLogin: boolean;
  showPasswordVisibilityToggle: boolean;
  showRememberMe: boolean;
  showForgotPasswordLink: boolean;
  allowSelfRegistration: boolean;
  supportContactNumber: string;
  loginInstructions: string;
}

export interface DeliveryAreaConfig {
  id: string;
  name: string;
  allowed: boolean;
  deliveryCharge?: number;
  areaType?: 'sub_city' | 'tehsil' | 'town' | 'village' | 'sector';
}

export interface DeliveryCityConfig {
  id?: string;
  name: string;
  province?: string;
  allowed: boolean;
  deliveryCharge?: number;
  areas?: DeliveryAreaConfig[];
}

export interface BusinessProfile {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  website?: string;
  address: string;
  ntnNumber: string;
  paymentChannels: PakistaniPaymentChannels;
  shippingPartner: ShippingPartnerSettings;
  deliveryCities?: DeliveryCityConfig[];
  defaultCityCenterDeliveryCharge?: number;
  currencySymbol: string; // 'Rs.'
  weeklyReminderDay: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  monthlyReminderDay: number; // e.g. 1st, 5th
  autoSendEnabled: boolean;
  defaultPaymentTermsDays: number;
  adminPin?: string; // Server-side Owner Master PIN override (never hardcoded in client)
  loginFormConfig?: LoginFormConfig;
}

export interface ReminderTemplate {
  id: string;
  title: string;
  titleUrdu?: string;
  type:
    | 'weekly_due'
    | 'pre_due_soft'
    | 'due_today'
    | 'overdue'
    | 'overdue_3days'
    | 'monthly_statement'
    | 'invoice_new'
    | 'receipt_thanks'
    | 'product_broadcast'
    | 'lucky_draw_winner';
  content: string; // English + Urdu bilingual
}

export interface ProductBroadcast {
  id: string;
  productName: string;
  urduProductName?: string;
  urduName?: string;
  title?: string;
  description: string;
  price?: number;
  productLink: string;
  imageUrl?: string;
  targetArea?: string;
  targetAgeGroup?: string;
  targetGender?: string;
  createdAt: string;
}

export interface BroadcastContact {
  id: string;
  name: string;
  phone: string;
  city: string; // e.g. Lahore, Karachi, Rawalpindi
  area?: string; // e.g. Shah Alam, DHA, Saddar
  gender: GenderType;
  ageGroup: AgeGroupType;
  type: 'retail' | 'individual' | 'lead';
  notes?: string;
  createdAt: string;
}

export interface SavedBroadcastCampaign {
  id: string;
  title: string;
  productName: string;
  productLink?: string;
  messageText: string;
  filters: {
    area?: string;
    ageGroup?: string;
    gender?: string;
    customerGroup?: string;
  };
  recipientsCount: number;
  sentCount?: number;
  sentAt: string;
  createdAt: string;
}

export interface TopBuyer {
  customer: Customer;
  rank: number;
  totalPurchases: number;
  totalOrders: number;
  lastPurchaseAmount: number;
  lastPaidAmount: number; // Total paid amount of last purchase items (used for 1st prize)
  luckyDrawTokens: number;
  isRetail: boolean;
}

export interface LuckyDrawWinner {
  rank: 1 | 2 | 3;
  customerId: string;
  customerName: string;
  phone: string;
  prizeTitle: string;
  voucherCode: string;
  discountValue: string;
  customerType: CustomerType;
  lastPurchaseAmount?: number;
  lastPaidAmount?: number; // Total paid amount of last purchase items
  categoryRule: string; // 1st: 100% of last purchase among top 10 buyers; 2nd: 50% among all monthly buyers; 3rd: Rs. 500 social review
  reviewPlatform?: string;
  isUpcomingGift?: boolean;
}

export interface LuckyDrawEvent {
  id: string;
  title: string;
  date: string;
  totalParticipants: number;
  winners: LuckyDrawWinner[];
  upcomingItemGift?: string;
  status: 'conducted' | 'notified';
  notes?: string;
  createdAt: string;
}

export interface MonthlyCustomerStatement {
  customer: Customer;
  month: number; // 1-12
  year: number; // e.g. 2026
  monthName: string; // e.g. 'March 2026'
  totalPurchases: number;
  totalPaid: number;
  closingBalance: number;
  totalSavings: number;
  transactions: Transaction[];
  invoicesCount: number;
  luckyDrawWinnings?: {
    hasWon: boolean;
    rank?: 1 | 2 | 3;
    prizeTitle?: string;
    voucherCode?: string;
    discountValue?: string;
    winningAmount?: number;
  };
}

// USER ROLES & PERMISSIONS
export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'staff'
  | 'customer'
  | 'investor'
  | 'reseller';

export interface ManagerAuthorities {
  canRegisterWalkIn: boolean;
  canEnterSales: boolean;
  canViewStock: boolean;
  canManageStock: boolean;
  canRecordPayment: boolean;
  canRecordCash: boolean;
  canManageOrders: boolean;
  canManageCustomers: boolean;
  canAssignReferral: boolean;
  canTrackReferrals: boolean;
  canViewReports: boolean;
  canViewHistory: boolean;
  canAuthorizeDiscount: boolean;
  canAuthorizeCreditSale?: boolean;
  maxDiscountPercent?: number;
  crmRole?: CRMRoleSpecialization;
  crmPermissions?: CRMPermissions;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  contactNumber: string;
  assignedManagerId?: string;
  assignedManagerName?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  specialAuthorities?: ManagerAuthorities;
  remarks?: string;
}

export interface AppUser {
  id: string;
  username?: string;
  name: string;
  urduName?: string;
  role: UserRole;
  phone: string;
  whatsapp?: string;
  whatsappSameAsPhone?: boolean;
  email?: string;
  resellerCode?: string;
  customerId?: string;
  investorId?: string;
  branchId?: string;
  branchName?: string;
  managerAuthorities?: ManagerAuthorities;
  crmRole?: CRMRoleSpecialization;
  crmPermissions?: CRMPermissions;
  canAuthorizeCreditSale?: boolean;
  isAuthenticated?: boolean;
  mustChangePassword?: boolean;
  hasDefaultPin?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  fullName: string;
  urduName?: string;
  phone: string;
  whatsapp?: string;
  whatsappSameAsPhone?: boolean;
  email?: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'inactive';
  passwordHash?: string;
  passwordSalt?: string;
  mustChangePassword?: boolean;
  isTemporaryPassword?: boolean;
  temporaryPasswordExpiresAt?: string;
  suggestedDefaultPin?: string; // deprecated legacy field; random 30-min temp passwords are used instead
  linkedCustomerId?: string;
  linkedInvestorId?: string;
  linkedResellerCode?: string;
  linkedBranchId?: string;
  linkedBranchName?: string;
  managerAuthorities?: ManagerAuthorities;
  crmRole?: CRMRoleSpecialization;
  crmPermissions?: CRMPermissions;
  canAuthorizeCreditSale?: boolean;
  resetToken?: string;
  resetTokenExpiresAt?: string;
  lastLoginAt?: string;
  loginCount?: number;
  createdAt: string;
  createdBy?: string;
}

// INVESTOR MANAGEMENT MODEL
export interface InvestorProductAllocation {
  productId: string;
  unitsOwned: number;
  investedAmount?: number;
  notes?: string;
}

export interface Investor {
  id: string;
  name: string;
  urduName?: string;
  phone: string;
  whatsapp: string;
  email?: string;
  address?: string;
  investorType?: 'silent' | 'product'; // 'silent': Min Rs. 100K capital @ editable monthly %; 'product': Product equity & qty
  monthlyProfitPercent?: number; // Default 3.5% per month for silent investors (editable)
  totalInvestment: number; // Capital invested in PKR
  profitShareType: 'percentage' | 'fixed_per_unit' | 'fixed_per_order';
  profitShareValue: number; // e.g. 20% per product or Rs. 150 fixed per order/unit
  assignedProductIds: string[]; // List of product IDs funded by this investor
  productAllocations?: InvestorProductAllocation[]; // Multi-investor co-ownership with manual unit entry
  isReseller?: boolean; // Can also operate as a Reseller partner
  linkedResellerCode?: string;
  resellerId?: string;
  resellerPaymentChannel?: 'easypaisa' | 'jazzcash' | 'sadapay' | 'bank' | 'cash';
  resellerAccountTitle?: string;
  resellerAccountNumber?: string;
  status: 'active' | 'inactive';
  settledProfit: number; // Total profit paid out
  notes?: string;
  createdAt: string;
}

export interface InvestorTransaction {
  id: string;
  investorId: string;
  date: string; // YYYY-MM-DD
  type: 'investment_deposit' | 'profit_payout' | 'capital_withdrawal' | 'sale_share';
  amount: number;
  productId?: string;
  productName?: string;
  orderNumber?: string;
  paymentMode?: PaymentMode;
  notes?: string;
  reference?: string;
  createdAt: string;
}

// HIERARCHICAL & CLEAN CATEGORY MANAGEMENT
export interface CategoryRecord {
  id: string;
  name: string;
  urduName?: string;
  parentCategoryId?: string; // If set, this is a Level 2 subcategory or Level 3 child subcategory
  level?: 1 | 2 | 3;
  isUpcoming?: boolean; // When true: informational / viral category
  isActive?: boolean;
  description?: string;
  displayOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  details?: Record<string, any>;
  createdAt: string;
}

// CASH ON DELIVERY (COD) ORDERS MANAGEMENT
export type CODOrderStatus = 'pending' | 'dispatched' | 'delivered' | 'returned';

export interface CODOrder {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  phone: string;
  city: string;
  area?: string;
  mohalla?: string;
  landmark?: string;
  address: string;
  items: TransactionItem[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  courierPartner: 'WASAL delivery' | 'TCS' | 'Leopards' | 'Trax' | 'PostEx' | 'Rider' | 'Self';
  trackingNumber?: string;
  status: CODOrderStatus;
  resellerCode?: string;
  commissionAmount?: number;
  notes?: string;
  createdAt: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  returnedAt?: string;
}

export interface WasalSettlement {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  paymentMode: PaymentMode;
  reference?: string;
  notes?: string;
  recordedBy?: string;
  createdAt: string;
}

// HR HIRING, ALLOWANCES & ATTENDANCE
export type EmployeeRole = 'manager' | 'cashier' | 'dispatcher' | 'rider' | 'warehouse_staff';

export interface EmployeeAllowances {
  medical: number;
  fuel: number;
  food: number;
  bonus: number;
}

export interface Employee {
  id: string;
  name: string;
  urduName?: string;
  phone: string;
  cnic: string;
  role: EmployeeRole;
  baseSalary: number;
  allowances: EmployeeAllowances;
  joiningDate: string;
  status: 'active' | 'on_leave' | 'resigned';
  notes?: string;
}

export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'absent';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  checkInTime?: string;
  notes?: string;
}

// RESELLER ACCOUNTS (Rs. 30 per Rs. 1000 Paid)
export interface Reseller {
  id: string;
  name: string;
  urduName?: string;
  phone: string;
  city: string;
  referralCode: string; // e.g. RES-100D-01
  paymentChannel: 'easypaisa' | 'jazzcash' | 'sadapay' | 'bank' | 'cash';
  accountTitle: string;
  accountNumber: string;
  creditLimit: number; // Rs. 25,000 default credit limit
  currentCreditUsed?: number;
  totalReferredOrders: number;
  totalSales: number;
  totalPaidSales: number;
  earnedCommission: number; // Rs. 30 per 1000 on paid amount
  paidCommission: number;
  pin?: string; // 6-digit PIN (default: last 6 digits of phone)
  status: 'active' | 'inactive';
  createdAt: string;
}

// SOCIAL MEDIA REVIEW FOR RS. 500 COUPON
export interface ReviewRewardSubmission {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  productName: string;
  platform: 'whatsapp' | 'facebook' | 'tiktok' | 'instagram';
  reviewText: string;
  postLink?: string;
  status: 'pending' | 'approved' | 'rejected';
  voucherCode?: string;
  discountAmount: number; // 500
  createdAt: string;
  approvedAt?: string;
}

// LOGIN SECURITY & AUDIT RECORD
export interface LoginAuditRecord {
  id: string;
  userId?: string;
  userName: string;
  phone: string;
  role: UserRole;
  timestamp: string; // ISO string
  status: 'success' | 'failed';
  ipOrDevice?: string;
  notes?: string;
  usedPin?: string;
}

// WALK-IN CUSTOMER RECORD
export interface WalkInCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  branchId: string;
  branchName: string;
  registrationDate: string;
  salespersonCode?: string;
  status: 'active' | 'inactive';
  notes?: string;
}

// WALK-IN SALE ITEM
export interface WalkInSaleItem {
  productId: string;
  productName: string;
  variationId?: string;
  variationDetails?: string; // e.g. "Size: Standard 5-Head, Color: White"
  quantity: number;
  unitPrice: number;
  marketPrice: number;
  totalAmount: number;
}

// WALK-IN SALE TRANSACTION
export interface WalkInSale {
  id: string;
  receiptNumber: string; // e.g. "POS-BR01-100D-5821"
  branchId: string;
  branchName: string;
  managerId: string;
  managerName: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  salespersonCode?: string;
  items: WalkInSaleItem[];
  subtotal: number;
  discountAmount: number;
  discountReason?: string;
  taxAmount?: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: PaymentMode | 'cash' | 'split';
  paymentStatus: 'completed' | 'partial' | 'pending';
  saleDate: string;
  timestamp: string;
  notes?: string;
}

// SALESPERSON REFERRAL CODE
export interface SalespersonReferral {
  id: string;
  code: string; // e.g. "SP-SHAHALAM-01"
  salespersonName: string;
  phone: string;
  branchId: string;
  branchName: string;
  status: 'active' | 'inactive';
  totalSales: number;
  paidSales: number;
  earnedCommission: number; // PKR 30 per PKR 1,000 qualifying sales
  paidCommission: number;
  createdAt: string;
}

// COMMISSION RECORD LEDGER
export interface CommissionRecord {
  id: string;
  referralCode: string;
  salespersonId: string;
  salespersonName: string;
  branchId: string;
  branchName: string;
  transactionId: string;
  receiptNumber?: string;
  saleType: 'walk_in' | 'online_reseller' | 'cod';
  eligibleSalesAmount: number;
  commissionRate: number; // PKR 30 per PKR 1,000
  calculatedCommission: number;
  status: 'pending' | 'paid' | 'cancelled';
  createdAt: string;
  paidAt?: string;
  settlementReference?: string;
}

// PRODUCT IMPORT LOG
export interface ProductImportLog {
  id: string;
  sourceUrl: string;
  productTitle: string;
  status: 'success' | 'failed' | 'partial';
  variationsCount: number;
  imagesCount: number;
  timestamp: string;
  notes?: string;
}

// MONTHLY OVERHEAD & MANUAL EXPENSES
export type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'salaries'
  | 'marketing'
  | 'packaging'
  | 'courier'
  | 'maintenance'
  | 'software'
  | 'tax_fees'
  | 'other';

export interface MonthlyExpense {
  id: string;
  title: string;
  urduTitle?: string;
  category: ExpenseCategory;
  amount: number;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  paymentStatus: 'paid' | 'pending';
  paymentMode: PaymentMode;
  isRecurringMonthly?: boolean;
  notes?: string;
  recordedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

// ==========================================
// INTEGRATED CRM & RETENTION SYSTEM TYPES
// ==========================================

export type CRMSourceChannel =
  | 'WhatsApp'
  | 'Website'
  | 'Facebook'
  | 'Instagram'
  | 'Walk-in'
  | 'Phone'
  | 'Referral'
  | 'Reseller Network';

export type CRMRoleSpecialization =
  | 'administrator'
  | 'store_manager'
  | 'salesperson'
  | 'customer_support'
  | 'marketing'
  | 'accountant';

export interface CRMPermissions {
  canViewCrmDashboard?: boolean;
  canViewCustomer360?: boolean;
  canEditCustomers?: boolean;
  canManageSegments?: boolean;
  canManageFollowUps?: boolean;
  canManageLeads?: boolean;
  canSendWhatsAppCrm?: boolean;
  canManageCampaigns?: boolean;
  canApproveBulkMessages?: boolean;
  canManageLoyalty?: boolean;
  canManageTickets?: boolean;
  canManageAutomation?: boolean;
  canExportReports?: boolean;
  canViewFinancialBalances?: boolean;
}

export type CRMAutoSegmentName =
  | 'New Customer'
  | 'First Order'
  | 'Repeat Customer'
  | 'Regular Customer'
  | 'VIP Customer'
  | 'Wholesale Customer'
  | 'Reseller'
  | 'High Value'
  | 'Inactive 30 Days'
  | 'Inactive 60 Days'
  | 'Inactive 90 Days'
  | 'Lost Customer'
  | 'COD Risk'
  | 'Outstanding Payment'
  | 'Garments Customer'
  | 'Cosmetics Customer'
  | 'Kitchen Products Customer';

export interface CRMCustomSegmentRule {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  criteria: {
    minTotalSpend?: number;
    maxTotalSpend?: number;
    minOrders?: number;
    maxOrders?: number;
    minDaysSinceLastOrder?: number;
    maxDaysSinceLastOrder?: number;
    categoryKeyword?: string;
    city?: string;
    referralSource?: string;
    hasOutstandingBalance?: boolean;
    customerType?: CustomerType;
  };
  createdAt: string;
  updatedAt?: string;
}

export type CRMFollowUpTaskType =
  | 'Call'
  | 'WhatsApp'
  | 'Visit'
  | 'Payment Collection'
  | 'Order Check'
  | 'Complaint Follow-Up'
  | 'Lead Follow-Up'
  | 'call'
  | 'whatsapp'
  | 'visit'
  | 'payment_collection'
  | 'order_check'
  | 'complaint_follow_up'
  | 'lead_follow_up';

export type CRMFollowUpPriority = 'Low' | 'Medium' | 'High' | 'Urgent' | 'low' | 'medium' | 'high' | 'urgent';
export type CRMFollowUpStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';

export interface CRMFollowUpTask {
  id: string;
  title: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  leadId?: string;
  taskType: CRMFollowUpTaskType;
  followUpDate: string; // YYYY-MM-DD
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  priority: CRMFollowUpPriority;
  notes?: string;
  status: CRMFollowUpStatus;
  outcome?: string;
  nextFollowUpDate?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export type CRMLeadStage = 'New' | 'Contacted' | 'Interested' | 'Follow-up' | 'Converted' | 'Lost';

export interface CRMLead {
  id: string;
  leadName: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  source: CRMSourceChannel;
  interestedProductId?: string;
  interestedProductName?: string;
  interestedCategory?: string;
  estimatedValue: number;
  assignedSalespersonId?: string;
  assignedSalespersonName?: string;
  notes?: string;
  followUpDate?: string;
  stage: CRMLeadStage;
  convertedCustomerId?: string;
  convertedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export type CRMWhatsAppTemplateType =
  | 'welcome'
  | 'order_confirmation'
  | 'delivery_confirmation'
  | 'feedback_request'
  | 'product_recommendation'
  | 'new_arrivals'
  | 'discount_offer'
  | 'payment_reminder'
  | 'abandoned_cart'
  | 'repeat_purchase_reminder'
  | 'inactive_recovery'
  | 'vip_offer'
  | 'referral_invitation';

export interface CRMCampaign {
  id: string;
  name: string;
  description?: string;
  channel?: 'whatsapp_click_to_chat' | 'broadcast_queue' | 'referral_push';
  campaignMode?: 'segment' | 'manual_bundle';
  bundleTitle?: string;
  bundleProductIds?: string[];
  bundleOfferPrice?: number;
  mediaImageUrl?: string;
  mediaVideoUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  targetRecipientIds?: string[];
  status: 'Draft' | 'Approved' | 'Launched' | 'Completed' | 'Paused' | 'draft' | 'approved' | 'active' | 'completed' | 'paused';
  segmentName?: string;
  targetCity?: string;
  cityFilter?: string;
  categoryFilter?: string;
  minSpendFilter?: number;
  minOrdersFilter?: number;
  templateType: CRMWhatsAppTemplateType;
  messageBody: string;
  couponCode?: string;
  discountPercent?: number;
  discountFlat?: number;
  adminApproved?: boolean;
  approvedBy?: string;
  adminApprovedBy?: string;
  adminApprovedAt?: string;
  recipientsCount: number;
  sentCount: number;
  conversionsCount: number;
  revenueGenerated: number;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export type CRMLoyaltyTier = 'Bronze' | 'Silver' | 'Gold' | 'VIP Platinum';

export interface CRMLoyaltyAccount {
  customerId: string;
  pointsBalance: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  tier: CRMLoyaltyTier;
  updatedAt: string;
}

export interface CRMLoyaltyLedgerEntry {
  id: string;
  customerId: string;
  type: 'earned' | 'redeemed' | 'bonus' | 'expired' | 'adjusted';
  points: number;
  orderNumber?: string;
  couponCode?: string;
  notes?: string;
  createdAt: string;
}

export interface CRMLoyaltyCoupon {
  id: string;
  code: string;
  title?: string;
  rewardType?: 'purchase' | 'birthday' | 'repeat' | 'review' | 'vip' | 'campaign';
  reason?: string;
  discountType: 'fixed' | 'percent' | 'percentage';
  discountValue: number;
  minOrderAmount?: number;
  customerId?: string;
  usageLimit?: number;
  usedCount?: number;
  expiresAt?: string;
  redeemedAt?: string;
  status: 'active' | 'redeemed' | 'used' | 'expired' | 'disabled';
  createdAt: string;
}

export interface CRMLoyaltyConfig {
  pointsPerThousandPkr: number;
  pkrPerPoint: number;
  silverThresholdPoints: number;
  goldThresholdPoints: number;
  vipThresholdPoints: number;
  vipDiscountPercent: number;
  goldDiscountPercent: number;
  silverDiscountPercent: number;
  birthdayCouponAmount: number;
  reviewCouponAmount: number;
  repeatOrderCouponAmount: number;
  couponValidityDays: number;
}

export type CRMTicketCategory =
  | 'Damaged product'
  | 'Wrong item'
  | 'Late delivery'
  | 'Payment issue'
  | 'Refund request'
  | 'Product quality'
  | 'Courier issue'
  | 'Staff complaint'
  | 'General inquiry'
  | 'Product Inquiry';

export type CRMTicketStatus = 'Open' | 'Investigating' | 'Resolved' | 'Closed' | 'Escalated';
export type CRMTicketPriority = 'Low' | 'Medium' | 'High' | 'Urgent' | 'low' | 'medium' | 'high' | 'critical';

export interface CRMSupportTicket {
  id: string;
  ticketNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  orderId?: string;
  orderNumber?: string;
  category: CRMTicketCategory;
  subject: string;
  description?: string;
  priority: CRMTicketPriority;
  status: CRMTicketStatus;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  slaHours?: number;
  dueAt: string;
  resolutionNotes?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export type CRMAutomationTriggerType =
  | 'after_first_order'
  | 'after_delivery'
  | 'review_request_after_delivery'
  | 'no_order_30_days'
  | 'no_order_60_days'
  | 'no_order_90_days'
  | 'payment_due_soon'
  | 'payment_overdue'
  | 'abandoned_cart'
  | 'vip_threshold_reached'
  | 'frequent_cod_returns'
  | 'birthday_or_anniversary'
  | 'back_in_stock_for_interested';

export interface CRMAutomationRule {
  id: string;
  triggerType: CRMAutomationTriggerType;
  name: string;
  description: string;
  enabled: boolean;
  isBulkAction: boolean;
  requiresAdminApproval: boolean;
  templateType: CRMWhatsAppTemplateType;
  actionMode: 'create_task' | 'queue_whatsapp' | 'both';
  delayDays?: number;
  thresholdValue?: number;
  lastRunAt?: string;
  totalTriggeredCount: number;
}

export interface CRMAutomationLog {
  id: string;
  ruleId: string;
  ruleName?: string;
  triggerType: CRMAutomationTriggerType;
  customerId: string;
  customerName: string;
  idempotencyKey: string;
  actionTaken?: string;
  actionSummary?: string;
  createdTaskId?: string;
  status: 'executed' | 'queued' | 'task_created' | 'skipped_opt_out' | 'skipped_approval' | 'dry_run';
  details?: string;
  createdAt: string;
}

export type CRMActivityEventType =
  | 'product_view'
  | 'product_inquiry'
  | 'cart_add'
  | 'cart_abandon'
  | 'order_placed'
  | 'order_delivered'
  | 'order_returned'
  | 'note_added'
  | 'call_logged'
  | 'whatsapp_opened'
  | 'ticket_opened'
  | 'loyalty_earned'
  | 'lead_converted';

export interface CRMActivityEvent {
  id: string;
  customerId?: string;
  customerName?: string;
  phone?: string;
  eventType: CRMActivityEventType;
  productId?: string;
  productName?: string;
  category?: string;
  orderNumber?: string;
  amount?: number;
  notes?: string;
  actorName?: string;
  createdAt: string;
}

export interface CRMDashboardKPIs {
  totalCustomers: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  activeCustomers: number;
  repeatCustomers: number;
  vipCustomers: number;
  inactiveCustomers: number;
  lostCustomers: number;
  totalCustomerRevenue: number;
  averageOrderValue: number;
  customerLifetimeValue: number;
  repeatPurchaseRate: number;
  retentionRate: number;
  totalLeads: number;
  convertedLeads: number;
  leadConversionRate: number;
  todaysFollowUps: number;
  overdueFollowUps: number;
  outstandingBalances: number;
  openTickets: number;
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

export interface Customer360Profile {
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

export interface CRMProductIntelligence {
  mostViewedProducts: Array<{ productId: string; name: string; views: number; orders: number; stockQty: number }>;
  inquiredNotOrdered: Array<{ productId: string; name: string; inquiries: number; orders: number }>;
  cartAbandonedProducts: Array<{ productId: string; name: string; cartAdds: number; orders: number }>;
  bestRepeatProducts: Array<{ productId: string; name: string; repeatBuyers: number; totalUnits: number }>;
  highestComplaintProducts: Array<{ productId?: string; name: string; ticketsCount: number; returnedOrders: number }>;
  categoryRepeatSummary: Array<{ category: string; uniqueBuyers: number; repeatBuyers: number; repeatRatePercent: number }>;
  frequentlyBoughtTogether: Array<{ productA: string; productB: string; coOccurrences: number }>;
  priceSensitivity: { fullPriceOrders: number; discountedSavingsOrders: number; averageDiscountPercent: number };
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

export interface InvestorProductOffering {
  id: string;
  productId?: string;
  title: string;
  urduTitle?: string;
  category: string;
  imageUrl?: string;
  description?: string;
  unitPrice: number;
  minInvestQty: number;
  maxAvailableQty: number;
  reservedQty: number;
  otherExpenses: number;
  otherExpensesNote?: string;
  expectedProfitSharePercent?: number;
  estimatedMonthlyReturnText?: string;
  status: 'active' | 'funded' | 'closed';
  createdById?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InvestorProductRequest {
  id: string;
  offeringId: string;
  offeringTitle: string;
  productId?: string;
  investorId?: string;
  userId?: string;
  investorName: string;
  investorPhone: string;
  requestedQty: number;
  unitPrice: number;
  subtotalAmount: number;
  otherExpensesShare: number;
  totalInvestment: number;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export type CRMSignalGroupKey =
  | 'recent_buyers'
  | 'cold_customers'
  | 'repeat_buyers'
  | 'regular_customers'
  | 'vip_customers'
  | 'category_affinity'
  | 'payment_due';

export type CRMSignalActionType =
  | 'Offer'
  | 'Reminder'
  | 'Win-Back'
  | 'Payment Reminder'
  | 'New Arrival';

export interface CRMBuyerSignal {
  customerId: string;
  customerName: string;
  phone: string;
  city?: string;
  groupKey: CRMSignalGroupKey;
  groupLabel: string;
  actionType: CRMSignalActionType;
  templateType: CRMWhatsAppTemplateType;
  recommendedProductId?: string;
  recommendedProductName: string;
  recommendedProductPrice?: number;
  preferredCategory?: string;
  daysSinceLastOrder?: number;
  totalOrders: number;
  totalSpend: number;
  outstandingBalance: number;
  reason: string;
  priorityScore: number;
}

export interface CRMGroupSignalSummary {
  id: string;
  groupKey: CRMSignalGroupKey;
  groupLabel: string;
  categoryName?: string;
  actionType: CRMSignalActionType;
  templateType: CRMWhatsAppTemplateType;
  recommendedProductId?: string;
  recommendedProductName: string;
  recommendedProductPrice?: number;
  buyerCount: number;
  buyers: CRMBuyerSignal[];
  reason: string;
}


