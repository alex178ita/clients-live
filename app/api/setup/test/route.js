import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../../lib/auth';
import { dataCentre } from '../../../../lib/zoho-dc';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WON_STAGE = process.env.WON_STAGE || '8. Client Won';

// Proves the credentials work BEFORE they are saved on Vercel, and — just as
// important — shows how many won licence deals that user can actually see: a
// restricted profile returns fewer rows instead of an error.
export async function POST(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  const refreshToken = String(body.refreshToken || '').trim();
  const dc = dataCentre(body.dc);
  const apiHost = body.apiHost && /^https:\/\/[\w.-]+\.(zoho|zohoapis|zohocloud)[\w.]*$/i.test(body.apiHost)
    ? body.apiHost
    : dc.api;

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({ error: 'Client ID, Client Secret and refresh token are all needed.' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });

    const tokenRes = await fetch(`${dc.accounts}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
    const tokenJson = await tokenRes.json().catch(() => ({}));

    if (!tokenJson.access_token) {
      return NextResponse.json(
        { error: tokenJson.error || 'The refresh token was refused', raw: tokenJson },
        { status: 400 }
      );
    }

    const checks = [];

    // 1. deals + coql
    const coqlRes = await fetch(`${apiHost}/crm/v7/coql`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${tokenJson.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        select_query: `select id, Deal_Name from Deals where Licence > 0 and Stage = '${WON_STAGE}' order by id asc limit 200`
      })
    });

    if (coqlRes.status === 204) {
      checks.push({ name: 'Won licence deals visible', ok: false, detail: 'the query ran but returned nothing' });
    } else {
      const coqlJson = await coqlRes.json().catch(() => ({}));
      if (coqlRes.ok && coqlJson.data) {
        const more = coqlJson.info && coqlJson.info.more_records;
        checks.push({
          name: 'Won licence deals visible',
          ok: true,
          detail: `${coqlJson.data.length}${more ? '+' : ''} deals readable with ZohoCRM.coql.READ`
        });
      } else {
        checks.push({
          name: 'Won licence deals visible',
          ok: false,
          detail: JSON.stringify(coqlJson).slice(0, 300)
        });
      }
    }

    // 2. users (owner names)
    const usersRes = await fetch(`${apiHost}/crm/v7/users?type=AllUsers&per_page=5`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokenJson.access_token}` }
    });
    checks.push({
      name: 'User names readable',
      ok: usersRes.ok,
      detail: usersRes.ok
        ? 'ZohoCRM.users.READ granted — deal owners will show their names'
        : `HTTP ${usersRes.status} — owners will fall back to blank`
    });

    return NextResponse.json({
      ok: checks.every((c) => c.ok),
      apiHost,
      checks
    });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}
