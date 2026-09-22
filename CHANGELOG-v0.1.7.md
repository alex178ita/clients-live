# v0.1.7 — 22 September 2026

Three things: subscriptions are matched to deals when Zoho did not write the
link, unpaid invoices are counted on their own outside the deal table, and the
charts stop drawing months nobody asked for.

## The charts follow the period filter

Selecting a year left the axis spanning everything, squeezing the bars into
slivers at the right-hand end. Two causes: a deal closing in 2026 carries
instalments into 2028 whatever period is selected, and the new overdue ledger
reaches back to the oldest unpaid invoice, which widened the axis further.

The period filter now clips the axis as well as the table, so *This year* means
twelve bars. A one-sided period stays one-sided: *from January* is January
onwards, not January to January plus seventeen. With no period chosen the chart
opens on a two-year window around today — six months back, seventeen forward —
instead of the whole history.

The button beside the chart tabs says what is shown (`Mar 26 – Jan 28 · 23/26
months`) and switches to every month in one click. Bars are capped at 36px so a
short window does not produce absurd slabs. If a chosen period contains no
months at all, the chart falls back to the whole series rather than leaving an
empty panel with no way out.

## Overdue invoices, independent of any subscription

The deal table answers *what are we billing against the contracts we won*. That
is the wrong lens for money that has not arrived. An invoice from a subscription
that expired last year is exactly as unpaid as one from a live subscription, and
an invoice Books never linked to a CRM deal (`zcrm_potential_id` empty) appeared
nowhere at all — 3 such invoices in the demo data, and rather more in the real
Books.

There is now a **Past due** panel above the charts, built straight from Books
with no reference to any subscription or deal:

- total owed, number of invoices, age of the oldest
- ageing buckets — 1–30, 31–60, 61–90, over 90 days — coloured amber through red
- three views: every overdue invoice, only the ones with no deal in the table,
  or a per-customer summary sorted by the largest debt
- per invoice: customer, number (linked to Books), issue and due date, days past
  due, amount still owed, and the deal when there is one — otherwise *no CRM
  deal on the invoice*
- its own **Excel** button: one sheet of invoices, one by customer, never
  filtered by the dashboard's filters, because what is owed is owed whether or
  not its deal is in the current view

Knock-on changes:

- the **Past due** KPI tile now reports the whole Books ledger rather than the
  filtered rows, so it no longer shrinks when you narrow the view
- the amber part of each past cash bar comes from the ledger, so it includes
  invoices belonging to expired or cancelled subscriptions and to no deal
- double-clicking a cash bar exports those same invoices, with the customer name
  in the note when there is no deal behind them
- a notice at the foot of the page counts what is owed from outside the table

Settled, draft, voided and credit-noted invoices owe nothing and never appear.
An invoice with no due date is not called overdue — there is nothing to be late
against — it keeps the *no due date* label it already had in the row detail.

## Matching a subscription to its deal

Only **12 of 200** subscriptions carry `zcrm_potential_id`. The old fallback
matched by customer and gave up whenever a customer had more than one candidate,
which is most of them: Jakala alone has a dozen live subscriptions, one per end
client. Hence *No subscription in Zoho Billing is linked to this deal* on rows
that plainly had one.

Candidates are now scored on the signals Billing actually exposes — amount
against Value per Duration, billing interval against Duration Basis, activation
against the licence start, expiry against the licence end, plan kind against
licence/delivery, salesperson against the deal owner, and the `reference_id`,
which at Kleecks encodes the end client and the year (`granapadano202627`).
Inactive subscriptions are not offered at all: expired and cancelled ones cannot
be what a current deal bills against. A subscription already carrying a CRM link
is never offered to a second deal, and the assignment is made across all deals
at once, best score first, so no subscription is claimed twice.

A match is accepted only when it scores at least 55 **and** beats the runner-up
by 15. Everything else is listed as a candidate on the expanded row, with the
reasons, and a note that filling in the deal on the subscription in Billing
makes the link exact. An attached-but-not-linked subscription carries an amber
badge with the same reasons.

Five rules came out of running the matcher against the real 569 won/closing
deals and 200 subscriptions before shipping it. The first three killed matches
that should never have been made:

- **a reference that names another client disqualifies the candidate.** The
  Aspesi deal and an Enervit subscription both bill 1092 a month under Jakala;
  amount and interval agreed and the pair was matched. `enervit202526` says
  otherwise.
- **corroboration alone is never enough.** A match needs the amount or the
  reference; interval, dates and salesperson can only support one.
- **figures that plainly disagree count against.** A subscription billing 50500
  against a deal worth 25800 is evidence of a different contract, not a blank.

The last three came from matches that should have been made and were not:

- **a rolled-forward renewal belongs to the year it is billing now.** Billing
  does not always create a new subscription at renewal; more often it rolls the
  existing one forward, leaving the reference id and the line description naming
  the year it was born in. Loro Piana's SUB-00321 still reads `loropiana2526`
  and "Kleecks Services 21/09/2025–20/09/2026", but its current term runs
  21/09/2026–21/10/2026 with eleven cycles to go: it is billing the 2026/2027
  licence. It was being handed to the 25/26 deal, which is closed, leaving the
  current contract showing no subscription at all. A subscription whose current
  term falls inside a deal's licence period now scores +35 for it, and one that
  has rolled past a deal's licence end scores −25 against it.

- **three letters is enough to be a client.** MSC, ITA and GNV all bill about
  the same monthly figure under Jakala; with four characters as the floor for a
  name, `msc2026` and `ita2026` said nothing and each deal matched the other's
  subscription equally well, so neither was attached. Short names now count, but
  only at the start of a reference, so `ita` cannot be found inside `qualitas`.
- **our own product names are not client names.** `conteaisa` and
  `qualitasaisa` are two clients buying AISA. The shared product word made each
  of them match the other's deal. AISA, Connect, Tier, POC and the plan words
  are now noise, like *Kleecks* already was.

A subscription that starts after the deal's licence has ended is ruled out —
unless its reference names that very client, which is what a renewal looks like:
the deal still carries the original end date while Billing has rolled into the
new year. Those attach, with *runs past the licence end — a renewal* among the
reasons.

A reference naming somebody else no longer hides the candidate, it only bars the
automatic match: Billing carries `Kempinsky` for a deal spelled Kempinski and
`comnte202425` for Conte, and a typo should cost the row its link, not its only
clue. Contradicted candidates are capped at 30 so they sort last, and anything
below 25 is not shown at all.

On the real data — all 569 won and closing deals against the 200 subscriptions —
**41 of the 44 active subscriptions are attached**, the other 3 already carry
the CRM link, none is claimed by two deals, and no row is left holding a
candidate it cannot resolve. Two Billing typos had to be fixed by hand along the
way (`Kempinsky` for a deal spelled Kempinski, `comnte202425` for Conte); until
they were, those two showed as candidates with the reason spelled out rather
than disappearing.

### How to see the state of the CRM link yourself

A notice at the foot of the page now counts it from the live data: how many
subscriptions Billing holds, how many are active, **how many carry the CRM deal
link**, how many were matched here, and how many active ones are still attached
to nothing. The same figures are in the payload under
`stats.subscriptions`. In Billing itself the field is *Deal* on the subscription
(`zcrm_potential_id` in the API) — it is what the CRM–Billing integration writes
when a subscription is created from a deal, and empty on subscriptions created
by hand.

`test/validate-matcher.mjs` is the dry-run harness: point it at a COQL dump of
the deals and a Billing subscriptions dump and it prints every match with its
reasons, everything it declined, and the best deal for each unmatched
subscription. Not part of `npm test`.

New: `src/lib/{matchSubscription,overdue,chartWindow}.ts`,
`src/components/Overdue.tsx`, `src/app/api/export/overdue/route.ts`,
`test/{matchSubscription,overdue,chartWindow,rolledRenewal}.test.ts`
(25 tests, 66 in total).
Touched: `src/lib/{types,build,normalise,monthBreakdown}.ts`,
`src/components/{Charts,DealDetail,Kpis}.tsx`, `src/app/page.tsx`,
`src/app/api/export/month/route.ts`, `fixtures/demo.json`, `README.md`.

No new Zoho scopes: both features read what the token already fetches.
