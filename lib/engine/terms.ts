// Quarter arithmetic and registrar deadlines. Thin wrapper over the vendored quarters.js so the rest of the
// engine never spells a quarter code by hand. Pure: `now` is always a parameter.
import { qIndex, qLabel, qStep } from '../vendor/tritonplan/quarters.js';
import type { Deadline, TermCode } from '../types';
import { registrarCalendar } from './data';

export const isTerm = (code: string): boolean => qIndex(code) != null;

/** 'Fall 2026' for 'FA26'; unknown codes print themselves. */
export const label = (term: TermCode): string => qLabel(term);

/** The n-th MAIN quarter after `term` (negative n steps back). Summers are skipped, as the planner board does. */
export function next(term: TermCode, n = 1): TermCode {
  const t = qStep(term, n);
  if (!t) throw new Error(`not a quarter code: ${term}`);
  return t;
}

/** Chronological comparator; non-quarter codes ('XFER') sort last. */
export function compare(a: TermCode, b: TermCode): number {
  return (qIndex(a) ?? Infinity) - (qIndex(b) ?? Infinity);
}

/** Main quarters from `from` to `to` (0 when equal, negative when `to` is earlier). A summer `to` rounds up. */
export function between(from: TermCode, to: TermCode): number {
  const target = qIndex(to);
  if (target == null || qIndex(from) == null) throw new Error(`not quarter codes: ${from}, ${to}`);
  let cursor = from;
  let n = 0;
  const dir = compare(from, to) <= 0 ? 1 : -1;
  while (dir > 0 ? (qIndex(cursor) as number) < target : (qIndex(cursor) as number) > target) {
    cursor = next(cursor, dir);
    n += dir;
    if (Math.abs(n) > 400) throw new Error('between(): runaway');
  }
  return n;
}

/** The next n main quarters after `term`, in order. */
export function mainQuartersAfter(term: TermCode, n: number): TermCode[] {
  const out: TermCode[] = [];
  for (let i = 1; i <= n; i++) out.push(next(term, i));
  return out;
}

const DEADLINE_LABELS: Record<Deadline['key'], string> = {
  dropWithoutW: 'Drop without a W',
  changeUnits: 'Change units',
  changeGradingOption: 'Change grading option (P/NP)',
  dropWithW: 'Drop with a W',
};

/** Calendar date in Pacific time, 'YYYY-MM-DD'. Deadlines are 11:59 pm PT, so a day-level compare is exact. */
export function pacificDate(now: Date | string): string {
  const d = typeof now === 'string' ? new Date(now) : now;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Registrar deadlines for a term with `passed` judged against `now`. Empty when the calendar has no such term. */
export function deadlinesFor(term: TermCode, now: Date | string): Deadline[] {
  const cal = registrarCalendar().terms[String(term).toUpperCase()];
  if (!cal) return [];
  const today = pacificDate(now);
  return (Object.keys(DEADLINE_LABELS) as Deadline['key'][]).map((key) => ({
    key,
    label: DEADLINE_LABELS[key],
    date: cal[key],
    term: String(term).toUpperCase(),
    passed: today > cal[key],
  }));
}
