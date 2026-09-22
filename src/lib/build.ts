// Assembles the dashboard payload from normalised CRM / Books / Billing records.
// Pure: no I/O, so it can be unit tested against fixtures.

import { addDays, diffDays, monthKey, monthRange, today } from './dates';
import { buildSchedule } from './schedule';
import { isActiveSubscription, nameKey } from './normalise';
import { assignSubscriptions } from './matchSubscription';
import { buildOverdue, overdueByMonth } from './overdue';
import type {
  OverdueLedger,
  BillingSubscription,
  BooksInvoice,
  CreditNoteRef,
  CrmDeal,
  DashboardPayload,
  DealRow,
  InvoiceRef,
  MonthlyPoint,
} from './types';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Invoices that never became real revenue: drafts, voided ones, and — the case
 * that matters in practice — invoices fully closed by a credit note because
 * they were cancelled and reissued. Books leaves those at "paid", so counting
 * them would inflate the revenue and make the client look like a fast payer.
 */
function isLiveInvoice(inv: BooksInvoice): boolean {
  if (inv.status === 'void' || inv.status === 'draft') return false;
  if (inv.closedByCreditNote) return false;
  return true;
}

const CREDIT_TOLERANCE = 0.01;

/** Attaches the credit notes to each invoice and works out what is cancelled. */
export function applyCreditNotes(
  invoices: BooksInvoice[],
  byInvoice: Map<string, CreditNoteRef[]>,
): BooksInvoice[] {
  return invoices.map((invoice) => {
    const creditNotes = byInvoice.get(invoice.invoiceId) ?? [];
    if (creditNotes.length === 0) return invoice;
    const creditedAmount = round2(creditNotes.reduce((sum, c) => sum + c.amount, 0));
    return {
      ...invoice,
      creditNotes,
      creditedAmount,
      closedByCreditNote: creditedAmount >= invoice.total - CREDIT_TOLERANCE && invoice.total > 0,
    };
  });
}

/**
 * Mean number of days between invoice date and payment date, per Books customer.
 * This is what drives the "realistic cash flow" chart.
 */
export function paymentDelayByCustomer(invoices: BooksInvoice[]): {
  perCustomer: Map<string, { avgDays: number; sample: number }>;
  companyAvgDays: number | null;
  companySample: number;
} {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const inv of invoices) {
    if (!isLiveInvoice(inv)) continue;
    if (!inv.lastPaymentDate || !inv.date) continue;
    if (inv.balance > 0.01) continue; // only fully settled invoices
    const days = diffDays(inv.date, inv.lastPaymentDate);
    if (days < 0 || days > 720) continue; // guard against data entry noise
    const list = buckets.get(inv.customerId) ?? [];
    list.push(days);
    buckets.set(inv.customerId, list);
    all.push(days);
  }
  const perCustomer = new Map<string, { avgDays: number; sample: number }>();
  for (const [customerId, days] of buckets) {
    const avg = mean(days);
    if (avg !== null) perCustomer.set(customerId, { avgDays: Math.round(avg), sample: days.length });
  }
  const companyAvg = mean(all);
  return {
    perCustomer,
    companyAvgDays: companyAvg === null ? null : Math.round(companyAvg),
    companySample: all.length,
  };
}

function linkedSubscription(
  deal: CrmDeal,
  byDeal: Map<string, BillingSubscription[]>,
): BillingSubscription | null {
  const linked = byDeal.get(deal.id);
  if (!linked || linked.length === 0) return null;
  const best = [...linked].sort((a, b) =>
    (b.currentTermStartsAt ?? '').localeCompare(a.currentTermStartsAt ?? ''),
  )[0];
  return { ...best, matchedBy: 'crm-link' };
}

export interface BuildInput {
  deals: CrmDeal[];
  invoices: BooksInvoice[];
  subscriptions: BillingSubscription[];
  /** Reference "now" — injectable so tests are deterministic. */
  now?: string;
}

export function buildDashboard(input: BuildInput): DashboardPayload {
  const now = input.now ?? today();
  const notices: string[] = [];

  const invoicesByDeal = new Map<string, BooksInvoice[]>();
  const customerIdByName = new Map<string, string>();
  for (const inv of input.invoices) {
    if (inv.dealId) {
      const list = invoicesByDeal.get(inv.dealId) ?? [];
      list.push(inv);
      invoicesByDeal.set(inv.dealId, list);
    }
    const key = nameKey(inv.customerName);
    if (key && !customerIdByName.has(key)) customerIdByName.set(key, inv.customerId);
  }

  const subsByDeal = new Map<string, BillingSubscription[]>();
  const subsByCustomer = new Map<string, BillingSubscription[]>();
  for (const sub of input.subscriptions) {
    if (sub.dealId) {
      const list = subsByDeal.get(sub.dealId) ?? [];
      list.push(sub);
      subsByDeal.set(sub.dealId, list);
    }
    const list = subsByCustomer.get(sub.customerId) ?? [];
    list.push(sub);
    subsByCustomer.set(sub.customerId, list);
    const key = nameKey(sub.customerName);
    if (key && !customerIdByName.has(key)) customerIdByName.set(key, sub.customerId);
  }

  const { perCustomer, companyAvgDays, companySample } = paymentDelayByCustomer(input.invoices);

  // --- subscriptions -----------------------------------------------------
  // The CRM link wins where Zoho wrote one. Everything else is scored, across
  // all the deals at once so a subscription is never claimed twice, and only
  // against subscriptions still in force.
  const context = input.deals.map((deal) => {
    const invoices = (invoicesByDeal.get(deal.id) ?? [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const liveInvoices = invoices.filter(isLiveInvoice);
    const customerId =
      liveInvoices[0]?.customerId ??
      invoices[0]?.customerId ??
      customerIdByName.get(nameKey(deal.accountName)) ??
      null;
    return { deal, invoices, liveInvoices, customerId, linked: linkedSubscription(deal, subsByDeal) };
  });

  const claimed = new Set<string>();
  for (const sub of input.subscriptions) {
    // Any subscription carrying a CRM link belongs to that deal, in scope or not.
    if (sub.dealId) claimed.add(sub.subscriptionId);
  }

  const activeByCustomer = new Map<string, BillingSubscription[]>();
  for (const [customerId, list] of subsByCustomer) {
    const active = list.filter(isActiveSubscription);
    if (active.length > 0) activeByCustomer.set(customerId, active);
  }

  const assignment = assignSubscriptions(
    context.filter((c) => !c.linked).map(({ deal, customerId }) => ({ deal, customerId })),
    activeByCustomer,
    claimed,
  );

  const rows: DealRow[] = context.map(({ deal, invoices, liveInvoices, customerId, linked }) => {
    const scored = linked ? null : assignment.matched.get(deal.id) ?? null;
    const subscription = linked ?? (scored ? { ...scored.subscription, matchedBy: 'scored' as const } : null);
    const subscriptionMatch = scored ? { score: scored.score, signals: scored.signals } : null;
    const subscriptionCandidates = subscription ? [] : assignment.candidates.get(deal.id) ?? [];
    const schedule = buildSchedule(deal);

    // Net of any partial credit note: a credited slice was never revenue.
    const invoicedTotal = round2(
      liveInvoices.reduce((s, i) => s + (i.total - i.creditedAmount), 0),
    );
    const outstandingTotal = round2(liveInvoices.reduce((s, i) => s + i.balance, 0));
    const collectedTotal = round2(invoicedTotal - outstandingTotal);

    // Last invoice: the newest real Books invoice, otherwise the last planned instalment in the past.
    let lastInvoice: InvoiceRef | null = null;
    const lastReal = liveInvoices[liveInvoices.length - 1];
    if (lastReal) {
      lastInvoice = {
        date: lastReal.date,
        amount: lastReal.total,
        source: 'books',
        label: lastReal.invoiceNumber,
      };
    } else {
      const past = schedule.instalments.filter((i) => i.invoiceDate <= now);
      const item = past[past.length - 1];
      if (item) {
        lastInvoice = {
          date: item.invoiceDate,
          amount: item.amount,
          source: 'duration',
          label: item.kind === 'advance' ? 'Advance' : `Instalment ${item.seq}/${schedule.instalments.length}`,
        };
      }
    }

    // Next invoice: Billing when a subscription is attached, otherwise the plan.
    let nextInvoice: InvoiceRef | null = null;
    if (subscription?.nextBillingAt && subscription.nextBillingAt >= now) {
      nextInvoice = {
        date: subscription.nextBillingAt,
        amount: subscription.subTotal || subscription.amount,
        source: 'billing',
        label: subscription.subscriptionNumber,
      };
    } else {
      const future = schedule.instalments.find((i) => i.invoiceDate > now);
      if (future) {
        nextInvoice = {
          date: future.invoiceDate,
          amount: future.amount,
          source: 'duration',
          label:
            future.kind === 'advance'
              ? 'Advance'
              : `Instalment ${future.seq}/${schedule.instalments.length}`,
        };
      }
    }

    const delay = customerId ? perCustomer.get(customerId) ?? null : null;

    return {
      ...deal,
      schedule,
      invoices,
      subscription,
      subscriptionMatch,
      subscriptionCandidates,
      hasLicence: deal.licence > 0,
      hasServices: deal.delivery > 0,
      invoicedTotal,
      collectedTotal,
      outstandingTotal,
      lastInvoice,
      nextInvoice,
      avgPaymentDelayDays: delay?.avgDays ?? null,
      paymentDelaySampleSize: delay?.sample ?? 0,
    };
  });

  // Unpaid money is counted across the whole of Books, not just the rows above:
  // an invoice from an expired subscription, or one Books never linked to a
  // deal, is owed all the same.
  const overdue = buildOverdue(input.invoices, {
    dealIdsOnDashboard: new Set(input.deals.map((d) => d.id)),
    now,
  });

  const monthly = buildMonthly(rows, { companyAvgDays, now, overdue });

  const unlinked = input.invoices.filter((i) => !i.dealId && isLiveInvoice(i)).length;
  if (unlinked > 0) {
    notices.push(
      `${unlinked} Books invoice(s) carry no CRM deal link (zcrm_potential_id) and are therefore not attached to any row. Any of them that are overdue still appear in the overdue panel.`,
    );
  }
  if (overdue.offDashboardCount > 0) {
    notices.push(
      `${overdue.offDashboardCount} overdue invoice(s) worth ${overdue.offDashboardTotal.toLocaleString('it-IT')} EUR belong to no deal in this table — typically subscriptions that have since expired or been cancelled. They are listed in the overdue panel and counted in the amber part of the cash bars.`,
    );
  }
  const cancelled = input.invoices.filter((i) => i.closedByCreditNote).length;
  if (cancelled > 0) {
    notices.push(
      `${cancelled} invoice(s) were closed in full by a credit note — usually cancelled and reissued. They are shown struck through and left out of every total, chart and payment-time average.`,
    );
  }
  // How well Billing itself knows which deal each subscription belongs to.
  // This is the number behind "the CRM link is mostly missing": it is counted
  // here, from `zcrm_potential_id` on the subscriptions Billing returns, so it
  // can be checked rather than taken on trust.
  const activeSubs = input.subscriptions.filter(isActiveSubscription);
  const scoredCount = rows.filter((r) => r.subscription?.matchedBy === 'scored').length;
  const activeUnattached = activeSubs.filter(
    (s) => !s.dealId && !rows.some((r) => r.subscription?.subscriptionId === s.subscriptionId),
  ).length;
  const subscriptionCoverage = {
    total: input.subscriptions.length,
    active: activeSubs.length,
    crmLinked: input.subscriptions.filter((s) => s.dealId).length,
    matchedHere: scoredCount,
    unresolved: activeUnattached,
  };

  notices.push(
    `Zoho Billing holds ${subscriptionCoverage.total} subscription(s), ${subscriptionCoverage.active} of them still active, but only ${subscriptionCoverage.crmLinked} carry the CRM deal link (the Deal field on the subscription, \`zcrm_potential_id\`). ` +
      `${subscriptionCoverage.matchedHere} more were matched here on amount, billing interval, dates and reference, and ${subscriptionCoverage.unresolved} active subscription(s) are still attached to no deal. ` +
      `Setting the deal on a subscription in Billing replaces the guess with the real link.`,
  );

  const unresolvedRows = rows.filter(
    (r) => !r.subscription && r.subscriptionCandidates.length > 0,
  ).length;
  if (unresolvedRows > 0) {
    notices.push(
      `${unresolvedRows} deal(s) have plausible subscriptions that were not close enough to attach with confidence — the candidates are listed when the row is expanded.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    currency: 'EUR',
    rows,
    monthly,
    overdue,
    stats: {
      dealCount: rows.length,
      wonCount: rows.filter((r) => r.group === 'won').length,
      closingCount: rows.filter((r) => r.group === 'closing').length,
      totalAmount: round2(rows.reduce((s, r) => s + r.amount, 0)),
      invoicedTotal: round2(rows.reduce((s, r) => s + r.invoicedTotal, 0)),
      collectedTotal: round2(rows.reduce((s, r) => s + r.collectedTotal, 0)),
      outstandingTotal: round2(rows.reduce((s, r) => s + r.outstandingTotal, 0)),
      companyAvgPaymentDelayDays: companyAvgDays,
      companyPaymentDelaySampleSize: companySample,
      subscriptions: subscriptionCoverage,
    },
    notices,
    sourceErrors: [],
  };
}

/**
 * Monthly series behind the three charts.
 *  - plannedBilling  : instalments from the Duration block of each deal
 *  - actualBilling   : Books invoices actually issued
 *  - plannedCash     : instalments shifted by the contractual payment terms
 *  - realisticCash   : instalments shifted by the customer's own historical delay
 *  - actualCash      : payments actually received
 */
export function buildMonthly(
  rows: DealRow[],
  options: { companyAvgDays: number | null; now: string; overdue?: OverdueLedger },
): MonthlyPoint[] {
  const { companyAvgDays, now, overdue } = options;
  const map = new Map<string, MonthlyPoint>();
  const touch = (month: string): MonthlyPoint => {
    let point = map.get(month);
    if (!point) {
      point = {
        month,
        plannedBilling: 0,
        actualBilling: 0,
        plannedCash: 0,
        realisticCash: 0,
        actualCash: 0,
        overdueCash: 0,
      };
      map.set(month, point);
    }
    return point;
  };

  for (const row of rows) {
    const delay = row.avgPaymentDelayDays ?? companyAvgDays;
    for (const inst of row.schedule.instalments) {
      touch(monthKey(inst.invoiceDate)).plannedBilling += inst.amount;
      touch(monthKey(inst.dueDate)).plannedCash += inst.amount;
      const realisticDate =
        delay === null ? inst.dueDate : addDays(inst.invoiceDate, delay);
      touch(monthKey(realisticDate)).realisticCash += inst.amount;
    }
    for (const inv of row.invoices) {
      if (!isLiveInvoice(inv) || !inv.date) continue;
      const netTotal = round2(inv.total - inv.creditedAmount);
      touch(monthKey(inv.date)).actualBilling += netTotal;
      const paid = round2(netTotal - inv.balance);
      if (paid > 0.01 && inv.lastPaymentDate) {
        touch(monthKey(inv.lastPaymentDate)).actualCash += paid;
      } else if (paid > 0.01) {
        touch(monthKey(inv.dueDate ?? inv.date)).actualCash += paid;
      }
      // Overdue is not added here: it comes from the ledger below, which also
      // carries invoices belonging to no row — expired subscriptions, invoices
      // with no CRM link. Adding it twice would double the amber.
      if (!overdue && inv.balance > 0.01) {
        const due = inv.dueDate ?? inv.date;
        if (due && due < now) {
          touch(monthKey(due)).overdueCash += inv.balance;
        }
      }
    }
  }

  // The money that should have landed in a past month and did not — counted
  // across the whole of Books, whatever it was billed from.
  if (overdue) {
    for (const [month, amount] of overdueByMonth(overdue)) {
      touch(month).overdueCash += amount;
    }
  }

  const months = [...map.keys()].sort();
  if (months.length === 0) return [];
  const full = monthRange(`${months[0]}-01`, `${months[months.length - 1]}-01`);
  return full.map((month) => {
    const point = touch(month);
    return {
      month,
      plannedBilling: round2(point.plannedBilling),
      actualBilling: round2(point.actualBilling),
      plannedCash: round2(point.plannedCash),
      realisticCash: round2(point.realisticCash),
      actualCash: round2(point.actualCash),
      overdueCash: round2(point.overdueCash),
    };
  });
}
