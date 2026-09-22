import { timingSafeEqual } from 'node:crypto';

/**
 * The /setup page hands out a refresh token, so it is gated by its own secret,
 * separate from APP_PASSWORD. With SETUP_KEY unset the whole page is disabled —
 * closed by default rather than open by default.
 */
export function setupKeyValid(candidate: string | null | undefined): boolean {
  const expected = process.env.SETUP_KEY;
  if (!expected) return false;
  const a = Buffer.from(candidate ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function setupEnabled(): boolean {
  return Boolean(process.env.SETUP_KEY);
}
