'use client';

import type { DealRow, OverdueLedger } from '@/lib/types';
import { money } from '@/lib/format';

/**
 * The past-due tile reports the whole Books ledger rather than the filtered
 * rows: unpaid money does not belong to a contract view, and the invoices of a
 * subscription that has since expired would otherwise vanish from the total.
 */
export default function Kpis({ rows, overdue }: { rows: DealRow[]; overdue: OverdueLedger }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const won = rows.filter((r) => r.group === 'won');
  const closing = rows.filter((r) => r.group === 'closing');
  const invoiced = rows.reduce((s, r) => s + r.invoicedTotal, 0);
  const outstanding = rows.reduce((s, r) => s + r.outstandingTotal, 0);
  const licence = rows.reduce((s, r) => s + r.licence, 0);
  const delivery = rows.reduce((s, r) => s + r.delivery, 0);

  const tiles = [
    { label: 'Contract value (net)', value: money(total), hint: `${rows.length} deals` },
    { label: 'Won', value: money(won.reduce((s, r) => s + r.amount, 0)), hint: `${won.length} deals` },
    {
      label: 'In closing',
      value: money(closing.reduce((s, r) => s + r.amount, 0)),
      hint: `${closing.length} deals`,
    },
    { label: 'Licence', value: money(licence), hint: 'Licence field' },
    { label: 'Professional Services', value: money(delivery), hint: 'Delivery field' },
    { label: 'Invoiced (Books)', value: money(invoiced), hint: 'incl. VAT where applied' },
    { label: 'Outstanding', value: money(outstanding), hint: 'open balance' },
    {
      label: 'Past due',
      value: money(overdue.total),
      hint:
        overdue.count === 0
          ? 'nothing overdue'
          : `${overdue.count} invoice${overdue.count === 1 ? '' : 's'} in Books, oldest ${overdue.oldestDays} d`,
      alert: overdue.count > 0,
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`card px-3 py-2 ${tile.alert ? 'border-[#5a2020] bg-[#1d1414]' : ''}`}
        >
          <div className="text-[11px] uppercase tracking-wide text-muted">{tile.label}</div>
          <div
            className={`text-lg font-semibold ${tile.alert ? 'text-[#ff8f8f]' : 'text-white'}`}
          >
            {tile.value}
          </div>
          <div className="text-[11px] text-muted">{tile.hint}</div>
        </div>
      ))}
    </section>
  );
}
