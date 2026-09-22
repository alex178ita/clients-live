// What sits behind a single bar.
//
// Double-clicking a month in any chart exports these lines, so the figure on
// screen can always be taken apart into the deals and invoices that made it.

import { addDays, monthKey } from './dates';
import { invoiceTiming } from './invoiceTiming';
import type { BreakdownChart, BreakdownLine, DealRow, OverdueLedger } from './types';

function isLiveInvoice(invoice: { status: string; closedByCreditNote: boolean }): boolean {
  if (invoice.status === 'void' || invoice.status === 'draft') return false;
  // Cancelled by a credit note and usually reissued: it never was revenue.
  return !invoice.closedByCreditNote;
}

export interface BreakdownOptions {
  month: string; // yyyy-mm
  chart: BreakdownChart;
  companyAvgDays: number | null;
  now: string;
  /**
   * The overdue ledger, so the amber slice of a cash bar can be taken apart
   * into the same invoices it was drawn from — including those that belong to
   * no row, which is the whole point of keeping the ledger separate.
   */
  overdue?: OverdueLedger;
}

/**
 * For the billing chart a line lands in the month by its invoice date; for the
 * two cash charts by the date the money is expected or arrived — which is what
 * the bar is measuring in each case.
 */
export function monthBreakdown(rows: DealRow[], options: BreakdownOptions): BreakdownLine[] {
  const { month, chart, companyAvgDays, now, overdue } = options;
  const lines: BreakdownLine[] = [];

  for (const row of rows) {
    const delay = row.avgPaymentDelayDays ?? companyAvgDays;

    // --- the plan -------------------------------------------------------
    for (const instalment of row.schedule.instalments) {
      const date =
        chart === 'billing'
          ? instalment.invoiceDate
          : chart === 'cash'
            ? instalment.dueDate
            : delay === null
              ? instalment.dueDate
              : addDays(instalment.invoiceDate, delay);
      if (monthKey(date) !== month) continue;
      lines.push({
        kind: 'planned',
        dealId: row.id,
        dealName: row.dealName,
        accountName: row.accountName,
        stage: row.stage,
        reference:
          instalment.kind === 'advance'
            ? 'Advance payment'
            : `Instalment ${instalment.seq}/${row.schedule.instalments.length}`,
        date,
        dueDate: instalment.dueDate,
        amount: instalment.amount,
        status: 'planned',
        note:
          chart === 'realistic' && delay !== null
            ? `invoice ${instalment.invoiceDate} + ${delay} days of typical delay`
            : chart === 'cash'
              ? `invoice ${instalment.invoiceDate} + payment terms`
              : '',
      });
    }

    // --- what actually happened ------------------------------------------
    for (const invoice of row.invoices) {
      if (!isLiveInvoice(invoice) || !invoice.date) continue;
      const timing = invoiceTiming(invoice, now);
      const netTotal = Math.round((invoice.total - invoice.creditedAmount) * 100) / 100;
      const paid = Math.round((netTotal - invoice.balance) * 100) / 100;

      if (chart === 'billing') {
        if (monthKey(invoice.date) !== month) continue;
        lines.push({
          kind: 'issued',
          dealId: row.id,
          dealName: row.dealName,
          accountName: row.accountName,
          stage: row.stage,
          reference: invoice.invoiceNumber,
          date: invoice.date,
          dueDate: invoice.dueDate,
          amount: netTotal,
          status: invoice.status,
          note:
            invoice.creditedAmount > 0
              ? `${timing.label} · net of credit note ${invoice.creditNotes
                  .map((c) => c.number)
                  .join(', ')}`
              : timing.label,
        });
        continue;
      }

      // Cash charts: money in, and money that should have come in.
      if (paid > 0.01) {
        const paidDate = invoice.lastPaymentDate ?? invoice.dueDate ?? invoice.date;
        if (monthKey(paidDate) === month) {
          lines.push({
            kind: 'collected',
            dealId: row.id,
            dealName: row.dealName,
            accountName: row.accountName,
            stage: row.stage,
            reference: invoice.invoiceNumber,
            date: paidDate,
            dueDate: invoice.dueDate,
            amount: paid,
            status: invoice.status,
            note: timing.label,
          });
        }
      }
      if (!overdue && invoice.balance > 0.01) {
        const due = invoice.dueDate ?? invoice.date;
        if (due && due < now && monthKey(due) === month) {
          lines.push({
            kind: 'overdue',
            dealId: row.id,
            dealName: row.dealName,
            accountName: row.accountName,
            stage: row.stage,
            reference: invoice.invoiceNumber,
            date: due,
            dueDate: invoice.dueDate,
            amount: invoice.balance,
            status: invoice.status,
            note: timing.label,
          });
        }
      }
    }
  }

  // The amber slice, straight from the ledger: it includes invoices from
  // subscriptions that have expired or been cancelled and invoices with no deal.
  if (overdue && chart !== 'billing') {
    const byDeal = new Map(rows.map((row) => [row.id, row]));
    for (const entry of overdue.invoices) {
      const due = entry.dueDate ?? entry.date;
      if (!due || monthKey(due) !== month) continue;
      const row = entry.dealId ? byDeal.get(entry.dealId) : undefined;
      lines.push({
        kind: 'overdue',
        dealId: entry.dealId ?? '',
        dealName: row?.dealName ?? entry.dealName ?? '(no deal in the CRM)',
        accountName: row?.accountName ?? entry.customerName,
        stage: row?.stage ?? '(not in this table)',
        reference: entry.invoiceNumber,
        date: due,
        dueDate: entry.dueDate,
        amount: entry.balance,
        status: entry.status,
        note: row ? entry.label : `${entry.label} · ${entry.customerName}`,
      });
    }
  }

  const order: Record<BreakdownLine['kind'], number> = {
    collected: 0,
    overdue: 1,
    issued: 2,
    planned: 3,
  };
  return lines.sort(
    (a, b) => order[a.kind] - order[b.kind] || b.amount - a.amount || a.dealName.localeCompare(b.dealName),
  );
}

export function breakdownTotals(lines: BreakdownLine[]): Record<BreakdownLine['kind'], number> {
  const totals: Record<BreakdownLine['kind'], number> = {
    planned: 0,
    issued: 0,
    collected: 0,
    overdue: 0,
  };
  for (const line of lines) totals[line.kind] += line.amount;
  for (const key of Object.keys(totals) as BreakdownLine['kind'][]) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }
  return totals;
}
