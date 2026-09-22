import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDashboard } from '../src/lib/build.ts';
import { buildOverdue, overdueByMonth } from '../src/lib/overdue.ts';
import type { BooksInvoice, CrmDeal } from '../src/lib/types.ts';

const NOW = '2026-06-15';

function invoice(patch: Partial<BooksInvoice>): BooksInvoice {
  return {
    invoiceId: 'I1',
    invoiceNumber: 'INV26-001',
    dealId: null,
    dealName: null,
    customerId: 'C1',
    customerName: 'Acme SpA',
    date: '2026-01-01',
    dueDate: '2026-01-31',
    total: 1220,
    balance: 1220,
    status: 'sent',
    lastPaymentDate: null,
    currency: 'EUR',
    url: null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
    ...patch,
  };
}

function deal(patch: Partial<CrmDeal>): CrmDeal {
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
    expectedDateOfFirstInvoice: '2026-01-01',
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

const on = { dealIdsOnDashboard: new Set(['D1']), now: NOW };

test('an invoice counts as overdue only once its due date has passed', () => {
  const ledger = buildOverdue(
    [
      invoice({ invoiceId: 'a', dueDate: '2026-01-31' }), // 135 days past
      invoice({ invoiceId: 'b', dueDate: '2026-07-31' }), // not due yet
      invoice({ invoiceId: 'c', dueDate: '2026-06-15' }), // due today
    ],
    on,
  );
  assert.equal(ledger.count, 1);
  assert.equal(ledger.invoices[0].invoiceId, 'a');
  assert.equal(ledger.invoices[0].daysOverdue, 135);
  assert.equal(ledger.total, 1220);
});

test('settled, void, draft and credit-noted invoices owe nothing', () => {
  const ledger = buildOverdue(
    [
      invoice({ invoiceId: 'paid', balance: 0, status: 'paid', lastPaymentDate: '2026-02-02' }),
      invoice({ invoiceId: 'void', status: 'void' }),
      invoice({ invoiceId: 'draft', status: 'draft' }),
      invoice({ invoiceId: 'credited', closedByCreditNote: true, creditedAmount: 1220 }),
    ],
    on,
  );
  assert.equal(ledger.count, 0);
  assert.equal(ledger.total, 0);
});

test('an invoice from outside the deal table is still owed, and is marked as such', () => {
  const ledger = buildOverdue(
    [
      invoice({ invoiceId: 'mine', dealId: 'D1', dealName: 'Acme - Licence 2026' }),
      // Books never linked this one — an expired subscription, say.
      invoice({ invoiceId: 'orphan', customerId: 'C9', customerName: 'Neen SpA', balance: 8500 }),
      // Linked, but to a deal that is not in this view.
      invoice({ invoiceId: 'elsewhere', dealId: 'D9', dealName: 'Old deal', balance: 500 }),
    ],
    on,
  );
  assert.equal(ledger.count, 3);
  assert.equal(ledger.total, 10220);
  assert.equal(ledger.offDashboardCount, 2);
  assert.equal(ledger.offDashboardTotal, 9000);
  assert.equal(ledger.invoices.find((i) => i.invoiceId === 'mine')?.onDashboard, true);
  assert.equal(ledger.invoices.find((i) => i.invoiceId === 'orphan')?.onDashboard, false);
});

test('ageing buckets and per-customer totals are sorted worst first', () => {
  const ledger = buildOverdue(
    [
      invoice({ invoiceId: 'a', customerId: 'C1', dueDate: '2026-06-01', balance: 100 }), // 14 d
      invoice({ invoiceId: 'b', customerId: 'C1', dueDate: '2026-04-20', balance: 200 }), // 56 d
      invoice({ invoiceId: 'c', customerId: 'C2', customerName: 'Beta', dueDate: '2025-01-01', balance: 900 }),
    ],
    on,
  );
  const buckets = Object.fromEntries(ledger.buckets.map((b) => [b.label, b.total]));
  assert.equal(buckets['1–30 days'], 100);
  assert.equal(buckets['31–60 days'], 200);
  assert.equal(buckets['over 90 days'], 900);
  assert.equal(ledger.byCustomer[0].customerName, 'Beta');
  assert.equal(ledger.byCustomer[0].total, 900);
  assert.equal(ledger.oldestDays, ledger.invoices[0].daysOverdue);
});

test('overdue is placed in the month it was due in', () => {
  const ledger = buildOverdue(
    [
      invoice({ invoiceId: 'a', dueDate: '2026-01-31', balance: 100 }),
      invoice({ invoiceId: 'b', dueDate: '2026-01-15', balance: 50 }),
      invoice({ invoiceId: 'c', dueDate: '2026-03-31', balance: 70 }),
    ],
    on,
  );
  const byMonth = overdueByMonth(ledger);
  assert.equal(byMonth.get('2026-01'), 150);
  assert.equal(byMonth.get('2026-03'), 70);
});

test('the dashboard counts overdue invoices that belong to no row', () => {
  const payload = buildDashboard({
    deals: [deal({})],
    invoices: [
      invoice({ invoiceId: 'row', dealId: 'D1', dueDate: '2026-02-28', balance: 1220 }),
      invoice({ invoiceId: 'orphan', dueDate: '2026-02-28', balance: 3000, customerId: 'C9' }),
    ],
    subscriptions: [],
    now: NOW,
  });
  assert.equal(payload.overdue.count, 2);
  assert.equal(payload.overdue.total, 4220);
  // Both land in the amber of February, even though only one has a deal row.
  const february = payload.monthly.find((m) => m.month === '2026-02');
  assert.equal(february?.overdueCash, 4220);
  assert.ok(payload.notices.some((n) => n.includes('belong to no deal in this table')));
});
