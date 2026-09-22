# v0.1.6 — 22 September 2026

## Invoices cancelled by a credit note

When an invoice is closed with a credit note and reissued, Zoho Books marks the
original **paid**. Counting it inflated the revenue twice over and, worse, made
the client look like a lightning-fast payer: the credit note "settles" the
invoice within a day or two, which dragged the average payment time down and
skewed the realistic cash flow chart.

Credit notes are now loaded from Books and attached to their invoices. The list
endpoint does not say which invoices a note was applied to — only the detail
does — so each note's detail is fetched, six at a time, capped at 400 and
filtered to the ones that are neither draft nor void.

**Fully credited** — the credit notes cover the invoice:

- shown struck through, on a violet row, with a `credited CN-xxxx` chip carrying
  the credit note number (hover for date and amount of each)
- status reads *cancelled*, balance and payment date read `—`
- left out of the invoiced, collected and outstanding totals, all three charts,
  the past-due figures, the month drill-downs and both payment-time averages
- counted in a notice at the foot of the page

**Partly credited** — the credited slice is netted off the invoiced amount, the
invoice otherwise behaves normally, and the chip reads `part credited`.

Draft and voided credit notes neutralise nothing.

In the Excel export the Invoices sheet gains **Credit note**, **Credited
amount** and **Counted**; cancelled rows are struck through in violet.

If `ZohoBooks.creditnotes.READ` is missing from the token, the amber banner says
so specifically and the rest of the dashboard still loads — it just cannot tell
a cancelled invoice from a paid one.

New: `test/creditNotes.test.ts` (8 tests, 41 in total).
Touched: `src/lib/{types,normalise,build,invoiceTiming,monthBreakdown,source,zoho}.ts`,
`src/components/DealDetail.tsx`, `src/app/api/export/route.ts`,
`fixtures/demo.json`, `README.md`.
