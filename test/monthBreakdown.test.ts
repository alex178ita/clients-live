import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDashboard } from '../src/lib/build.ts';
import { breakdownTotals, monthBreakdown } from '../src/lib/monthBreakdown.ts';
import type { BooksInvoice, CrmDeal } from '../src/lib/types.ts';

const NOW = '2026-09-22';

function deal(patch: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'D1',
    dealName: 'Acme - Licence 2026',
    stage: '8. Client Won',
    group: 'won',
    accountId: 'A1',
    accountName: 'Acme SpA',
    finalClientName: null,
    ownerName: 'Peretti',
    csmName: null,
    amount: 12000,
    licence: 12000,
    delivery: 0,
    closingDate: '2026-01-01',
    licenceStartDate: '2026-01-01',
    licenceEndDate: '2026-12-31',
    duration: 12,
    durationBasis: 'Month',
    valuePerDuration: 1000,
    expectedDateOfFirstInvoice: '2026-01-10',
    paymentTermsDays: 30,
    advancePayment: 0,
    advanceTermsDays: null,
    advanceInvoiceDate: null,
    licenceModules: [],
    autoRenew: null,
    currency: 'EUR',
    ...patch,
  };
}

function invoice(patch: Partial<BooksInvoice>): BooksInvoice {
  return {
    invoiceId: 'I1',
    invoiceNumber: 'INV-1',
    dealId: 'D1',
    dealName: 'Acme - Licence 2026',
    customerId: 'C1',
    customerName: 'Acme SpA',
    date: '2026-06-01',
    dueDate: '2026-07-01',
    total: 1000,
    balance: 0,
    status: 'paid',
    lastPaymentDate: '2026-07-05',
    currency: 'EUR',
    url: null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
    ...patch,
  };
}

function rowsFor(invoices: BooksInvoice[]) {
  return buildDashboard({ deals: [deal()], invoices, subscriptions: [], now: NOW }).rows;
}

test('an unpaid invoice whose due date has passed becomes overdue cash in that month', () => {
  const payload = buildDashboard({
    deals: [deal()],
    invoices: [
      invoice({ invoiceId: 'a', dueDate: '2026-05-10', balance: 1000, status: 'sent', lastPaymentDate: null }),
    ],
    subscriptions: [],
    now: NOW,
  });
  const may = payload.monthly.find((m) => m.month === '2026-05');
  assert.equal(may?.overdueCash, 1000);
  assert.equal(may?.actualCash, 0);
});

test('an unpaid invoice not yet due is not counted as overdue', () => {
  const payload = buildDashboard({
    deals: [deal()],
    invoices: [
      invoice({ invoiceId: 'b', dueDate: '2026-12-10', balance: 1000, status: 'sent', lastPaymentDate: null }),
    ],
    subscriptions: [],
    now: NOW,
  });
  const december = payload.monthly.find((m) => m.month === '2026-12');
  assert.equal(december?.overdueCash ?? 0, 0);
});

test('a settled invoice lands in collected, in the month it was paid', () => {
  const payload = buildDashboard({
    deals: [deal()],
    invoices: [invoice({ invoiceId: 'c', dueDate: '2026-07-01', lastPaymentDate: '2026-08-05', balance: 0 })],
    subscriptions: [],
    now: NOW,
  });
  assert.equal(payload.monthly.find((m) => m.month === '2026-08')?.actualCash, 1000);
  assert.equal(payload.monthly.find((m) => m.month === '2026-08')?.overdueCash, 0);
});

test('the cash breakdown of a month lists the plan, what was collected and what is past due', () => {
  const rows = rowsFor([
    invoice({ invoiceId: 'paid', invoiceNumber: 'INV-PAID', dueDate: '2026-05-01', lastPaymentDate: '2026-05-20', balance: 0 }),
    invoice({
      invoiceId: 'late',
      invoiceNumber: 'INV-LATE',
      date: '2026-04-01',
      dueDate: '2026-05-12',
      balance: 700,
      total: 700,
      status: 'sent',
      lastPaymentDate: null,
    }),
  ]);
  const lines = monthBreakdown(rows, {
    month: '2026-05',
    chart: 'cash',
    companyAvgDays: null,
    now: NOW,
  });
  const totals = breakdownTotals(lines);
  assert.equal(totals.collected, 1000);
  assert.equal(totals.overdue, 700);
  // The plan puts the instalment invoiced on 10 April into May, 30 days later.
  assert.equal(totals.planned, 1000);
  assert.equal(totals.issued, 0);
  assert.ok(lines.some((l) => l.kind === 'overdue' && l.reference === 'INV-LATE'));
  // Collected is listed before past due, which is how the bar is stacked.
  assert.equal(lines[0].kind, 'collected');
});

test('the billing breakdown uses invoice dates, not collection dates', () => {
  const rows = rowsFor([
    invoice({ invoiceId: 'x', invoiceNumber: 'INV-X', date: '2026-06-01', dueDate: '2026-07-01', lastPaymentDate: '2026-07-20', balance: 0 }),
  ]);
  const june = monthBreakdown(rows, { month: '2026-06', chart: 'billing', companyAvgDays: null, now: NOW });
  assert.ok(june.some((l) => l.kind === 'issued' && l.reference === 'INV-X'));
  const july = monthBreakdown(rows, { month: '2026-07', chart: 'billing', companyAvgDays: null, now: NOW });
  assert.ok(!july.some((l) => l.kind === 'issued'));
});

test('the realistic breakdown shifts the plan by the client delay and says so', () => {
  const rows = rowsFor([]);
  const lines = monthBreakdown(rows, {
    month: '2026-03',
    chart: 'realistic',
    companyAvgDays: 60,
    now: NOW,
  });
  // Instalment invoiced 10 January + 60 days = 11 March.
  assert.ok(lines.some((l) => l.kind === 'planned' && l.date === '2026-03-11'));
  assert.ok(lines[0].note.includes('60 days'));
});

test('void invoices stay out of the breakdown', () => {
  const rows = rowsFor([
    invoice({ invoiceId: 'v', invoiceNumber: 'INV-VOID', status: 'void', dueDate: '2026-05-01', lastPaymentDate: '2026-05-02' }),
  ]);
  const lines = monthBreakdown(rows, { month: '2026-05', chart: 'cash', companyAvgDays: null, now: NOW });
  assert.ok(!lines.some((l) => l.reference === 'INV-VOID'));
});
