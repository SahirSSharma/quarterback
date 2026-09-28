// Course-code and term-label normalization shared by the department-page parsers.
import type { CourseCode, TermCode } from '../types';

/** '[MATH 18](http://…)' → 'MATH 18'. */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** 'CSE-003' → 'CSE 3', 'ECE 005' → 'ECE 5', 'CSE-008A' → 'CSE 8A', 'MATH 20C' → 'MATH 20C'; null when no code is present. */
export function normalizeCourseCode(raw: string): CourseCode | null {
  const m = /\b([A-Z]{2,5})\s*-?\s*0*(\d+)([A-Z]{0,3})\b/.exec(stripMarkdownLinks(raw).toUpperCase());
  return m ? `${m[1]} ${m[2]}${m[3]}` : null;
}

const SEASON: Record<string, string> = { FALL: 'FA', FA: 'FA', WINTER: 'WI', WI: 'WI', SPRING: 'SP', SP: 'SP' };

/**
 * 'Fall 2026' | 'FALL 26' | 'FA26' → 'FA26'. A bare season ('FALL') needs the academic year ('2026-2027'):
 * fall belongs to the first year, winter and spring to the second. Summer columns return null because the
 * page does not say which session (S127/S227).
 */
export function termCode(label: string, academicYear?: string): TermCode | null {
  const text = label.trim().toUpperCase();
  if (/^(FA|WI|SP|S1|S2)\d{2}$/.test(text)) return text;
  const m = /^(FALL|FA|WINTER|WI|SPRING|SP)\b\s*'?(\d{4}|\d{2})?/.exec(text);
  if (!m) return null;
  const season = SEASON[m[1]];
  if (m[2]) return `${season}${m[2].slice(-2)}`;
  const years = academicYear && /^(\d{4})-(\d{4})$/.exec(academicYear);
  if (!years) return null;
  return `${season}${(season === 'FA' ? years[1] : years[2]).slice(-2)}`;
}

/** Sort key so that FA26 < WI27 < SP27 < S127 < S227 < FA27. */
export function termOrder(code: TermCode): number {
  const m = /^(WI|SP|S1|S2|FA)(\d{2})$/.exec(code);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[2]) * 10 + ['WI', 'SP', 'S1', 'S2', 'FA'].indexOf(m[1]);
}
