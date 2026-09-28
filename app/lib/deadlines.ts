// Registrar deadlines for a term, from data/registrar-calendar.json. The term is always a parameter.
import calendar from '@/data/registrar-calendar.json';
import type { Deadline, TermCode } from '@/lib/types';
import { laDateString } from './format';

interface CalendarTerm {
  name: string;
  quarterBegins: string;
  quarterEnds: string;
  instructionBegins: string;
  dropWithoutW: string;
  changeUnits: string;
  changeGradingOption: string;
  dropWithW: string;
}

const terms = calendar.terms as Record<string, CalendarTerm>;

const LABELS: Record<Deadline['key'], string> = {
  dropWithoutW: 'Drop without a W',
  changeUnits: 'Change units',
  changeGradingOption: 'Switch to P/NP',
  dropWithW: 'Drop with a W',
};

/** Deadlines for `term`, `passed` judged on the LA calendar day (deadlines are 11:59 p.m. PT). */
export function deadlinesFor(term: TermCode, now: Date): Deadline[] {
  const t = terms[term];
  if (!t) return [];
  const today = laDateString(now);
  return (Object.keys(LABELS) as Deadline['key'][]).map((key) => ({
    key,
    label: LABELS[key],
    date: t[key],
    term,
    passed: t[key] < today,
  }));
}

/** First day of instruction for a term, or null when the calendar does not cover it. */
export function termStart(term: TermCode): string | null {
  return terms[term]?.instructionBegins ?? null;
}

/** The term in progress on the LA calendar day of `now`, else the next one to begin, else the last known. */
export function currentTermFromCalendar(now: Date): TermCode {
  const today = laDateString(now);
  const codes = Object.keys(terms).sort((a, b) => terms[a].quarterBegins.localeCompare(terms[b].quarterBegins));
  const inProgress = codes.find((c) => terms[c].quarterBegins <= today && today <= terms[c].quarterEnds);
  return inProgress ?? codes.find((c) => terms[c].quarterBegins > today) ?? codes[codes.length - 1];
}
