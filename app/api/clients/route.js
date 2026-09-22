import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../lib/auth';
import { getRows } from '../../../lib/crmcache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const { rows, fetchedAt, cached } = await getRows({ force });
    // probeCandidates never leave the server: the live route rebuilds them from
    // the client key, so a forged payload cannot make the app fetch a URL of
    // someone else's choosing.
    const safeRows = rows.map(({ probeCandidates, ...rest }) => rest);
    return NextResponse.json({
      rows: safeRows,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached
    });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
