import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { today } from '@/lib/dates';
import { DEFAULT_FILTERS, applyFilters, type FilterState } from '@/lib/filter';
import { breakdownTotals, monthBreakdown } from '@/lib/monthBreakdown';
import { getDashboard } from '@/lib/source';
import type { BreakdownChart } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DATE = 'dd/mm/yyyy';
const MONEY = '#,##0.00';

const CHART_TITLES: Record<BreakdownChart, string> = {
  billing: 'Billing plan',
  cash: 'Cash flow — payment terms',
  realistic: 'Cash flow — realistic',
};

const KIND_LABELS = {
  planned: 'Planned',
  issued: 'Issued (Books)',
  collected: 'Collected',
  overdue: 'Past due',
} as const;

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
  const month = typeof body?.month === 'string' ? body.month : '';
  const chart: BreakdownChart = ['billing', 'cash', 'realistic'].includes(body?.chart)
    ? body.chart
    : 'billing';

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'A month in yyyy-mm form is required.' }, { status: 400 });
  }

  const payload = await getDashboard();
  const rows = applyFilters(payload.rows, filters);
  const now = today();
  const lines = monthBreakdown(rows, {
    month,
    chart,
    companyAvgDays: payload.stats.companyAvgPaymentDelayDays,
    now,
    // Not filtered: money owed is money owed, whether or not its deal passed
    // the filters or exists in the CRM at all.
    overdue: payload.overdue,
  });
  const totals = breakdownTotals(lines);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kleecks BI — Won Deals & Billing Plan';
  wb.created = new Date();

  const sheet = wb.addWorksheet(month);

  const title = sheet.addRow([`${CHART_TITLES[chart]} — ${month}`]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([`${lines.length} line(s), generated ${new Date().toLocaleString('en-GB')}`]).font = {
    color: { argb: 'FF808080' },
    size: 9,
  };
  sheet.addRow([]);

  const summary = sheet.addRow(['Totals']);
  summary.font = { bold: true };
  for (const kind of ['planned', 'issued', 'collected', 'overdue'] as const) {
    if (totals[kind] === 0) continue;
    const row = sheet.addRow([KIND_LABELS[kind], totals[kind]]);
    row.getCell(2).numFmt = MONEY;
  }
  sheet.addRow([]);

  const header = sheet.addRow([
    'Kind',
    'Deal',
    'Account',
    'Stage',
    'Reference',
    'Date in this month',
    'Due date',
    'Amount',
    'Invoice status',
    'Note',
  ]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1116' } };
  sheet.views = [{ state: 'frozen', ySplit: header.number }];
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: 10 },
  };

  for (const line of lines) {
    const added = sheet.addRow([
      KIND_LABELS[line.kind],
      line.dealName,
      line.accountName ?? '',
      line.stage,
      line.reference,
      toDate(line.date),
      toDate(line.dueDate),
      line.amount,
      line.status,
      line.note,
    ]);
    if (line.kind === 'overdue') added.font = { color: { argb: 'FFC00000' } };
    if (line.kind === 'collected') added.font = { color: { argb: 'FF107C10' } };
  }

  sheet.getColumn(6).numFmt = DATE;
  sheet.getColumn(7).numFmt = DATE;
  sheet.getColumn(8).numFmt = MONEY;
  [16, 40, 26, 16, 22, 20, 14, 14, 16, 30].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${chart}-${month}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
