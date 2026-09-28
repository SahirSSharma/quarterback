import { describe, expect, it } from 'vitest';
import type { ApprovalRecord } from '../types';
import { icsFor } from './ics';
import { NOW, sampleRun } from './test-fixture';

const approval: ApprovalRecord = { id: 'apr_abc123def456', at: NOW, planHash: 'h', planId: 'p-fastest', overrides: [], ledger: [] };
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const events = (ics: string) => unfold(ics).split('BEGIN:VEVENT').slice(1).map((e) => e.split('END:VEVENT')[0]);

describe('icsFor', () => {
  const ics = icsFor(sampleRun(), approval);

  it('is a well-formed RFC 5545 calendar: CRLF only, folded at 75 octets, stamped with the approval time', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain('DTSTAMP:20260927T200000Z');
    expect(unfold(ics)).not.toMatch(/nemotron|model|agent/i);
  });

  it('has the current term deadlines plus one all-day event per planned course in a term the calendar knows', () => {
    const evs = events(ics);
    // 4 FA26 deadlines + 4 WI27 courses + 4 SP27 courses; FA27 (2 courses) is not on the 2026–27 calendar.
    expect(evs).toHaveLength(12);
    expect(ics).toContain('UID:apr_abc123def456-FA26-dropWithoutW@quarterback');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261023');
    expect(ics).toContain('DTEND;VALUE=DATE:20261024');
    expect(unfold(ics)).toContain('SUMMARY:Drop without a W — Fall 2026');
    const cse29 = evs.find((e) => e.includes('UID:apr_abc123def456-WI27-CSE29@quarterback'))!;
    expect(cse29).toContain('DTSTART;VALUE=DATE:20270104'); // WI27 instruction begins
    expect(cse29).toContain('DTEND;VALUE=DATE:20270105');
    expect(cse29).toContain('SUMMARY:CSE 29 — Winter 2027');
    expect(cse29).toContain('DESCRIPTION:Fastest plan: CSE 29\\, CSE 105\\, CSE 194\\, MATH 183 (16 units).');
    expect(evs.find((e) => e.includes('-SP27-CSE30@'))).toContain('DTSTART;VALUE=DATE:20270329');
    expect(unfold(ics)).not.toContain('CSE 150B — Fall 2027');
  });

  it('adds a note for a term without calendar dates instead of inventing one', () => {
    const notes = unfold(ics).split('\r\n').filter((l) => l.startsWith('X-QB-NOTE:'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Fall 2027 is not on the registrar calendar yet');
    expect(notes[0]).toContain('2 planned courses');
  });

  it('puts verifier flags and the refusal evidence on the affected course, escaped', () => {
    const cse194 = events(ics).find((e) => e.includes('-WI27-CSE194@'))!;
    expect(cse194).toContain('Flag (assumed-offered): CSE 194 in Winter 2027 has no instructor');
    expect(cse194).toContain('Refused: The fastest plan only saves a quarter');
    expect(cse194).toContain('Source: "CSE-194\\,"Race\\, Gender\\, and Computing"\\,Imani Munyaka\\,\\," https://cse.ucsd.edu');
    expect(cse194).toContain('First day of instruction.\\nFlag'); // lines joined with an escaped newline
    const cse105 = events(ics).find((e) => e.includes('-WI27-CSE105@'))!;
    expect(cse105).not.toContain('Flag');
    expect(cse105).not.toContain('Refused');
  });

  it('a clean plan carries no flags and no notes; the deadlines follow the run, not a constant', () => {
    const run = sampleRun({ state: { ...sampleRun().state, currentTerm: 'WI27' } });
    const out = icsFor(run, { ...approval, planId: 'p-balanced' });
    expect(events(out)).toHaveLength(4 + 4 + 4);
    expect(out).toContain('UID:apr_abc123def456-WI27-dropWithoutW@quarterback');
    expect(out).toContain('DTSTART;VALUE=DATE:20270129');
    expect(unfold(out)).not.toContain('X-QB-NOTE');
    expect(unfold(out)).not.toContain('Flag (');
  });

  it('refuses an approval whose plan is not on the run', () => {
    expect(() => icsFor(sampleRun(), { ...approval, planId: 'p-ghost' })).toThrow(/unknown plan p-ghost/);
  });
});
