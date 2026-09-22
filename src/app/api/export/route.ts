import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { buildMonthly } from '@/lib/build';
import { addDays, today } from '@/lib/dates';
import { DEFAULT_FILTERS, applyFilters, type FilterState } from '@/lib/filter';
import { invoiceTiming, overdueSummary } from '@/lib/invoiceTiming';
import { getDashboard } from '@/lib/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DATE = 'dd/mm/yyyy';
const MONEY = '#,##0.00';
const HEADER_FILL = 'FF0E1116';

function headerRow(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  row.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: row.number }];
  sheet.autoFilter = {
    from: { row: row.number, column: 1 },
    to: { row: row.number, column: headers.length },
  };
}

function autoWidth(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export async function POST(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const filters: FilterState = { ...DEFAULT_FILTERS, ...(body?.filters ?? {}) };

  const payload = await getDashboard();
  const rows = applyFilters(payload.rows, filters);
  const now = today();
  const monthly = buildMonthly(rows, {
    companyAvgDays: payload.stats.companyAvgPaymentDelayDays,
    now,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kleecks BI — Won Deals & Billing Plan';
  wb.created = new Date();

  /* ---------------------------------------------------------- Deals */
  const deals = wb.addWorksheet('Deals', { views: [{ state: 'frozen', ySplit: 1 }] });
  headerRow(deals, [
    'Deal',
    'Account',
    'Final client',
    'Stage',
    'Owner',
    'CSM',
    'Licence',
    'Professional Services',
    'Amount (net)',
    'Licence value',
    'Delivery value',
    'Licence start',
    'Licence end',
    'Closing date',
    'Duration',
    'Duration basis',
    'Value per duration',
    'Expected date of first invoice',
    'Payment terms (days)',
    'Advance payment',
    'Terms for advance payment (days)',
    'Invoice date for advance payment',
    'Last invoice date',
    'Last invoice amount',
    'Last invoice source',
    'Next invoice date',
    'Next invoice amount',
    'Next invoice source',
    'Invoiced to date (Books total)',
    'Collected',
    'Outstanding',
    'Subscription',
    'Subscription status',
    'Avg payment delay (days)',
    'Overdue invoices',
    'Overdue amount',
    'Worst overdue (days)',
    'Schedule warnings',
  ]);
  for (const row of rows) {
    deals.addRow([
      row.dealName,
      row.accountName ?? '',
      row.finalClientName ?? '',
      row.stage,
      row.ownerName ?? '',
      row.csmName ?? '',
      row.hasLicence ? 'Yes' : '',
      row.hasServices ? 'Yes' : '',
      row.amount,
      row.licence,
      row.delivery,
      toDate(row.licenceStartDate),
      toDate(row.licenceEndDate),
      toDate(row.closingDate),
      row.duration ?? '',
      row.durationBasis ?? '',
      row.valuePerDuration ?? '',
      toDate(row.expectedDateOfFirstInvoice),
      row.paymentTermsDays ?? '',
      row.advancePayment || '',
      row.advanceTermsDays ?? '',
      toDate(row.advanceInvoiceDate),
      toDate(row.lastInvoice?.date ?? null),
      row.lastInvoice?.amount ?? '',
      row.lastInvoice?.source ?? '',
      toDate(row.nextInvoice?.date ?? null),
      row.nextInvoice?.amount ?? '',
      row.nextInvoice?.source ?? '',
      row.invoicedTotal,
      row.collectedTotal,
      row.outstandingTotal,
      row.subscription?.subscriptionNumber ?? '',
      row.subscription?.status ?? '',
      row.avgPaymentDelayDays ?? '',
      overdueSummary(row.invoices, now).count || '',
      overdueSummary(row.invoices, now).amount || '',
      overdueSummary(row.invoices, now).worstDays || '',
      row.schedule.warnings.map((w) => w.message).join(' | '),
    ]);
  }
  [9, 10, 11, 17, 20, 24, 27, 29, 30, 31, 36].forEach((col) => {
    deals.getColumn(col).numFmt = MONEY;
  });
  [12, 13, 14, 18, 22, 23, 26].forEach((col) => {
    deals.getColumn(col).numFmt = DATE;
  });
  autoWidth(deals, [
    40, 26, 20, 16, 14, 16, 9, 20, 14, 14, 14, 13, 13, 13, 10, 15, 16, 22, 16, 14, 20, 20, 14, 14,
    12, 14, 14, 12, 22, 14, 14, 16, 16, 18, 16, 16, 20, 60,
  ]);

  /* --------------------------------------------------- Billing plan */
  const plan = wb.addWorksheet('Billing plan');
  headerRow(plan, [
    'Deal',
    'Account',
    'Stage',
    'Instalment',
    'Type',
    'Planned invoice date',
    'Planned collection date (terms)',
    'Realistic collection date',
    'Amount',
  ]);
  for (const row of rows) {
    const delay = row.avgPaymentDelayDays ?? payload.stats.companyAvgPaymentDelayDays;
    for (const item of row.schedule.instalments) {
      plan.addRow([
        row.dealName,
        row.accountName ?? '',
        row.stage,
        item.kind === 'advance' ? 'advance' : item.seq,
        item.kind,
        toDate(item.invoiceDate),
        toDate(item.dueDate),
        toDate(delay === null ? item.dueDate : addDays(item.invoiceDate, delay)),
        item.amount,
      ]);
    }
  }
  [6, 7, 8].forEach((col) => (plan.getColumn(col).numFmt = DATE));
  plan.getColumn(9).numFmt = MONEY;
  autoWidth(plan, [40, 26, 16, 12, 12, 20, 26, 24, 14]);

  /* ------------------------------------------------------- Invoices */
  const invoices = wb.addWorksheet('Invoices');
  headerRow(invoices, [
    'Deal',
    'Account',
    'Invoice number',
    'Invoice date',
    'Due date',
    'Total (Books)',
    'Balance',
    'Status',
    'Payment date',
    'Against due date',
    'Days late (+) / early (-)',
    'Needs chasing',
    'Credit note',
    'Credited amount',
    'Counted',
  ]);
  for (const row of rows) {
    for (const inv of row.invoices) {
      const timing = invoiceTiming(inv, now);
      // Signed so the column can be summed or averaged: + is late, - is early.
      const signedDays =
        timing.state === 'overdue' || timing.state === 'paid-late'
          ? timing.days
          : timing.state === 'paid-on-time'
            ? -timing.days
            : timing.state === 'due'
              ? -timing.days
              : 0;
      invoices.addRow([
        row.dealName,
        inv.customerName,
        inv.invoiceNumber,
        toDate(inv.date),
        toDate(inv.dueDate),
        inv.total,
        inv.balance,
        inv.status,
        toDate(inv.lastPaymentDate),
        inv.closedByCreditNote ? 'closed by credit note' : timing.label,
        inv.closedByCreditNote || timing.state === 'no-due-date' ? '' : signedDays,
        timing.needsChasing && !inv.closedByCreditNote ? 'Yes' : '',
        inv.creditNotes.map((c) => c.number).join(', '),
        inv.creditedAmount || '',
        inv.closedByCreditNote ? 'No — cancelled' : 'Yes',
      ]);
      const added = invoices.lastRow;
      if (added) {
        if (inv.closedByCreditNote) {
          added.font = { color: { argb: 'FF7A5FBF' }, strike: true };
        } else if (timing.needsChasing) {
          added.font = { color: { argb: 'FFC00000' } };
        }
      }
    }
  }
  [4, 5, 9].forEach((col) => (invoices.getColumn(col).numFmt = DATE));
  [6, 7, 14].forEach((col) => (invoices.getColumn(col).numFmt = MONEY));
  autoWidth(invoices, [40, 26, 16, 14, 14, 16, 14, 16, 14, 22, 24, 14, 18, 16, 16]);

  /* -------------------------------------------------- Subscriptions */
  const subs = wb.addWorksheet('Subscriptions');
  headerRow(subs, [
    'Deal',
    'Subscription',
    'Customer',
    'Plan',
    'Status',
    'Interval',
    'Current term start',
    'Current term end',
    'Last billing',
    'Next billing',
    'Amount (net)',
    'Payment terms',
    'Matched by',
  ]);
  for (const row of rows) {
    const sub = row.subscription;
    if (!sub) continue;
    subs.addRow([
      row.dealName,
      sub.subscriptionNumber,
      sub.customerName,
      sub.planName,
      sub.status,
      `${sub.interval} ${sub.intervalUnit}`,
      toDate(sub.currentTermStartsAt),
      toDate(sub.currentTermEndsAt),
      toDate(sub.lastBillingAt),
      toDate(sub.nextBillingAt),
      sub.subTotal,
      sub.paymentTermsLabel ?? sub.paymentTerms ?? '',
      sub.matchedBy ?? '',
    ]);
  }
  [7, 8, 9, 10].forEach((col) => (subs.getColumn(col).numFmt = DATE));
  subs.getColumn(11).numFmt = MONEY;
  autoWidth(subs, [40, 16, 26, 18, 14, 14, 18, 18, 14, 14, 14, 22, 22]);

  /* ---------------------------------------------------- Monthly view */
  const months = wb.addWorksheet('Monthly');
  headerRow(months, [
    'Month',
    'Planned invoicing',
    'Issued (Books)',
    'Expected collection (terms)',
    'Realistic collection',
    'Collected',
  ]);
  for (const point of monthly) {
    months.addRow([
      point.month,
      point.plannedBilling,
      point.actualBilling,
      point.plannedCash,
      point.realisticCash,
      point.actualCash,
    ]);
  }
  [2, 3, 4, 5, 6].forEach((col) => (months.getColumn(col).numFmt = MONEY));
  autoWidth(months, [12, 20, 18, 26, 22, 16]);

  /* ------------------------------------------------------------ Info */
  const info = wb.addWorksheet('Read me');
  autoWidth(info, [34, 90]);
  const lines: [string, string][] = [
    ['Report', 'Won Deals & Billing Plan — v.0.1 Beta for testing'],
    ['Generated', new Date().toLocaleString('en-GB')],
    ['Scope', filters.scope],
    ['Period basis', filters.basis],
    ['Period', `${filters.from || 'open'} → ${filters.to || 'open'}`],
    ['Search', filters.search || '—'],
    ['Deals included', String(rows.length)],
    ['', ''],
    [
      'Billing plan',
      'Built from the CRM Duration block: Duration x Value per Duration from the Expected Date of First Invoice, stepping by Duration Basis. The last instalment absorbs rounding so the plan always adds up to Amount.',
    ],
    [
      'Expected collection',
      'Each planned invoice date plus Payment Terms (number of days). The advance payment uses Terms for Advance Payment when set.',
    ],
    [
      'Realistic collection',
      `Each planned invoice date plus the average number of days that client actually took to settle their Books invoices. Clients with no settled invoice use the company average (${payload.stats.companyAvgPaymentDelayDays ?? 'n/a'} days over ${payload.stats.companyPaymentDelaySampleSize} invoices).`,
    ],
    [
      'Amounts',
      'CRM Amount and Value per Duration are always net of VAT. Books invoice totals include VAT where it applies, so "Invoiced to date" is not directly comparable with "Amount".',
    ],
    [
      'Invoice matching',
      'Books invoices are attached to a deal through the CRM link (zcrm_potential_id) written by Zoho. Invoices without that link do not appear under any deal.',
    ],
  ];
  for (const [key, value] of lines) {
    const row = info.addRow([key, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="won-deals-billing-plan-${now}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
