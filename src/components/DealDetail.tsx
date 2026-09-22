'use client';

import { useEffect, useState } from 'react';
import type { DealRow } from '@/lib/types';
import { date, money } from '@/lib/format';
import { apiFetch } from '@/lib/client';
import { today } from '@/lib/dates';
import {
  averageDaysLate,
  invoiceTiming,
  overdueSummary,
  type InvoiceTimingState,
} from '@/lib/invoiceTiming';

interface InvoiceDetail {
  invoiceId: string;
  subTotal: number | null;
  taxTotal: number | null;
  payments: { date: string; amount: number; paymentMode: string | null }[];
}

const STATUS_COLOURS: Record<string, string> = {
  paid: 'bg-[#123524] text-[#5ddf9a]',
  sent: 'bg-[#0f2537] text-[#7cc4ff]',
  overdue: 'bg-[#3a1616] text-[#ff8f8f]',
  draft: 'bg-[#2a2a2a] text-[#b9b9b9]',
  void: 'bg-[#2a2a2a] text-[#8b97a8] line-through',
  partially_paid: 'bg-[#33290f] text-[#f0c064]',
  unpaid: 'bg-[#33290f] text-[#f0c064]',
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`chip ${STATUS_COLOURS[status] ?? 'bg-[#2a2a2a] text-[#b9b9b9]'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const TIMING_COLOURS: Record<InvoiceTimingState, string> = {
  overdue: 'text-[#ff8f8f] font-medium',
  'paid-late': 'text-[#f0c064]',
  'paid-on-time': 'text-[#5ddf9a]',
  'due-today': 'text-[#f0c064]',
  due: 'text-muted',
  'no-due-date': 'text-muted',
};

export default function DealDetail({ row }: { row: DealRow }) {
  const [details, setDetails] = useState<Record<string, InvoiceDetail>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (row.invoices.length === 0) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/deal/${row.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.details) return;
        const map: Record<string, InvoiceDetail> = {};
        for (const item of json.details as InvoiceDetail[]) map[item.invoiceId] = item;
        setDetails(map);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [row.id, row.invoices.length]);

  const sub = row.subscription;
  const now = today();
  const overdue = overdueSummary(row.invoices, now);
  const lateness = averageDaysLate(row.invoices, now);

  return (
    <div className="grid gap-4 border-t border-line bg-[#11161d] p-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
      {/* Subscription ------------------------------------------------- */}
      <div className="card p-3">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          Billing subscription
          {sub?.matchedBy === 'scored' && (
            <span
              className="chip bg-[#33290f] text-[#f0c064]"
              title={`No CRM link in Billing. Matched on:\n${(row.subscriptionMatch?.signals ?? [])
                .map((s) => `• ${s.label} (+${s.points})`)
                .join('\n')}`}
            >
              matched, not linked
            </span>
          )}
        </h4>
        {!sub ? (
          <div className="text-sm">
            <p className="text-muted">
              No subscription in Zoho Billing carries the CRM link for this deal.
            </p>
            {row.subscriptionCandidates.length > 0 ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  Active subscriptions of this customer that could be it, none close enough to
                  attach with confidence:
                </p>
                <ul className="mt-1 space-y-1.5">
                  {row.subscriptionCandidates.map((candidate) => (
                    <li
                      key={candidate.subscription.subscriptionId}
                      className="rounded border border-line/70 px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#e6edf3]">
                          {candidate.subscription.subscriptionNumber}
                        </span>
                        <span className="text-muted">
                          {money(candidate.subscription.subTotal, true)} · every{' '}
                          {candidate.subscription.interval} {candidate.subscription.intervalUnit}
                        </span>
                      </div>
                      <div className="text-muted">
                        {candidate.subscription.referenceId ?? 'no reference'} ·{' '}
                        {date(candidate.subscription.activatedAt)} →{' '}
                        {date(candidate.subscription.expiresAt)}
                      </div>
                      <div className="text-[#8b97a8]">
                        {candidate.signals.map((s) => s.label).join(' · ') || 'nothing matched'}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-muted">
                  Setting the deal on the subscription in Zoho Billing removes the guesswork for
                  good.
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted">
                No active subscription of this customer resembles this deal either.
              </p>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Number</dt>
            <dd>{sub.subscriptionNumber}</dd>
            <dt className="text-muted">Plan</dt>
            <dd>
              {sub.planName} <span className="text-muted">({sub.planCode})</span>
            </dd>
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusChip status={sub.status} />
            </dd>
            <dt className="text-muted">Recurs</dt>
            <dd>
              every {sub.interval} {sub.intervalUnit}
            </dd>
            <dt className="text-muted">Current term</dt>
            <dd>
              {date(sub.currentTermStartsAt)} → {date(sub.currentTermEndsAt)}
            </dd>
            <dt className="text-muted">Expires</dt>
            <dd>{date(sub.expiresAt)}</dd>
            <dt className="text-muted">Last billed</dt>
            <dd>{date(sub.lastBillingAt)}</dd>
            <dt className="text-muted">Next billing</dt>
            <dd className="font-medium text-white">{date(sub.nextBillingAt)}</dd>
            <dt className="text-muted">Amount (net)</dt>
            <dd>{money(sub.subTotal, true)}</dd>
            <dt className="text-muted">Payment terms</dt>
            <dd>{sub.paymentTermsLabel ?? (sub.paymentTerms !== null ? `${sub.paymentTerms} d` : '—')}</dd>
            <dt className="text-muted">Reference</dt>
            <dd className="break-all">{sub.referenceId ?? '—'}</dd>
          </dl>
        )}

        {sub?.matchedBy === 'scored' && row.subscriptionMatch && (
          <p className="mt-2 text-[11px] text-[#f0c064]">
            Matched without a CRM link, on: {row.subscriptionMatch.signals.map((s) => s.label).join(' · ')}.
          </p>
        )}

        <h4 className="mb-2 mt-4 text-sm font-semibold text-white">Planned instalments</h4>
        {row.schedule.instalments.length === 0 ? (
          <p className="text-sm text-muted">No schedule could be built for this deal.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-left font-medium">#</th>
                <th className="py-1 text-left font-medium">Invoice</th>
                <th className="py-1 text-left font-medium">Collection</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {row.schedule.instalments.map((item) => (
                <tr key={`${item.kind}-${item.seq}`} className="border-t border-line/60">
                  <td className="py-1">{item.kind === 'advance' ? 'adv' : item.seq}</td>
                  <td className="py-1">{date(item.invoiceDate)}</td>
                  <td className="py-1">{date(item.dueDate)}</td>
                  <td className="py-1 text-right">{money(item.amount, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {row.schedule.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] text-[#f0c064]">
            {row.schedule.warnings.map((warning) => (
              <li key={warning.code}>• {warning.message}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Invoices ------------------------------------------------------ */}
      <div className="card p-3">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          Invoices issued
          <span className="text-xs font-normal text-muted">
            {row.invoices.length} record(s){loading ? ' — loading net amounts…' : ''}
          </span>
        </h4>
        {row.invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoice in Zoho Books is linked to this deal yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 text-left text-[11px] font-medium uppercase">Number</th>
                  <th className="py-1 text-left text-[11px] font-medium uppercase">Date</th>
                  <th className="py-1 text-left text-[11px] font-medium uppercase">Due</th>
                  <th className="py-1 text-right text-[11px] font-medium uppercase">Net</th>
                  <th className="py-1 text-right text-[11px] font-medium uppercase">VAT</th>
                  <th className="py-1 text-right text-[11px] font-medium uppercase">Total</th>
                  <th className="py-1 text-right text-[11px] font-medium uppercase">Balance</th>
                  <th className="py-1 text-left text-[11px] font-medium uppercase">Status</th>
                  <th className="py-1 text-left text-[11px] font-medium uppercase">Paid on</th>
                  <th className="py-1 text-left text-[11px] font-medium uppercase">
                    Against due date
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.invoices.map((inv) => {
                  const detail = details[inv.invoiceId];
                  const timing = invoiceTiming(inv, now);
                  const cancelled = inv.closedByCreditNote;
                  return (
                    <tr
                      key={inv.invoiceId}
                      className={`border-t border-line/60 ${
                        cancelled
                          ? 'bg-[#221a2e]/60 text-muted'
                          : timing.needsChasing
                            ? 'bg-[#2a1616]/40'
                            : ''
                      }`}
                    >
                      <td className="py-1">
                        <span className={cancelled ? 'line-through decoration-[#b39ddb]' : ''}>
                          {inv.url ? (
                            <a
                              href={inv.url}
                              target="_blank"
                              rel="noreferrer"
                              className={
                                cancelled ? 'hover:underline' : 'text-accent hover:underline'
                              }
                            >
                              {inv.invoiceNumber}
                            </a>
                          ) : (
                            inv.invoiceNumber
                          )}
                        </span>
                        {inv.creditNotes.length > 0 && (
                          <span
                            className="chip ml-1.5 bg-[#2f2547] text-[#c4b5fd]"
                            title={inv.creditNotes
                              .map((c) => `${c.number} — ${money(c.amount, true)} on ${date(c.date)}`)
                              .join('\n')}
                          >
                            {cancelled ? 'credited' : 'part credited'}{' '}
                            {inv.creditNotes.map((c) => c.number).join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-1">{date(inv.date)}</td>
                      <td className="py-1">{date(inv.dueDate)}</td>
                      <td className="py-1 text-right">
                        {detail?.subTotal !== null && detail?.subTotal !== undefined
                          ? money(detail.subTotal, true)
                          : '—'}
                      </td>
                      <td className="py-1 text-right text-muted">
                        {detail?.taxTotal !== null && detail?.taxTotal !== undefined
                          ? money(detail.taxTotal, true)
                          : '—'}
                      </td>
                      <td className={`py-1 text-right ${cancelled ? 'line-through' : ''}`}>
                        {money(inv.total, true)}
                      </td>
                      <td className="py-1 text-right">
                        {cancelled ? '—' : money(inv.balance, true)}
                      </td>
                      <td className="py-1">
                        {cancelled ? (
                          <span className="chip bg-[#2f2547] text-[#c4b5fd]">cancelled</span>
                        ) : (
                          <StatusChip status={inv.status} />
                        )}
                      </td>
                      <td className="py-1">{cancelled ? '—' : date(inv.lastPaymentDate)}</td>
                      <td
                        className={`py-1 text-xs ${
                          cancelled ? 'text-[#c4b5fd]' : TIMING_COLOURS[timing.state]
                        }`}
                      >
                        {cancelled ? 'closed by credit note' : timing.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {overdue.count > 0 && (
          <div className="mt-3 rounded-md border border-[#5a2020] bg-[#241414] px-3 py-2 text-sm text-[#ff8f8f]">
            {overdue.count} invoice{overdue.count === 1 ? '' : 's'} past due for{' '}
            <strong>{money(overdue.amount, true)}</strong>, the oldest{' '}
            <strong>{overdue.worstDays} days</strong> beyond its due date.
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase text-muted">Deal amount (net)</div>
            <div className="font-medium">{money(row.amount, true)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted">Invoiced (Books total)</div>
            <div className="font-medium">{money(row.invoicedTotal, true)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted">Collected</div>
            <div className="font-medium text-[#5ddf9a]">{money(row.collectedTotal, true)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted">Outstanding</div>
            <div className="font-medium text-[#f0c064]">{money(row.outstandingTotal, true)}</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Books totals include VAT where it applies, while the CRM Amount is always net — the Net
          column above is the comparable figure.
          {row.avgPaymentDelayDays !== null && (
            <>
              {' '}
              This client settles invoices in <strong>{row.avgPaymentDelayDays} days</strong> from
              the invoice date on average ({row.paymentDelaySampleSize} settled invoices)
              {lateness.averageDays !== null && (
                <>
                  , which is{' '}
                  <strong>
                    {lateness.averageDays > 0
                      ? `${lateness.averageDays} days late`
                      : lateness.averageDays === 0
                        ? 'right on'
                        : `${Math.abs(lateness.averageDays)} days early`}
                  </strong>{' '}
                  against the agreed due date
                </>
              )}
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
