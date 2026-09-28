// Display formatting. Every date is rendered in America/Los_Angeles because UCSD deadlines are
// "11:59 p.m. PT on the date posted"; a date-only ISO string is a calendar day, not an instant.
import type { TermCode } from '@/lib/types';

export const LA = 'America/Los_Angeles';

export function formatUnits(units: number): string {
  return `${units} ${units === 1 ? 'unit' : 'units'}`;
}

/** Cents for the ledger: 0.011 → "1.1¢"; whole dollars once it matters. */
export function formatCents(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  if (cents === 0) return '0¢';
  if (cents < 0.1) return '<0.1¢';
  return `${cents.toFixed(1)}¢`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A date-only string is pinned to noon UTC so it prints as the same calendar day in LA. */
function toDate(iso: string): Date {
  const m = DATE_ONLY.exec(iso);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return new Date(iso);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: LA, month: 'short', day: 'numeric', year: 'numeric' }).format(toDate(iso));
}

export function formatDateTime(iso: string): string {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: LA, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(toDate(iso));
  return `${s} PT`;
}

/** Calendar date in LA as YYYY-MM-DD, for comparing against deadline dates. */
export function laDateString(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Whole days from the LA calendar day of `now` to a date-only ISO string; negative when past. */
export function daysUntil(isoDate: string, now: Date): number {
  const a = toDate(laDateString(now)).getTime();
  const b = toDate(isoDate).getTime();
  return Math.round((b - a) / 86_400_000);
}

const SEASONS: Record<string, string> = {
  FA: 'Fall', WI: 'Winter', SP: 'Spring', S1: 'Summer Session I', S2: 'Summer Session II', S3: 'Summer Session III', SU: 'Summer',
};

/** 'WI27' → 'Winter 2027'; unknown codes pass through untouched. */
export function termName(code: TermCode): string {
  if (code === 'XFER') return 'Transfer credit';
  const m = /^([A-Z][A-Z0-9])(\d{2})$/.exec(code);
  if (!m || !SEASONS[m[1]]) return code;
  return `${SEASONS[m[1]]} 20${m[2]}`;
}
