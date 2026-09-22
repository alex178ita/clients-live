// Small date helpers. Everything is handled as a plain yyyy-mm-dd string in UTC
// so that the Vercel runtime timezone can never shift an invoice into another month.

export function toISODate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // Zoho returns either "2026-09-15" or "2026-09-15T14:00:00+02:00".
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseISO(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function formatISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds whole months, clamping to the last day of the target month (31 Jan + 1m = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const d = parseISO(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatISO(target);
}

export function addDays(date: string, days: number): string {
  const d = parseISO(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISO(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86400000);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const end = `${to.slice(0, 7)}-01`;
  let guard = 0;
  while (cursor <= end && guard < 600) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return out;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
