import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCreditNotes, buildDashboard, paymentDelayByCustomer } from '../src/lib/build.ts';
import { creditNotesByInvoice } from '../src/lib/normalise.ts';
import { overdueSummary } from '../src/lib/invoiceTiming.ts';
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
    date: '2026-03-01',
    dueDate: '2026-03-31',
    total: 1000,
    balance: 0,
    status: 'paid',
    lastPaymentDate: '2026-03-03',
    currency: 'EUR',
    url: null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
    ...patch,
  };
}

/** Shaped like the Zoho Books credit note detail: an `invoices[]` of links. */
function rawCreditNote(patch: Record<string, unknown> = {}) {
  return {
    creditnote_id: 'CN1',
    creditnote_number: 'CN-0001',
    date: '2026-03-05',
    status: 'closed',
    invoices: [{ invoice_id: 'I1', invoice_number: 'INV-1', amount: 1000 }],
    ...patch,
  };
}

test('a credit note covering the whole invoice marks it cancelled', () => {
  const [result] = applyCreditNotes(
    [invoice({})],
    creditNotesByInvoice([rawCreditNote()]),
  );
  assert.equal(result.closedByCreditNote, true);
  assert.equal(result.creditedAmount, 1000);
  assert.equal(result.creditNotes[0].number, 'CN-0001');
});

test('a partial credit note does not cancel the invoice', () => {
  const [result] = applyCreditNotes(
    [invoice({})],
    creditNotesByInvoice([
      rawCreditNote({ invoices: [{ invoice_id: 'I1', invoice_number: 'INV-1', amount: 250 }] }),
    ]),
  );
  assert.equal(result.closedByCreditNote, false);
  assert.equal(result.creditedAmount, 250);
});

test('draft and voided credit notes neutralise nothing', () => {
  for (const status of ['draft', 'void']) {
    const [result] = applyCreditNotes(
      [invoice({})],
      creditNotesByInvoice([rawCreditNote({ status })]),
    );
    assert.equal(result.closedByCreditNote, false, status);
    assert.equal(result.creditNotes.length, 0, status);
  }
});

test('a cancelled invoice is left out of the invoiced and collected totals', () => {
  const invoices = applyCreditNotes(
    [
      invoice({ invoiceId: 'I1', invoiceNumber: 'INV-1' }),
      invoice({ invoiceId: 'I2', invoiceNumber: 'INV-2', date: '2026-03-10', dueDate: '2026-04-09', lastPaymentDate: '2026-04-20' }),
    ],
    creditNotesByInvoice([rawCreditNote()]),
  );
  const payload = buildDashboard({ deals: [deal()], invoices, subscriptions: [], now: NOW });
  const row = payload.rows[0];
  // Both invoices are still listed, but only the live one is counted.
  assert.equal(row.invoices.length, 2);
  assert.equal(row.invoicedTotal, 1000);
  assert.equal(row.collectedTotal, 1000);
  assert.ok(payload.notices.some((n) => n.includes('closed in full by a credit note')));
});

test('a partial credit is netted off the invoiced total', () => {
  const invoices = applyCreditNotes(
    [invoice({})],
    creditNotesByInvoice([
      rawCreditNote({ invoices: [{ invoice_id: 'I1', invoice_number: 'INV-1', amount: 250 }] }),
    ]),
  );
  const payload = buildDashboard({ deals: [deal()], invoices, subscriptions: [], now: NOW });
  assert.equal(payload.rows[0].invoicedTotal, 750);
});

test('a cancelled invoice does not flatter the payment-time average', () => {
  // Settled two days after issue — but only because a credit note closed it.
  const invoices = applyCreditNotes(
    [invoice({ date: '2026-03-01', lastPaymentDate: '2026-03-03' })],
    creditNotesByInvoice([rawCreditNote()]),
  );
  const { perCustomer, companySample } = paymentDelayByCustomer(invoices);
  assert.equal(perCustomer.get('C1'), undefined);
  assert.equal(companySample, 0);
});

test('a cancelled invoice never appears as overdue', () => {
  const invoices = applyCreditNotes(
    [invoice({ balance: 1000, status: 'sent', dueDate: '2026-04-01', lastPaymentDate: null })],
    creditNotesByInvoice([rawCreditNote()]),
  );
  assert.equal(overdueSummary(invoices, NOW).count, 0);
});

test('a cancelled invoice is kept out of the monthly series', () => {
  const invoices = applyCreditNotes(
    [invoice({ date: '2026-03-01', lastPaymentDate: '2026-03-03' })],
    creditNotesByInvoice([rawCreditNote()]),
  );
  const payload = buildDashboard({ deals: [deal()], invoices, subscriptions: [], now: NOW });
  const march = payload.monthly.find((m) => m.month === '2026-03');
  assert.equal(march?.actualBilling, 0);
  assert.equal(march?.actualCash, 0);
});
