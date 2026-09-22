import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartWindow, shiftMonth } from '../src/lib/chartWindow.ts';
import type { MonthlyPoint } from '../src/lib/types.ts';

const TODAY = '2026-09-22';

function series(from: string, to: string): MonthlyPoint[] {
  const points: MonthlyPoint[] = [];
  let month = from;
  while (month <= to) {
    points.push({
      month,
      plannedBilling: 0,
      actualBilling: 0,
      plannedCash: 0,
      realisticCash: 0,
      actualCash: 0,
      overdueCash: 0,
    });
    month = shiftMonth(month, 1);
  }
  return points;
}

test('months shift across year boundaries in both directions', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-09', -13), '2025-08');
});

test('a chosen period clips the axis to that period', () => {
  const data = series('2023-01', '2028-12');
  const view = chartWindow(data, { from: '2026-01-01', to: '2026-12-31' }, TODAY);
  assert.equal(view.from, '2026-01');
  assert.equal(view.to, '2026-12');
  assert.equal(view.rows.length, 12);
  assert.equal(view.clipped, true);
});

test('a one-sided period stays one-sided', () => {
  const data = series('2023-01', '2028-12');
  const fromOnly = chartWindow(data, { from: '2027-01-01', to: '' }, TODAY);
  assert.equal(fromOnly.from, '2027-01');
  assert.equal(fromOnly.to, '2028-12');
  const toOnly = chartWindow(data, { from: '', to: '2024-06-30' }, TODAY);
  assert.equal(toOnly.from, '2023-01');
  assert.equal(toOnly.to, '2024-06');
});

test('with no period chosen the chart opens around today, not on six years', () => {
  const data = series('2023-01', '2028-12');
  const view = chartWindow(data, { from: '', to: '' }, TODAY);
  assert.equal(view.from, '2026-03'); // six months back
  assert.equal(view.to, '2028-02'); // seventeen months forward
  assert.equal(view.rows.length, 24);
  assert.equal(view.clipped, true);
});

test('a short series is left alone', () => {
  const data = series('2026-06', '2026-11');
  const view = chartWindow(data, { from: '', to: '' }, TODAY);
  assert.equal(view.rows.length, data.length);
  assert.equal(view.clipped, false);
});

test('a window that would be empty falls back to the whole series', () => {
  const data = series('2023-01', '2023-06');
  const view = chartWindow(data, { from: '2027-01-01', to: '2027-12-31' }, TODAY);
  assert.equal(view.rows.length, data.length);
  assert.equal(view.clipped, false);
});

test('an empty series produces an empty window rather than throwing', () => {
  const view = chartWindow([], { from: '', to: '' }, TODAY);
  assert.deepEqual(view.rows, []);
  assert.equal(view.clipped, false);
});
