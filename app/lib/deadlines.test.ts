import { describe, it, expect } from 'vitest';
import { currentTermFromCalendar, deadlinesFor, termStart } from './deadlines';

describe('deadlinesFor', () => {
  it('reads the verified Fall 2026 dates for the requested term', () => {
    const d = deadlinesFor('FA26', new Date('2026-09-27T20:00:00Z'));
    expect(d.map((x) => [x.key, x.date])).toEqual([
      ['dropWithoutW', '2026-10-23'],
      ['changeUnits', '2026-11-06'],
      ['changeGradingOption', '2026-11-06'],
      ['dropWithW', '2026-11-06'],
    ]);
    expect(d.every((x) => x.term === 'FA26' && !x.passed)).toBe(true);
  });

  it('marks a deadline passed only after 11:59 p.m. PT of its day', () => {
    // 06:00Z on Oct 24 is still 23:00 PDT on Oct 23.
    expect(deadlinesFor('FA26', new Date('2026-10-24T06:00:00Z'))[0].passed).toBe(false);
    expect(deadlinesFor('FA26', new Date('2026-10-24T08:00:00Z'))[0].passed).toBe(true);
    const nov = deadlinesFor('FA26', new Date('2026-11-01T12:00:00Z'));
    expect(nov.map((x) => x.passed)).toEqual([true, false, false, false]);
  });

  it('is a parameter, not a constant: Winter differs from Fall', () => {
    expect(deadlinesFor('WI27', new Date('2026-09-27T20:00:00Z'))[0].date).toBe('2027-01-29');
    expect(deadlinesFor('FA99', new Date())).toEqual([]);
  });

  it('knows when instruction begins', () => {
    expect(termStart('WI27')).toBe('2027-01-04');
    expect(termStart('FA27')).toBeNull();
  });

  it('derives the current term from the calendar instead of a constant', () => {
    expect(currentTermFromCalendar(new Date('2026-09-27T20:00:00Z'))).toBe('FA26');
    expect(currentTermFromCalendar(new Date('2026-12-20T20:00:00Z'))).toBe('WI27'); // between quarters → next
    expect(currentTermFromCalendar(new Date('2027-02-01T20:00:00Z'))).toBe('WI27');
    expect(currentTermFromCalendar(new Date('2027-08-01T20:00:00Z'))).toBe('SP27'); // past the calendar → last known
  });
});
