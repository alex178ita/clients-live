'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlyPoint } from '@/lib/types';
import type { FilterState } from '@/lib/filter';
import { apiFetch } from '@/lib/client';
import { compact, money, monthLabel } from '@/lib/format';
import { chartWindow } from '@/lib/chartWindow';

type ChartId = 'billing' | 'cash' | 'realistic';

/**
 * Colours carry meaning here, so they are not free choices.
 *  - PLAN is a categorical slot (the expectation, not a state).
 *  - COLLECTED and PAST DUE are status colours, good and warning.
 * Both status steps clear 3:1 on this surface, and the pair is weak only under
 * tritanopia — so they are always stacked in the same order and always labelled,
 * never separated by hue alone.
 */
const SURFACE = '#161b22';
const COLOURS = {
  plan: '#3987e5',
  planAlt: '#9085e9',
  issued: '#6b7785',
  collected: '#0ca30c',
  overdue: '#fab219',
  cumulative: '#c084fc',
};

const CHARTS: { id: ChartId; title: string; caption: string }[] = [
  {
    id: 'billing',
    title: 'Billing plan',
    caption:
      'Invoices expected from the Duration block of each deal, against the invoices actually issued in Books.',
  },
  {
    id: 'cash',
    title: 'Cash flow — payment terms',
    caption:
      'The plan shifted by the contractual payment terms. Past months split into what was collected and what fell due and never arrived.',
  },
  {
    id: 'realistic',
    title: 'Cash flow — realistic',
    caption:
      'The plan shifted by how long each client actually takes to pay, measured on their settled Books invoices.',
  },
];

interface SeriesSpec {
  key: keyof MonthlyPoint;
  label: string;
  colour: string;
  stackId?: string;
}

const SERIES: Record<ChartId, { plan: SeriesSpec; actual: SeriesSpec[] }> = {
  billing: {
    plan: { key: 'plannedBilling', label: 'Planned invoicing', colour: COLOURS.plan },
    actual: [{ key: 'actualBilling', label: 'Issued (Books)', colour: COLOURS.issued }],
  },
  cash: {
    plan: { key: 'plannedCash', label: 'Expected collection', colour: COLOURS.plan },
    actual: [
      { key: 'actualCash', label: 'Collected', colour: COLOURS.collected, stackId: 'actual' },
      { key: 'overdueCash', label: 'Past due', colour: COLOURS.overdue, stackId: 'actual' },
    ],
  },
  realistic: {
    plan: { key: 'realisticCash', label: 'Realistic collection', colour: COLOURS.planAlt },
    actual: [
      { key: 'actualCash', label: 'Collected', colour: COLOURS.collected, stackId: 'actual' },
      { key: 'overdueCash', label: 'Past due', colour: COLOURS.overdue, stackId: 'actual' },
    ],
  },
};

interface ChartRow {
  month: string;
  label: string;
  cumulative: number;
  [key: string]: string | number;
}

function ChartTooltip({
  active,
  payload,
  chartId,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; payload: ChartRow }[];
  chartId: ChartId;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const spec = SERIES[chartId];
  const entries = [spec.plan, ...spec.actual].map((series) => ({
    ...series,
    value: Number(row[series.key] ?? 0),
  }));
  const stacked = entries.filter((e) => e.stackId);
  const stackTotal = stacked.reduce((sum, e) => sum + e.value, 0);

  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium text-white">{row.label}</div>
      <table>
        <tbody>
          {entries.map((entry) => {
            if (entry.value === 0 && entry.stackId) return null;
            return (
              <tr key={String(entry.key)}>
                <td className="pr-2 align-middle">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: entry.colour }}
                  />
                </td>
                <td className="pr-3" style={{ color: entry.colour }}>
                  {entry.label}
                </td>
                <td className="text-right font-medium" style={{ color: entry.colour }}>
                  {money(entry.value, true)}
                </td>
              </tr>
            );
          })}
          {stacked.length > 1 && stackTotal > 0 && (
            <tr className="border-t border-line">
              <td />
              <td className="pr-3 pt-1 text-muted">Total</td>
              <td className="pt-1 text-right font-semibold text-white">
                {money(stackTotal, true)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-1.5 text-[10px] text-muted">Double-click for the detail in Excel</div>
    </div>
  );
}

function ChartPanel({
  id,
  data,
  cumulative,
  onDrill,
}: {
  id: ChartId;
  data: MonthlyPoint[];
  cumulative: boolean;
  onDrill: (month: string, chart: ChartId) => void;
}) {
  const spec = SERIES[id];
  const rows = useMemo<ChartRow[]>(() => {
    let running = 0;
    return data.map((point) => {
      running += Number(point[spec.plan.key] ?? 0);
      return {
        ...point,
        label: monthLabel(point.month),
        cumulative: running,
      } as ChartRow;
    });
  }, [data, spec.plan.key]);

  if (rows.length === 0) {
    return <p className="p-8 text-center text-sm text-muted">No data for the current selection.</p>;
  }

  return (
    <div className="h-[280px] w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
          onDoubleClick={(state: any) => {
            const month = state?.activePayload?.[0]?.payload?.month;
            if (month) onDrill(month, id);
          }}
        >
          <CartesianGrid stroke="#252c37" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#8b97a8', fontSize: 11 }}
            axisLine={{ stroke: '#252c37' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: '#8b97a8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => compact(Number(v))}
            width={56}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={<ChartTooltip chartId={id} />}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            // The swatch carries identity; the label stays in muted ink.
            formatter={(value: string) => <span style={{ color: '#8b97a8' }}>{value}</span>}
          />
          <Bar
            dataKey={spec.plan.key as string}
            name={spec.plan.label}
            fill={spec.plan.colour}
            radius={[3, 3, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
          />
          {spec.actual.map((series, index) => (
            <Bar
              key={String(series.key)}
              dataKey={series.key as string}
              name={series.label}
              fill={series.colour}
              stackId={series.stackId}
              // The top segment of a stack keeps the rounded end; a 1px surface
              // stroke gives the segments a visible seam.
              radius={
                !series.stackId || index === spec.actual.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]
              }
              stroke={series.stackId ? SURFACE : undefined}
              strokeWidth={series.stackId ? 1 : 0}
              maxBarSize={36}
              isAnimationActive={false}
            />
          ))}
          {cumulative && (
            <Line
              type="monotone"
              dataKey="cumulative"
              name="Cumulative plan"
              stroke={COLOURS.cumulative}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Charts({
  data,
  avgDelayDays,
  delaySample,
  filters,
}: {
  data: MonthlyPoint[];
  avgDelayDays: number | null;
  delaySample: number;
  filters: FilterState;
}) {
  const [active, setActive] = useState<ChartId>('billing');
  const [showAll, setShowAll] = useState(false);
  const [cumulative, setCumulative] = useState(false);
  const [everyMonth, setEveryMonth] = useState(false);
  const [drilling, setDrilling] = useState<string | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const visible = showAll ? CHARTS : CHARTS.filter((c) => c.id === active);
  const today = new Date().toISOString().slice(0, 10);
  const view = useMemo(() => chartWindow(data, filters, today), [data, filters, today]);
  const series = everyMonth ? data : view.rows;

  const drill = async (month: string, chart: ChartId) => {
    setDrilling(`${chart}:${month}`);
    setDrillError(null);
    try {
      const res = await apiFetch('/api/export/month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, month, chart }),
      });
      if (!res.ok) throw new Error('Could not build the detail for that month.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${chart}-${month}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDrillError(error instanceof Error ? error.message : String(error));
    } finally {
      setDrilling(null);
    }
  };

  return (
    <section className="card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line p-0.5">
          {CHARTS.map((chart) => (
            <button
              key={chart.id}
              type="button"
              onClick={() => {
                setActive(chart.id);
                setShowAll(false);
              }}
              className={`rounded px-3 py-1.5 text-sm transition ${
                !showAll && active === chart.id
                  ? 'bg-accent text-[#08121f]'
                  : 'text-muted hover:text-white'
              }`}
            >
              {chart.title}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Single chart' : 'Show all three'}
        </button>
        <span className="text-[11px] text-muted">
          {drilling ? 'Building the month detail…' : 'Double-click a month for its detail in Excel'}
        </span>
        {(view.clipped || everyMonth) && (
          <button
            type="button"
            className="btn"
            onClick={() => setEveryMonth((v) => !v)}
            title={
              everyMonth
                ? 'Go back to the months the period filter selects'
                : 'Include every month present in the data, however far out'
            }
          >
            {everyMonth
              ? `All ${data.length} months · narrow`
              : `${monthLabel(view.from)} – ${monthLabel(view.to)} · ${view.rows.length}/${data.length} months`}
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={cumulative}
            onChange={(e) => setCumulative(e.target.checked)}
          />
          Cumulative line
        </label>
      </div>

      {drillError && (
        <div className="mb-2 rounded-md border border-[#5a2020] bg-[#241414] px-3 py-2 text-sm text-[#ff8f8f]">
          {drillError}
        </div>
      )}

      <div className={showAll ? 'grid gap-4' : ''}>
        {visible.map((chart) => (
          <div key={chart.id}>
            {showAll && <h3 className="mb-1 text-sm font-medium text-white">{chart.title}</h3>}
            <p className="mb-1 text-xs text-muted">
              {chart.caption}
              {chart.id === 'realistic' && avgDelayDays !== null && (
                <>
                  {' '}
                  Company-wide fallback delay: <strong>{avgDelayDays} days</strong> (from{' '}
                  {delaySample} settled invoices).
                </>
              )}
            </p>
            <ChartPanel id={chart.id} data={series} cumulative={cumulative} onDrill={drill} />
          </div>
        ))}
      </div>
    </section>
  );
}
