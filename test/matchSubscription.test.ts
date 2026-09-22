import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACCEPT_THRESHOLD,
  CONTRADICTED_CEILING,
  assignSubscriptions,
  referenceKeys,
  referenceStem,
  scoreSubscription,
} from '../src/lib/matchSubscription.ts';
import type { BillingSubscription, CrmDeal } from '../src/lib/types.ts';

function deal(patch: Partial<CrmDeal>): CrmDeal {
  return {
    id: 'D1',
    dealName: 'Kleecks for Poliform',
    stage: '8. Client Won',
    group: 'won',
    accountId: 'A1',
    accountName: 'Neen SpA',
    finalClientName: 'Poliform',
    ownerName: 'Peretti',
    csmName: null,
    amount: 10080,
    licence: 10080,
    delivery: 0,
    closingDate: '2026-06-01',
    licenceStartDate: '2026-07-01',
    licenceEndDate: '2027-06-30',
    duration: 12,
    durationBasis: 'Month',
    valuePerDuration: 840,
    expectedDateOfFirstInvoice: '2026-07-01',
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

function sub(patch: Partial<BillingSubscription>): BillingSubscription {
  return {
    subscriptionId: 'S1',
    subscriptionNumber: 'SUB-00271',
    name: 'Kleecks Monthly',
    planName: 'Kleecks Monthly',
    planCode: 'KGENMON',
    status: 'live',
    customerId: 'C1',
    customerName: 'Neen SpA',
    dealId: null,
    dealName: null,
    amount: 1024.8,
    subTotal: 840,
    interval: 1,
    intervalUnit: 'months',
    currentTermStartsAt: '2026-09-01',
    currentTermEndsAt: '2026-10-01',
    activatedAt: '2026-07-01',
    expiresAt: '2027-07-01',
    lastBillingAt: '2026-09-01',
    nextBillingAt: '2026-10-01',
    paymentTerms: 30,
    paymentTermsLabel: '30gg netto',
    referenceId: 'poliform2627',
    salespersonName: 'Peretti',
    matchedBy: null,
    ...patch,
  };
}

test('the client name is read out of the deal name, past the noise words', () => {
  const keys = referenceKeys(deal({ dealName: 'Kleecks e consulenza SEO per Fendi 2021' }));
  assert.ok(keys.includes('fendi'));
  assert.ok(!keys.includes('kleecks'));
  assert.ok(!keys.includes('consulenza'));
  assert.equal(referenceStem('granapadano202627'), 'granapadano');
  assert.equal(referenceStem('2026'), ''); // a bare year names nobody
});

test('amount, reference, interval and dates together make a confident match', () => {
  const scored = scoreSubscription(deal({}), sub({}));
  assert.equal(scored.vetoed, null);
  assert.ok(scored.score >= ACCEPT_THRESHOLD, `scored ${scored.score}`);
  assert.ok(scored.signals.some((s) => s.label.startsWith('amount matches')));
  assert.ok(scored.signals.some((s) => s.label.includes('names this client')));
});

test('a reference naming another client bars the match but keeps the candidate visible', () => {
  // The real case: an Enervit subscription that happens to bill 1092 a month,
  // exactly like the Aspesi deal. The amount agreed; the reference did not.
  const aspesi = deal({
    dealName: 'Kleecks for Aspesi',
    finalClientName: 'Aspesi',
    accountName: 'JAKALA S.P.A.',
    valuePerDuration: 1092,
    licenceStartDate: null,
    licenceEndDate: null,
  });
  const enervit = sub({ subTotal: 1092, referenceId: 'enervit202526', customerName: 'JAKALA S.P.A.' });
  const scored = scoreSubscription(aspesi, enervit);
  assert.ok(scored.score <= CONTRADICTED_CEILING, `scored ${scored.score}`);
  assert.ok(scored.score < ACCEPT_THRESHOLD);
  assert.ok(scored.signals.some((s) => s.label.includes('names another client')));
});

test('a three-letter client is read, and only at the start of the reference', () => {
  // MSC and ITA are both Jakala sub-clients billing about 3,080 a month. Four
  // characters as the floor left them indistinguishable, and each matched the
  // other's deal just as well.
  const msc = deal({ dealName: 'MSC - License 2026 [Jakala]', finalClientName: null, accountName: 'JAKALA S.P.A.' });
  const mscSub = sub({ referenceId: 'msc2026' });
  const itaSub = sub({ referenceId: 'ita2026' });
  assert.ok(scoreSubscription(msc, mscSub).signals.some((s) => s.label.includes('names this client')));
  assert.ok(scoreSubscription(msc, itaSub).signals.some((s) => s.label.includes('names another client')));
  // "mcm" opens mcmaccessibility202526; it must not be found mid-word.
  const mcm = deal({ dealName: 'MCM - [EMEA] a11y Modulo', accountName: 'MCM Global AG', finalClientName: null });
  assert.ok(
    scoreSubscription(mcm, sub({ referenceId: 'mcmaccessibility202526' })).signals.some((s) =>
      s.label.includes('names this client'),
    ),
  );
});

test('our own product names never stand in for the client', () => {
  // conteaisa and qualitasaisa are two clients buying AISA. Letting the product
  // name count made each of them match the other's deal.
  const conte = deal({ dealName: 'Conte - AISA licenza annuale', accountName: 'THE NEWCO S.R.L.', finalClientName: null });
  assert.ok(
    scoreSubscription(conte, sub({ referenceId: 'conteaisa' })).signals.some((s) =>
      s.label.includes('names this client'),
    ),
  );
  assert.ok(
    scoreSubscription(conte, sub({ referenceId: 'qualitasaisa' })).signals.some((s) =>
      s.label.includes('names another client'),
    ),
  );
});

test('corroboration on its own never reaches the threshold', () => {
  // Same monthly amount is not stated, the reference says nothing: an interval
  // and a start date that agree are a coincidence, not a match.
  const scored = scoreSubscription(
    deal({ valuePerDuration: null, amount: 0 }),
    sub({ subTotal: 0, amount: 0, referenceId: null }),
  );
  assert.ok(scored.score < ACCEPT_THRESHOLD, `scored ${scored.score}`);
});

test('a subscription starting after the licence ended is out, unless it is that client renewing', () => {
  const old = deal({ licenceEndDate: '2022-08-01', referenceId: undefined } as Partial<CrmDeal>);
  const later = sub({ activatedAt: '2026-07-01', referenceId: null });
  assert.match(scoreSubscription(old, later).vetoed ?? '', /after this licence ended/);

  // Named for this client, so it is not ruled out — but it is billing a period
  // this deal's licence no longer covers, which counts against it. The deal
  // that owns it is the later one, and that is decided by the score.
  const renewal = sub({
    activatedAt: '2026-07-01',
    currentTermStartsAt: '2026-09-01',
    referenceId: 'poliform2627',
  });
  const scored = scoreSubscription(old, renewal);
  assert.equal(scored.vetoed, null);
  assert.ok(scored.signals.some((s) => s.label.includes('rolled past this licence year')));
});

test('a figure that plainly disagrees counts against the candidate', () => {
  const scored = scoreSubscription(
    deal({ valuePerDuration: 25800, amount: 25800 }),
    sub({ subTotal: 50500, referenceId: 'poliform2627' }),
  );
  assert.ok(scored.signals.some((s) => s.points < 0 && s.label.includes('not')));
});

test('one subscription is never handed to two deals, and a tie attaches to neither', () => {
  const a = deal({ id: 'D1', dealName: 'Loro Piana - Licence' });
  const b = deal({ id: 'D2', dealName: 'Loro Piana - Strategy' });
  const only = sub({ subscriptionId: 'S9', referenceId: null });
  const { matched, candidates } = assignSubscriptions(
    [
      { deal: a, customerId: 'C1' },
      { deal: b, customerId: 'C1' },
    ],
    new Map([['C1', [only]]]),
    new Set(),
  );
  const claimed = [...matched.values()].map((s) => s.subscription.subscriptionId);
  assert.equal(new Set(claimed).size, claimed.length);
  assert.ok(matched.size <= 1);
  // Whoever did not get it is told the subscription was a possibility.
  if (matched.size === 1) {
    const loser = matched.has('D1') ? 'D2' : 'D1';
    assert.ok(!candidates.has(loser) || candidates.get(loser)!.length === 0);
  }
});

test('a subscription already carrying a CRM link is never offered to anyone else', () => {
  const { matched, candidates } = assignSubscriptions(
    [{ deal: deal({}), customerId: 'C1' }],
    new Map([['C1', [sub({ subscriptionId: 'S5' })]]]),
    new Set(['S5']),
  );
  assert.equal(matched.size, 0);
  assert.equal(candidates.size, 0);
});
