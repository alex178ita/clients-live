'use client';

import type { FilterState, PeriodBasis, Scope, SortKey } from '@/lib/filter';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'won', label: 'Won only' },
  { id: 'won_closing', label: 'Won + Closing' },
  { id: 'closing', label: 'Closing only' },
];

const BASES: { id: PeriodBasis; label: string; hint: string }[] = [
  { id: 'closing', label: 'Deal closing date', hint: 'Deals closed (or expected to close) in the period' },
  { id: 'licence', label: 'Licence period', hint: 'Deals whose licence period overlaps the window' },
  { id: 'invoice', label: 'Invoice / instalment date', hint: 'Deals with an invoice or instalment in the window' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'closingDate', label: 'Closing date' },
  { id: 'dealName', label: 'Deal name' },
  { id: 'accountName', label: 'Account' },
  { id: 'ownerName', label: 'Owner' },
  { id: 'stage', label: 'Stage' },
  { id: 'amount', label: 'Amount' },
  { id: 'valuePerDuration', label: 'Value per duration' },
  { id: 'duration', label: 'Duration' },
  { id: 'licenceStartDate', label: 'Licence start' },
  { id: 'licenceEndDate', label: 'Licence end' },
  { id: 'expectedDateOfFirstInvoice', label: 'First invoice date' },
  { id: 'paymentTermsDays', label: 'Payment terms' },
  { id: 'lastInvoiceDate', label: 'Last invoice' },
  { id: 'nextInvoiceDate', label: 'Next invoice' },
];

function yearStart(offset = 0): string {
  const y = new Date().getUTCFullYear() + offset;
  return `${y}-01-01`;
}
function yearEnd(offset = 0): string {
  const y = new Date().getUTCFullYear() + offset;
  return `${y}-12-31`;
}
function shift(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function Filters({
  filters,
  onChange,
  onExport,
  onRefresh,
  exporting,
  refreshing,
  count,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  onExport: () => void;
  onRefresh: () => void;
  exporting: boolean;
  refreshing: boolean;
  count: number;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  const presets: { label: string; from: string; to: string }[] = [
    { label: 'All', from: '', to: '' },
    { label: 'This year', from: yearStart(), to: yearEnd() },
    { label: 'Last year', from: yearStart(-1), to: yearEnd(-1) },
    { label: 'Last 12 months', from: shift(-12), to: new Date().toISOString().slice(0, 10) },
    { label: 'Next 12 months', from: new Date().toISOString().slice(0, 10), to: shift(12) },
  ];

  return (
    <section className="card flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Deals</div>
        <div className="flex rounded-md border border-line p-0.5">
          {SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              onClick={() => set({ scope: scope.id })}
              className={`rounded px-3 py-1.5 text-sm transition ${
                filters.scope === scope.id ? 'bg-accent text-[#08121f]' : 'text-muted hover:text-white'
              }`}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Period on</div>
        <select
          className="input"
          value={filters.basis}
          onChange={(e) => set({ basis: e.target.value as PeriodBasis })}
          title={BASES.find((b) => b.id === filters.basis)?.hint}
        >
          {BASES.map((basis) => (
            <option key={basis.id} value={basis.id}>
              {basis.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">From</div>
        <input
          type="date"
          className="input"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
        />
      </div>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">To</div>
        <input
          type="date"
          className="input"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
        />
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Quick range</div>
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn !px-2 !py-1 !text-xs"
              onClick={() => set({ from: preset.from, to: preset.to })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Sort by</div>
        <div className="flex gap-1">
          <select
            className="input"
            value={filters.sortKey}
            onChange={(e) => set({ sortKey: e.target.value as SortKey })}
          >
            {SORTS.map((sort) => (
              <option key={sort.id} value={sort.id}>
                {sort.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => set({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
            title="Toggle sort direction"
          >
            {filters.sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      <div className="min-w-[180px] flex-1">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Search</div>
        <input
          type="search"
          className="input w-full"
          placeholder="Deal, account, owner, invoice no."
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted">{count} deals</span>
        <button type="button" className="btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="btn-primary" onClick={onExport} disabled={exporting}>
          {exporting ? 'Building…' : 'Export to Excel'}
        </button>
      </div>
    </section>
  );
}
