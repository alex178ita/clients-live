// Which months the bars cover.
//
// A deal closing in 2026 still carries instalments into 2028, and the overdue
// ledger reaches back to whenever the oldest unpaid invoice fell due — so the
// months present in the series are far wider than the period the filters
// select, and drawing them all squeezes the bars into unreadable slivers at the
// right-hand end. The period filter therefore clips the axis as well as the
// table, and with no period chosen the chart opens on a two-year window around
// today rather than on the whole history.

import type { MonthlyPoint } from './types';

/** Months either side of today when no period has been chosen. */
export const DEFAULT_BACK = 6;
export const DEFAULT_FORWARD = 17;

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export interface ChartWindow {
  rows: MonthlyPoint[];
  /** True when months were left out, so the control that reveals them is shown. */
  clipped: boolean;
  from: string;
  to: string;
}

export function chartWindow(
  data: MonthlyPoint[],
  filters: { from: string; to: string },
  today: string,
): ChartWindow {
  const all: ChartWindow = {
    rows: data,
    clipped: false,
    from: data[0]?.month ?? '',
    to: data[data.length - 1]?.month ?? '',
  };
  if (data.length === 0) return all;

  const chosen = !!filters.from || !!filters.to;
  const nowMonth = today.slice(0, 7);
  // A one-sided period stays one-sided: "from January" means January onwards,
  // not January to January plus seventeen.
  const from = filters.from
    ? filters.from.slice(0, 7)
    : chosen
      ? all.from
      : shiftMonth(nowMonth, -DEFAULT_BACK);
  const to = filters.to
    ? filters.to.slice(0, 7)
    : chosen
      ? all.to
      : shiftMonth(nowMonth, DEFAULT_FORWARD);

  const rows = data.filter((point) => point.month >= from && point.month <= to);
  // A window with nothing in it would leave the reader staring at an empty
  // panel with no way back, so fall back to the whole series.
  if (rows.length === 0) return all;
  return {
    rows,
    clipped: rows.length < data.length,
    from: rows[0].month,
    to: rows[rows.length - 1].month,
  };
}
