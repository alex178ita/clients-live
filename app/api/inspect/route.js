import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../lib/auth';
import { getRows } from '../../../lib/crmcache';
import { checkClient } from '../../../lib/livecheck';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Why is this client showing that domain, and that status?
//
// Every disagreement between the CRM and the dashboard so far has been argued
// from guesses, because the row on screen shows a conclusion and hides the
// reasoning. This endpoint prints the reasoning: the exact fields read from
// Zoho, which one won, the URLs that were tried and what each answered.
//
//   /api/inspect?q=mcm            — the rows whose name contains "mcm"
//   /api/inspect?q=mcm&force=1    — and re-probe them now, ignoring every cache
export async function GET(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const force = url.searchParams.get('force') === '1';
  if (!q) {
    return NextResponse.json({ error: 'Add ?q=<part of the client name>' }, { status: 400 });
  }

  try {
    // force reads the CRM again, so the answer can never be a stale copy held
    // by whichever instance happens to serve this request.
    const { rows, fetchedAt } = await getRows({ force });
    const matches = rows.filter((row) => row.clientName.toLowerCase().includes(q)).slice(0, 10);

    const out = [];
    for (const row of matches) {
      const probe = await checkClient({ key: row.key, candidates: row.probeCandidates || [] }, { force });
      out.push({
        client: row.clientName,
        clientId: row.clientId,
        channel: row.channel,
        partner: row.partner,
        lastDeal: { id: row.lastDealId, name: row.lastDealName },
        licence: { start: row.licenceStart, end: row.licenceEnd, lost: row.lost, expired: row.expired },
        domain: {
          resolved: row.domain,
          // Where it came from: 'deal' = Website URL on the deal, 'account' =
          // Website on the account, 'override' = the fallback map, 'guess' =
          // invented from the client name.
          source: row.domainSource,
          triedInOrder: row.probeCandidates || []
        },
        probe: {
          status: probe.status,
          httpStatus: probe.httpStatus,
          finalUrl: probe.finalUrl,
          signals: probe.signals,
          bodyClass: probe.bodyClass,
          reason: probe.reason,
          cached: probe.cached,
          checkedAt: probe.checkedAt
        }
      });
    }

    return NextResponse.json({
      crmReadAt: new Date(fetchedAt).toISOString(),
      forced: force,
      matches: out.length,
      rows: out
    });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
