'use client';

import { Fragment, useState } from 'react';
import type { DealRow, InvoiceRef } from '@/lib/types';
import { date, days, money } from '@/lib/format';
import { today } from '@/lib/dates';
import { overdueSummary } from '@/lib/invoiceTiming';
import DealDetail from './DealDetail';

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_DEAL_URL || 'https://crm.zoho.eu/crm/tab/Potentials';

const SOURCE_BADGE: Record<InvoiceRef['source'], { label: string; title: string; className: string }> = {
  books: { label: 'K', title: 'From an invoice issued in Zoho Books', className: 'bg-[#0f2537] text-[#7cc4ff]' },
  billing: { label: 'B', title: 'From the linked Zoho Billing subscription', className: 'bg-[#1d2a12] text-[#a3d977]' },
  duration: { label: 'D', title: 'From the Duration block of the deal', className: 'bg-[#2a2a2a] text-[#b9b9b9]' },
};

function InvoiceCell({ value }: { value: InvoiceRef | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const badge = SOURCE_BADGE[value.source];
  return (
    <span className="inline-flex items-center gap-2" title={value.label ?? undefined}>
      <span className={`chip ${badge.className}`} title={badge.title}>
        {badge.label}
      </span>
      <span>{date(value.date)}</span>
      <span className="text-muted">{money(value.amount)}</span>
    </span>
  );
}

function StageChip({ row }: { row: DealRow }) {
  const won = row.group === 'won';
  return (
    <span
      className={`chip ${won ? 'bg-[#123524] text-[#5ddf9a]' : 'bg-[#33290f] text-[#f0c064]'}`}
    >
      {row.stage}
    </span>
  );
}

export default function DealTable({ rows }: { rows: DealRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const now = today();

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-muted">
        No deal matches the current filters.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-line">
            <th className="th w-8" />
            <th className="th sticky left-0 z-20 bg-panel">Deal</th>
            <th className="th">Account</th>
            <th className="th">Stage</th>
            <th className="th">Owner</th>
            <th className="th">Type</th>
            <th className="th text-right">Amount</th>
            <th className="th">Licence start</th>
            <th className="th">Licence end</th>
            <th className="th">Closing date</th>
            <th className="th text-right">Duration</th>
            <th className="th">Duration basis</th>
            <th className="th text-right">Value / duration</th>
            <th className="th">First invoice</th>
            <th className="th text-right">Terms</th>
            <th className="th text-right">Advance</th>
            <th className="th text-right">Adv. terms</th>
            <th className="th">Adv. invoice date</th>
            <th className="th">Last invoice</th>
            <th className="th">Next invoice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.id;
            const warned = row.schedule.warnings.length > 0;
            return (
              <Fragment key={row.id}>
                <tr
                  className={`border-b border-line/60 transition hover:bg-[#1a2029] ${
                    expanded ? 'bg-[#1a2029]' : ''
                  }`}
                >
                  <td className="td">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : row.id)}
                      className="flex h-6 w-6 items-center justify-center rounded border border-line text-muted hover:border-accent hover:text-white"
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      {expanded ? '−' : '+'}
                    </button>
                  </td>
                  <td
                    className={`td sticky left-0 z-10 max-w-[280px] truncate ${
                      expanded ? 'bg-[#1a2029]' : 'bg-panel'
                    }`}
                    title={row.dealName}
                  >
                    <a
                      href={`${CRM_BASE}/${row.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-accent hover:underline"
                    >
                      {row.dealName}
                    </a>
                    {warned && (
                      <span
                        className="ml-1 cursor-help text-[#f0c064]"
                        title={row.schedule.warnings.map((w) => w.message).join('\n')}
                      >
                        ▲
                      </span>
                    )}
                  </td>
                  <td className="td max-w-[200px] truncate" title={row.accountName ?? ''}>
                    {row.accountName ?? '—'}
                    {row.finalClientName && (
                      <span className="ml-1 text-xs text-muted">→ {row.finalClientName}</span>
                    )}
                  </td>
                  <td className="td">
                    <StageChip row={row} />
                  </td>
                  <td className="td">{row.ownerName ?? '—'}</td>
                  <td className="td">
                    <span className="flex gap-1">
                      {row.hasLicence && (
                        <span
                          className="chip bg-[#123524] text-[#5ddf9a]"
                          title={`Licence: ${money(row.licence, true)}`}
                        >
                          Licence
                        </span>
                      )}
                      {row.hasServices && (
                        <span
                          className="chip bg-[#0c2f2f] text-[#63d9d9]"
                          title={`Delivery: ${money(row.delivery, true)}`}
                        >
                          Professional Services
                        </span>
                      )}
                      {!row.hasLicence && !row.hasServices && (
                        <span className="text-muted">—</span>
                      )}
                    </span>
                  </td>
                  <td className="td text-right font-medium">{money(row.amount)}</td>
                  <td className="td">{date(row.licenceStartDate)}</td>
                  <td className="td">{date(row.licenceEndDate)}</td>
                  <td className="td">{date(row.closingDate)}</td>
                  <td className="td text-right">{row.duration ?? '—'}</td>
                  <td className="td">{row.durationBasis ?? '—'}</td>
                  <td className="td text-right">{money(row.valuePerDuration)}</td>
                  <td className="td">{date(row.expectedDateOfFirstInvoice)}</td>
                  <td className="td text-right">{days(row.paymentTermsDays)}</td>
                  <td className="td text-right">
                    {row.advancePayment > 0 ? money(row.advancePayment) : '—'}
                  </td>
                  <td className="td text-right">{days(row.advanceTermsDays)}</td>
                  <td className="td">{date(row.advanceInvoiceDate)}</td>
                  <td className="td">
                    <InvoiceCell value={row.lastInvoice} />
                    {(() => {
                      const overdue = overdueSummary(row.invoices, now);
                      if (overdue.count === 0) return null;
                      return (
                        <span
                          className="chip ml-2 bg-[#3a1616] text-[#ff8f8f]"
                          title={`${overdue.count} invoice(s) past due for ${money(
                            overdue.amount,
                            true,
                          )}, oldest ${overdue.worstDays} days beyond the due date`}
                        >
                          {overdue.count} past due
                        </span>
                      );
                    })()}
                  </td>
                  <td className="td">
                    <InvoiceCell value={row.nextInvoice} />
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={20} className="p-0">
                      <DealDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
