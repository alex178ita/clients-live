// Shared domain types for the Won Deals & Billing Plan dashboard.

export type DealStageGroup = 'won' | 'closing';

export type ScheduleSource = 'duration' | 'billing' | 'books';

/** A raw Zoho CRM deal, reduced to the fields this app uses. */
export interface CrmDeal {
  id: string;
  dealName: string;
  stage: string;
  group: DealStageGroup;
  accountId: string | null;
  accountName: string | null;
  finalClientName: string | null;
  ownerName: string | null;
  csmName: string | null;
  amount: number;
  licence: number;
  delivery: number;
  closingDate: string | null; // yyyy-mm-dd
  licenceStartDate: string | null;
  licenceEndDate: string | null;
  duration: number | null;
  durationBasis: string | null;
  valuePerDuration: number | null;
  expectedDateOfFirstInvoice: string | null;
  paymentTermsDays: number | null;
  advancePayment: number;
  advanceTermsDays: number | null;
  advanceInvoiceDate: string | null;
  licenceModules: string[];
  autoRenew: string | null;
  currency: string;
}

/** One planned instalment produced by the schedule engine. */
export interface Instalment {
  /** Sequence number, 0 = advance payment when present. */
  seq: number;
  kind: 'advance' | 'instalment';
  /** Planned invoice date, yyyy-mm-dd */
  invoiceDate: string;
  /** Planned collection date using the contractual payment terms, yyyy-mm-dd */
  dueDate: string;
  amount: number;
}

export interface ScheduleWarning {
  code:
    | 'no-duration'
    | 'no-basis'
    | 'amount-mismatch'
    | 'no-start-date'
    | 'zero-amount';
  message: string;
}

export interface DealSchedule {
  instalments: Instalment[];
  warnings: ScheduleWarning[];
  /** True when the periodicity had to be inferred rather than read from Duration Basis. */
  inferred: boolean;
}

/** A credit note applied against an invoice. */
export interface CreditNoteRef {
  creditNoteId: string;
  number: string;
  date: string;
  /** Amount of this credit note applied to that invoice. */
  amount: number;
  status: string;
}

/** A Zoho Books invoice linked to a deal. */
export interface BooksInvoice {
  invoiceId: string;
  invoiceNumber: string;
  dealId: string | null;
  dealName: string | null;
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  total: number;
  balance: number;
  status: string;
  lastPaymentDate: string | null;
  currency: string;
  url: string | null;
  /** Credit notes applied to this invoice, newest first. */
  creditNotes: CreditNoteRef[];
  /** Total credited against this invoice. */
  creditedAmount: number;
  /**
   * True when credit notes cover the whole invoice: it was cancelled and
   * usually reissued, so no money ever moved. Books still calls it "paid",
   * which is why this is worked out here instead of trusting the status.
   */
  closedByCreditNote: boolean;
}

/** A Zoho Billing subscription. */
export interface BillingSubscription {
  subscriptionId: string;
  subscriptionNumber: string;
  name: string;
  planName: string;
  planCode: string;
  status: string;
  customerId: string;
  customerName: string;
  dealId: string | null;
  dealName: string | null;
  amount: number;
  subTotal: number;
  interval: number;
  intervalUnit: string;
  currentTermStartsAt: string | null;
  currentTermEndsAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  lastBillingAt: string | null;
  nextBillingAt: string | null;
  paymentTerms: number | null;
  paymentTermsLabel: string | null;
  referenceId: string | null;
  salespersonName: string | null;
  /**
   * How the subscription was attached to the deal: the CRM link Zoho writes,
   * or our own scoring when that link is missing.
   */
  matchedBy: 'crm-link' | 'scored' | null;
}

export interface InvoiceRef {
  date: string;
  amount: number;
  source: ScheduleSource;
  label: string | null;
}

export interface SubscriptionMatchInfo {
  score: number;
  signals: { label: string; points: number }[];
}

export interface SubscriptionCandidate {
  subscription: BillingSubscription;
  score: number;
  signals: { label: string; points: number }[];
}

/** One fully assembled row of the main table. */
export interface DealRow extends CrmDeal {
  schedule: DealSchedule;
  invoices: BooksInvoice[];
  subscription: BillingSubscription | null;
  /** Why the subscription was attached, when it was not the CRM link. */
  subscriptionMatch: SubscriptionMatchInfo | null;
  /** Plausible but not confident enough to attach — shown so they can be fixed. */
  subscriptionCandidates: SubscriptionCandidate[];
  hasLicence: boolean;
  hasServices: boolean;
  invoicedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  lastInvoice: InvoiceRef | null;
  nextInvoice: InvoiceRef | null;
  /** Mean delay in days between invoice date and payment date for this customer. */
  avgPaymentDelayDays: number | null;
  paymentDelaySampleSize: number;
}

export interface MonthlyPoint {
  month: string; // yyyy-mm
  plannedBilling: number;
  actualBilling: number;
  plannedCash: number;
  realisticCash: number;
  /** Cash actually received in the month. */
  actualCash: number;
  /** Open invoice balances whose due date fell in this month and is now past. */
  overdueCash: number;
}

/** One line behind a single bar, for the per-month Excel drill-down. */
export interface BreakdownLine {
  kind: 'planned' | 'issued' | 'collected' | 'overdue';
  dealId: string;
  dealName: string;
  accountName: string | null;
  stage: string;
  reference: string;
  date: string;
  dueDate: string | null;
  amount: number;
  status: string;
  note: string;
}

export type BreakdownChart = 'billing' | 'cash' | 'realistic';

/** One invoice that is open and past its due date, whoever it belongs to. */
export interface OverdueEntry {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  total: number;
  /** Still owed. */
  balance: number;
  daysOverdue: number;
  label: string;
  status: string;
  url: string | null;
  dealId: string | null;
  dealName: string | null;
  /** True when the invoice belongs to a deal shown in the table above. */
  onDashboard: boolean;
}

export interface OverdueBucket {
  label: string;
  fromDays: number;
  total: number;
  count: number;
}

/**
 * Unpaid money across the whole of Books, independent of any subscription:
 * an expired or cancelled subscription still leaves its invoices behind.
 */
export interface OverdueLedger {
  total: number;
  count: number;
  oldestDays: number;
  /** Owed on invoices that belong to no deal in the table. */
  offDashboardTotal: number;
  offDashboardCount: number;
  buckets: OverdueBucket[];
  byCustomer: { customerId: string; customerName: string; total: number; count: number; oldestDays: number }[];
  invoices: OverdueEntry[];
}

/** One Zoho product that refused to answer, reported rather than swallowed. */
export interface SourceError {
  source: 'crm' | 'books' | 'creditnotes' | 'billing';
  label: string;
  message: string;
  endpoint: string;
  status: number | null;
  hint: string;
}

export interface DashboardPayload {
  generatedAt: string;
  currency: string;
  rows: DealRow[];
  monthly: MonthlyPoint[];
  /** Every overdue invoice in Books, whatever it was billed from. */
  overdue: OverdueLedger;
  stats: {
    dealCount: number;
    wonCount: number;
    closingCount: number;
    totalAmount: number;
    invoicedTotal: number;
    collectedTotal: number;
    outstandingTotal: number;
    companyAvgPaymentDelayDays: number | null;
    companyPaymentDelaySampleSize: number;
    /** How well Zoho Billing itself knows which deal each subscription belongs to. */
    subscriptions: {
      total: number;
      active: number;
      /** Carrying `zcrm_potential_id` — the link Billing writes when the deal is set. */
      crmLinked: number;
      /** Active, no CRM link, attached here by scoring. */
      matchedHere: number;
      /** Active, no CRM link, and not confidently attached to any deal. */
      unresolved: number;
    };
  };
  notices: string[];
  /** Empty when all three Zoho products answered. */
  sourceErrors: SourceError[];
}
