// Zoho CRM REST access with the app's own OAuth refresh token.
// Scopes required: ZohoCRM.coql.READ, ZohoCRM.modules.deals.READ, ZohoCRM.users.READ

// Vercel keeps whatever was pasted, trailing newline and all, and Zoho answers
// "invalid_code" to a refresh token with a stray character on the end.
function env(name, fallback = '') {
  const value = process.env[name];
  return (value === undefined || value === null ? fallback : String(value)).trim();
}

const ACCOUNTS_HOST = env('ZOHO_ACCOUNTS_HOST', 'https://accounts.zoho.eu').replace(/\/+$/, '');
const API_HOST = env('ZOHO_API_HOST', 'https://www.zohoapis.eu').replace(/\/+$/, '');

let cachedToken = null; // { value, expiresAt }
let pendingRefresh = null; // in-flight refresh shared by concurrent callers

// Zoho keeps at most 10 live access tokens per refresh token and silently
// invalidates the oldest beyond that. Every cold lambda refreshing on its own
// burns through that in seconds when the dashboard fires its batches in
// parallel, and the losers get "invalid oauth token" on a token they were
// holding quite legitimately. So: one refresh at a time per instance, and a
// single retry on 401 (see coql).
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = refreshAccessToken(now).finally(() => {
    pendingRefresh = null;
  });
  return pendingRefresh;
}

async function refreshAccessToken(now) {
  const refreshToken = env('ZOHO_REFRESH_TOKEN');
  const clientId = env('ZOHO_CLIENT_ID');
  const clientSecret = env('ZOHO_CLIENT_SECRET');

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      'Zoho is not configured: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN must all be set. Open /setup to generate them.'
    );
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  const res = await fetch(`${ACCOUNTS_HOST}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`${explainRefreshError(json.error)} (Zoho said "${json.error || res.status}", host ${ACCOUNTS_HOST}). Open /setup and press "Check the saved connection" for the details.`);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 3_600_000)
  };
  return cachedToken.value;
}

async function coql(selectQuery, { retryOn401 = true } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_HOST}/crm/v7/coql`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ select_query: selectQuery })
  });

  if (res.status === 204) return { data: [], info: { more_records: false } };

  const json = await res.json();
  if (!res.ok) {
    // 401 here means the access token we were holding is no longer valid —
    // invalidated by Zoho's 10-token ceiling, or revoked. Drop it and ask for a
    // fresh one once. If that is refused too, the problem is the credentials
    // and the error belongs on screen.
    if (res.status === 401) {
      cachedToken = null;
      if (retryOn401) return coql(selectQuery, { retryOn401: false });
    }
    throw new Error(`COQL failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

// COQL caps a page at 200 rows; walk the pages until they run out.
async function coqlAll(buildQuery, { pageSize = 200, maxPages = 25 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const query = `${buildQuery()} limit ${pageSize}${offset ? ` offset ${offset}` : ''}`;
    const json = await coql(query);
    const batch = (json && json.data) || [];
    rows.push(...batch);
    if (!json.info || !json.info.more_records) break;
  }
  return rows;
}

// The refresh grant reports almost everything as "invalid_code", so the message
// has to name the handful of things that actually cause it.
function explainRefreshError(code) {
  const key = String(code || '').toLowerCase();
  if (key === 'invalid_code') {
    return 'Zoho rejected ZOHO_REFRESH_TOKEN. Usually that means the grant code was saved instead of the refresh token, the token belongs to a different Self Client than ZOHO_CLIENT_ID, or it was issued in another data centre than ZOHO_ACCOUNTS_HOST';
  }
  if (key === 'invalid_client') {
    return 'Zoho rejected ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET: they do not match, or they belong to a Self Client in another data centre';
  }
  if (key === 'invalid_client_secret') {
    return 'ZOHO_CLIENT_SECRET does not match ZOHO_CLIENT_ID';
  }
  return 'Zoho refused to issue an access token';
}

module.exports = { getAccessToken, coql, coqlAll, API_HOST, ACCOUNTS_HOST, env, explainRefreshError };
