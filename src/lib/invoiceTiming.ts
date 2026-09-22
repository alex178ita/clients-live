// How an invoice sits against its own due date.
//
// Zoho Books keeps a `status` field, but it is not a reliable way to see
// lateness: an invoice can sit at "sent" with its due date well past, and a
// "paid" one says nothing about whether it was paid on time. So we work it out
// from the dates we have — due date, balance and payment date — and treat the
// Books status as a label rather than as the truth.

import { diffDays } from './dates';
import type { BooksInvoice } from './types';

export type InvoiceTimingState =
  | 'paid-on-time'
  | 'paid-late'
  | 'overdue'
  | 'due'
  | 'due-today'
  | 'no-due-date';

export interface InvoiceTiming {
  state: InvoiceTimingState;
  /** Days late (positive) or days remaining (positive), depending on state. */
  days: number;
  /** Ready-made label, e.g. "42 days overdue". */
  label: string;
  /** True when this needs chasing: still open and past due. */
  needsChasing: boolean;
}

const OPEN_THRESHOLD = 0.01;

function plural(days: number): string {
  return days === 1 ? 'day' : 'days';
}

export function invoiceTiming(invoice: BooksInvoice, today: string): InvoiceTiming {
  const settled = invoice.balance <= OPEN_THRESHOLD;

  if (!invoice.dueDate) {
    return {
      state: 'no-due-date',
      days: 0,
      label: settled ? 'paid' : 'no due date',
      needsChasing: false,
    };
  }

  if (settled) {
    // Paid: measure the payment against the due date. With no payment date
    // recorded we cannot say, so we treat it as on time rather than invent one.
    if (!invoice.lastPaymentDate) {
      return { state: 'paid-on-time', days: 0, label: 'paid', needsChasing: false };
    }
    const late = diffDays(invoice.dueDate, invoice.lastPaymentDate);
    if (late > 0) {
      return {
        state: 'paid-late',
        days: late,
        label: `paid ${late} ${plural(late)} late`,
        needsChasing: false,
      };
    }
    return {
      state: 'paid-on-time',
      days: Math.abs(late),
      label: late === 0 ? 'paid on the due date' : `paid ${Math.abs(late)} ${plural(Math.abs(late))} early`,
      needsChasing: false,
    };
  }

  // Still open: measure today against the due date.
  const overdueBy = diffDays(invoice.dueDate, today);
  if (overdueBy > 0) {
    return {
      state: 'overdue',
      days: overdueBy,
      label: `${overdueBy} ${plural(overdueBy)} overdue`,
      needsChasing: true,
    };
  }
  if (overdueBy === 0) {
    return { state: 'due-today', days: 0, label: 'due today', needsChasing: false };
  }
  const inDays = Math.abs(overdueBy);
  return {
    state: 'due',
    days: inDays,
    label: `due in ${inDays} ${plural(inDays)}`,
    needsChasing: false,
  };
}

/**
 * Average days between due date and payment for the invoices of one deal that
 * have actually been settled. Positive means habitually late.
 * This is about the due date; the payment delay used by the realistic cash flow
 * chart is measured from the invoice date instead.
 */
export function averageDaysLate(invoices: BooksInvoice[], today: string): {
  averageDays: number | null;
  sample: number;
} {
  const values: number[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'void' || invoice.status === 'draft') continue;
    if (invoice.closedByCreditNote) continue; // cancelled and reissued: no money moved
    const timing = invoiceTiming(invoice, today);
    if (timing.state === 'paid-late') values.push(timing.days);
    else if (timing.state === 'paid-on-time' && invoice.lastPaymentDate) values.push(-timing.days);
  }
  if (values.length === 0) return { averageDays: null, sample: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { averageDays: Math.round(mean), sample: values.length };
}

/** Totals for the invoices of one deal that are open and past due. */
export function overdueSummary(invoices: BooksInvoice[], today: string): {
  count: number;
  amount: number;
  worstDays: number;
} {
  let count = 0;
  let amount = 0;
  let worstDays = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'void' || invoice.status === 'draft') continue;
    if (invoice.closedByCreditNote) continue; // cancelled and reissued: no money moved
    const timing = invoiceTiming(invoice, today);
    if (!timing.needsChasing) continue;
    count += 1;
    amount += invoice.balance;
    worstDays = Math.max(worstDays, timing.days);
  }
  return { count, amount: Math.round(amount * 100) / 100, worstDays };
}
