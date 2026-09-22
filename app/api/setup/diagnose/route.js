import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../../lib/auth';
import { env, explainRefreshError } from '../../../../lib/zoho';
import { DATA_CENTRES } from '../../../../lib/zoho-dc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Diagnoses the variables that are actually saved on this deployment.
// Reads them from process.env, never from the request, and never returns a
// secret: only shapes, prefixes and what Zoho answered.
export async function GET(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const raw = {
    clientId: process.env.ZOHO_CLIENT_ID || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN || ''
  };

  const clientId = env('ZOHO_CLIENT_ID');
  const clientSecret = env('ZOHO_CLIENT_SECRET');
  const refreshToken = env('ZOHO_REFRESH_TOKEN');
  const accountsHost = env('ZOHO_ACCOUNTS_HOST', 'https://accounts.zoho.eu').replace(/\/+$/, '');

  const shape = {
    clientId: describe(raw.clientId, clientId),
    clientSecret: describe(raw.clientSecret, clientSecret),
    refreshToken: describe(raw.refreshToken, refreshToken),
    accountsHost
  };

  const notes = [];
  if (raw.clientId !== clientId || raw.clientSecret !== clientSecret || raw.refreshToken !== refreshToken) {
    notes.push(
      'At least one variable has leading or trailing whitespace on Vercel. The app trims it, but it is worth re-pasting the value cleanly.'
    );
  }

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({
      ok: false,
      stage: 'missing',
      message: 'One or more Zoho variables are not set on this deployment.',
      shape,
      notes
    });
  }

  // 1. the configured data centre
  const primary = await tryRefresh(accountsHost, clientId, clientSecret, refreshToken);
  if (primary.ok) {
    return NextResponse.json({
      ok: true,
      stage: 'refresh',
      message: `The saved credentials work against ${accountsHost}.`,
      shape,
      notes,
      apiDomain: primary.apiDomain,
      scope: primary.scope
    });
  }

  // 2. the same token against the other data centres — a token issued on .com
  //    and refreshed against .eu comes back as invalid_code, which reads
  //    exactly like a bad token.
  const others = [];
  for (const [key, centre] of Object.entries(DATA_CENTRES)) {
    if (centre.accounts === accountsHost) continue;
    const attempt = await tryRefresh(centre.accounts, clientId, clientSecret, refreshToken);
    others.push({ key, label: centre.label, accounts: centre.accounts, ok: attempt.ok, error: attempt.error });
    if (attempt.ok) {
      return NextResponse.json({
        ok: false,
        stage: 'wrong-dc',
        message: `Wrong data centre. The token is valid on ${centre.accounts}, but ZOHO_ACCOUNTS_HOST is set to ${accountsHost}.`,
        fix: [
          `ZOHO_ACCOUNTS_HOST=${centre.accounts}`,
          `ZOHO_API_HOST=${attempt.apiDomain || centre.api}`,
          `NEXT_PUBLIC_CRM_BASE_URL=${centre.crm}/crm/tab/Potentials`
        ].join('\n'),
        shape,
        notes,
        zohoError: primary.error,
        others
      });
    }
  }

  return NextResponse.json({
    ok: false,
    stage: 'refused',
    message: explainRefreshError(primary.error) + '.',
    zohoError: primary.error,
    shape,
    notes,
    others,
    checklist: checklistFor(primary.error)
  });
}

function describe(rawValue, trimmed) {
  if (!trimmed) return { set: false };
  return {
    set: true,
    length: trimmed.length,
    prefix: trimmed.slice(0, 12),
    suffix: trimmed.slice(-4),
    hadWhitespace: rawValue !== trimmed,
    looksLikeZohoToken: /^1000\./.test(trimmed)
  };
}

function checklistFor(code) {
  const key = String(code || '').toLowerCase();
  if (key === 'invalid_code') {
    return [
      'Is ZOHO_REFRESH_TOKEN the refresh_token from the answer, and not the grant code you pasted into the setup page? They look almost identical — both start with 1000. — but the code works once and only for a few minutes.',
      'Were ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET saved from the same Self Client that issued the token? A token only refreshes with the client that created it.',
      'Has that Self Client been deleted and recreated, or the token revoked in the API console under Self Client → Revoke?',
      'Have more than 20 refresh tokens been issued for this client and user? Zoho drops the oldest without telling you.'
    ];
  }
  if (key.startsWith('invalid_client')) {
    return [
      'Copy ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET again from the Client Secret tab — a truncated paste is the usual cause.',
      'Check the Self Client lives in the data centre named above.'
    ];
  }
  return ['Re-run the /setup page from step 1 with a fresh grant code.'];
}

async function tryRefresh(accountsHost, clientId, clientSecret, refreshToken) {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    const res = await fetch(`${accountsHost}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (json.access_token) {
      return { ok: true, apiDomain: json.api_domain || null, scope: json.scope || null };
    }
    return { ok: false, error: json.error || `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}
