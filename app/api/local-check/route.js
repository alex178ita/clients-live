import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRows } from '../../../lib/crmcache';
import { readLocalChecks, writeLocalChecks, configured, storageMode, blobAccess } from '../../../lib/localchecks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// This endpoint is for the script, not the browser, so it authenticates with a
// bearer token of its own rather than the dashboard's session cookie.
function authorised(request) {
  const expected = (process.env.LOCAL_CHECK_TOKEN || '').trim();
  if (!expected) return false;

  const header = request.headers.get('authorization') || '';
  const given = header.replace(/^Bearer\s+/i, '').trim();
  if (!given) return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// GET: what to check. The script never decides the targets itself, so the CRM
// stays the single source of truth for which client lives at which URL.
export async function GET(request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  try {
    const { rows, fetchedAt } = await getRows();
    const targets = rows
      .filter((row) => row.probeCandidates && row.probeCandidates.length > 0)
      .map((row) => ({
        key: row.key,
        clientName: row.clientName,
        domain: row.domain,
        urls: row.probeCandidates
      }));

    const stored = await readLocalChecks();
    return NextResponse.json({
      targets,
      crmFetchedAt: new Date(fetchedAt).toISOString(),
      lastRunAt: stored.runAt,
      blobConfigured: configured(),
      storageMode: storageMode(),
      blobAccess: blobAccess()
    });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}

// POST: the results of a run. Replaces the stored set wholesale.
export async function POST(request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body.results) ? body.results : null;
  if (!incoming) {
    return NextResponse.json({ error: 'Expected { results: [...] }' }, { status: 400 });
  }

  const results = {};
  for (const entry of incoming) {
    if (!entry || !entry.key) continue;
    const status = ['live', 'offline', 'unknown'].includes(entry.status) ? entry.status : 'unknown';
    results[String(entry.key)] = {
      status,
      signals: Array.isArray(entry.signals) ? entry.signals.slice(0, 12).map(String) : [],
      reason: entry.reason ? String(entry.reason).slice(0, 300) : null,
      httpStatus: Number.isFinite(entry.httpStatus) ? entry.httpStatus : null,
      finalUrl: entry.finalUrl ? String(entry.finalUrl).slice(0, 500) : null,
      checkedAt: entry.checkedAt || new Date().toISOString()
    };
  }

  const payload = {
    runAt: new Date().toISOString(),
    source: body.source ? String(body.source).slice(0, 80) : 'local script',
    results
  };

  try {
    await writeLocalChecks(payload);
    const counts = Object.values(results).reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    return NextResponse.json({ ok: true, stored: Object.keys(results).length, counts, runAt: payload.runAt });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
