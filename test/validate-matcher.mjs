// Offline sanity run of the subscription matcher against real Zoho data.
// Not part of `npm test`: it reads saved API dumps whose paths are passed in.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/validate-matcher.mjs <deals.json> <subscriptions.json>

import { readFileSync } from 'node:fs';
import { normaliseDeal, normaliseSubscription, isActiveSubscription, nameKey } from '../src/lib/normalise.ts';
import { assignSubscriptions, scoreSubscription } from '../src/lib/matchSubscription.ts';

const [dealsPath, subsPath] = process.argv.slice(2);
const dealsRaw = JSON.parse(readFileSync(dealsPath, 'utf8'));
const subsRaw = JSON.parse(readFileSync(subsPath, 'utf8'));

const deals = (dealsRaw.data?.data ?? dealsRaw.data ?? [])
  .map(normaliseDeal)
  .filter(Boolean);
const subs = (subsRaw.data?.subscriptions ?? subsRaw.subscriptions ?? []).map(normaliseSubscription);

const active = subs.filter(isActiveSubscription);
console.log(`deals ${deals.length} · subscriptions ${subs.length} (active ${active.length})`);
const linked = subs.filter((s) => s.dealId);
console.log(`subscriptions carrying the CRM link: ${linked.length}`);

// Deals have no Books invoice here, so anchor them to a Billing customer by name.
const customerByName = new Map();
for (const s of subs) {
  const key = nameKey(s.customerName);
  if (key && !customerByName.has(key)) customerByName.set(key, s.customerId);
}

const claimed = new Set(linked.map((s) => s.subscriptionId));
const byCustomer = new Map();
for (const s of active) {
  const list = byCustomer.get(s.customerId) ?? [];
  list.push(s);
  byCustomer.set(s.customerId, list);
}

const linkedDeals = new Set(linked.map((s) => s.dealId));
const input = deals
  .filter((d) => !linkedDeals.has(d.id))
  .map((deal) => ({
    deal,
    customerId:
      customerByName.get(nameKey(deal.accountName)) ??
      customerByName.get(nameKey(deal.finalClientName)) ??
      null,
  }));

const anchored = input.filter((i) => i.customerId).length;
console.log(`deals without a CRM-linked subscription: ${input.length} (anchored to a Billing customer: ${anchored})`);

const { matched, candidates } = assignSubscriptions(input, byCustomer, claimed);
console.log(`\nmatched with confidence: ${matched.size}`);
console.log(`plausible but not confident: ${candidates.size}\n`);

const byId = new Map(deals.map((d) => [d.id, d]));
const rows = [...matched.entries()].sort((a, b) => b[1].score - a[1].score);
for (const [dealId, scored] of rows) {
  const deal = byId.get(dealId);
  const sub = scored.subscription;
  console.log(
    `[${String(scored.score).padStart(3)}] ${deal.dealName}\n` +
      `       -> ${sub.subscriptionNumber} ${sub.planName} · ${sub.customerName} · ` +
      `${sub.subTotal} every ${sub.interval} ${sub.intervalUnit} · ref ${sub.referenceId ?? '-'}\n` +
      `       deal: value/duration ${deal.valuePerDuration ?? '-'} · basis ${deal.durationBasis ?? '-'} · ` +
      `start ${deal.licenceStartDate ?? '-'}\n` +
      `       ${scored.signals.map((s) => `${s.label} (+${s.points})`).join('; ')}`,
  );
}

console.log('\n--- not confident enough ---');
for (const [dealId, list] of candidates) {
  const deal = byId.get(dealId);
  console.log(
    `${deal.dealName} · ${list
      .map((s) => `${s.subscription.subscriptionNumber}(${s.score})`)
      .join(' ')}`,
  );
}

// Every subscription must be claimed at most once.
const seen = new Set();
for (const [, scored] of matched) {
  const id = scored.subscription.subscriptionId;
  if (seen.has(id)) throw new Error(`subscription ${id} assigned twice`);
  seen.add(id);
}
console.log('\nno subscription was assigned to two deals.');

// --- reverse view: for each unclaimed active subscription, the best deal ---
console.log('\n--- per active subscription, best deal (diagnostic) ---');
const dealsByCustomer = new Map();
for (const { deal, customerId } of input) {
  if (!customerId) continue;
  const list = dealsByCustomer.get(customerId) ?? [];
  list.push(deal);
  dealsByCustomer.set(customerId, list);
}
for (const s of active) {
  if (claimed.has(s.subscriptionId)) continue;
  const pool = dealsByCustomer.get(s.customerId) ?? [];
  const best = pool
    .map((d) => ({ d, r: scoreSubscription(d, s) }))
    .sort((a, b) => b.r.score - a.r.score)[0];
  const vetoes = pool.map((d) => scoreSubscription(d, s)).filter((r) => r.vetoed).length;
  console.log(
    `${s.subscriptionNumber} ${s.customerName} · ${s.subTotal}/${s.interval}${s.intervalUnit} · ref ${s.referenceId ?? '-'} · deals ${pool.length} (vetoed ${vetoes}) -> ` +
      (best && best.r.score > 0 ? `${best.r.score} ${best.d.dealName}` : 'nothing'),
  );
}
