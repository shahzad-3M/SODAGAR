import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  Receipt,
  Wallet,
  Scale,
  Plus,
  Copy,
  CheckCircle2,
  Clock,
  Trash2,
  Pencil,
  Download,
  Printer,
  Search,
  CreditCard,
  Users,
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  X,
  Save,
  Layers,
} from 'lucide-react';
import {
  AppUser,
  AttendanceRecord,
  BusinessProfile,
  CODOrder,
  Customer,
  Employee,
  ExpenseCategory,
  Investor,
  MonthlyExpense,
  PaymentMode,
  ProductItem,
  Reseller,
  Transaction,
} from '../types/index.ts';
import {
  getCommissionRecords,
  getWalkInSales,
  getWasalSettlements,
} from '../utils/storage.ts';
import {
  ConfirmDialogModal,
  ConfirmDialogState,
  ToastBanner,
  ToastMessage,
} from './AppDialogs.tsx';

interface FinancialMasterViewProps {
  transactions: Transaction[];
  customers: Customer[];
  products: ProductItem[];
  codOrders: CODOrder[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  resellers: Reseller[];
  investors: Investor[];
  profile: BusinessProfile;
  monthlyExpenses: MonthlyExpense[];
  onSaveExpense: (expense: MonthlyExpense) => void;
  onDeleteExpense: (expenseId: string) => void;
  onCloneRecurringExpenses: (fromMonth: string, toMonth: string) => number;
  currentUser?: AppUser;
  onNavigateTab: (tab: string) => void;
}

const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string; urdu: string }> = [
  { value: 'rent', label: 'Shop / Warehouse Rent', urdu: 'کرایہ دکان و گودام' },
  { value: 'utilities', label: 'Electricity, Gas & Internet', urdu: 'بجلی، گیس و انٹرنیٹ' },
  { value: 'salaries', label: 'Staff Salaries / Wages', urdu: 'تنخواہیں و مزدوری' },
  { value: 'marketing', label: 'Marketing & Ads (FB/TikTok)', urdu: 'مارکیٹنگ و اشتہارات' },
  { value: 'packaging', label: 'Packaging & Flyers', urdu: 'پیکنگ میٹریل' },
  { value: 'courier', label: 'Courier & Transport Charges', urdu: 'کوریئر و ٹرانسپورٹ' },
  { value: 'maintenance', label: 'Maintenance & Repairs', urdu: 'مرمت و دیکھ بھال' },
  { value: 'software', label: 'Software, Hosting & Tools', urdu: 'سافٹ ویئر و ٹولز' },
  { value: 'tax_fees', label: 'Taxes, Bank & Gateway Fees', urdu: 'ٹیکس و بینک چارجز' },
  { value: 'other', label: 'Other Miscellaneous Overhead', urdu: 'متفرق اخراجات' },
];

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash Counter',
  easypaisa: 'EasyPaisa',
  jazzcash: 'JazzCash',
  sadapay: 'SadaPay',
  bank_transfer: 'Bank IBAN',
  cheque: 'Cheque',
  cod: 'COD Cash',
  other: 'Other',
};

interface MasterLedgerRow {
  id: string;
  date: string;
  reference: string;
  category: 'sale' | 'payment_received' | 'pending_due' | 'expense';
  partyOrTitle: string;
  channel: string;
  status: string;
  grossAmount: number;
  receivedAmount: number;
  pendingAmount: number;
  expenseAmount: number;
  estimatedProfitImpact: number;
  notes?: string;
}

export const FinancialMasterView: React.FC<FinancialMasterViewProps> = ({
  transactions,
  customers,
  products,
  codOrders,
  employees,
  attendance,
  resellers,
  investors,
  profile,
  monthlyExpenses,
  onSaveExpense,
  onDeleteExpense,
  onCloneRecurringExpenses,
  currentUser,
  onNavigateTab,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthDefault = todayStr.slice(0, 7);

  const [periodMode, setPeriodMode] = useState<'monthly' | 'all'>('monthly');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthDefault);
  const [includeAutoHrPayroll, setIncludeAutoHrPayroll] = useState<boolean>(true);
  const [includeResellerCommissions, setIncludeResellerCommissions] = useState<boolean>(true);

  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'sale' | 'payment_received' | 'pending_due' | 'expense'>('all');
  const [ledgerSearch, setLedgerSearch] = useState('');

  // Expense Form Modal / Inline Drawer
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<MonthlyExpense | null>(null);
  const [expTitle, setExpTitle] = useState('');
  const [expUrduTitle, setExpUrduTitle] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('rent');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(todayStr);
  const [expStatus, setExpStatus] = useState<'paid' | 'pending'>('paid');
  const [expMode, setExpMode] = useState<PaymentMode>('cash');
  const [expRecurring, setExpRecurring] = useState<boolean>(true);
  const [expNotes, setExpNotes] = useState('');

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const pushToast = (text: string, type: ToastMessage['type'] = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const cs = profile.currencySymbol || 'Rs.';

  const walkInSales = useMemo(() => getWalkInSales(), [transactions, codOrders, monthlyExpenses]);
  const wasalSettlements = useMemo(() => getWasalSettlements(), [codOrders, transactions, monthlyExpenses]);
  const commissionRecords = useMemo(() => getCommissionRecords(), [resellers, walkInSales, codOrders]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductItem>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const matchesPeriod = (dateStr?: string): boolean => {
    if (periodMode === 'all') return true;
    if (!dateStr) return false;
    return dateStr.startsWith(selectedMonth);
  };

  // Compute non-overlapping comprehensive financial totals
  const metrics = useMemo(() => {
    // 1. Direct Store & Credit Sales (excluding COD transactions which are tracked via codOrders)
    const directCreditTxs = transactions.filter(
      (t) =>
        t.type === 'credit' &&
        t.saleType !== 'cod' &&
        t.status !== 'cancelled' &&
        matchesPeriod(t.date)
    );

    const directSettlementDebits = transactions.filter(
      (t) =>
        t.type === 'debit' &&
        !t.id.startsWith('tx_cod_deliv_') &&
        t.status !== 'cancelled' &&
        matchesPeriod(t.date)
    );

    let directSalesTotal = 0;
    let directUpfrontPaid = 0;
    let directPeriodPending = 0;
    let directCogs = 0;

    directCreditTxs.forEach((tx) => {
      directSalesTotal += tx.amount || 0;
      const auditRecoveredSum = (tx.auditTrail || [])
        .filter((a) => a.action === 'payment_received')
        .reduce((acc, a) => {
          if (typeof a.previousAmount === 'number' && typeof a.newAmount === 'number') {
            return acc + Math.max(0, a.previousAmount - a.newAmount);
          }
          return acc;
        }, 0);

      if (tx.saleType === 'full') {
        directUpfrontPaid += tx.amount || 0;
      } else {
        const totalPaidOnTx = tx.paidAmount || 0;
        const initialUpfront = Math.max(0, totalPaidOnTx - auditRecoveredSum);
        directUpfrontPaid += initialUpfront;
        const remaining =
          tx.dueBalance !== undefined
            ? Math.max(0, tx.dueBalance)
            : Math.max(0, (tx.amount || 0) - totalPaidOnTx);
        directPeriodPending += remaining;
      }

      if (tx.items && tx.items.length > 0) {
        tx.items.forEach((it) => {
          const cost = it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0;
          directCogs += cost * (it.quantity || 0);
        });
      }
    });

    const directDebitsReceived = directSettlementDebits.reduce((s, t) => s + (t.amount || 0), 0);
    const directReceivedTotal = directUpfrontPaid + directDebitsReceived;
    const customerKhataTotalPositive = customers
      .filter((c) => (c.balance || 0) > 0)
      .reduce((s, c) => s + (c.balance || 0), 0);
    const directPendingReceivable =
      periodMode === 'all' ? Math.max(customerKhataTotalPositive, directPeriodPending) : directPeriodPending;

    // 2. COD Orders & WASAL Delivery
    const activeCodOrders = codOrders.filter(
      (o) =>
        o.status !== 'returned' &&
        matchesPeriod(o.deliveredAt || o.dispatchedAt || o.createdAt)
    );
    const codSalesTotal = activeCodOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const codDeliveryFeesTotal = activeCodOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);

    let codCogs = 0;
    activeCodOrders.forEach((o) => {
      o.items.forEach((it) => {
        const cost = it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0;
        codCogs += cost * (it.quantity || 0);
      });
    });

    const periodWasalSettlements = wasalSettlements.filter((w) => matchesPeriod(w.date));
    const wasalCashReceived = periodWasalSettlements.reduce((s, w) => s + (w.amount || 0), 0);
    const nonWasalDeliveredCash = activeCodOrders
      .filter((o) => o.status === 'delivered' && o.courierPartner !== 'WASAL delivery')
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    const codCashReceived = wasalCashReceived + nonWasalDeliveredCash;

    const codInTransitPending = activeCodOrders
      .filter((o) => o.status === 'pending' || o.status === 'dispatched')
      .reduce((s, o) => s + (o.totalAmount || 0), 0);

    const wasalDeliveredTotal = activeCodOrders
      .filter((o) => o.status === 'delivered' && o.courierPartner === 'WASAL delivery')
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    const wasalPendingRemittance = Math.max(0, wasalDeliveredTotal - wasalCashReceived);
    const codPendingTotal = codInTransitPending + wasalPendingRemittance;

    // 3. Walk-In Branch POS Sales
    const periodWalkInSales = walkInSales.filter((s) =>
      matchesPeriod(s.saleDate || s.timestamp)
    );
    const walkinSalesTotal = periodWalkInSales.reduce((s, x) => s + (x.totalAmount || 0), 0);
    const walkinCashReceived = periodWalkInSales.reduce((s, x) => s + (x.paidAmount || 0), 0);
    const walkinPendingDue = periodWalkInSales.reduce((s, x) => s + (x.dueAmount || 0), 0);

    let walkinCogs = 0;
    periodWalkInSales.forEach((s) => {
      s.items.forEach((it) => {
        const cost = it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0;
        walkinCogs += cost * (it.quantity || 0);
      });
    });

    // 4. Consolidated Sales, Cash & Pending
    const totalSales = directSalesTotal + codSalesTotal + walkinSalesTotal;
    const totalCOGS = directCogs + codCogs + walkinCogs;
    const grossProfit = totalSales - totalCOGS;
    const grossMarginRatio = totalSales > 0 ? grossProfit / totalSales : 0;

    const totalPaymentsReceived = directReceivedTotal + codCashReceived + walkinCashReceived;
    const totalPendingReceivables = directPendingReceivable + codPendingTotal + walkinPendingDue;

    // 5. Manual Monthly Expenses
    const periodExpenses = monthlyExpenses.filter((e) =>
      periodMode === 'all' ? true : e.month === selectedMonth || e.date.startsWith(selectedMonth)
    );
    const manualExpensesPaid = periodExpenses
      .filter((e) => e.paymentStatus === 'paid')
      .reduce((s, e) => s + (e.amount || 0), 0);
    const manualExpensesPending = periodExpenses
      .filter((e) => e.paymentStatus === 'pending')
      .reduce((s, e) => s + (e.amount || 0), 0);
    const manualExpensesTotal = manualExpensesPaid + manualExpensesPending;

    // 6. HR Staff Monthly Payroll Overhead (mirrors HRManagementView exact deduction math)
    let autoHrPayrollTotal = 0;
    if (includeAutoHrPayroll) {
      const targetMonth = periodMode === 'monthly' ? selectedMonth : currentMonthDefault;
      const monthAtt = attendance.filter((a) => a.date.startsWith(targetMonth));
      const activeEmployees = employees.filter((e) => e.status !== 'resigned');
      autoHrPayrollTotal = activeEmployees.reduce((sum, emp) => {
        const empAtt = monthAtt.filter((a) => a.employeeId === emp.id);
        const lateDays = empAtt.filter((a) => a.status === 'late').length;
        const halfDays = empAtt.filter((a) => a.status === 'half_day').length;
        const absentDays = empAtt.filter((a) => a.status === 'absent').length;
        const allowances =
          (emp.allowances?.medical || 0) +
          (emp.allowances?.fuel || 0) +
          (emp.allowances?.food || 0) +
          (emp.allowances?.bonus || 0);
        const gross = (emp.baseSalary || 0) + allowances;
        const dailyRate = Math.round((emp.baseSalary || 0) / 30);
        const deductions = Math.round(
          absentDays * dailyRate + halfDays * (dailyRate * 0.5) + lateDays * (dailyRate * 0.25)
        );
        return sum + Math.max(0, gross - deductions);
      }, 0);
    }

    // 7. Reseller & Salesperson Commissions Overhead
    const periodCommissions = commissionRecords.filter(
      (c) => c.status !== 'cancelled' && matchesPeriod(c.createdAt)
    );
    const paidCommissionsRecords = periodCommissions
      .filter((c) => c.status === 'paid')
      .reduce((s, c) => s + (c.calculatedCommission || 0), 0);
    const pendingCommissionsRecords = periodCommissions
      .filter((c) => c.status === 'pending')
      .reduce((s, c) => s + (c.calculatedCommission || 0), 0);
    const resellerPaidTotal =
      periodMode === 'all'
        ? Math.max(
            paidCommissionsRecords,
            resellers.reduce((s, r) => s + (r.paidCommission || 0), 0)
          )
        : paidCommissionsRecords;
    const resellerPendingTotal =
      periodMode === 'all'
        ? Math.max(
            pendingCommissionsRecords,
            resellers.reduce((s, r) => s + Math.max(0, (r.earnedCommission || 0) - (r.paidCommission || 0)), 0)
          )
        : pendingCommissionsRecords;
    const totalCommissionsOverhead = includeResellerCommissions
      ? resellerPaidTotal + resellerPendingTotal
      : 0;

    // 8. Total Overhead, Breakeven, Realized Net Profit, Expected Profit, Available Cash
    const totalOverhead = manualExpensesTotal + autoHrPayrollTotal + totalCommissionsOverhead;
    const breakevenRevenue =
      grossMarginRatio > 0 ? Math.round(totalOverhead / grossMarginRatio) : totalOverhead;
    const breakevenProgressPct =
      breakevenRevenue > 0 ? Math.min(100, Math.round((totalSales / breakevenRevenue) * 100)) : 100;
    const remainingToBreakeven = Math.max(0, breakevenRevenue - totalSales);
    const surplusAboveBreakeven = Math.max(0, totalSales - breakevenRevenue);

    // Expected Profit After Clearing All Pending Payments = Gross Profit - Total Overheads
    const expectedNetProfitAfterClearingAll = grossProfit - totalOverhead;

    // Realized Cash Collected Margin (Collected revenue * gross margin ratio or collected - COGS - Paid Expenses)
    const realizedCollectedNetCashFlow =
      totalPaymentsReceived -
      totalCOGS -
      manualExpensesPaid -
      (includeAutoHrPayroll ? autoHrPayrollTotal : 0) -
      (includeResellerCommissions ? resellerPaidTotal : 0);

    // Available Liquid Cash = Payments Received - Paid Manual Expenses - Paid Commissions - Settled Investor Profit (all-time context note)
    const investorSettledPayouts =
      periodMode === 'all' ? investors.reduce((s, i) => s + (i.settledProfit || 0), 0) : 0;
    const availableNetCash =
      totalPaymentsReceived -
      manualExpensesPaid -
      (includeResellerCommissions ? resellerPaidTotal : 0) -
      investorSettledPayouts;

    // Expense breakdown by category
    const expenseByCategory = EXPENSE_CATEGORIES.map((cat) => {
      const catItems = periodExpenses.filter((e) => e.category === cat.value);
      const total = catItems.reduce((s, e) => s + (e.amount || 0), 0);
      return { ...cat, total, count: catItems.length };
    }).filter((c) => c.total > 0);

    return {
      directCreditTxs,
      directSettlementDebits,
      activeCodOrders,
      periodWalkInSales,
      periodExpenses,
      directSalesTotal,
      directReceivedTotal,
      directPendingReceivable,
      codSalesTotal,
      codDeliveryFeesTotal,
      codCashReceived,
      codInTransitPending,
      wasalPendingRemittance,
      wasalCashReceived,
      walkinSalesTotal,
      walkinCashReceived,
      walkinPendingDue,
      totalSales,
      totalCOGS,
      grossProfit,
      grossMarginRatio,
      totalPaymentsReceived,
      totalPendingReceivables,
      manualExpensesPaid,
      manualExpensesPending,
      manualExpensesTotal,
      autoHrPayrollTotal,
      resellerPaidTotal,
      resellerPendingTotal,
      totalCommissionsOverhead,
      totalOverhead,
      breakevenRevenue,
      breakevenProgressPct,
      remainingToBreakeven,
      surplusAboveBreakeven,
      expectedNetProfitAfterClearingAll,
      realizedCollectedNetCashFlow,
      availableNetCash,
      investorSettledPayouts,
      expenseByCategory,
    };
  }, [
    transactions,
    customers,
    products,
    codOrders,
    walkInSales,
    wasalSettlements,
    commissionRecords,
    monthlyExpenses,
    employees,
    attendance,
    resellers,
    investors,
    periodMode,
    selectedMonth,
    includeAutoHrPayroll,
    includeResellerCommissions,
    productMap,
    currentMonthDefault,
  ]);

  // Unified Master File Ledger Rows
  const masterLedgerRows = useMemo<MasterLedgerRow[]>(() => {
    const rows: MasterLedgerRow[] = [];

    // Direct Store & Credit sales
    metrics.directCreditTxs.forEach((tx) => {
      const cust = customerMap.get(tx.customerId);
      let cogs = 0;
      (tx.items || []).forEach((it) => {
        cogs += (it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0) * (it.quantity || 0);
      });
      const remaining =
        tx.saleType === 'full'
          ? 0
          : tx.dueBalance !== undefined
          ? Math.max(0, tx.dueBalance)
          : Math.max(0, tx.amount - (tx.paidAmount || 0));
      const paid = Math.max(0, tx.amount - remaining);

      rows.push({
        id: `tx_${tx.id}`,
        date: tx.date,
        reference: tx.invoiceNumber || `INV-${tx.id.slice(-6).toUpperCase()}`,
        category: remaining > 0 ? 'pending_due' : 'sale',
        partyOrTitle: cust ? `${cust.name} (${cust.phone})` : 'Store Customer',
        channel: (tx.paymentMode || tx.saleType || 'Store').toUpperCase(),
        status: remaining > 0 ? 'Pending Balance' : 'Paid Sale',
        grossAmount: tx.amount,
        receivedAmount: paid,
        pendingAmount: remaining,
        expenseAmount: 0,
        estimatedProfitImpact: tx.amount - cogs,
        notes: tx.notes,
      });
    });

    // Direct Khata Debit Settlements
    metrics.directSettlementDebits.forEach((tx) => {
      const cust = customerMap.get(tx.customerId);
      rows.push({
        id: `deb_${tx.id}`,
        date: tx.date,
        reference: tx.invoiceNumber || `REC-${tx.id.slice(-6).toUpperCase()}`,
        category: 'payment_received',
        partyOrTitle: cust ? `${cust.name} (Khata Recovery)` : 'Customer Recovery',
        channel: (tx.paymentMode || 'Cash').toUpperCase(),
        status: 'Cash Received',
        grossAmount: 0,
        receivedAmount: tx.amount,
        pendingAmount: 0,
        expenseAmount: 0,
        estimatedProfitImpact: 0,
        notes: tx.notes,
      });
    });

    // COD Orders
    metrics.activeCodOrders.forEach((ord) => {
      let cogs = 0;
      ord.items.forEach((it) => {
        cogs += (it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0) * (it.quantity || 0);
      });
      const isPendingCod = ord.status === 'pending' || ord.status === 'dispatched';
      rows.push({
        id: `cod_${ord.id}`,
        date: (ord.deliveredAt || ord.dispatchedAt || ord.createdAt).slice(0, 10),
        reference: ord.orderNumber,
        category: isPendingCod ? 'pending_due' : 'sale',
        partyOrTitle: `${ord.customerName} (${ord.city})`,
        channel: ord.courierPartner,
        status: ord.status.toUpperCase(),
        grossAmount: ord.totalAmount,
        receivedAmount: ord.status === 'delivered' && ord.courierPartner !== 'WASAL delivery' ? ord.totalAmount : 0,
        pendingAmount: isPendingCod ? ord.totalAmount : 0,
        expenseAmount: 0,
        estimatedProfitImpact: ord.totalAmount - cogs,
        notes: ord.courierPartner === 'WASAL delivery' && ord.status === 'delivered' ? 'Remitted via WASAL Settlements' : ord.notes,
      });
    });

    // Walk-in POS Sales
    metrics.periodWalkInSales.forEach((s) => {
      let cogs = 0;
      s.items.forEach((it) => {
        cogs += (it.productId ? productMap.get(it.productId)?.costPrice || 0 : 0) * (it.quantity || 0);
      });
      rows.push({
        id: `pos_${s.id}`,
        date: (s.saleDate || s.timestamp).slice(0, 10),
        reference: s.receiptNumber,
        category: s.dueAmount > 0 ? 'pending_due' : 'sale',
        partyOrTitle: `${s.customerName || 'Walk-in Customer'} (${s.branchName})`,
        channel: `POS · ${String(s.paymentMethod).toUpperCase()}`,
        status: s.dueAmount > 0 ? 'Partial / Due' : 'Completed POS',
        grossAmount: s.totalAmount,
        receivedAmount: s.paidAmount,
        pendingAmount: s.dueAmount,
        expenseAmount: 0,
        estimatedProfitImpact: s.totalAmount - cogs,
        notes: s.notes,
      });
    });

    // Manual Monthly Expenses
    metrics.periodExpenses.forEach((exp) => {
      const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === exp.category)?.label || exp.category;
      rows.push({
        id: `exp_${exp.id}`,
        date: exp.date,
        reference: catLabel,
        category: 'expense',
        partyOrTitle: exp.urduTitle ? `${exp.title} (${exp.urduTitle})` : exp.title,
        channel: PAYMENT_MODE_LABELS[exp.paymentMode] || exp.paymentMode,
        status: exp.paymentStatus === 'paid' ? 'Paid Expense' : 'Pending Bill',
        grossAmount: 0,
        receivedAmount: 0,
        pendingAmount: 0,
        expenseAmount: exp.amount,
        estimatedProfitImpact: -exp.amount,
        notes: exp.notes,
      });
    });

    const filtered = rows.filter((r) => {
      if (ledgerFilter !== 'all' && r.category !== ledgerFilter) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.trim().toLowerCase();
        const hay = `${r.reference} ${r.partyOrTitle} ${r.channel} ${r.status} ${r.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => b.date.localeCompare(a.date));
  }, [metrics, customerMap, productMap, ledgerFilter, ledgerSearch]);

  // Open Expense Add / Edit Modal
  const openAddExpense = () => {
    setEditingExpense(null);
    setExpTitle('');
    setExpUrduTitle('');
    setExpCategory('rent');
    setExpAmount('');
    setExpDate(
      periodMode === 'monthly' && selectedMonth !== currentMonthDefault
        ? `${selectedMonth}-01`
        : todayStr
    );
    setExpStatus('paid');
    setExpMode('cash');
    setExpRecurring(true);
    setExpNotes('');
    setIsExpenseModalOpen(true);
  };

  const openEditExpense = (exp: MonthlyExpense) => {
    setEditingExpense(exp);
    setExpTitle(exp.title);
    setExpUrduTitle(exp.urduTitle || '');
    setExpCategory(exp.category);
    setExpAmount(String(exp.amount));
    setExpDate(exp.date);
    setExpStatus(exp.paymentStatus);
    setExpMode(exp.paymentMode);
    setExpRecurring(Boolean(exp.isRecurringMonthly));
    setExpNotes(exp.notes || '');
    setIsExpenseModalOpen(true);
  };

  const handleSaveExpenseForm = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Math.round(Number(expAmount));
    if (!expTitle.trim()) {
      pushToast('Please enter an expense title.', 'error');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      pushToast('Please enter a valid positive amount in PKR.', 'error');
      return;
    }

    const cleanDate = expDate || todayStr;
    const derivedMonth = cleanDate.slice(0, 7);

    const record: MonthlyExpense = {
      id: editingExpense?.id || `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: expTitle.trim(),
      urduTitle: expUrduTitle.trim() || undefined,
      category: expCategory,
      amount: numericAmount,
      month: derivedMonth,
      date: cleanDate,
      paymentStatus: expStatus,
      paymentMode: expMode,
      isRecurringMonthly: expRecurring,
      notes: expNotes.trim() || undefined,
      recordedBy: currentUser?.name || 'Admin',
      createdAt: editingExpense?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveExpense(record);
    setIsExpenseModalOpen(false);
    pushToast(
      editingExpense
        ? `Updated expense "${record.title}" (${cs}${record.amount.toLocaleString('en-PK')}).`
        : `Added monthly expense "${record.title}" (${cs}${record.amount.toLocaleString('en-PK')}).`,
      'success'
    );
  };

  const handleClonePreviousMonth = () => {
    const [yearStr, monStr] = selectedMonth.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monStr, 10);
    if (!year || !mon) return;
    const prevDate = new Date(year, mon - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const count = onCloneRecurringExpenses(prevMonth, selectedMonth);
    if (count > 0) {
      pushToast(`Cloned ${count} recurring bill(s) from ${prevMonth} into ${selectedMonth}.`, 'success');
    } else {
      pushToast(`No new recurring expenses found in ${prevMonth} to clone into ${selectedMonth}.`, 'info');
    }
  };

  const handleExportMasterCSV = () => {
    const summaryRows = [
      ['100DAGAR FINANCIAL MASTER FILE', periodMode === 'monthly' ? selectedMonth : 'ALL TIME'],
      ['Total Gross Sales', metrics.totalSales],
      ['Cost of Goods Sold (COGS)', metrics.totalCOGS],
      ['Gross Profit', metrics.grossProfit],
      ['Total Payments Received', metrics.totalPaymentsReceived],
      ['Pending Receivables (Khata + COD + WASAL + POS)', metrics.totalPendingReceivables],
      ['Manual Monthly Expenses (Paid + Pending)', metrics.manualExpensesTotal],
      ['Auto HR Payroll Included', metrics.autoHrPayrollTotal],
      ['Reseller/Salesperson Commissions', metrics.totalCommissionsOverhead],
      ['Total Overhead', metrics.totalOverhead],
      ['Breakeven Revenue Target', metrics.breakevenRevenue],
      ['Available Liquid Cash', metrics.availableNetCash],
      ['Expected Profit After Clearing All Pending', metrics.expectedNetProfitAfterClearingAll],
      [],
      ['Date', 'Reference', 'Type', 'Party / Title', 'Channel', 'Status', 'Gross Sale', 'Received', 'Pending Due', 'Expense', 'Profit Impact', 'Notes'],
    ];

    const ledgerRows = masterLedgerRows.map((r) => [
      r.date,
      `"${r.reference.replace(/"/g, '""')}"`,
      r.category,
      `"${r.partyOrTitle.replace(/"/g, '""')}"`,
      `"${r.channel.replace(/"/g, '""')}"`,
      r.status,
      r.grossAmount,
      r.receivedAmount,
      r.pendingAmount,
      r.expenseAmount,
      r.estimatedProfitImpact,
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csv =
      'data:text/csv;charset=utf-8,' +
      [...summaryRows.map((r) => r.join(',')), ...ledgerRows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute(
      'download',
      `100DAGAR_Financial_Master_${periodMode === 'monthly' ? selectedMonth : 'ALL'}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    pushToast('Master Financial File exported as CSV.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* 1. HEADER & PERIOD CONTROL BAR */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="p-2.5 rounded-xl bg-amber-500 text-slate-950 shadow-xs shrink-0">
              <Calculator className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Financial Master File &amp; Monthly Expenses
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                منافع، ماہانہ اخراجات، بریک ایون اور واجب الادا رقم کا مکمل حساب — Live sales, payments received, pending dues, overheads, breakeven &amp; expected profit.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            {/* Period Switch */}
            <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPeriodMode('monthly')}
                className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
                  periodMode === 'monthly'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Monthly View
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('all')}
                className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
                  periodMode === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                All-Time Master
              </button>
            </div>

            {periodMode === 'monthly' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value || currentMonthDefault)}
                className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            )}

            <button
              type="button"
              onClick={openAddExpense}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-slate-950 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Monthly Expense</span>
            </button>

            <button
              type="button"
              onClick={handleExportMasterCSV}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Overhead Inclusion Toggles + Quick Shortcuts to Payment Accounts & HR */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs no-print">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeAutoHrPayroll}
                onChange={(e) => setIncludeAutoHrPayroll(e.target.checked)}
                className="rounded border-slate-300 text-amber-500 focus:ring-amber-400"
              />
              <span>
                Include Auto HR Payroll ({cs}{metrics.autoHrPayrollTotal.toLocaleString('en-PK')})
              </span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeResellerCommissions}
                onChange={(e) => setIncludeResellerCommissions(e.target.checked)}
                className="rounded border-slate-300 text-amber-500 focus:ring-amber-400"
              />
              <span>
                Include Reseller/Staff Commissions ({cs}{(metrics.resellerPaidTotal + metrics.resellerPendingTotal).toLocaleString('en-PK')})
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('settings')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold hover:bg-emerald-100 cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Manual Payment Accounts</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('hr_payroll')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-bold hover:bg-blue-100 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>HR Staff &amp; Salaries</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. EXECUTIVE FINANCIAL KPI GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* KPI 1: Total Sales & Gross Profit */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Total Sales (کل فروخت)</span>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
            {cs}{metrics.totalSales.toLocaleString('en-PK')}
          </p>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span>Store &amp; Credit:</span>
              <span>{cs}{metrics.directSalesTotal.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>COD &amp; WASAL:</span>
              <span>{cs}{metrics.codSalesTotal.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Walk-In Branch POS:</span>
              <span>{cs}{metrics.walkinSalesTotal.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold pt-1">
              <span>Gross Profit ({Math.round(metrics.grossMarginRatio * 100)}%):</span>
              <span>{cs}{metrics.grossProfit.toLocaleString('en-PK')}</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Payments Received & Available Cash */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Payments Received &amp; Cash</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {cs}{metrics.totalPaymentsReceived.toLocaleString('en-PK')}
          </p>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span>Store &amp; Khata Cash:</span>
              <span>{cs}{metrics.directReceivedTotal.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>COD &amp; WASAL Remitted:</span>
              <span>{cs}{metrics.codCashReceived.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Walk-In POS Received:</span>
              <span>{cs}{metrics.walkinCashReceived.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between text-slate-900 dark:text-white font-bold pt-1">
              <span>Available Liquid Cash:</span>
              <span className={metrics.availableNetCash >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}>
                {cs}{metrics.availableNetCash.toLocaleString('en-PK')}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Pending Receivables */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Pending Payments (واجب الادا)</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {cs}{metrics.totalPendingReceivables.toLocaleString('en-PK')}
          </p>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span>Customer Khata Dues:</span>
              <span>{cs}{metrics.directPendingReceivable.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>COD In-Transit / Pending:</span>
              <span>{cs}{metrics.codInTransitPending.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Due From WASAL Courier:</span>
              <span>{cs}{metrics.wasalPendingRemittance.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Walk-In POS Due:</span>
              <span>{cs}{metrics.walkinPendingDue.toLocaleString('en-PK')}</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Total Overheads & Manual Expenses */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Monthly Overhead (اخراجات)</span>
            <Receipt className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-black font-mono tabular-nums text-rose-600 dark:text-rose-400">
            {cs}{metrics.totalOverhead.toLocaleString('en-PK')}
          </p>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
            <div className="flex justify-between">
              <span>Manual Expenses (Paid):</span>
              <span>{cs}{metrics.manualExpensesPaid.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Manual Bills (Pending):</span>
              <span>{cs}{metrics.manualExpensesPending.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>HR Staff Payroll:</span>
              <span>{cs}{metrics.autoHrPayrollTotal.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Reseller/Sales Commissions:</span>
              <span>{cs}{metrics.totalCommissionsOverhead.toLocaleString('en-PK')}</span>
            </div>
          </div>
        </div>

        {/* KPI 5: Breakeven Target & Progress */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Breakeven Target (بریک ایون)</span>
            <Scale className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
            {cs}{metrics.breakevenRevenue.toLocaleString('en-PK')}
          </p>
          <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                metrics.breakevenProgressPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${metrics.breakevenProgressPct}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 font-mono">
            <div className="flex justify-between font-bold">
              <span>Achieved:</span>
              <span className={metrics.breakevenProgressPct >= 100 ? 'text-emerald-600' : 'text-amber-600'}>
                {metrics.breakevenProgressPct}%
              </span>
            </div>
            {metrics.remainingToBreakeven > 0 ? (
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>Remaining Sales Needed:</span>
                <span>{cs}{metrics.remainingToBreakeven.toLocaleString('en-PK')}</span>
              </div>
            ) : (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Sales Above Breakeven:</span>
                <span>+{cs}{metrics.surplusAboveBreakeven.toLocaleString('en-PK')}</span>
              </div>
            )}
          </div>
        </div>

        {/* KPI 6: Expected Profit After Clearing All Pending Payments */}
        <div
          className={`rounded-2xl p-4 shadow-2xs space-y-2 border ${
            metrics.expectedNetProfitAfterClearingAll >= 0
              ? 'bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50/60 dark:bg-rose-950/25 border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            <span>Expected Net Profit (بعد از وصولی)</span>
            {metrics.expectedNetProfitAfterClearingAll >= 0 ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-600" />
            )}
          </div>
          <p
            className={`text-2xl font-black font-mono tabular-nums ${
              metrics.expectedNetProfitAfterClearingAll >= 0
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-rose-700 dark:text-rose-300'
            }`}
          >
            {metrics.expectedNetProfitAfterClearingAll >= 0 ? '+' : ''}
            {cs}{metrics.expectedNetProfitAfterClearingAll.toLocaleString('en-PK')}
          </p>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 pt-1 border-t border-black/10 dark:border-white/10 font-mono">
            <div className="flex justify-between">
              <span>Gross Margin (All Sales):</span>
              <span>{cs}{metrics.grossProfit.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between">
              <span>Less Total Overhead:</span>
              <span>-{cs}{metrics.totalOverhead.toLocaleString('en-PK')}</span>
            </div>
            <div className="flex justify-between font-bold pt-0.5">
              <span>Collected Cash Position:</span>
              <span>{cs}{metrics.realizedCollectedNetCashFlow.toLocaleString('en-PK')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. MANUAL MONTHLY EXPENSES MANAGEMENT + CATEGORY BREAKDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Manual Expenses Table */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-500" />
                <span>Manual Monthly Expenses &amp; Overheads (ماہانہ اخراجات)</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Record rent, electricity, internet, marketing, packaging, courier, and custom overhead bills.
              </p>
            </div>

            <div className="flex items-center gap-2 no-print">
              {periodMode === 'monthly' && (
                <button
                  type="button"
                  onClick={handleClonePreviousMonth}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                  title="Clone recurring bills from previous month"
                >
                  <Copy className="w-3 h-3" />
                  <span>Clone Recurring</span>
                </button>
              )}
              <button
                type="button"
                onClick={openAddExpense}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Expense</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Expense Title</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {metrics.periodExpenses.map((exp) => {
                  const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === exp.category);
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{exp.date}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{exp.title}</span>
                          {exp.isRecurringMonthly && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                              Monthly
                            </span>
                          )}
                        </div>
                        {exp.urduTitle && (
                          <div className="text-[10px] text-slate-400 font-urdu">{exp.urduTitle}</div>
                        )}
                        {exp.notes && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{exp.notes}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {catInfo?.label || exp.category}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {PAYMENT_MODE_LABELS[exp.paymentMode] || exp.paymentMode}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                        {cs}{exp.amount.toLocaleString('en-PK')}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            onSaveExpense({
                              ...exp,
                              paymentStatus: exp.paymentStatus === 'paid' ? 'pending' : 'paid',
                              updatedAt: new Date().toISOString(),
                            })
                          }
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            exp.paymentStatus === 'paid'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                          title="Click to toggle Paid / Pending"
                        >
                          {exp.paymentStatus === 'paid' ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> PAID
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3" /> PENDING
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap no-print">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditExpense(exp)}
                            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            title="Edit Expense"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDialog({
                                title: 'Delete Monthly Expense',
                                message: `Delete "${exp.title}" (${cs}${exp.amount.toLocaleString('en-PK')}) from monthly overhead?`,
                                confirmLabel: 'Delete',
                                danger: true,
                                onConfirm: () => {
                                  onDeleteExpense(exp.id);
                                  pushToast(`Deleted expense "${exp.title}".`, 'info');
                                },
                              })
                            }
                            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Delete Expense"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {metrics.periodExpenses.length === 0 && (
            <div className="p-8 text-center space-y-2">
              <AlertCircle className="w-7 h-7 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                No manual expenses entered for {periodMode === 'monthly' ? selectedMonth : 'All Time'} yet.
              </p>
              <p className="text-[11px] text-slate-400">
                Click "Add Expense" to enter shop rent, electricity, internet, marketing, or custom overheads for accurate breakeven &amp; net profit tracking.
              </p>
            </div>
          )}
        </div>

        {/* Category Breakdown & Cost Structure Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-600" />
              <span>Overhead &amp; Expense Breakdown</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Combined cost allocation affecting monthly breakeven.
            </p>
          </div>

          <div className="space-y-2.5 text-xs">
            {metrics.expenseByCategory.map((cat) => {
              const pct =
                metrics.totalOverhead > 0 ? Math.round((cat.total / metrics.totalOverhead) * 100) : 0;
              return (
                <div key={cat.value} className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-slate-700 dark:text-slate-300 truncate">{cat.label}</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {cs}{cat.total.toLocaleString('en-PK')} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}

            {includeAutoHrPayroll && (
              <div className="space-y-1">
                <div className="flex justify-between font-semibold">
                  <span className="text-blue-700 dark:text-blue-300">Auto HR Staff Payroll</span>
                  <span className="font-mono text-slate-900 dark:text-white">
                    {cs}{metrics.autoHrPayrollTotal.toLocaleString('en-PK')}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{
                      width: `${
                        metrics.totalOverhead > 0
                          ? Math.round((metrics.autoHrPayrollTotal / metrics.totalOverhead) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            {includeResellerCommissions && (
              <div className="space-y-1">
                <div className="flex justify-between font-semibold">
                  <span className="text-amber-700 dark:text-amber-300">Reseller &amp; Sales Commissions</span>
                  <span className="font-mono text-slate-900 dark:text-white">
                    {cs}{metrics.totalCommissionsOverhead.toLocaleString('en-PK')}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500"
                    style={{
                      width: `${
                        metrics.totalOverhead > 0
                          ? Math.round((metrics.totalCommissionsOverhead / metrics.totalOverhead) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] space-y-1 font-mono text-slate-500 dark:text-slate-400">
            <div className="flex justify-between">
              <span>Product Inventory Cost (COGS):</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {cs}{metrics.totalCOGS.toLocaleString('en-PK')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>COD Delivery Fees Billed:</span>
              <span>{cs}{metrics.codDeliveryFeesTotal.toLocaleString('en-PK')}</span>
            </div>
            {periodMode === 'all' && metrics.investorSettledPayouts > 0 && (
              <div className="flex justify-between">
                <span>Investor Profit Payouts Settled:</span>
                <span>{cs}{metrics.investorSettledPayouts.toLocaleString('en-PK')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. UNIFIED MASTER FILE LEDGER */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-white">
              Master File Ledger ({masterLedgerRows.length} Records)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Complete consolidated log of all Store sales, Walk-In POS receipts, COD/WASAL orders, pending balances, and monthly expenses.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search ref, customer, city..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-48"
              />
            </div>

            <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'sale', label: 'Sales' },
                  { id: 'payment_received', label: 'Received' },
                  { id: 'pending_due', label: 'Pending Dues' },
                  { id: 'expense', label: 'Expenses' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLedgerFilter(f.id)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                    ledgerFilter === f.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-bold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Reference</th>
                <th className="py-2.5 px-3">Party / Description</th>
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Sale</th>
                <th className="py-2.5 px-3 text-right">Received</th>
                <th className="py-2.5 px-3 text-right">Pending</th>
                <th className="py-2.5 px-3 text-right">Expense</th>
                <th className="py-2.5 px-3 text-right">Profit Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {masterLedgerRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono whitespace-nowrap">{row.date}</td>
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {row.reference}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900 dark:text-white">{row.partyOrTitle}</div>
                    {row.notes && (
                      <div className="text-[10px] text-slate-400 truncate max-w-[220px]">{row.notes}</div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {row.channel}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                        row.category === 'expense'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : row.category === 'pending_due'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {row.grossAmount > 0 ? `${cs}${row.grossAmount.toLocaleString('en-PK')}` : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                    {row.receivedAmount > 0 ? `${cs}${row.receivedAmount.toLocaleString('en-PK')}` : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                    {row.pendingAmount > 0 ? `${cs}${row.pendingAmount.toLocaleString('en-PK')}` : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
                    {row.expenseAmount > 0 ? `${cs}${row.expenseAmount.toLocaleString('en-PK')}` : '-'}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                      row.estimatedProfitImpact > 0
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : row.estimatedProfitImpact < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {row.estimatedProfitImpact === 0
                      ? '-'
                      : `${row.estimatedProfitImpact > 0 ? '+' : ''}${cs}${row.estimatedProfitImpact.toLocaleString('en-PK')}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {masterLedgerRows.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-400">
            No matching ledger records found for this filter and period.
          </div>
        )}
      </div>

      {/* 5. ADD / EDIT MANUAL EXPENSE MODAL */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4">
          <form
            onSubmit={handleSaveExpenseForm}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {editingExpense ? 'Edit Monthly Expense' : 'Add Manual Monthly Expense'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  ماہانہ اخراجات درج کریں (Rent, Utilities, Marketing, Courier, Custom)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Expense Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Shop Monthly Rent"
                    value={expTitle}
                    onChange={(e) => setExpTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Urdu Title (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="دکان کا کرایہ"
                    value={expUrduTitle}
                    onChange={(e) => setExpUrduTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-urdu"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Category *
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Amount ({cs}) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="15000"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Status
                  </label>
                  <select
                    value={expStatus}
                    onChange={(e) => setExpStatus(e.target.value as 'paid' | 'pending')}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="paid">Paid (ادائیگی ہو گئی)</option>
                    <option value="pending">Pending Bill (واجب الادا)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={expMode}
                    onChange={(e) => setExpMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {Object.entries(PAYMENT_MODE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notes / Bill Reference
                </label>
                <input
                  type="text"
                  placeholder="Optional meter #, landlord name, or ad invoice ID..."
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <label className="inline-flex items-center gap-2 pt-1 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={expRecurring}
                  onChange={(e) => setExpRecurring(e.target.checked)}
                  className="rounded border-slate-300 text-amber-500"
                />
                <span>Mark as Recurring Monthly Overhead (allows 1-click Clone next month)</span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-850">
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 hover:bg-slate-800 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{editingExpense ? 'Save Changes' : 'Save Expense'}</span>
              </button>
            </div>
          </form>
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
    </div>
  );
};
