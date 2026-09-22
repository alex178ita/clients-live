import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../lib/auth';
import { getRows } from '../../../lib/crmcache';
import { checkAll } from '../../../lib/livecheck';
import { readLocalChecks } from '../../../lib/localchecks';
import { crmLiveGuess, today } from '../../../lib/crmstatus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The browser asks for one batch of client keys at a time so rows fill in as the
// answers arrive and no single invocation runs long.
export async function POST(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys.slice(0, 40) : [];
  const force = body.force === true;

  try {
    const { rows } = await getRows();
    const byKey = new Map(rows.map((row) => [row.key, row]));

    const targets = keys
      .map((key) => byKey.get(key))
      .filter(Boolean)
      .map((row) => ({ key: row.key, candidates: row.probeCandidates || [] }));

    const [results, local] = await Promise.all([checkAll(targets, { force }), readLocalChecks()]);

    // The local script only fills the gaps: where this probe could read the page
    // its answer is fresher and stands. Where it was refused or timed out, the
    // run from a normal connection is the only real evidence we have.
    for (const key of Object.keys(results)) {
      if (results[key].status !== 'unknown') continue;
      const fromScript = local.results[key];
      if (!fromScript || fromScript.status === 'unknown') continue;

      results[key] = {
        ...fromScript,
        source: 'local',
        sourceLabel: local.source || 'local script',
        runAt: local.runAt,
        blockedReason: results[key].reason || null
      };
    }

    // Still blind after both probes: fall back on the licence. Only ever
    // upwards — see lib/crmstatus.js.
    const day = today();
    for (const key of Object.keys(results)) {
      if (results[key].status !== 'unknown') continue;
      const guess = crmLiveGuess(byKey.get(key), day);
      if (!guess) continue;

      results[key] = { ...guess, blockedReason: results[key].reason || null };
    }

    return NextResponse.json({ results, localRunAt: local.runAt });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
