import { describe, it, expect } from 'vitest';
import { buildIcs, foldLine, icsEscape } from './ics';
import type { Deadline } from '@/lib/types';

const now = new Date('2026-09-27T20:00:00Z');
const deadlines: Deadline[] = [
  { key: 'dropWithoutW', label: 'Drop without a W', date: '2026-10-23', term: 'FA26', passed: false },
  { key: 'dropWithW', label: 'Drop with a W', date: '2026-11-06', term: 'FA26', passed: false },
];
const terms = [
  { term: 'WI27', courses: ['CSE 29', 'CSE 105', 'MATH 183', 'HUM 5'], units: 16 },
  { term: 'FA27', courses: ['CSE 150B'], units: 4 },
];

describe('ics', () => {
  it('escapes text per RFC 5545', () => {
    expect(icsEscape('a, b; c\\d\nnext')).toBe('a\\, b\; c\\\\d\\nnext');
  });

  it('folds long lines at 75 octets with a leading space, without splitting multi-byte characters', () => {
    const long = 'SUMMARY:' + 'x'.repeat(70) + 'é' + 'y'.repeat(20);
    const folded = foldLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBe(2);
    expect(new TextEncoder().encode(parts[0]).length).toBeLessThanOrEqual(75);
    expect(parts[1].startsWith(' ')).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long); // unfolding restores the line
    expect(foldLine('short')).toBe('short');
  });

  it('emits one all-day event per deadline and per planned term with a known start', () => {
    const ics = buildIcs({ uid: 'apr_1', label: 'Balanced plan', deadlines, terms, termStarts: { WI27: '2027-01-04', FA27: null }, now });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(3); // 2 deadlines + WI27; FA27 has no calendar date
    expect(ics).toContain('DTSTART;VALUE=DATE:20261023');
    expect(ics).toContain('DTEND;VALUE=DATE:20261024');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270104');
    expect(ics).toContain('UID:apr_1-FA26-dropWithoutW@quarterback');
    expect(ics).toContain('DTSTAMP:20260927T200000Z');
    // Commas inside the course list are escaped, and only CRLF line endings are used.
    expect(ics).toContain('CSE 29\\, CSE 105');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
