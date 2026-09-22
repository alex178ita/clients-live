import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE = 'kwd_session';
/**
 * Inside the Zoho CRM Web Tab the app is a third-party iframe, and Chrome and
 * Safari now block plain third-party cookies. So the session token travels in
 * a request header (kept in sessionStorage by the client) and the cookie is
 * only a convenience for people opening the app directly.
 */
const HEADER = 'x-app-token';
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || 'kleecks-dev-secret';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function issueToken(): string {
  const expires = Date.now() + MAX_AGE * 1000;
  return `${expires}.${sign(String(expires))}`;
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true; // no password configured: the app is open
  const a = Buffer.from(candidate ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAuthenticated(request?: Request): boolean {
  if (!process.env.APP_PASSWORD) return true;
  // 1. The header the client sends — this is what works inside the CRM iframe.
  if (verifyToken(request?.headers.get(HEADER))) return true;
  // 2. The cookie, for a direct visit outside the iframe.
  try {
    return verifyToken(cookies().get(COOKIE)?.value);
  } catch {
    return false;
  }
}

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAX_AGE = MAX_AGE;
export const TOKEN_HEADER = HEADER;
