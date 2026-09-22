// The overdue ledger as a workbook: one sheet per invoice, one per customer.
//
// Not filtered by the dashboard's own filters. What is owed is owed whether or
// not its deal is in the current view — or in the CRM at all.

import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getDashboard } from '@/lib/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DATE = 'dd/mm/yyyy';
const MONEY = '#,##0.00';

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

  const payload = await getDashboard();
  const ledger = payload.overdue;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kleecks BI — Won Deals & Billing Plan';
  wb.created = new Date();

  // --- invoices ----------------------------------------------------------
  const sheet = wb.addWorksheet('Past due');
  const title = sheet.addRow(['Invoices past due — all of Zoho Books']);
  title.font = { bold: true, size: 13 };
  sheet.addRow([
    `${ledger.count} invoice(s), ${ledger.total.toFixed(2)} EUR owed, oldest ${ledger.oldestDays} days · ` +
      `generated ${new Date().toLocaleString('en-GB')}`,
  ]).font = { color: { argb: 'FF808080' }, size: 9 };
  sheet.addRow([
    'Subscriptions are not consulted: invoices from expired or cancelled subscriptions, and invoices with no CRM deal, are included.',
  ]).font = { color: { argb: 'FF808080' }, size: 9 };
  sheet.addRow([]);

  for (const bucket of ledger.buckets) {
    if (bucket.count === 0) continue;
    const row = sheet.addRow([bucket.label, bucket.total, `${bucket.count} invoice(s)`]);
    row.getCell(2).numFmt = MONEY;
  }
  sheet.addRow([]);

  const header = sheet.addRow([
    'Customer',
    'Invoice',
    'Issued',
    'Due date',
    'Days overdue',
    'Invoice total',
    'Still owed',
    'Books status',
    'Deal',
    'In the dashboard table',
    'Link',
  ]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1116' } };
  sheet.views = [{ state: 'frozen', ySplit: header.number }];
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: 11 },
  };

  for (const invoice of ledger.invoices) {
    const row = sheet.addRow([
      invoice.customerName,
      invoice.invoiceNumber,
      toDate(invoice.date),
      toDate(invoice.dueDate),
      invoice.daysOverdue,
      invoice.total,
      invoice.balance,
      invoice.status,
      invoice.dealName ?? '',
      invoice.onDashboard ? 'yes' : 'no',
      invoice.url ?? '',
    ]);
    if (invoice.daysOverdue > 90) row.font = { color: { argb: 'FFC00000' } };
    else if (invoice.daysOverdue > 60) row.font = { color: { argb: 'FFB06000' } };
  }

  sheet.getColumn(3).numFmt = DATE;
  sheet.getColumn(4).numFmt = DATE;
  sheet.getColumn(6).numFmt = MONEY;
  sheet.getColumn(7).numFmt = MONEY;
  [34, 18, 12, 12, 14, 16, 16, 14, 38, 20, 46].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  // --- by customer -------------------------------------------------------
  const byCustomer = wb.addWorksheet('By customer');
  const ch = byCustomer.addRow(['Customer', 'Owed', 'Invoices', 'Oldest (days)']);
  ch.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1116' } };
  byCustomer.views = [{ state: 'frozen', ySplit: 1 }];
  for (const customer of ledger.byCustomer) {
    byCustomer.addRow([customer.customerName, customer.total, customer.count, customer.oldestDays]);
  }
  byCustomer.getColumn(2).numFmt = MONEY;
  [40, 18, 12, 16].forEach((width, index) => {
    byCustomer.getColumn(index + 1).width = width;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="overdue-invoices.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
