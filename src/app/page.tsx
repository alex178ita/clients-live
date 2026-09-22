'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Charts from '@/components/Charts';
import DealTable from '@/components/DealTable';
import Filters from '@/components/Filters';
import Kpis from '@/components/Kpis';
import Logo from '@/components/Logo';
import Overdue from '@/components/Overdue';
import Splash from '@/components/Splash';
import { buildMonthly } from '@/lib/build';
import { apiFetch, clearToken, storeToken } from '@/lib/client';
import { DEFAULT_FILTERS, applyFilters, type FilterState } from '@/lib/filter';
import type { DashboardPayload } from '@/lib/types';

function LoginCard({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError('Wrong password.');
        return;
      }
      // Keep the token ourselves: inside the CRM iframe the cookie does not survive.
      if (json?.token) storeToken(json.token);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6 text-center">
        <Logo className="mx-auto h-9 w-auto" />
        <h1 className="text-lg font-semibold text-white">Won Deals &amp; Billing Plan</h1>
        <input
          type="password"
          className="input w-full text-center"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="text-sm text-[#ff8f8f]">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <p className="text-[11px] italic text-muted">v.0.1 — Beta for testing</p>
      </form>
    </div>
  );
}

export default function Page() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setError(null);
    const res = await apiFetch(`/api/data${force ? '?refresh=1' : ''}`);
    if (res.status === 401) {
      clearToken();
      setNeedsPassword(true);
      return;
    }
    setNeedsPassword(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json?.detail?.endpoint ? ` (${json.detail.endpoint})` : '';
      setError(`${json?.error ?? 'Could not load data from Zoho.'}${detail}`);
      return;
    }
    setPayload(json as DashboardPayload);
  }, []);

  /**
   * The password is accepted immediately; the first read of Zoho then takes
   * anything from a few seconds to half a minute (cold function, plus paging
   * through CRM, Books and Billing). Leaving the login card on screen for that
   * long made it look as though the password had been refused, so we switch to
   * the splash the moment the token is in hand.
   */
  const handleLoginSuccess = useCallback(() => {
    setNeedsPassword(false);
    setLoadingMessage('Signing in ... reading Zoho, this first load can take a moment ...');
    load()
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMessage(null));
  }, [load]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const rows = useMemo(
    () => (payload ? applyFilters(payload.rows, filters) : []),
    [payload, filters],
  );

  const monthly = useMemo(
    () =>
      payload
        ? buildMonthly(rows, {
            companyAvgDays: payload.stats.companyAvgPaymentDelayDays,
            now: new Date().toISOString().slice(0, 10),
            // The amber slice follows the ledger, not the filters: money owed on
            // a deal the filters hid — or on no deal at all — is still owed.
            overdue: payload.overdue,
          })
        : [],
    [rows, payload],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load(true).catch((e) => setError(String(e)));
    setRefreshing(false);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await apiFetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `won-deals-billing-plan-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (needsPassword) return <LoginCard onSuccess={handleLoginSuccess} />;

  if (!payload && !error) return <Splash message={loadingMessage ?? undefined} />;

  return (
    <main className="fade-in mx-auto flex max-w-[1800px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Logo className="h-8 w-auto" />
        <div>
          <h1 className="text-xl font-semibold leading-tight text-white">
            Won Deals &amp; Billing Plan
          </h1>
          <p className="text-xs italic text-muted">v.0.1 — Beta for testing</p>
        </div>
        {payload && (
          <span className="ml-auto text-[11px] text-muted">
            Data read live from Zoho CRM, Books and Billing — generated{' '}
            {new Date(payload.generatedAt).toLocaleString('en-GB')}
          </span>
        )}
      </header>

      {error && (
        <div className="card border-[#5a2020] bg-[#241414] p-3 text-sm text-[#ff8f8f]">
          {error}
        </div>
      )}

      {payload && payload.sourceErrors.length > 0 && (
        <div className="card border-[#5a3f14] bg-[#2a2013] p-3 text-sm">
          <p className="mb-2 font-medium text-[#f0c064]">
            {payload.sourceErrors.length === 1
              ? 'One Zoho product refused this request, so part of the picture is missing:'
              : 'Some Zoho products refused this request, so part of the picture is missing:'}
          </p>
          <ul className="space-y-2">
            {payload.sourceErrors.map((issue) => (
              <li key={issue.source}>
                <span className="font-medium text-[#f0c064]">{issue.label}</span>{' '}
                <span className="text-[#e6edf3]">
                  — {issue.message}
                  {issue.status ? ` (HTTP ${issue.status})` : ''}
                </span>
                {issue.endpoint && (
                  <div className="text-[11px] text-muted">endpoint: {issue.endpoint}</div>
                )}
                <div className="text-[11px] text-muted">{issue.hint}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {payload && (
        <>
          <Filters
            filters={filters}
            onChange={setFilters}
            onExport={exportExcel}
            onRefresh={refresh}
            exporting={exporting}
            refreshing={refreshing}
            count={rows.length}
          />
          <Kpis rows={rows} overdue={payload.overdue} />
          <Overdue ledger={payload.overdue} />
          <Charts
            data={monthly}
            avgDelayDays={payload.stats.companyAvgPaymentDelayDays}
            delaySample={payload.stats.companyPaymentDelaySampleSize}
            filters={filters}
          />
          <DealTable rows={rows} />
          {payload.notices.length > 0 && (
            <ul className="space-y-1 text-[11px] text-muted">
              {payload.notices.map((notice) => (
                <li key={notice}>• {notice}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
