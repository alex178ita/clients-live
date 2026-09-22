// Zoho CRM REST access with the app's own OAuth refresh token.
// Scopes required: ZohoCRM.coql.READ, ZohoCRM.modules.deals.READ, ZohoCRM.users.READ

const ACCOUNTS_HOST = process.env.ZOHO_ACCOUNTS_HOST || 'https://accounts.zoho.eu';
const API_HOST = process.env.ZOHO_API_HOST || 'https://www.zohoapis.eu';

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    client_id: process.env.ZOHO_CLIENT_ID || '',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token'
  });

  const res = await fetch(`${ACCOUNTS_HOST}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(json)}`);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 3_600_000)
  };
  return cachedToken.value;
}

async function coql(selectQuery) {
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
    // A stale in-memory access token survives a refresh-token change until the
    // lambda is recycled; drop it so the next call re-authenticates.
    if (res.status === 401) cachedToken = null;
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

module.exports = { getAccessToken, coql, coqlAll, API_HOST };
