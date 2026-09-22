import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../../lib/auth';
import { dataCentre, SCOPE_STRING } from '../../../../lib/zoho-dc';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Exchanges the Self Client grant code for the permanent refresh token.
// Nothing is stored: the answer goes straight back to the browser so it can be
// copied into the Vercel variables.
export async function POST(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  const code = String(body.code || '').trim();
  const dc = dataCentre(body.dc);

  if (!clientId || !clientSecret || !code) {
    return NextResponse.json({ error: 'Client ID, Client Secret and code are all needed.' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code
    });

    const res = await fetch(`${dc.accounts}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const json = await res.json().catch(() => ({}));

    if (!json.refresh_token) {
      // Zoho answers 200 with an "error" field, so the status is not enough.
      const zohoError = json.error || json.message || `HTTP ${res.status}`;
      return NextResponse.json(
        {
          error: zohoError,
          hint: explain(zohoError),
          raw: json
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      refreshToken: json.refresh_token,
      accessToken: json.access_token || null,
      apiDomain: json.api_domain || dc.api,
      scope: json.scope || SCOPE_STRING,
      expiresIn: json.expires_in || null,
      dc: {
        accounts: dc.accounts,
        api: json.api_domain || dc.api,
        crm: dc.crm
      }
    });
  } catch (error) {
    return NextResponse.json({ error: String(error.message || error) }, { status: 500 });
  }
}

function explain(code) {
  const key = String(code).toLowerCase();
  if (key.includes('invalid_code')) {
    return 'The code has expired or was already used. Codes last minutes and work once: go back to Generate Code and make a new one.';
  }
  if (key.includes('invalid_client')) {
    return 'Client ID and Client Secret do not match, or they belong to a Self Client in a different data centre from the one selected above.';
  }
  if (key.includes('invalid_scope')) {
    return 'The scopes were not accepted. Paste them on one line, comma separated, with no spaces.';
  }
  if (key.includes('redirect')) {
    return 'That client is not a Self Client: create a new one of type Self Client, which needs no redirect URI.';
  }
  return 'Check that the data centre matches the one your CRM lives in, then generate a fresh code.';
}
