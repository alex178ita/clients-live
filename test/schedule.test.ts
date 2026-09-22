import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSchedule, scheduleTotal } from '../src/lib/schedule.ts';
import type { CrmDeal } from '../src/lib/types.ts';

function deal(patch: Partial<CrmDeal>): CrmDeal {
  return {
    id: 'x',
    dealName: 'Test',
    stage: '8. Client Won',
    group: 'won',
    accountId: null,
    accountName: 'Acme',
    finalClientName: null,
    ownerName: null,
    csmName: null,
    amount: 0,
    licence: 0,
    delivery: 0,
    closingDate: null,
    licenceStartDate: null,
    licenceEndDate: null,
    duration: null,
    durationBasis: null,
    valuePerDuration: null,
    expectedDateOfFirstInvoice: null,
    paymentTermsDays: null,
    advancePayment: 0,
    advanceTermsDays: null,
    advanceInvoiceDate: null,
    licenceModules: [],
    autoRenew: null,
    currency: 'EUR',
    ...patch,
  };
}

test('monthly licence: 12 equal instalments from the first invoice date', () => {
  // Loro Piana - Licence 2026/2027
  const schedule = buildSchedule(
    deal({
      amount: 64800,
      duration: 12,
      durationBasis: 'Month',
      valuePerDuration: 5400,
      expectedDateOfFirstInvoice: '2026-09-21',
      paymentTermsDays: 30,
    }),
  );
  assert.equal(schedule.instalments.length, 12);
  assert.equal(schedule.instalments[0].invoiceDate, '2026-09-21');
  assert.equal(schedule.instalments[0].dueDate, '2026-10-21');
  assert.equal(schedule.instalments[11].invoiceDate, '2027-08-21');
  assert.equal(scheduleTotal(schedule), 64800);
  assert.equal(schedule.warnings.length, 0);
});

test('half yearly: two instalments six months apart', () => {
  // Conte.it - License 2026/2027
  const schedule = buildSchedule(
    deal({
      amount: 27000,
      duration: 2,
      durationBasis: 'Half yearly',
      valuePerDuration: 13500,
      expectedDateOfFirstInvoice: '2026-07-22',
      paymentTermsDays: 30,
    }),
  );
  assert.deepEqual(
    schedule.instalments.map((i) => i.invoiceDate),
    ['2026-07-22', '2027-01-22'],
  );
  assert.equal(scheduleTotal(schedule), 27000);
});

test('quarterly: four instalments three months apart', () => {
  // Grana Padano | License | 2026-27
  const schedule = buildSchedule(
    deal({
      amount: 23000,
      duration: 4,
      durationBasis: 'Quarter',
      valuePerDuration: 5750,
      expectedDateOfFirstInvoice: '2026-08-03',
      paymentTermsDays: 30,
    }),
  );
  assert.deepEqual(
    schedule.instalments.map((i) => i.invoiceDate),
    ['2026-08-03', '2026-11-03', '2027-02-03', '2027-05-03'],
  );
  assert.equal(scheduleTotal(schedule), 23000);
});

test('bimonthly steps two months at a time', () => {
  const schedule = buildSchedule(
    deal({
      amount: 78000,
      duration: 2,
      durationBasis: 'Bimonthly',
      valuePerDuration: 39000,
      expectedDateOfFirstInvoice: '2026-01-15',
    }),
  );
  assert.deepEqual(
    schedule.instalments.map((i) => i.invoiceDate),
    ['2026-01-15', '2026-03-15'],
  );
});

test('empty Duration and Duration Basis fall back to a single invoice with warnings', () => {
  // Fendi - Feed Management (yearly license)
  const schedule = buildSchedule(
    deal({
      amount: 7000,
      expectedDateOfFirstInvoice: '2026-12-31',
    }),
  );
  assert.equal(schedule.instalments.length, 1);
  assert.equal(schedule.instalments[0].amount, 7000);
  assert.ok(schedule.warnings.some((w) => w.code === 'no-duration'));
  assert.ok(schedule.warnings.some((w) => w.code === 'no-basis'));
  assert.equal(schedule.inferred, true);
});

test('Value per Duration that does not reconcile with Amount is flagged and corrected', () => {
  // Bulgari - Ottimizzazione Landing Page 2024 Holiday Season
  const schedule = buildSchedule(
    deal({
      amount: 27000,
      duration: 1,
      durationBasis: 'Month',
      valuePerDuration: 30000,
      expectedDateOfFirstInvoice: '2024-12-13',
      paymentTermsDays: 60,
    }),
  );
  assert.equal(scheduleTotal(schedule), 27000);
  assert.ok(schedule.warnings.some((w) => w.code === 'amount-mismatch'));
});

test('"Fixed" with several instalments spreads over the licence period', () => {
  // RAI - OnCrawl 2025: Fixed, Duration 4, 12 months of licence
  const schedule = buildSchedule(
    deal({
      amount: 48000,
      duration: 4,
      durationBasis: 'Fixed',
      valuePerDuration: 12000,
      licenceStartDate: '2025-04-18',
      licenceEndDate: '2026-04-17',
      expectedDateOfFirstInvoice: '2025-04-18',
      paymentTermsDays: 60,
    }),
  );
  assert.deepEqual(
    schedule.instalments.map((i) => i.invoiceDate),
    ['2025-04-18', '2025-07-18', '2025-10-18', '2026-01-18'],
  );
  assert.equal(scheduleTotal(schedule), 48000);
  assert.equal(schedule.inferred, true);
});

test('advance payment becomes its own instalment with its own terms', () => {
  const schedule = buildSchedule(
    deal({
      amount: 100000,
      duration: 4,
      durationBasis: 'Quarter',
      valuePerDuration: 20000,
      advancePayment: 20000,
      advanceInvoiceDate: '2026-01-10',
      advanceTermsDays: 15,
      expectedDateOfFirstInvoice: '2026-02-01',
      paymentTermsDays: 60,
    }),
  );
  assert.equal(schedule.instalments[0].kind, 'advance');
  assert.equal(schedule.instalments[0].amount, 20000);
  assert.equal(schedule.instalments[0].dueDate, '2026-01-25');
  assert.equal(schedule.instalments[1].invoiceDate, '2026-02-01');
  assert.equal(schedule.instalments[1].dueDate, '2026-04-02');
  assert.equal(scheduleTotal(schedule), 100000);
});

test('month ends are clamped rather than rolling into the next month', () => {
  const schedule = buildSchedule(
    deal({
      amount: 3000,
      duration: 3,
      durationBasis: 'Month',
      expectedDateOfFirstInvoice: '2026-01-31',
    }),
  );
  assert.deepEqual(
    schedule.instalments.map((i) => i.invoiceDate),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  );
});

test('a deal with no usable date produces no schedule', () => {
  const schedule = buildSchedule(deal({ amount: 5000 }));
  assert.equal(schedule.instalments.length, 0);
  assert.equal(schedule.warnings[0].code, 'no-start-date');
});

test('a zero-amount deal produces no schedule', () => {
  const schedule = buildSchedule(deal({ amount: 0, expectedDateOfFirstInvoice: '2026-01-01' }));
  assert.equal(schedule.instalments.length, 0);
  assert.equal(schedule.warnings[0].code, 'zero-amount');
});
