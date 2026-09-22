// Thin REST client for Zoho CRM, Zoho Books and Zoho Billing.
// The app talks to Zoho with its own OAuth refresh token (self client),
// exactly like Margin by Client and the other Kleecks BI apps.

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.eu';
const API = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.eu';

export const ORG_ID = process.env.ZOHO_ORG_ID || '';

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;
let inFlight: Promise<string> | null = null;

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    /** Which Zoho endpoint refused, so the UI can say what to fix. */
    readonly endpoint: string = '',
  ) {
    super(message);
    this.name = 'ZohoError';
  }
}

async function requestAccessToken(): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new ZohoError(
      'Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.',
      500,
      '',
    );
  }
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: { access_token?: string; expires_in?: number; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new ZohoError('Zoho token endpoint returned a non-JSON response.', res.status, text);
  }
  if (!json.access_token) {
    throw new ZohoError(`Zoho token refresh failed: ${json.error ?? 'unknown error'}`, res.status, text);
  }
  tokenState = {
    accessToken: json.access_token,
    // Refresh a minute early to avoid using a token that expires mid-request.
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
  return tokenState.accessToken;
}

/**
 * @param force      mint a new access token even if the cached one looks valid
 * @param staleToken the token that just failed — guarantees we come back with a
 *                   different one rather than joining a refresh that started
 *                   before the failure and would hand back the same stale token
 */
export async function getAccessToken(force = false, staleToken?: string): Promise<string> {
  if (!force && tokenState && tokenState.expiresAt > Date.now()) return tokenState.accessToken;

  // Another request may already have refreshed after our failure: reuse that.
  if (
    staleToken &&
    tokenState &&
    tokenState.accessToken !== staleToken &&
    tokenState.expiresAt > Date.now()
  ) {
    return tokenState.accessToken;
  }

  if (!inFlight) {
    inFlight = requestAccessToken().finally(() => {
      inFlight = null;
    });
  }
  const token = await inFlight;

  // We joined a refresh that had started before our failure and it gave us the
  // same dead token: mint one of our own.
  if (staleToken && token === staleToken) {
    inFlight = requestAccessToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  return token;
}

interface ZohoFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Set to false for endpoints that must not be retried on 401. */
  retryOnAuthFailure?: boolean;
}

async function zohoFetch(path: string, options: ZohoFetchOptions = {}): Promise<any> {
  const { method = 'GET', body, headers = {}, retryOnAuthFailure = true } = options;

  const run = async (token: string) => {
    const res = await fetch(`${API}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  };

  let token = await getAccessToken();
  let res = await run(token);

  // A warm lambda can hold an access token that Zoho has since invalidated:
  // either because the refresh token was rotated or new scopes were granted, or
  // because Zoho caps the number of live access tokens per refresh token and
  // evicted the oldest one. Both show up as a 401 and both are fixed by minting
  // a fresh token, so we retry twice before giving up.
  const looksLikeDeadToken = (body: string) =>
    /INVALID_TOKEN|INVALID_OAUTHTOKEN|"code"\s*:\s*57|OAUTH_SCOPE_MISMATCH|AUTHENTICATION_FAILURE/i.test(
      body,
    );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!retryOnAuthFailure) break;
    if (res.status !== 401 && res.status !== 400) break;
    const peek = await res.clone().text();
    if (!looksLikeDeadToken(peek)) break;
    const stale = token;
    token = await getAccessToken(true, stale);
    if (token === stale) break; // nothing new to try
    res = await run(token);
  }

  const text = await res.text();
  if (res.status === 204 || text.trim() === '') return null;

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ZohoError(
      `Zoho returned a non-JSON response for ${path}`,
      res.status,
      text.slice(0, 500),
      path,
    );
  }
  if (!res.ok) {
    // Zoho puts its own error code in different places depending on the product:
    // Books/Billing use a numeric "code", CRM a string code inside data[0].
    const code = json?.code ?? json?.data?.[0]?.code;
    const base = json?.message || json?.data?.[0]?.message || json?.error || 'request failed';
    const suffix = code === undefined || code === 0 ? '' : ` [Zoho code ${code}]`;
    throw new ZohoError(`${base}${suffix}`, res.status, text.slice(0, 500), path);
  }
  return json;
}

/* --------------------------------------------------- Setup / diagnostics */

/**
 * Exchanges the short-lived grant code from the Zoho self client for a
 * permanent refresh token, using this app's own client id and secret.
 * The code is valid for a few minutes only.
 */
export async function exchangeAuthCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  apiDomain: string | null;
  expiresIn: number | null;
}> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ZohoError('ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not set on this deployment.', 500, '');
  }
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: code.trim(),
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ZohoError('Zoho returned a non-JSON response to the code exchange.', res.status, text.slice(0, 300));
  }
  if (!json.refresh_token) {
    // Zoho answers 200 with {"error":"invalid_code"} and friends.
    throw new ZohoError(
      `No refresh token returned: ${json.error ?? 'unknown error'}`,
      res.status,
      text.slice(0, 300),
      '/oauth/v2/token',
    );
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token ?? '',
    apiDomain: json.api_domain ?? null,
    expiresIn: json.expires_in ?? null,
  };
}

/** Mints an access token from an arbitrary refresh token, bypassing the cache. */
export async function mintAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ZohoError('ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not set on this deployment.', 500, '');
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken.trim(),
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ZohoError('Zoho returned a non-JSON response to the token refresh.', res.status, text.slice(0, 300));
  }
  if (!json.access_token) {
    throw new ZohoError(
      `Token refresh failed: ${json.error ?? 'unknown error'}`,
      res.status,
      text.slice(0, 300),
      '/oauth/v2/token',
    );
  }
  return json.access_token;
}

/** One read-only call against a product, to see whether the token may do it. */
export async function probe(
  accessToken: string,
  path: string,
  options: { headers?: Record<string, string>; method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; message: string }> {
  const { headers = {}, method = 'GET', body } = options;
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep json null and fall back to the raw text below
  }
  const zohoCode = json?.code ?? json?.data?.[0]?.code;
  // Books and Billing answer 200 with code 0 on success; CRM answers 200/204.
  const ok = res.ok && (zohoCode === undefined || zohoCode === 0);
  const message = ok
    ? 'ok'
    : `${json?.message ?? json?.data?.[0]?.message ?? text.slice(0, 160) ?? 'failed'}${
        zohoCode === undefined || zohoCode === 0 ? '' : ` [Zoho code ${zohoCode}]`
      }`;
  return { ok, status: res.status, message };
}

/* ------------------------------------------------------------------ CRM */

export async function coql(selectQuery: string): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  const limit = 200;
  // COQL caps at 2000 rows per query through paging; we page until exhausted.
  for (let page = 0; page < 40; page += 1) {
    const query = `${selectQuery} limit ${limit} offset ${offset}`;
    const json = await zohoFetch('/crm/v7/coql', {
      method: 'POST',
      body: { select_query: query },
    });
    const rows: any[] = json?.data ?? [];
    out.push(...rows);
    if (!json?.info?.more_records || rows.length === 0) break;
    offset += limit;
  }
  return out;
}

/* ---------------------------------------------------------------- Books */

async function booksList(resource: string, params: Record<string, string> = {}): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 60; page += 1) {
    const search = new URLSearchParams({
      organization_id: ORG_ID,
      per_page: '200',
      page: String(page),
      ...params,
    });
    const json = await zohoFetch(`/books/v3/${resource}?${search.toString()}`);
    const rows: any[] = json?.[resource] ?? [];
    out.push(...rows);
    if (!json?.page_context?.has_more_page || rows.length === 0) break;
  }
  return out;
}

export function listBooksInvoices(params: Record<string, string> = {}) {
  return booksList('invoices', params);
}

export function listBooksCreditNotes(params: Record<string, string> = {}) {
  return booksList('creditnotes', params);
}

/**
 * Full credit note, which is the only place Zoho exposes which invoices it was
 * applied to (`invoices[]` with invoice_id and amount) — the list endpoint does
 * not carry that link.
 */
export async function getBooksCreditNote(creditNoteId: string): Promise<any> {
  const search = new URLSearchParams({ organization_id: ORG_ID });
  const json = await zohoFetch(`/books/v3/creditnotes/${creditNoteId}?${search.toString()}`);
  return json?.creditnote ?? null;
}

/** Full invoice record: sub_total, tax and the payments applied to it. */
export async function getBooksInvoice(invoiceId: string): Promise<any> {
  const search = new URLSearchParams({ organization_id: ORG_ID });
  const json = await zohoFetch(`/books/v3/invoices/${invoiceId}?${search.toString()}`);
  return json?.invoice ?? null;
}

/* -------------------------------------------------------------- Billing */

export async function listBillingSubscriptions(): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const search = new URLSearchParams({
      per_page: '200',
      page: String(page),
      filter_by: 'SubscriptionStatus.All',
    });
    const json = await zohoFetch(`/billing/v1/subscriptions?${search.toString()}`, {
      headers: { 'X-com-zoho-subscriptions-organizationid': ORG_ID },
    });
    const rows: any[] = json?.subscriptions ?? [];
    out.push(...rows);
    if (!json?.page_context?.has_more_page || rows.length === 0) break;
  }
  return out;
}
