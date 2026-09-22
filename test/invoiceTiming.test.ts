import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averageDaysLate, invoiceTiming, overdueSummary } from '../src/lib/invoiceTiming.ts';
import type { BooksInvoice } from '../src/lib/types.ts';

const TODAY = '2026-09-22';

function invoice(patch: Partial<BooksInvoice>): BooksInvoice {
  return {
    invoiceId: 'I1',
    invoiceNumber: 'INV26-001',
    dealId: 'D1',
    dealName: 'Deal',
    customerId: 'C1',
    customerName: 'Acme',
    date: '2026-06-01',
    dueDate: '2026-07-01',
    total: 1000,
    balance: 0,
    status: 'paid',
    lastPaymentDate: null,
    currency: 'EUR',
    url: null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
    ...patch,
  };
}

test('an open invoice past its due date is overdue, counted from the due date', () => {
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-08-13', balance: 1000, status: 'sent', lastPaymentDate: null }),
    TODAY,
  );
  assert.equal(timing.state, 'overdue');
  assert.equal(timing.days, 40);
  assert.equal(timing.label, '40 days overdue');
  assert.equal(timing.needsChasing, true);
});

test('Books calling it "sent" does not hide an overdue invoice', () => {
  // This is the case that prompted the change: Books leaves the status at
  // "sent" and only the dates reveal that it is late.
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-09-01', balance: 500, status: 'sent' }),
    TODAY,
  );
  assert.equal(timing.state, 'overdue');
  assert.equal(timing.days, 21);
});

test('an open invoice not yet due counts down', () => {
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-10-02', balance: 1000, status: 'sent' }),
    TODAY,
  );
  assert.equal(timing.state, 'due');
  assert.equal(timing.label, 'due in 10 days');
  assert.equal(timing.needsChasing, false);
});

test('due exactly today is neither overdue nor chasing', () => {
  const timing = invoiceTiming(invoice({ dueDate: TODAY, balance: 1000, status: 'sent' }), TODAY);
  assert.equal(timing.state, 'due-today');
  assert.equal(timing.needsChasing, false);
});

test('a paid invoice is measured against its due date, not against today', () => {
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-07-01', balance: 0, lastPaymentDate: '2026-07-16' }),
    TODAY,
  );
  assert.equal(timing.state, 'paid-late');
  assert.equal(timing.days, 15);
  assert.equal(timing.label, 'paid 15 days late');
  assert.equal(timing.needsChasing, false);
});

test('a paid invoice settled early says so', () => {
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-07-01', balance: 0, lastPaymentDate: '2026-06-24' }),
    TODAY,
  );
  assert.equal(timing.state, 'paid-on-time');
  assert.equal(timing.label, 'paid 7 days early');
});

test('one day reads as singular', () => {
  const timing = invoiceTiming(
    invoice({ dueDate: '2026-09-21', balance: 10, status: 'sent' }),
    TODAY,
  );
  assert.equal(timing.label, '1 day overdue');
});

test('an invoice with no due date is not called late', () => {
  const timing = invoiceTiming(invoice({ dueDate: null, balance: 1000, status: 'sent' }), TODAY);
  assert.equal(timing.state, 'no-due-date');
  assert.equal(timing.needsChasing, false);
});

test('average days late is positive for a habitually late payer', () => {
  const { averageDays, sample } = averageDaysLate(
    [
      invoice({ invoiceId: 'a', dueDate: '2026-03-01', lastPaymentDate: '2026-03-11' }), // +10
      invoice({ invoiceId: 'b', dueDate: '2026-04-01', lastPaymentDate: '2026-04-21' }), // +20
      invoice({ invoiceId: 'c', dueDate: '2026-05-01', lastPaymentDate: '2026-04-29' }), // -2
      invoice({ invoiceId: 'd', dueDate: '2026-06-01', balance: 900, status: 'sent' }), // open, ignored
    ],
    TODAY,
  );
  assert.equal(sample, 3);
  assert.equal(averageDays, 9); // (10 + 20 - 2) / 3 = 9.33 -> 9
});

test('void and draft invoices are left out of the averages and the chasing list', () => {
  const { sample } = averageDaysLate(
    [invoice({ status: 'void', lastPaymentDate: '2026-08-01' })],
    TODAY,
  );
  assert.equal(sample, 0);

  const summary = overdueSummary(
    [
      invoice({ invoiceId: 'x', dueDate: '2026-08-01', balance: 1000, status: 'sent' }),
      invoice({ invoiceId: 'y', dueDate: '2026-01-01', balance: 500, status: 'draft' }),
    ],
    TODAY,
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.amount, 1000);
  assert.equal(summary.worstDays, 52);
});
