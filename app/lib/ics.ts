// iCalendar export: one all-day event per registrar deadline and one per planned term (on its first
// day of instruction, when the calendar knows it). RFC 5545: CRLF line ends, 75-octet folding,
// escaped text. Nothing here mentions how the plan was produced.
import type { Deadline, PlanTerm } from '@/lib/types';
import { formatUnits, termName } from './format';

export interface IcsInput {
  /** Stable prefix for UIDs, e.g. the approval id. */
  uid: string;
  label: string;
  deadlines: Deadline[];
  terms: PlanTerm[];
  /** First day of instruction per term; terms missing here get no event. */
  termStarts: Record<string, string | null>;
  now: Date;
}

export function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets (UTF-8), continuation lines start with one space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Never split inside a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((first ? '' : ' ') + new TextDecoder().decode(bytes.subarray(start, end)));
    start = end;
    first = false;
  }
  return out.join('\r\n');
}

function icsDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function event(uid: string, date: string, summary: string, description: string, now: Date): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${icsDate(date)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(date))}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
  ];
}

export function buildIcs(input: IcsInput): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Quarterback//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Quarterback',
  ];
  for (const d of input.deadlines) {
    lines.push(...event(
      `${input.uid}-${d.term}-${d.key}@quarterback`,
      d.date,
      `${d.label} — ${termName(d.term)}`,
      'Deadline is 11:59 p.m. PT. Source: UC San Diego Enrollment Calendar.',
      input.now,
    ));
  }
  for (const t of input.terms) {
    const start = input.termStarts[t.term];
    if (!start) continue;
    lines.push(...event(
      `${input.uid}-${t.term}-plan@quarterback`,
      start,
      `${termName(t.term)} plan: ${t.courses.join(', ')} (${formatUnits(t.units)})`,
      `${input.label}. Courses: ${t.courses.join(', ')}. First day of instruction.`,
      input.now,
    ));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
