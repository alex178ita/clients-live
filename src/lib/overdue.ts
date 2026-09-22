// Every invoice that is open and past its due date — whoever it belongs to.
//
// The deal table answers "what are we billing against the contracts we won".
// That is the wrong lens for unpaid money: an invoice from a subscription that
// has since expired or been cancelled is exactly as unpaid as one from a live
// subscription, and an invoice Books never linked to a CRM deal
// (`zcrm_potential_id` empty) would otherwise never appear anywhere at all.
//
// So this ledger is built from the raw Books invoices, with no reference to any
// subscription or deal. A deal is attached only as a label, when there is one.

import { diffDays } from './dates';
import { invoiceTiming } from './invoiceTiming';
import type { BooksInvoice, OverdueBucket, OverdueEntry, OverdueLedger } from './types';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

const BUCKETS: { label: string; from: number; to: number }[] = [
  { label: '1–30 days', from: 1, to: 30 },
  { label: '31–60 days', from: 31, to: 60 },
  { label: '61–90 days', from: 61, to: 90 },
  { label: 'over 90 days', from: 91, to: Number.POSITIVE_INFINITY },
];

export interface OverdueOptions {
  /** Deals shown in the table, so an entry can say whether it is one of them. */
  dealIdsOnDashboard: Set<string>;
  now: string;
}

export function buildOverdue(invoices: BooksInvoice[], options: OverdueOptions): OverdueLedger {
  const { dealIdsOnDashboard, now } = options;
  const entries: OverdueEntry[] = [];

  for (const invoice of invoices) {
    if (invoice.status === 'void' || invoice.status === 'draft') continue;
    if (invoice.closedByCreditNote) continue; // cancelled and reissued: nothing is owed
    const timing = invoiceTiming(invoice, now);
    if (!timing.needsChasing) continue;

    entries.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      date: invoice.date,
      dueDate: invoice.dueDate,
      total: round2(invoice.total),
      // What is still owed, net of any partial credit note.
      balance: round2(invoice.balance),
      daysOverdue: timing.days,
      label: timing.label,
      status: invoice.status,
      url: invoice.url,
      dealId: invoice.dealId,
      dealName: invoice.dealName,
      onDashboard: !!invoice.dealId && dealIdsOnDashboard.has(invoice.dealId),
    });
  }

  entries.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);

  const buckets: OverdueBucket[] = BUCKETS.map(({ label, from, to }) => {
    const slice = entries.filter((e) => e.daysOverdue >= from && e.daysOverdue <= to);
    return {
      label,
      fromDays: from,
      total: round2(slice.reduce((s, e) => s + e.balance, 0)),
      count: slice.length,
    };
  });

  const byCustomerMap = new Map<string, OverdueEntry[]>();
  for (const entry of entries) {
    const list = byCustomerMap.get(entry.customerId) ?? [];
    list.push(entry);
    byCustomerMap.set(entry.customerId, list);
  }
  const byCustomer = [...byCustomerMap.values()]
    .map((list) => ({
      customerId: list[0].customerId,
      customerName: list[0].customerName,
      total: round2(list.reduce((s, e) => s + e.balance, 0)),
      count: list.length,
      oldestDays: Math.max(...list.map((e) => e.daysOverdue)),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total: round2(entries.reduce((s, e) => s + e.balance, 0)),
    count: entries.length,
    oldestDays: entries.length > 0 ? entries[0].daysOverdue : 0,
    offDashboardTotal: round2(
      entries.filter((e) => !e.onDashboard).reduce((s, e) => s + e.balance, 0),
    ),
    offDashboardCount: entries.filter((e) => !e.onDashboard).length,
    buckets,
    byCustomer,
    invoices: entries,
  };
}

/**
 * Open balances past due, by the month they were due in. This is what paints
 * the amber part of each past cash bar, and it deliberately counts invoices the
 * deal table never shows.
 */
export function overdueByMonth(ledger: OverdueLedger): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of ledger.invoices) {
    const due = entry.dueDate ?? entry.date;
    if (!due) continue;
    const month = due.slice(0, 7);
    map.set(month, round2((map.get(month) ?? 0) + entry.balance));
  }
  return map;
}

/** Days between the due date and today, for a quick check outside the ledger. */
export function daysPastDue(dueDate: string | null, now: string): number {
  if (!dueDate) return 0;
  return Math.max(0, diffDays(dueDate, now));
}
