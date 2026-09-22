import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignSubscriptions, scoreSubscription } from '../src/lib/matchSubscription.ts';
import type { BillingSubscription, CrmDeal } from '../src/lib/types.ts';

// The Loro Piana case, with the figures Billing actually returns.
//
// One subscription covers both licence years: it was opened for 2025/26 and
// simply rolled forward, so its reference id and its line description still
// name 2025/26 while its current term bills 2026/27.

function licenceDeal(id: string, start: string, end: string, name: string): CrmDeal {
  return {
    id,
    dealName: name,
    stage: '8. Client Won',
    group: 'won',
    accountId: 'A1',
    accountName: 'LORO PIANA S.P.A.',
    finalClientName: null,
    ownerName: 'Peretti',
    csmName: null,
    amount: 64800,
    licence: 64800,
    delivery: 0,
    closingDate: start,
    licenceStartDate: start,
    licenceEndDate: end,
    duration: 12,
    durationBasis: 'Month',
    valuePerDuration: 5400,
    expectedDateOfFirstInvoice: start,
    paymentTermsDays: 30,
    advancePayment: 0,
    advanceTermsDays: null,
    advanceInvoiceDate: null,
    licenceModules: [],
    autoRenew: null,
    currency: 'EUR',
  };
}

const lastYear = licenceDeal('D25', '2025-09-21', '2026-09-20', 'Loro Piana - Licence 25/26');
const thisYear = licenceDeal('D26', '2026-09-21', '2027-09-20', 'Loro Piana - Licence 2026/2027');

const rolled: BillingSubscription = {
  subscriptionId: 'S321',
  subscriptionNumber: 'SUB-00321',
  name: 'Kleecks M',
  planName: 'Kleecks M',
  planCode: 'KGENMON',
  status: 'live',
  customerId: 'C1',
  customerName: 'LORO PIANA S.P.A.',
  dealId: null,
  dealName: null,
  amount: 5400,
  subTotal: 5400,
  interval: 1,
  intervalUnit: 'months',
  // Born in 2025, billing 2026/27 today.
  currentTermStartsAt: '2026-09-21',
  currentTermEndsAt: '2026-10-21',
  activatedAt: '2025-09-21',
  expiresAt: '2027-09-21',
  lastBillingAt: '2026-09-21',
  nextBillingAt: '2026-10-21',
  paymentTerms: 30,
  paymentTermsLabel: '30gg netto',
  referenceId: 'loropiana2526',
  salespersonName: 'Sauro Piva',
  matchedBy: null,
};

test('a rolled-forward subscription belongs to the licence year it is billing now', () => {
  const current = scoreSubscription(thisYear, rolled);
  const previous = scoreSubscription(lastYear, rolled);
  assert.ok(
    current.signals.some((s) => s.label.includes('billing this licence period right now')),
    'the current year should recognise it',
  );
  assert.ok(
    previous.signals.some((s) => s.label.includes('rolled past this licence year')),
    'last year should say it has moved on',
  );
  assert.ok(
    current.score > previous.score,
    `current ${current.score} should beat previous ${previous.score}`,
  );
});

test('the reference id naming the old year does not send it back there', () => {
  const { matched } = assignSubscriptions(
    [
      { deal: lastYear, customerId: 'C1' },
      { deal: thisYear, customerId: 'C1' },
    ],
    new Map([['C1', [rolled]]]),
    new Set(),
  );
  assert.equal(matched.get('D26')?.subscription.subscriptionNumber, 'SUB-00321');
  assert.equal(matched.has('D25'), false);
});
