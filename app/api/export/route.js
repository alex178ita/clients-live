import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { isAuthorised } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLUMNS = [
  { header: 'Alert', key: 'alert', width: 7 },
  { header: 'Client', key: 'clientName', width: 40 },
  { header: 'Kleecks status', key: 'statusLabel', width: 15 },
  { header: 'Channel', key: 'channel', width: 11 },
  { header: 'Partner', key: 'partner', width: 30 },
  { header: 'Owner', key: 'owner', width: 18 },
  { header: 'Licence start', key: 'licenceStart', width: 14 },
  { header: 'Licence end', key: 'licenceEnd', width: 14 },
  { header: 'Closing date', key: 'closingDate', width: 14 },
  { header: 'Amount (last licence deal)', key: 'amount', width: 24 },
  { header: 'Total won amount', key: 'totalWonAmount', width: 18 },
  { header: 'Licence deals', key: 'licenceDeals', width: 13 },
  { header: 'Licence lost', key: 'lostLabel', width: 13 },
  { header: 'Domain checked', key: 'domain', width: 36 },
  { header: 'Domain from', key: 'domainSource', width: 13 },
  { header: 'Signals found', key: 'signals', width: 60 },
  { header: 'Last deal', key: 'lastDealName', width: 42 }
];

const GREEN = 'FF107C41';
const RED = 'FFC00000';
const AMBER = 'FFB26B00';

export async function POST(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const meta = body.meta || {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kleecks';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Won clients', {
    views: [{ state: 'frozen', ySplit: 5 }]
  });

  sheet.mergeCells('A1:E1');
  sheet.getCell('A1').value = 'Won Clients & Kleecks Live Status';
  sheet.getCell('A1').font = { size: 16, bold: true };

  sheet.mergeCells('A2:E2');
  sheet.getCell('A2').value = 'v.0.1 - Beta for testing';
  sheet.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF777777' } };

  sheet.mergeCells('A3:J3');
  sheet.getCell('A3').value =
    `Exported ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome' })}` +
    (meta.yearFrom ? ` — licence years ${meta.yearFrom}–${meta.yearTo}` : '') +
    (meta.filterNote ? ` — ${meta.filterNote}` : '');
  sheet.getCell('A3').font = { size: 10, color: { argb: 'FF777777' } };

  sheet.getRow(4).height = 6;

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const headerRow = sheet.getRow(5);
  COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF222222' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  headerRow.height = 26;

  for (const row of rows) {
    const status = row.live && row.live.status;
    const added = sheet.addRow({
      alert: row.alert ? '▲' : '',
      clientName: row.clientName,
      statusLabel: status === 'live' ? 'live' : status === 'offline' ? 'offline' : 'n/d',
      channel: row.channel,
      partner: row.partner || '',
      owner: row.owner || '',
      licenceStart: row.licenceStart || '',
      licenceEnd: row.licenceEnd || '',
      closingDate: row.closingDate || '',
      amount: row.amount || 0,
      totalWonAmount: row.totalWonAmount || 0,
      licenceDeals: row.licenceDeals || 0,
      lostLabel: row.lost ? 'Yes' : 'No',
      domain: row.domain || '',
      domainSource: row.domainSource || '',
      signals: row.live && row.live.signals && row.live.signals.length
        ? row.live.signals.join(' | ')
        : (row.live && row.live.reason) || '',
      lastDealName: row.lastDealName || ''
    });

    const colour = status === 'live' ? GREEN : status === 'offline' ? RED : AMBER;
    added.getCell('clientName').font = { bold: true, color: { argb: colour } };
    added.getCell('statusLabel').font = { bold: true, color: { argb: colour } };
    if (row.alert) {
      added.getCell('alert').font = { bold: true, color: { argb: AMBER } };
      added.getCell('alert').alignment = { horizontal: 'center' };
    }
    added.getCell('amount').numFmt = '#,##0.00';
    added.getCell('totalWonAmount').numFmt = '#,##0.00';
    added.getCell('lostLabel').font = { color: { argb: row.lost ? RED : 'FF333333' } };
  }

  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COLUMNS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="won-clients-live-${stamp}.xlsx"`
    }
  });
}
