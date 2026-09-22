// Matching a deal to its Zoho Billing subscription.
//
// Only a handful of subscriptions carry the CRM link (`zcrm_potential_id`), so
// for everything else the link has to be inferred. Rather than guess from the
// customer alone — useless when a customer has a dozen subscriptions, as Jakala
// does — each candidate is scored on the signals Billing actually exposes:
// the instalment amount, the billing interval, the activation date, the
// reference id (which at Kleecks encodes client and year: "granapadano202627"),
// the plan kind and the salesperson.
//
// Two rules keep the guessing honest, both learned from a dry run on the real
// data. First, some candidates are disqualified outright: a reference id that
// names a different client, or a subscription that only started after the
// deal's licence had already ended. Second, a match needs a strong signal —
// the amount or the reference — and never rides on coincidence alone: the
// Aspesi deal and an Enervit subscription happen to bill 1092 a month, which
// was enough to pair them until the reference id was allowed to object.
//
// A match is only accepted when it scores well AND clearly beats the runner-up.
// Anything short of that is reported as "no confident match" with the candidates
// listed, because a wrong subscription on a row is worse than none.

import { diffDays } from './dates';
import { basisToMonths } from './schedule';
import type { BillingSubscription, CrmDeal } from './types';

export interface MatchSignal {
  label: string;
  points: number;
}

export interface ScoredSubscription {
  subscription: BillingSubscription;
  score: number;
  signals: MatchSignal[];
  /** Set when the candidate was ruled out rather than merely scored low. */
  vetoed: string | null;
}

/** Score at or above which a candidate may be accepted at all. */
export const ACCEPT_THRESHOLD = 55;
/** How far ahead of the runner-up the winner must be. */
export const MARGIN = 15;
/** Ceiling for a candidate whose reference id names somebody else. */
export const CONTRADICTED_CEILING = 30;
/** Below this a candidate is not worth showing — it agrees on nothing that matters. */
export const CANDIDATE_FLOOR = 25;

function normalise(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Words that say nothing about which client a deal belongs to. Deal names here
 * read "Kleecks e consulenza SEO per Fendi 2021", and only "fendi" identifies it.
 */
const NOISE = new Set([
  'kleecks', 'for', 'per', 'and', 'con', 'del', 'della', 'delle', 'dei', 'the',
  'licence', 'license', 'licenza', 'licenze', 'rinnovo', 'renewal', 'progetto',
  'project', 'consulenza', 'consulting', 'seo', 'strategy', 'strategia',
  'attivita', 'analytics', 'services', 'service', 'servizio', 'servizi',
  'professional', 'copy', 'copywriting', 'migrazione', 'migration', 'sito',
  'site', 'web', 'cms', 'new', 'nuovo', 'plus', 'contratto', 'contract',
  'upsell', 'extension', 'estensione', 'delivery', 'setup', 'onboarding',
  'gruppo', 'group', 'spa', 'srl', 'sas', 'sarl', 'ltd', 'gmbh', 'benefit',
  'societa', 'italia', 'italy', 'europe',
  // Our own product and plan words. "aisa" matters: conteaisa and qualitasaisa
  // are two different clients buying the same product, and letting the product
  // name count as the client made each of them match the other's deal.
  'aisa', 'connect', 'tier', 'slot', 'poc', 'annuale', 'annual', 'mensile',
  'monthly', 'yearly', 'quarterly', 'licenza', 'rinnovo', 'saldo', 'consuntivo',
  'referral', 'pacchetto', 'giornate',
]);

/**
 * Three letters is the floor, because several clients are exactly that: MSC,
 * ITA, GNV. Short words are only ever compared whole (see `matchesKey`), so
 * "ita" cannot slip inside "italia".
 */
const MIN_TOKEN = 3;

function tokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_TOKEN && !NOISE.has(word) && !/^\d+$/.test(word));
}

/**
 * A long key may appear inside the reference stem ("bulgari" in
 * "bulgaristrategy"); a short one has to be the whole of it, or a whole word of
 * the deal, or three-letter names would match half the book.
 */
function matchesKey(stem: string, key: string): boolean {
  if (key.length <= 4 || stem.length <= 4) {
    // "mcm" opens "mcmaccessibility202526", but "ita" must not be found inside
    // "qualitas": a short name counts only at the start of the reference.
    return stem === key || stem.startsWith(key);
  }
  return stem.includes(key) || key.includes(stem);
}

/**
 * The names this deal might be known by inside a reference id: the final
 * client, the account, and the meaningful words of the deal name.
 */
export function referenceKeys(deal: CrmDeal): string[] {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = normalise(value);
    if (key.length >= MIN_TOKEN) keys.add(key);
    for (const word of tokens(value)) keys.add(word);
  };
  add(deal.finalClientName);
  add(deal.accountName);
  add(deal.dealName);
  return [...keys];
}

/**
 * The client part of a reference id: "granapadano202627" -> "granapadano",
 * "bulgaristrategy20252027" -> "bulgaristrategy". Empty when the reference is
 * just a code or a number, in which case it can neither confirm nor object.
 */
export function referenceStem(referenceId: string | null): string {
  const stem = normalise(referenceId).replace(/[0-9]+$/, '');
  return stem.length >= MIN_TOKEN && !NOISE.has(stem) ? stem : '';
}

function referenceVerdict(deal: CrmDeal, sub: BillingSubscription): 'match' | 'conflict' | 'silent' {
  const stem = referenceStem(sub.referenceId);
  if (!stem) return 'silent';
  const keys = referenceKeys(deal);
  if (keys.some((key) => matchesKey(stem, key))) return 'match';
  return 'conflict';
}

/** Interval in months, so "1 years" and "12 months" compare equal. */
function intervalMonths(sub: BillingSubscription): number | null {
  const unit = (sub.intervalUnit ?? '').toLowerCase();
  const n = Number(sub.interval) || 0;
  if (!n) return null;
  if (unit.startsWith('month')) return n;
  if (unit.startsWith('year')) return n * 12;
  if (unit.startsWith('week')) return Math.max(1, Math.round((n * 7) / 30));
  if (unit.startsWith('day')) return Math.max(1, Math.round(n / 30));
  return null;
}

function isServicesPlan(sub: BillingSubscription): boolean {
  const name = `${sub.planName} ${sub.name}`.toLowerCase();
  return /professional|service|consult|delivery/.test(name);
}

export function scoreSubscription(deal: CrmDeal, sub: BillingSubscription): ScoredSubscription {
  const signals: MatchSignal[] = [];
  const none = (vetoed: string): ScoredSubscription => ({ subscription: sub, score: 0, signals: [], vetoed });

  // --- disqualifications -------------------------------------------------
  // A reference naming another client bars the match but does not hide the
  // candidate: Billing carries "Kempinsky" for a deal spelled Kempinski and
  // "comnte" for Conte, and a typo should cost the row its automatic link, not
  // its only clue. Contradicted candidates are clamped so they sort last.
  const verdict = referenceVerdict(deal, sub);
  // A subscription that only started after this licence had ended is usually a
  // different contract — unless its reference id names this very client, which
  // is what a renewal looks like: the deal still carries the original end date
  // while Billing has rolled the subscription into the new year.
  const activatedAt = sub.activatedAt ?? sub.currentTermStartsAt;
  const startsAfterLicenceEnd =
    !!deal.licenceEndDate && !!activatedAt && diffDays(deal.licenceEndDate, activatedAt) > 31;
  if (startsAfterLicenceEnd && verdict !== 'match') {
    return none(`it started on ${activatedAt}, after this licence ended on ${deal.licenceEndDate}`);
  }

  // --- signals -----------------------------------------------------------
  // 1. Instalment amount. The strongest single signal: Billing's sub_total is
  //    the same net figure the CRM holds as Value per Duration.
  const target = sub.subTotal || sub.amount;
  const amounts = [deal.valuePerDuration, deal.amount].filter(
    (v): v is number => typeof v === 'number' && v > 0,
  );
  let amountPoints = 0;
  let amountLabel = '';
  for (const value of amounts) {
    if (!target) continue;
    const drift = Math.abs(target - value) / value;
    const points = drift <= 0.01 ? 40 : drift <= 0.05 ? 25 : 0;
    if (points > amountPoints) {
      amountPoints = points;
      amountLabel =
        drift <= 0.01
          ? `amount matches (${target.toFixed(2)})`
          : `amount close (${target.toFixed(2)} vs ${value.toFixed(2)})`;
    }
  }
  if (amountPoints > 0) {
    signals.push({ label: amountLabel, points: amountPoints });
  } else if (target > 0 && amounts.length > 0) {
    // Both sides state a figure and they are nowhere near each other. That is
    // evidence against, not a blank: it is what separated the Fendi CMS
    // consultancy from the Fendi licence subscription.
    const closest = amounts.reduce(
      (best, v) => (Math.abs(target - v) / v < Math.abs(target - best) / best ? v : best),
      amounts[0],
    );
    if (Math.abs(target - closest) / closest > 0.2) {
      signals.push({
        label: `but it bills ${target.toFixed(2)}, not ${closest.toFixed(2)}`,
        points: -20,
      });
    }
  }

  // 2. Reference id — what actually separates two subscriptions of one customer,
  //    e.g. granapadano202627 against mortadellabologna202627.
  if (verdict === 'conflict') {
    signals.push({
      label: `but its reference "${sub.referenceId}" names another client`,
      points: 0,
    });
  }
  if (verdict === 'match') {
    signals.push({ label: `reference "${sub.referenceId}" names this client`, points: 30 });
  }

  // 2b. Which licence year is it billing *now*.
  //
  //   Billing does not always create a new subscription at renewal: more often
  //   it rolls the existing one forward, leaving the reference id and the line
  //   description naming the year it was born in. Loro Piana's SUB-00321 still
  //   says "loropiana2526" and "Kleecks Services 21/09/2025-20/09/2026", but its
  //   current term runs 21/09/2026–21/10/2026 with eleven cycles to go: it is
  //   billing the 2026/2027 licence. The deal that owns it is therefore the one
  //   whose licence period covers what it is invoicing today, not the one it was
  //   opened for — otherwise the current contract shows no subscription while
  //   last year's closed one shows a live one.
  const billingNow = sub.currentTermStartsAt ?? sub.nextBillingAt ?? sub.lastBillingAt;
  if (billingNow && deal.licenceStartDate && deal.licenceEndDate) {
    if (billingNow >= deal.licenceStartDate && billingNow <= deal.licenceEndDate) {
      signals.push({ label: `it is billing this licence period right now`, points: 35 });
    } else if (billingNow > deal.licenceEndDate) {
      signals.push({
        label: `but it has already rolled past this licence year (billing ${billingNow})`,
        points: -25,
      });
    }
  }

  // Everything below is corroboration: on its own it is coincidence.
  const strong = amountPoints >= 40 || verdict === 'match';

  // 3. Billing interval against Duration Basis.
  const basis = basisToMonths(deal.durationBasis);
  const months = intervalMonths(sub);
  if (basis !== null && months !== null && basis === months) {
    signals.push({ label: `billed every ${months} month(s), as the Duration Basis`, points: 20 });
  }

  // 4. Activation against the licence start.
  const start = deal.licenceStartDate ?? deal.closingDate;
  if (start && activatedAt) {
    const gap = Math.abs(diffDays(start, activatedAt));
    if (gap <= 7) signals.push({ label: `starts within ${gap} day(s) of the licence`, points: 25 });
    else if (gap <= 31) signals.push({ label: `starts within ${gap} days of the licence`, points: 15 });
    else if (gap <= 92) signals.push({ label: `starts within ${gap} days of the licence`, points: 5 });
  }

  // 5. Licence end against the subscription expiry.
  if (deal.licenceEndDate && sub.expiresAt) {
    const gap = Math.abs(diffDays(deal.licenceEndDate, sub.expiresAt));
    if (gap <= 31) signals.push({ label: `expires within ${gap} days of the licence end`, points: 10 });
  }

  // 6. Plan kind against what the deal sells.
  const services = isServicesPlan(sub);
  const pureServices = deal.delivery > 0 && deal.licence === 0;
  const pureLicence = deal.licence > 0 && deal.delivery === 0;
  if (services && pureServices) {
    signals.push({ label: `a services plan, and this deal is all delivery`, points: 10 });
  } else if (!services && pureLicence) {
    signals.push({ label: `a licence plan, and this deal is all licence`, points: 10 });
  } else if (services && pureLicence) {
    signals.push({ label: `but it is a services plan and this deal is all licence`, points: -15 });
  } else if (!services && pureServices) {
    signals.push({ label: `but it is a licence plan and this deal is all delivery`, points: -15 });
  }

  // 7. Salesperson against the deal owner — weak, but it breaks ties.
  const owner = normalise(deal.ownerName);
  const salesperson = normalise(sub.salespersonName);
  if (owner && salesperson && (salesperson.includes(owner) || owner.includes(salesperson))) {
    signals.push({ label: `salesperson is the deal owner`, points: 10 });
  }

  const score = signals.reduce((sum, s) => sum + s.points, 0);
  // Corroboration without a strong signal is coincidence: two unrelated
  // contracts can easily share a monthly amount and a billing interval. A
  // contradicted reference is clamped harder still, so such a candidate only
  // ever appears when the row has nothing better to offer.
  const ceiling = verdict === 'conflict' ? CONTRADICTED_CEILING : ACCEPT_THRESHOLD - 1;
  return {
    subscription: sub,
    score: strong && verdict !== 'conflict' ? score : Math.min(score, ceiling),
    signals,
    vetoed: null,
  };
}

export interface AssignmentResult {
  /** dealId -> the subscription it gets, with why. */
  matched: Map<string, ScoredSubscription>;
  /** dealId -> plausible but not confident enough, best first. */
  candidates: Map<string, ScoredSubscription[]>;
}

/**
 * Assigns subscriptions across all the deals at once, best score first, so the
 * same subscription is never handed to two deals — the Loro Piana licence and
 * the Loro Piana strategy deal must not both claim the same one.
 */
export function assignSubscriptions(
  deals: { deal: CrmDeal; customerId: string | null }[],
  subsByCustomer: Map<string, BillingSubscription[]>,
  alreadyClaimed: Set<string>,
): AssignmentResult {
  const pairs: { dealId: string; scored: ScoredSubscription }[] = [];
  const allCandidates = new Map<string, ScoredSubscription[]>();

  for (const { deal, customerId } of deals) {
    if (!customerId) continue;
    const pool = (subsByCustomer.get(customerId) ?? []).filter(
      (sub) => !alreadyClaimed.has(sub.subscriptionId),
    );
    const scored = pool
      .map((sub) => scoreSubscription(deal, sub))
      .filter((s) => !s.vetoed && s.score >= CANDIDATE_FLOOR)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) allCandidates.set(deal.id, scored);
    for (const s of scored) pairs.push({ dealId: deal.id, scored: s });
  }

  // Global greedy assignment: the most convincing pair wins first.
  pairs.sort((a, b) => b.scored.score - a.scored.score);
  const matched = new Map<string, ScoredSubscription>();
  const takenSubs = new Set<string>();
  const takenDeals = new Set<string>();

  for (const { dealId, scored } of pairs) {
    if (takenDeals.has(dealId)) continue;
    if (takenSubs.has(scored.subscription.subscriptionId)) continue;
    if (scored.score < ACCEPT_THRESHOLD) continue;

    // Must clearly beat this deal's next best still-available candidate.
    const rivals = (allCandidates.get(dealId) ?? []).filter(
      (s) =>
        s.subscription.subscriptionId !== scored.subscription.subscriptionId &&
        !takenSubs.has(s.subscription.subscriptionId),
    );
    const runnerUp = rivals[0]?.score ?? 0;
    if (scored.score - runnerUp < MARGIN) continue;

    matched.set(dealId, scored);
    takenDeals.add(dealId);
    takenSubs.add(scored.subscription.subscriptionId);
  }

  const candidates = new Map<string, ScoredSubscription[]>();
  for (const [dealId, scored] of allCandidates) {
    if (matched.has(dealId)) continue;
    const left = scored.filter((s) => !takenSubs.has(s.subscription.subscriptionId)).slice(0, 4);
    if (left.length > 0) candidates.set(dealId, left);
  }

  return { matched, candidates };
}
