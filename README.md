# Won Deals & Billing Plan — Kleecks

Next.js app for a Zoho CRM **Web Tab**: every won deal and every deal in closing,
with its licence period, billing plan, cash flow forecast, linked Zoho Billing
subscription and the invoices actually issued in Zoho Books.

Same pattern as *Margin by Client*, *Logged Hours* and *Project Summary*: a
standalone app on GitHub + Vercel that talks to Zoho over REST with its own
OAuth refresh token (not through the MCP connectors), UI in British English,
splash screen with the Kleecks logo, `v.0.1 — Beta for testing`.

---

## 1. What it shows

**Scope toggle** — *Won only* / *Won + Closing* / *Closing only*.
Won = stages `8. Client Won` and the legacy `Client won`.
Closing = stages `6. Closing` and `7. Signed`.

**Main table**, one row per deal:

| Column | Source |
| --- | --- |
| Deal (links to the CRM record), Account, Final client | CRM |
| Stage, Owner | CRM |
| Type — green **Licence** chip when `Licence > 0`, green **Professional Services** chip when `Delivery > 0` | CRM |
| Amount, Licence start, Licence end, Closing date | CRM |
| Duration, Duration Basis, Value per Duration | CRM |
| Expected Date of First Invoice, Payment Terms (days) | CRM |
| Advance Payment, Terms for Advance Payment (days), Invoice Date for Advance Payment | CRM |
| **Last invoice** (date + amount) | newest Books invoice; falls back to the last past instalment of the plan |
| **Next invoice** (date + amount) | linked Billing subscription `next_billing_at`; falls back to the next future instalment of the plan |

The little badge on the last/next invoice columns says where the figure comes
from: **K** = Zoho Books, **B** = Zoho Billing, **D** = the Duration block of
the deal.

**Expanding a row** shows the linked Billing subscription (plan, status, term,
next billing, payment terms, reference), the full planned instalment table, and
every invoice issued in Books with net / VAT / total / balance / payment date.
Net and VAT are fetched on demand for that deal only.

**Past due panel**, above the charts — built straight from Books with no
reference to any subscription or deal, because an invoice from a subscription
that has since expired or been cancelled is exactly as unpaid as one from a live
subscription, and an invoice with no CRM link would otherwise appear nowhere.
It gives the total owed, the age of the oldest invoice, the ageing buckets
(1–30 / 31–60 / 61–90 / over 90 days), and three views: every overdue invoice,
only the ones belonging to no deal in the table, or a per-customer summary. It
has its own Excel export, which ignores the dashboard filters: what is owed is
owed whether or not its deal is in the current view.

**Three charts**, above the table, switchable with tabs or shown all together:

1. **Billing plan** — invoices expected from the Duration block, against what
   Books actually issued.
2. **Cash flow — payment terms** — the same plan shifted by each deal's
   `Payment Terms (number of days)`, against the cash actually collected.
3. **Cash flow — realistic** — the plan shifted by how long each client
   *actually* takes to pay, measured as the mean number of days between invoice
   date and payment date on their settled Books invoices. Clients with no
   settled invoice fall back to the company-wide average, which is printed under
   the chart.

The charts follow the period filter: selecting a year draws that year, not the
whole span. With no period chosen they open on a two-year window around today
(six months back, seventeen forward); the button beside the tabs says what is
shown and switches to every month in one click.

**Filters** — period (on deal closing date, licence period, or invoice /
instalment date), quick ranges, free-text search, sort by any column, and
**Export to Excel**.

---

## 2. How the billing plan is built

For each deal:

* **Start** = `Expected Date of First Invoice`, else `Licence Start Date`, else `Closing Date`.
* **Advance payment**, when `Advance Payment > 0`, becomes instalment 0 on
  `Invoice Date for Advance Payment` (or the start date) with
  `Terms for Advance Payment (days)`.
* **Number of instalments** = `Duration` (1 when empty).
* **Step between instalments** = `Duration Basis`: Month → 1, Bimonthly → 2,
  Quarter → 3, Half yearly → 6.
* **`Fixed`, `Option 1` and empty basis** have no periodicity in the CRM, so the
  step is inferred: the licence period divided by the number of instalments
  when both licence dates exist, otherwise monthly. These rows carry an amber ▲
  marker and the reason is shown when the row is expanded.
* **Instalment value** = `Value per Duration`, else `Amount / Duration`. The
  last instalment absorbs the rounding so the plan always adds up to `Amount`.
  When `Value per Duration × Duration` does not reconcile with `Amount` the row
  is flagged.
* Month-ends are clamped, never rolled over: 31 Jan + 1 month = 28 Feb.

All of this lives in `src/lib/schedule.ts` and is covered by unit tests built on
real deals (Loro Piana, Conte.it, Grana Padano, Fendi, Bulgari, RAI).

---

## 3. Linking to Books and Billing

* **Invoices → deal**: the `zcrm_potential_id` that Zoho writes on the Books
  invoice. Invoices without that link are counted in a notice at the bottom of
  the page but are not attached to any row.
* **Subscription → deal**: the same `zcrm_potential_id` on the Billing
  subscription — the *Deal* field on the subscription, written by the
  CRM–Billing integration and empty on subscriptions created by hand, so most of
  the time the link has to be inferred. The notice at the foot of the page
  counts how many subscriptions carry it, live; the same figures are in
  `stats.subscriptions` in the payload. Candidates are scored on the amount against
  Value per Duration, the billing interval against Duration Basis, the
  activation date against the licence start, the expiry against the licence end,
  the plan kind against licence/delivery, the salesperson against the deal
  owner, and the `reference_id`, which at Kleecks encodes the end client and the
  year (`granapadano202627`). A reference naming a different client rules the
  candidate out, a match needs the amount or the reference rather than
  circumstantial agreement alone, and inactive subscriptions are never offered.
  Because Billing usually rolls a subscription forward at renewal rather than
  creating a new one, the deal that owns it is the one whose licence period
  covers what it is invoicing **today**, not the one named in its reference id.
  A subscription is accepted only when it scores at least 55 and beats the
  runner-up by 15; it then carries an amber *matched, not linked* badge listing
  the reasons. Anything less confident is shown as a candidate on the expanded
  row instead. Filling in the CRM link on the Billing side removes the guesswork
  — `src/lib/matchSubscription.ts` has the full reasoning.
* **Amounts**: CRM `Amount` and `Value per Duration` are always net of VAT,
  while Books invoice totals include VAT where it applies. The expanded row
  shows the net figure per invoice; the summary columns say "Books total".

---

## 4. Setup

### Zoho self client

Create a self client and generate a refresh token with these scopes
(one per line in the Zoho console, **no spaces** — pasting them on several lines
merges them into one and Zoho answers `Invalid scope`):

The authoritative list lives in `src/lib/scopes.ts` and is printed, ready to
copy, on the **/setup** page — use that rather than retyping it here. In short:
CRM (`coql`, `modules.deals`, `users`, `settings.fields`), Books (`invoices`,
`contacts`, `creditnotes`, `settings`) and Billing (`subscriptions`, `invoices`,
`customers`, `payments`, `plans`, `addons` to read, plus CREATE/UPDATE on
subscriptions, invoices, customers and payments for later).

The Billing scope really is spelled `ZohoSubscriptions.…`, not `ZohoBilling.…`,
even though the product was renamed to Zoho Billing and the endpoint is
`/billing/v1/`: the scope kept the old name. Verified against
https://www.zoho.com/billing/api/v1/oauth/ — `ZohoBilling.subscriptions.READ`
is not a scope Zoho knows, and including it can make the whole scope string
invalid.

For the record, the Billing call this app makes is
`GET https://www.zohoapis.eu/billing/v1/subscriptions` with the header
`X-com-zoho-subscriptions-organizationid`, which matches the documented API
root for the EU data centre.

Nothing in this app writes to Zoho.

**If the dashboard reports that a product refused**, the amber banner names the
product, the endpoint and Zoho's own error code. The usual causes:

| Message | Cause |
| --- | --- |
| `You are not authorized to perform this operation [Zoho code 57]` on `/books/...` | the token has no Books scope, or `ZOHO_ORG_ID` is not a Books organisation this user can see |
| the same on `/billing/...` | no Billing scope, or the org id is not the Billing organisation |
| `invalid oauth scope to access this URL` on `/crm/...` | `ZohoCRM.coql.READ` is missing |

Scopes cannot be added to an existing refresh token: generate a new one with
the full list, update `ZOHO_REFRESH_TOKEN`, redeploy, and give it a few minutes.

### Credit notes

An invoice cancelled and reissued is closed in Books with a credit note, and
Books then calls it **paid** — so counting it would inflate the revenue and make
the client look like a lightning-fast payer. The app loads credit notes and
attaches them to their invoices (the list endpoint does not carry the link, so
each credit note's detail is fetched, with a small amount of concurrency).

An invoice whose credit notes cover it in full is treated as cancelled: struck
through in violet with the credit note number beside it, and left out of the
invoiced and collected totals, the charts, the past-due figures and the
payment-time averages. A partial credit is netted off the invoiced amount and
the invoice otherwise behaves normally. Draft and voided credit notes neutralise
nothing.

### The /setup page

`https://<the app>/setup?k=<SETUP_KEY>` does the token work for this app on its
own, so the refresh token never has to be borrowed from another one:

1. **Scopes** — the exact string to paste into the Zoho self client, with a copy
   button and a note on what each scope is for. It is generated from
   `src/lib/scopes.ts`, so it cannot drift from what the code actually calls.
2. **Exchange** — paste the short-lived grant code from the self client and it
   comes back as a permanent refresh token, exchanged with this deployment's own
   `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`. The token is shown once and stored
   nowhere: copy it into `ZOHO_REFRESH_TOKEN` on Vercel and redeploy.
3. **Diagnostics** — one real read per product (CRM deals, COQL, users; Books
   invoices and contacts; Billing subscriptions and customers) against either
   the deployment's token or the one just generated, so a missing scope shows up
   here rather than as a 401 in the dashboard.

The page is gated by `SETUP_KEY`, which is separate from `APP_PASSWORD`; with
`SETUP_KEY` unset the page and its endpoints return 404. It is served with
`frame-ancestors 'none'`, `noindex` and `no-store`.

### Environment variables

Copy `.env.example` to `.env.local` for local work, and set the same keys in
Vercel → Project → Settings → Environment Variables.

> After changing `ZOHO_REFRESH_TOKEN` on Vercel, redeploy **and give it a few
> minutes**: warm functions keep the old access token in memory for up to an
> hour and Books answers `401 code 57` in the meantime even though the new token
> is fine.

### Logo

`public/kleecks-logo-white.svg` is a placeholder — drop the official white logo
in its place and nothing else changes.

### Run

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # schedule + aggregation unit tests
npm run build
```

### Deploy

GitHub repo → Vercel project in the **Kleecks BI** team, as usual. Claude
delivers the sources as a zip; the repo push and the Vercel link are done by
Alex.

### Zoho CRM Web Tab

Setup → Customisation → Modules and Fields → **Web Tabs** → new tab of type
*URL*, pointing at the Vercel URL. `next.config.mjs` already allows framing from
the Zoho CRM domains and blocks everything else; add any further domain there if
the tab is also embedded elsewhere.

**Session inside the iframe.** Chrome and Safari block third-party cookies, so a
plain session cookie is dropped when the app runs embedded in the CRM and the
password appears to "not take" — you log in and land straight back on the login
card. The app therefore returns the signed session token in the body of
`/api/auth`, keeps it in `sessionStorage`, and sends it back on every request as
the `X-App-Token` header. The cookie is still set as well, with `Partitioned`,
for people who open the app directly outside the CRM.

Deployment Protection must be **off** on the Vercel project (Settings →
Deployment Protection → Vercel Authentication). With it on, the iframe shows the
Vercel login page instead of the app.

---

## 5. Known limitations

* Deals and invoices older than `MIN_DATA_DATE` (default 1 January 2023) are not
  loaded at all.
* Credit notes older than `MIN_DATA_DATE` are not loaded, so an invoice
  cancelled before that date still looks paid.
* The realistic cash flow uses a simple mean of the payment delay. If a client
  has one badly outlying invoice it will drag their average; switching to the
  median is a one-line change in `paymentDelayByCustomer`.
* Subscription matching is deliberately conservative: on the real data it
  attaches 41 of the 44 active subscriptions — the other 3 already carry the CRM
  link — and offers anything less certain as a candidate.
  A wrong subscription on a row is worse than none, and the proper fix is the
  CRM link in Billing.
* A client identified only by an acronym that appears nowhere in the deal name
  will not be matched from the reference id alone. The matcher reads names, not
  abbreviations it has never seen.
* An overdue invoice needs a due date. An invoice without one is shown as
  *no due date* on its row but is not counted as past due — there is nothing to
  be late against.

### Checking the matcher against real data

`test/validate-matcher.mjs` runs the matcher offline against saved API dumps and
prints every match with its reasons, everything it declined, and the best deal
for each unmatched subscription. It is not part of `npm test`:

```bash
node --experimental-strip-types --import ./test/register.mjs \
  test/validate-matcher.mjs deals-coql.json subscriptions.json
```
