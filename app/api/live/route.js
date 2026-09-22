import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../lib/auth';
import { getRows } from '../../../lib/crmcache';
import { checkAll } from '../../../lib/livecheck';

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

    const results = await checkAll(targets, { force });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
