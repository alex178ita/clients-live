import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDashboard, paymentDelayByCustomer } from '../src/lib/build.ts';
import type { BillingSubscription, BooksInvoice, CrmDeal } from '../src/lib/types.ts';

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

function invoice(patch: Partial<BooksInvoice>): BooksInvoice {
  return {
    invoiceId: 'I1',
    invoiceNumber: 'INV26-001',
    dealId: 'D1',
    dealName: 'Acme - Licence 2026',
    customerId: 'C1',
    customerName: 'Acme SpA',
    date: '2026-01-01',
    dueDate: '2026-01-31',
    total: 1220,
    balance: 0,
    status: 'paid',
    lastPaymentDate: '2026-02-15',
    currency: 'EUR',
    url: null,
    creditNotes: [],
    creditedAmount: 0,
    closedByCreditNote: false,
    ...patch,
  };
}

function subscription(patch: Partial<BillingSubscription>): BillingSubscription {
  return {
    subscriptionId: 'S1',
    subscriptionNumber: 'SUB-001',
    name: 'Kleecks M',
    planName: 'Kleecks M',
    planCode: 'KGENMON',
    status: 'live',
    customerId: 'C1',
    customerName: 'Acme SpA',
    dealId: 'D1',
    dealName: 'Acme - Licence 2026',
    amount: 1220,
    subTotal: 1000,
    interval: 1,
    intervalUnit: 'months',
    currentTermStartsAt: '2026-06-01',
    currentTermEndsAt: '2026-07-01',
    activatedAt: '2026-01-01',
    expiresAt: '2027-01-01',
    lastBillingAt: '2026-06-01',
    nextBillingAt: '2026-07-01',
    paymentTerms: 30,
    paymentTermsLabel: '30gg netto',
    referenceId: 'acme2026',
    salespersonName: 'Peretti',
    matchedBy: null,
    ...patch,
  };
}

test('average payment delay is measured per customer on settled invoices only', () => {
  const { perCustomer, companyAvgDays } = paymentDelayByCustomer([
    invoice({ invoiceId: 'a', date: '2026-01-01', lastPaymentDate: '2026-02-10', balance: 0 }), // 40
    invoice({ invoiceId: 'b', date: '2026-02-01', lastPaymentDate: '2026-03-23', balance: 0 }), // 50
    invoice({ invoiceId: 'c', date: '2026-03-01', lastPaymentDate: null, balance: 1220, status: 'sent' }),
    invoice({ invoiceId: 'd', date: '2026-03-01', lastPaymentDate: '2026-03-10', balance: 0, status: 'void' }),
  ]);
  assert.equal(perCustomer.get('C1')?.avgDays, 45);
  assert.equal(perCustomer.get('C1')?.sample, 2);
  assert.equal(companyAvgDays, 45);
});

test('invoices and subscriptions attach to the deal through the CRM link', () => {
  const payload = buildDashboard({
    deals: [deal({})],
    invoices: [
      invoice({}),
      invoice({ invoiceId: 'I2', invoiceNumber: 'INV26-002', dealId: 'OTHER' }),
      invoice({ invoiceId: 'I3', invoiceNumber: 'INV26-003', dealId: null, dealName: null }),
    ],
    subscriptions: [subscription({})],
    now: '2026-06-15',
  });
  const row = payload.rows[0];
  assert.equal(row.invoices.length, 1);
  assert.equal(row.subscription?.subscriptionNumber, 'SUB-001');
  assert.equal(row.subscription?.matchedBy, 'crm-link');
  assert.equal(row.lastInvoice?.source, 'books');
  assert.equal(row.nextInvoice?.source, 'billing');
  assert.equal(row.nextInvoice?.date, '2026-07-01');
  assert.equal(row.nextInvoice?.amount, 1000);
  assert.ok(payload.notices.some((n) => n.includes('no CRM deal link')));
});

test('without a subscription the next invoice comes from the Duration plan', () => {
  const payload = buildDashboard({
    deals: [deal({})],
    invoices: [],
    subscriptions: [],
    now: '2026-06-15',
  });
  const row = payload.rows[0];
  assert.equal(row.subscription, null);
  assert.equal(row.nextInvoice?.source, 'duration');
  assert.equal(row.nextInvoice?.date, '2026-07-01');
  assert.equal(row.lastInvoice?.source, 'duration');
  assert.equal(row.lastInvoice?.date, '2026-06-01');
});

test('monthly series splits planned billing, terms-based cash and realistic cash', () => {
  const payload = buildDashboard({
    deals: [
      deal({
        duration: 2,
        valuePerDuration: 6000,
        amount: 12000,
        expectedDateOfFirstInvoice: '2026-01-10',
        paymentTermsDays: 30,
      }),
    ],
    // one settled invoice: paid 60 days after issue, so the realistic delay is 60 days
    invoices: [
      invoice({
        invoiceId: 'p',
        date: '2025-01-10',
        lastPaymentDate: '2025-03-11',
        balance: 0,
        total: 6000,
      }),
    ],
    subscriptions: [],
    now: '2026-06-15',
  });
  const byMonth = Object.fromEntries(payload.monthly.map((m) => [m.month, m]));
  assert.equal(byMonth['2026-01'].plannedBilling, 6000);
  assert.equal(byMonth['2026-02'].plannedBilling, 6000);
  // terms: 10 Jan + 30 days = 9 Feb; 10 Feb + 30 days = 12 Mar
  assert.equal(byMonth['2026-02'].plannedCash, 6000);
  assert.equal(byMonth['2026-03'].plannedCash, 6000);
  // realistic: 10 Jan + 60 days = 11 Mar; 10 Feb + 60 days = 11 Apr
  assert.equal(byMonth['2026-03'].realisticCash, 6000);
  assert.equal(byMonth['2026-04'].realisticCash, 6000);
});

test('a subscription without a CRM link is matched on its own signals', () => {
  const payload = buildDashboard({
    deals: [deal({})],
    invoices: [invoice({})],
    subscriptions: [subscription({ dealId: null, dealName: null })],
    now: '2026-06-15',
  });
  assert.equal(payload.rows[0].subscription?.matchedBy, 'scored');
  assert.ok((payload.rows[0].subscriptionMatch?.score ?? 0) >= 55);
  assert.ok(payload.notices.some((n) => n.includes('matched here on amount')));
  assert.equal(payload.stats.subscriptions.crmLinked, 0);
  assert.equal(payload.stats.subscriptions.matchedHere, 1);
  assert.equal(payload.stats.subscriptions.unresolved, 0);
});
