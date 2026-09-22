'use client';

/**
 * Client-side session handling.
 *
 * Inside the Zoho CRM Web Tab the app is a third-party iframe, where Chrome and
 * Safari block the session cookie. So the token issued by /api/auth is kept in
 * sessionStorage (which is partitioned per top-level site, but does work) and
 * sent back on every request as a header.
 */

const TOKEN_KEY = 'kwd_token';
export const TOKEN_HEADER = 'X-App-Token';

export function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode or storage blocked: the cookie fallback may still carry us.
  }
}

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing to do
  }
}

/** fetch() with the session header attached. */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = readToken();
  const headers = new Headers(init.headers);
  if (token) headers.set(TOKEN_HEADER, token);
  return fetch(input, { ...init, headers, credentials: 'include' });
}
