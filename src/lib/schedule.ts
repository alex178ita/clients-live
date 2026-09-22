// Pure billing-schedule engine.
//
// It turns the CRM "Duration" block of a deal (Duration, Duration Basis,
// Value per Duration, Advance Payment, Expected Date of First Invoice,
// Payment Terms) into a list of planned instalments with a planned invoice
// date and a planned collection date.
//
// No I/O here on purpose: this file is unit tested on its own.

import { addDays, addMonths, diffDays } from './dates';
import type { CrmDeal, DealSchedule, Instalment, ScheduleWarning } from './types';

/** Months between two instalments for each Duration Basis value. */
const BASIS_MONTHS: Record<string, number> = {
  month: 1,
  monthly: 1,
  bimonthly: 2,
  quarter: 3,
  quarterly: 3,
  'half yearly': 6,
  'half-yearly': 6,
  halfyearly: 6,
  yearly: 12,
  annual: 12,
};

export function basisToMonths(basis: string | null | undefined): number | null {
  if (!basis) return null;
  const key = basis.trim().toLowerCase();
  if (key === '-none-' || key === 'fixed' || key.startsWith('option')) return null;
  return BASIS_MONTHS[key] ?? null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** First invoice date: the explicit CRM field, then licence start, then closing date. */
export function scheduleStartDate(deal: CrmDeal): string | null {
  return deal.expectedDateOfFirstInvoice || deal.licenceStartDate || deal.closingDate || null;
}

export function buildSchedule(deal: CrmDeal): DealSchedule {
  const warnings: ScheduleWarning[] = [];
  const instalments: Instalment[] = [];

  const amount = Number(deal.amount) || 0;
  const advance = Math.max(0, Number(deal.advancePayment) || 0);
  const start = scheduleStartDate(deal);

  if (!start) {
    warnings.push({
      code: 'no-start-date',
      message:
        'No Expected Date of First Invoice, Licence Start Date or Closing Date: no schedule could be built.',
    });
    return { instalments, warnings, inferred: false };
  }

  if (amount <= 0) {
    warnings.push({ code: 'zero-amount', message: 'Deal amount is zero.' });
    return { instalments, warnings, inferred: false };
  }

  const termsDays = Number.isFinite(deal.paymentTermsDays as number)
    ? (deal.paymentTermsDays as number)
    : 0;

  // 1. Advance payment, when there is one.
  if (advance > 0) {
    const advanceDate = deal.advanceInvoiceDate || start;
    const advanceTerms = Number.isFinite(deal.advanceTermsDays as number)
      ? (deal.advanceTermsDays as number)
      : termsDays;
    instalments.push({
      seq: 0,
      kind: 'advance',
      invoiceDate: advanceDate,
      dueDate: addDays(advanceDate, advanceTerms),
      amount: round2(advance),
    });
  }

  // 2. Number of instalments for the balance.
  const rawDuration = Number(deal.duration);
  const count = Number.isFinite(rawDuration) && rawDuration >= 1 ? Math.floor(rawDuration) : 1;
  if (!Number.isFinite(rawDuration) || rawDuration < 1) {
    warnings.push({
      code: 'no-duration',
      message: 'Duration is empty: the balance is treated as a single invoice.',
    });
  }

  // 3. Periodicity.
  let stepMonths = basisToMonths(deal.durationBasis);
  let inferred = false;
  if (stepMonths === null) {
    inferred = true;
    warnings.push({
      code: 'no-basis',
      message: `Duration Basis is "${deal.durationBasis ?? 'empty'}": the periodicity has been inferred.`,
    });
    if (count > 1 && deal.licenceStartDate && deal.licenceEndDate) {
      const months = diffDays(deal.licenceStartDate, deal.licenceEndDate) / 30.4375;
      stepMonths = Math.max(1, Math.round(months / count));
    } else {
      stepMonths = 1;
    }
  }

  // 4. Instalment value: the CRM field when present, otherwise an even split.
  const balance = round2(amount - advance);
  const perInstalment =
    Number.isFinite(deal.valuePerDuration as number) && (deal.valuePerDuration as number) > 0
      ? round2(deal.valuePerDuration as number)
      : round2(balance / count);

  let allocated = 0;
  for (let i = 0; i < count; i += 1) {
    const invoiceDate = addMonths(start, i * (stepMonths as number));
    const isLast = i === count - 1;
    // The last instalment absorbs rounding so that the plan always adds up to Amount.
    const value = isLast ? round2(balance - allocated) : perInstalment;
    allocated = round2(allocated + value);
    instalments.push({
      seq: i + 1,
      kind: 'instalment',
      invoiceDate,
      dueDate: addDays(invoiceDate, termsDays),
      amount: value,
    });
  }

  // 5. Flag deals where Value per Duration x Duration does not reconcile with Amount.
  if (
    Number.isFinite(deal.valuePerDuration as number) &&
    (deal.valuePerDuration as number) > 0
  ) {
    const expected = round2((deal.valuePerDuration as number) * count + advance);
    if (Math.abs(expected - amount) > 1) {
      warnings.push({
        code: 'amount-mismatch',
        message: `Value per Duration x Duration (+ advance) is ${expected.toFixed(2)} but Amount is ${amount.toFixed(2)}: the last instalment has been adjusted.`,
      });
    }
  }

  return { instalments, warnings, inferred };
}

/** Total of a schedule, for reconciliation. */
export function scheduleTotal(schedule: DealSchedule): number {
  return round2(schedule.instalments.reduce((sum, i) => sum + i.amount, 0));
}
