'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildStamp } from '../lib/build-stamp';

const BATCH_SIZE = 10;
const PARALLEL_BATCHES = 4;

const COLUMNS = [
  { key: 'alert', label: '', sortable: false, className: 'static' },
  { key: 'clientName', label: 'Client' },
  { key: 'statusRank', label: 'Status' },
  { key: 'channel', label: 'Channel' },
  { key: 'partner', label: 'Partner' },
  { key: 'owner', label: 'Owner' },
  { key: 'licenceStart', label: 'Licence start' },
  { key: 'licenceEnd', label: 'Licence end' },
  { key: 'closingDate', label: 'Closing date' },
  { key: 'amount', label: 'Amount', numeric: true },
  { key: 'totalWonAmount', label: 'Total won', numeric: true },
  { key: 'licenceDeals', label: 'Deals', numeric: true },
  { key: 'lost', label: 'Licence lost' },
  { key: 'domain', label: 'Domain checked' }
];

// Where the probed domain came from. A domain read out of the CRM gets no badge
// — that is the normal case; the badges mark the ones still to fix.
const SOURCE_BADGE = {
  guess: {
    label: 'guessed',
    title: 'No Website in the CRM: this domain was guessed from the client name and may well be wrong'
  },
  override: {
    label: 'map',
    title: 'No Website in the CRM: falling back to an unverified entry in config/domain-overrides.json'
  },
  skipped: { label: 'skipped', title: 'Left out of the live check on purpose' }
};

const CRM_BASE = process.env.NEXT_PUBLIC_CRM_BASE_URL || 'https://crm.zoho.eu/crm/tab/Potentials';

function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function formatMoney(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function yearOf(value) {
  return value ? Number(value.slice(0, 4)) : null;
}

function statusRank(status) {
  if (status === 'live') return 0;
  if (status === 'offline') return 1;
  if (status === 'unknown') return 2;
  return 3;
}

// The tooltip is not enough when a whole column is n/d: the reason belongs on
// the row, short enough to read at a glance.
function shortReason(reason) {
  const text = String(reason || '');
  if (/bot protection/i.test(text)) return 'blocked';
  const http = text.match(/HTTP (\d{3})/);
  if (http) return http[1];
  if (/timeout/i.test(text)) return 'timeout';
  if (/no domain/i.test(text)) return 'no domain';
  if (/ENOTFOUND|getaddrinfo|dns/i.test(text)) return 'DNS';
  if (/certificate|SSL|TLS/i.test(text)) return 'TLS';
  return 'unreachable';
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export default function Page() {
  const [authorised, setAuthorised] = useState(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [passwordConfigured, setPasswordConfigured] = useState(true);

  const [rows, setRows] = useState([]);
  const [live, setLive] = useState({});
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeDone, setProbeDone] = useState(0);

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lostFilter, setLostFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [sort, setSort] = useState({ key: 'clientName', dir: 'asc' });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((json) => {
        setAuthorised(Boolean(json.authorised));
        setPasswordConfigured(json.configured !== false);
      })
      .catch(() => setAuthorised(false));
  }, []);

  const runProbes = useCallback(async (list, force) => {
    setProbing(true);
    setProbeDone(0);
    const batches = chunk(list.map((row) => row.key), BATCH_SIZE);
    let cursor = 0;
    let done = 0;

    async function worker() {
      while (cursor < batches.length) {
        const index = cursor;
        cursor += 1;
        try {
          const res = await fetch('/api/live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: batches[index], force })
          });
          const json = await res.json();
          if (json.results) setLive((current) => ({ ...current, ...json.results }));
        } catch (err) {
          // a failed batch just leaves those rows pending; the refresh button retries
        }
        done += batches[index].length;
        setProbeDone(done);
      }
    }

    await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker));
    setProbing(false);
  }, []);

  const loadAll = useCallback(async ({ force = false } = {}) => {
    setLoadingCrm(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/clients${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the CRM data');
      setRows(json.rows || []);
      setFetchedAt(json.fetchedAt);
      setLoadingCrm(false);
      await runProbes(json.rows || [], force);
    } catch (error) {
      setLoadError(String(error.message || error));
      setLoadingCrm(false);
      setProbing(false);
    }
  }, [runProbes]);

  useEffect(() => {
    if (authorised) loadAll();
  }, [authorised, loadAll]);

  async function submitPassword(event) {
    event.preventDefault();
    setAuthError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      setPassword('');
      setAuthorised(true);
    } else {
      setAuthError('Wrong password.');
    }
  }

  const decorated = useMemo(() => {
    return rows.map((row) => {
      const result = live[row.key] || null;
      const status = result ? result.status : 'pending';
      return {
        ...row,
        live: result,
        status,
        statusRank: statusRank(status),
        alert: Boolean(row.lost && status === 'live')
      };
    });
  }, [rows, live]);

  const years = useMemo(() => {
    const set = new Set();
    for (const row of rows) {
      const a = yearOf(row.licenceStart);
      const b = yearOf(row.licenceEnd);
      if (a) set.add(a);
      if (b) set.add(b);
    }
    return Array.from(set).sort((x, y) => x - y);
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const from = yearFrom ? Number(yearFrom) : null;
    const to = yearTo ? Number(yearTo) : null;

    return decorated.filter((row) => {
      if (needle) {
        const hay = `${row.clientName} ${row.partner || ''} ${row.owner || ''} ${row.domain || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (channelFilter !== 'all' && row.channel !== channelFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (lostFilter === 'yes' && !row.lost) return false;
      if (lostFilter === 'no' && row.lost) return false;
      if (sourceFilter !== 'all' && row.domainSource !== sourceFilter) return false;

      if (from || to) {
        // Keep the client when its licence period overlaps the selected years.
        const start = yearOf(row.licenceStart);
        const end = yearOf(row.licenceEnd);
        if (start === null && end === null) return false;
        const lo = start !== null ? start : end;
        const hi = end !== null ? end : start;
        if (from && hi < from) return false;
        if (to && lo > to) return false;
      }
      return true;
    });
  }, [decorated, search, channelFilter, statusFilter, lostFilter, sourceFilter, yearFrom, yearTo]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const { key, dir } = sort;
    const factor = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let x = a[key];
      let y = b[key];
      if (key === 'lost') {
        x = a.lost ? 1 : 0;
        y = b.lost ? 1 : 0;
      }
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * factor;
      return String(x).localeCompare(String(y), 'en', { numeric: true }) * factor;
    });
    return list;
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const liveCount = filtered.filter((r) => r.status === 'live').length;
    const offline = filtered.filter((r) => r.status === 'offline').length;
    const unknown = filtered.filter((r) => r.status === 'unknown').length;
    const alarms = filtered.filter((r) => r.alert).length;
    const lost = filtered.filter((r) => r.lost).length;
    return { total, liveCount, offline, unknown, alarms, lost };
  }, [filtered]);

  function toggleSort(key, sortable) {
    if (sortable === false) return;
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: sorted,
          meta: {
            buildStamp: buildStamp(),
            yearFrom: yearFrom || null,
            yearTo: yearTo || null,
            filterNote: [
              channelFilter !== 'all' ? `channel ${channelFilter}` : null,
              statusFilter !== 'all' ? `status ${statusFilter}` : null,
              lostFilter !== 'all' ? `licence lost ${lostFilter}` : null,
              search ? `search "${search}"` : null
            ]
              .filter(Boolean)
              .join(', ')
          }
        })
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `won-clients-live-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setLoadError(String(error.message || error));
    } finally {
      setExporting(false);
    }
  }

  if (authorised === null) {
    return (
      <div className="splash">
        <img src="/kleecks-logo-white.png" alt="Kleecks" />
        <p>Loading data ... please wait ...</p>
      </div>
    );
  }

  if (!authorised) {
    return (
      <div className="gate">
        <form onSubmit={submitPassword}>
          <h2>Won Clients &amp; Kleecks Live Status</h2>
          {passwordConfigured ? (
            <p>Enter the password to open the dashboard.</p>
          ) : (
            <p className="error">
              APP_PASSWORD is not set on this deployment. Add it in the Vercel
              environment variables and redeploy.
            </p>
          )}
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
          <div style={{ height: 12 }} />
          <button className="primary" type="submit">Open</button>
          {authError ? <p className="error">{authError}</p> : null}
        </form>
      </div>
    );
  }

  const stillLoading = loadingCrm || (probing && probeDone === 0);
  const progress = rows.length ? Math.round((probeDone / rows.length) * 100) : 0;

  if (stillLoading) {
    return (
      <div className="splash">
        <img src="/kleecks-logo-white.png" alt="Kleecks" />
        <p>Loading data ... please wait ...</p>
        <div className="splash-bar"><span style={{ width: `${loadingCrm ? 8 : Math.max(progress, 8)}%` }} /></div>
      </div>
    );
  }

  return (
    <>
      <header className="masthead">
        <img src="/kleecks-logo-white.png" alt="Kleecks" />
        <h1>Won Clients &amp; Kleecks Live Status</h1>
        <p className="version">{buildStamp()}</p>
      </header>

      <main>
        <div className="toolbar">
          <div className="field grow">
            <label htmlFor="search">Search</label>
            <input
              id="search"
              type="search"
              value={search}
              placeholder="Client, partner, owner, domain"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="yearFrom">Licence year from</label>
            <select id="yearFrom" value={yearFrom} onChange={(event) => setYearFrom(event.target.value)}>
              <option value="">Any</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="yearTo">to</label>
            <select id="yearTo" value={yearTo} onChange={(event) => setYearTo(event.target.value)}>
              <option value="">Any</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="channel">Channel</label>
            <select id="channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="Direct">Direct</option>
              <option value="Indirect">Indirect</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="status">Kleecks status</label>
            <select id="status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="live">Live</option>
              <option value="offline">Offline</option>
              <option value="unknown">Not reachable</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="lost">Licence lost</label>
            <select id="lost" value={lostFilter} onChange={(event) => setLostFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="source">Domain from</label>
            <select id="source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="override">Fallback map</option>
              <option value="deal">Deal website</option>
              <option value="account">Account website</option>
              <option value="guess">Guessed from name</option>
              <option value="none">Not resolved</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>

          <div className="spacer" />

          <div className="actions">
            <button type="button" onClick={() => loadAll({ force: true })} disabled={probing}>
              {probing ? `Checking ${probeDone}/${rows.length}` : 'Re-check now'}
            </button>
            <button type="button" onClick={exportExcel} disabled={exporting || sorted.length === 0}>
              {exporting ? 'Preparing…' : 'Export to Excel'}
            </button>
          </div>
        </div>

        {loadError ? <p className="error">{loadError}</p> : null}

        <div className="summary">
          <span className="pill"><b>{stats.total}</b> clients</span>
          <span className="pill live"><b>{stats.liveCount}</b> live</span>
          <span className="pill offline"><b>{stats.offline}</b> offline</span>
          <span className="pill"><b>{stats.unknown}</b> not reachable</span>
          <span className="pill"><b>{stats.lost}</b> licence lost</span>
          <span className="pill alarm"><b>{stats.alarms}</b> lost but still live</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={column.sortable === false ? 'static' : undefined}
                    onClick={() => toggleSort(column.key, column.sortable)}
                    title={column.sortable === false ? undefined : 'Sort'}
                  >
                    {column.label}
                    {sort.key === column.key ? <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.key} className={row.alert ? 'alarm' : undefined}>
                  <td>
                    {row.alert ? (
                      <span className="alarm-mark" title="Licence flagged as lost but Kleecks is still live on the site">▲</span>
                    ) : null}
                  </td>
                  <td className={`client ${row.status}`}>
                    <a
                      className="domain"
                      href={`${CRM_BASE}/${row.lastDealId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'inherit' }}
                      title={row.lastDealName || ''}
                    >
                      {row.clientName}
                    </a>
                  </td>
                  <td>
                    <span
                      className={`status ${row.status}`}
                      title={
                        row.live
                          ? (row.live.signals && row.live.signals.length
                              ? row.live.signals.join('\n')
                              : row.live.reason || 'no Kleecks marker on the home page')
                          : 'checking…'
                      }
                    >
                      {row.status === 'live' ? 'live' : row.status === 'offline' ? 'offline' : row.status === 'unknown' ? 'n/d' : '…'}
                    </span>
                    {row.status === 'unknown' && row.live && row.live.reason ? (
                      <span className="why">{shortReason(row.live.reason)}</span>
                    ) : null}
                  </td>
                  <td>{row.channel}</td>
                  <td>{row.partner || '—'}</td>
                  <td>{row.owner || '—'}</td>
                  <td>{formatDate(row.licenceStart)}</td>
                  <td>{formatDate(row.licenceEnd)}</td>
                  <td>{formatDate(row.closingDate)}</td>
                  <td className="num">{formatMoney(row.amount)}</td>
                  <td className="num">{formatMoney(row.totalWonAmount)}</td>
                  <td className="num">{row.licenceDeals}</td>
                  <td className={row.lost ? 'lost-yes' : 'lost-no'}>{row.lost ? 'Yes' : 'No'}</td>
                  <td>
                    {row.domain ? (
                      <>
                        <a className="domain" href={`https://${row.domain}`} target="_blank" rel="noreferrer">
                          {row.domain}
                        </a>
                        {SOURCE_BADGE[row.domainSource] ? (
                          <span
                            className={`src ${row.domainSource}`}
                            title={SOURCE_BADGE[row.domainSource].title}
                          >
                            {SOURCE_BADGE[row.domainSource].label}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: 'var(--amber)' }}>not resolved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="foot">
          <span>CRM data read {fetchedAt ? new Date(fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/Rome' }) : '—'}.</span>
          <span className="legend">
            <span><b>live</b> = x-optimized-by Kleecks header and/or KL-* classes on the body</span>
            <span><b>n/d</b> = the home page could not be read (timeout, bot protection, no domain)</span>
            <span>no badge on the domain = read from the CRM; <b>guessed</b> / <b>map</b> = Website still missing in Zoho</span>
            <a className="domain" href="/setup">Zoho connection setup</a>
          </span>
        </div>
      </main>
    </>
  );
}
