'use client';

// Unpaid money, seen on its own terms.
//
// The table above is organised by contract; this panel is organised by what is
// owed. It deliberately ignores subscriptions: an invoice from a subscription
// that expired last year is as overdue as one from a live subscription, and an
// invoice Books never linked to a CRM deal appears here and nowhere else.

import { useMemo, useState } from 'react';
import { money, date as fmtDate } from '@/lib/format';
import { apiFetch } from '@/lib/client';
import type { OverdueLedger } from '@/lib/types';

const AMBER = '#fab219';

/** Older debt reads darker: a year-old invoice is not the same news as a late one. */
function ageColour(days: number): string {
  if (days > 90) return '#ff8f8f';
  if (days > 60) return '#f0a24a';
  return AMBER;
}

type Scope = 'all' | 'off' | 'customers';

export default function Overdue({ ledger }: { ledger: OverdueLedger }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoices = useMemo(
    () => (scope === 'off' ? ledger.invoices.filter((i) => !i.onDashboard) : ledger.invoices),
    [ledger, scope],
  );

  const exportExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/export/overdue', { method: 'POST' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `overdue-invoices-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (ledger.count === 0) {
    return (
      <section className="card px-4 py-2 text-sm text-muted">
        Nothing is past due: every open invoice in Books is still within its payment terms.
      </section>
    );
  }

  return (
    <section className="card">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm text-muted transition hover:text-white"
          aria-expanded={open}
        >
          {open ? '▾' : '▸'}
        </button>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">Past due</div>
          <div className="text-lg font-semibold" style={{ color: ageColour(ledger.oldestDays) }}>
            {money(ledger.total)}
          </div>
        </div>
        <div className="text-[11px] text-muted">
          {ledger.count} invoice{ledger.count === 1 ? '' : 's'} · oldest {ledger.oldestDays} days
          {ledger.offDashboardCount > 0 && (
            <>
              <br />
              {money(ledger.offDashboardTotal)} of it on {ledger.offDashboardCount} invoice
              {ledger.offDashboardCount === 1 ? '' : 's'} with no deal in the table above
            </>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {ledger.buckets
            .filter((bucket) => bucket.count > 0)
            .map((bucket) => (
              <span
                key={bucket.label}
                className="rounded-md border border-line px-2 py-1 text-[11px]"
                style={{ color: ageColour(bucket.fromDays) }}
                title={`${bucket.count} invoice(s) between ${bucket.label} past due`}
              >
                {bucket.label}: {money(bucket.total)}
              </span>
            ))}
          <button type="button" className="btn" onClick={exportExcel} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Excel'}
          </button>
        </div>
      </header>

      {error && (
        <p className="px-4 pb-2 text-sm text-[#ff8f8f]">{error}</p>
      )}

      {open && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
            {(
              [
                ['all', `All ${ledger.count}`],
                ['off', `Not in the table (${ledger.offDashboardCount})`],
                ['customers', `By customer (${ledger.byCustomer.length})`],
              ] as [Scope, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
                  scope === value
                    ? 'bg-accent text-[#08121f]'
                    : 'border border-line text-muted hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-muted">
              Read straight from Books — no subscription involved, expired and cancelled ones
              included.
            </span>
          </div>

          <div className="max-h-[420px] overflow-auto">
            {scope === 'customers' ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Customer</th>
                    <th className="px-4 py-2 text-right font-medium">Owed</th>
                    <th className="px-4 py-2 text-right font-medium">Invoices</th>
                    <th className="px-4 py-2 text-right font-medium">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.byCustomer.map((customer) => (
                    <tr key={customer.customerId} className="border-t border-line/60">
                      <td className="px-4 py-2 text-white">{customer.customerName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(customer.total)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {customer.count}
                      </td>
                      <td
                        className="px-4 py-2 text-right tabular-nums"
                        style={{ color: ageColour(customer.oldestDays) }}
                      >
                        {customer.oldestDays} d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Customer</th>
                    <th className="px-4 py-2 text-left font-medium">Invoice</th>
                    <th className="px-4 py-2 text-left font-medium">Issued</th>
                    <th className="px-4 py-2 text-left font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Overdue</th>
                    <th className="px-4 py-2 text-right font-medium">Owed</th>
                    <th className="px-4 py-2 text-left font-medium">Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.invoiceId} className="border-t border-line/60">
                      <td className="px-4 py-2 text-white">{invoice.customerName}</td>
                      <td className="px-4 py-2">
                        {invoice.url ? (
                          <a
                            href={invoice.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </a>
                        ) : (
                          invoice.invoiceNumber
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted">{fmtDate(invoice.date)}</td>
                      <td className="px-4 py-2 tabular-nums text-muted">
                        {fmtDate(invoice.dueDate)}
                      </td>
                      <td
                        className="px-4 py-2 text-right tabular-nums"
                        style={{ color: ageColour(invoice.daysOverdue) }}
                      >
                        {invoice.daysOverdue} d
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-white">
                        {money(invoice.balance, true)}
                      </td>
                      <td className="px-4 py-2 text-[12px]">
                        {invoice.dealName ? (
                          <span className={invoice.onDashboard ? 'text-[#e6edf3]' : 'text-muted'}>
                            {invoice.dealName}
                            {!invoice.onDashboard && ' (not in the table)'}
                          </span>
                        ) : (
                          <span className="text-muted">no CRM deal on the invoice</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
