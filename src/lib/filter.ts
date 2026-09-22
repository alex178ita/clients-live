import type { DealRow } from './types';

export type Scope = 'won' | 'won_closing' | 'closing';
export type PeriodBasis = 'closing' | 'licence' | 'invoice';

export type SortKey =
  | 'dealName'
  | 'accountName'
  | 'ownerName'
  | 'stage'
  | 'closingDate'
  | 'licenceStartDate'
  | 'licenceEndDate'
  | 'amount'
  | 'valuePerDuration'
  | 'duration'
  | 'expectedDateOfFirstInvoice'
  | 'paymentTermsDays'
  | 'lastInvoiceDate'
  | 'nextInvoiceDate';

export interface FilterState {
  scope: Scope;
  basis: PeriodBasis;
  from: string; // yyyy-mm-dd, empty = open
  to: string;
  search: string;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: FilterState = {
  scope: 'won_closing',
  basis: 'closing',
  from: '',
  to: '',
  search: '',
  sortKey: 'closingDate',
  sortDir: 'desc',
};

function inScope(row: DealRow, scope: Scope): boolean {
  if (scope === 'won') return row.group === 'won';
  if (scope === 'closing') return row.group === 'closing';
  return true;
}

function overlaps(start: string | null, end: string | null, from: string, to: string): boolean {
  const s = start ?? end;
  const e = end ?? start;
  if (!s || !e) return false;
  if (from && e < from) return false;
  if (to && s > to) return false;
  return true;
}

function inPeriod(row: DealRow, basis: PeriodBasis, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (basis === 'closing') {
    const d = row.closingDate;
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  if (basis === 'licence') {
    return overlaps(row.licenceStartDate, row.licenceEndDate, from, to);
  }
  // invoice: at least one issued invoice or planned instalment inside the window
  const dates = [
    ...row.invoices.map((i) => i.date),
    ...row.schedule.instalments.map((i) => i.invoiceDate),
  ].filter(Boolean);
  return dates.some((d) => (!from || d >= from) && (!to || d <= to));
}

function searchMatches(row: DealRow, search: string): boolean {
  if (!search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return [
    row.dealName,
    row.accountName,
    row.finalClientName,
    row.ownerName,
    row.csmName,
    row.stage,
    row.subscription?.subscriptionNumber,
    ...row.invoices.map((i) => i.invoiceNumber),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function sortValue(row: DealRow, key: SortKey): string | number {
  switch (key) {
    case 'lastInvoiceDate':
      return row.lastInvoice?.date ?? '';
    case 'nextInvoiceDate':
      return row.nextInvoice?.date ?? '';
    case 'amount':
      return row.amount;
    case 'valuePerDuration':
      return row.valuePerDuration ?? 0;
    case 'duration':
      return row.duration ?? 0;
    case 'paymentTermsDays':
      return row.paymentTermsDays ?? -1;
    default: {
      const value = (row as unknown as Record<string, unknown>)[key];
      return value === null || value === undefined ? '' : String(value);
    }
  }
}

export function applyFilters(rows: DealRow[], filters: FilterState): DealRow[] {
  const filtered = rows.filter(
    (row) =>
      inScope(row, filters.scope) &&
      inPeriod(row, filters.basis, filters.from, filters.to) &&
      searchMatches(row, filters.search),
  );
  const dir = filters.sortDir === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    const va = sortValue(a, filters.sortKey);
    const vb = sortValue(b, filters.sortKey);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}
