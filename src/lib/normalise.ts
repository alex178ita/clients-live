import { toISODate } from './dates';
import type {
  BillingSubscription,
  BooksInvoice,
  CreditNoteRef,
  CrmDeal,
  DealStageGroup,
} from './types';

export const WON_STAGES = ['8. Client Won', 'Client won'];
export const CLOSING_STAGES = ['6. Closing', '7. Signed'];

export function stageGroup(stage: string): DealStageGroup | null {
  if (WON_STAGES.includes(stage)) return 'won';
  if (CLOSING_STAGES.includes(stage)) return 'closing';
  return null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lookupName(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.name ?? null;
}

function lookupId(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return null;
  return value.id ?? null;
}

export function normaliseDeal(raw: any): CrmDeal | null {
  const group = stageGroup(raw.Stage);
  if (!group) return null;
  const modules = raw.Licence_Modules;
  return {
    id: String(raw.id),
    dealName: raw.Deal_Name ?? '(no name)',
    stage: raw.Stage,
    group,
    accountId: lookupId(raw.Account_Name),
    accountName: lookupName(raw.Account_Name),
    finalClientName: lookupName(raw.Final_Client),
    ownerName: lookupName(raw.Owner),
    csmName: lookupName(raw.Customer_Success_Manager),
    amount: num(raw.Amount),
    licence: num(raw.Licence),
    delivery: num(raw.Delivery),
    closingDate: toISODate(raw.Closing_Date),
    licenceStartDate: toISODate(raw.Licence_Start_Date),
    licenceEndDate: toISODate(raw.Licence_End_Date),
    duration: optNum(raw.Duration),
    durationBasis: raw.Duration_Basis ?? null,
    valuePerDuration: optNum(raw.Value_per_Duration),
    expectedDateOfFirstInvoice: toISODate(raw.Expected_Date_of_First_Invoice),
    paymentTermsDays: optNum(raw.Payment_Terms_number_of_days),
    advancePayment: num(raw.Advance_Payment),
    advanceTermsDays: optNum(raw.Terms_for_Advance_Payment_days),
    advanceInvoiceDate: toISODate(raw.Invoice_Date_for_Advance_Payment),
    licenceModules: Array.isArray(modules)
      ? modules.map(String)
      : typeof modules === 'string' && modules
        ? modules.split(/[;,]/).map((m) => m.trim()).filter(Boolean)
        : [],
    autoRenew: raw.Auto_renew ?? null,
    currency: raw.Currency ?? 'EUR',
  };
}

export function normaliseInvoice(raw: any): BooksInvoice {
  return {
    invoiceId: String(raw.invoice_id),
    invoiceNumber: raw.invoice_number ?? '',
    dealId: raw.zcrm_potential_id ? String(raw.zcrm_potential_id) : null,
    dealName: raw.zcrm_potential_name || null,
    customerId: String(raw.customer_id ?? ''),
    customerName: raw.customer_name ?? '',
    date: toISODate(raw.date) ?? '',
    dueDate: toISODate(raw.due_date),
    total: num(raw.total),
    balance: num(raw.balance),
    status: raw.status ?? '',
    lastPaymentDate: toISODate(raw.last_payment_date),
    currency: raw.currency_code ?? 'EUR',
    url: raw.invoice_url ? String(raw.invoice_url).trim() : null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
  };
}

/**
 * Turns the credit notes fetched from Books into a map invoice id -> credits.
 * Each raw record is a full credit note, whose `invoices[]` names the invoices
 * it was applied to and for how much.
 */
export function creditNotesByInvoice(rawCreditNotes: any[]): Map<string, CreditNoteRef[]> {
  const map = new Map<string, CreditNoteRef[]>();
  for (const raw of rawCreditNotes) {
    if (!raw) continue;
    const status = raw.status ?? '';
    // A draft or voided credit note never neutralised anything.
    if (status === 'draft' || status === 'void') continue;
    const applied: any[] = Array.isArray(raw.invoices) ? raw.invoices : [];
    for (const link of applied) {
      const invoiceId = link?.invoice_id ? String(link.invoice_id) : '';
      if (!invoiceId) continue;
      const list = map.get(invoiceId) ?? [];
      list.push({
        creditNoteId: String(raw.creditnote_id ?? ''),
        number: raw.creditnote_number ?? '',
        date: toISODate(raw.date) ?? '',
        amount: num(link.amount),
        status,
      });
      map.set(invoiceId, list);
    }
  }
  for (const [, list] of map) list.sort((a, b) => b.date.localeCompare(a.date));
  return map;
}

export function normaliseSubscription(raw: any): BillingSubscription {
  return {
    subscriptionId: String(raw.subscription_id),
    subscriptionNumber: raw.subscription_number ?? '',
    name: raw.name ?? '',
    planName: raw.plan_name ?? '',
    planCode: raw.plan_code ?? '',
    status: raw.status ?? '',
    customerId: String(raw.customer_id ?? ''),
    customerName: raw.customer_name ?? '',
    dealId: raw.zcrm_potential_id ? String(raw.zcrm_potential_id) : null,
    dealName: raw.zcrm_potential_name || null,
    amount: num(raw.amount),
    subTotal: num(raw.sub_total),
    interval: num(raw.interval) || 1,
    intervalUnit: raw.interval_unit ?? 'months',
    currentTermStartsAt: toISODate(raw.current_term_starts_at),
    currentTermEndsAt: toISODate(raw.current_term_ends_at),
    activatedAt: toISODate(raw.activated_at),
    expiresAt: toISODate(raw.expires_at),
    lastBillingAt: toISODate(raw.last_billing_at),
    nextBillingAt: toISODate(raw.next_billing_at),
    paymentTerms: optNum(raw.payment_terms),
    paymentTermsLabel: raw.payment_terms_label || null,
    referenceId: raw.reference_id || null,
    salespersonName: raw.salesperson_name || null,
    matchedBy: null,
  };
}

/**
 * Subscriptions still in force. Expired and cancelled ones are not offered as
 * candidates when the CRM link is missing: they cannot be what a current deal
 * bills against. A subscription carrying an explicit CRM link is still attached
 * whatever its status, so history stays intact.
 */
const ACTIVE_STATUSES = new Set([
  'live',
  'trial',
  'future',
  'non_renewing',
  'paused',
  'past_due',
  'unpaid',
]);

export function isActiveSubscription(sub: BillingSubscription): boolean {
  return ACTIVE_STATUSES.has((sub.status ?? '').toLowerCase());
}

/** Loose name key used when a deal has no invoice to anchor it to a Books customer. */
export function nameKey(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(s\.?p\.?a|s\.?r\.?l|srl|spa|ltd|limited|gmbh|sa|sas|inc|società benefit|societa benefit|branch of)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
