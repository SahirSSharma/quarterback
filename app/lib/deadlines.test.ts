import { describe, it, expect } from 'vitest';
import { currentTermFromCalendar, deadlineHeadline, deadlinesFor, icsCoverage, termStart } from './deadlines';

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

describe('deadlineHeadline', () => {
  const before = deadlinesFor('FA26', new Date('2026-10-01T20:00:00Z'));
  const afterNoW = deadlinesFor('FA26', new Date('2026-10-30T20:00:00Z'));
  const afterAll = deadlinesFor('FA26', new Date('2026-11-10T20:00:00Z'));

  it('says nothing while the relevant deadline is ahead', () => {
    expect(deadlineHeadline('drop', before)).toBeNull();
    expect(deadlineHeadline('pnp', before)).toBeNull();
    expect(deadlineHeadline('keep', afterAll)).toBeNull();
  });

  it('names the passed drop deadline and what a drop now means', () => {
    expect(deadlineHeadline('drop', afterNoW)).toBe('The drop-without-a-W deadline passed on Oct 23, 2026; a drop before Nov 6, 2026 records a W.');
    expect(deadlineHeadline('drop', afterAll)).toBe('Both drop deadlines for Fall 2026 have passed (Oct 23, 2026 and Nov 6, 2026); a drop now needs college approval.');
  });

  it('names the passed grading-option deadline for P/NP', () => {
    expect(deadlineHeadline('pnp', afterNoW)).toBeNull(); // Nov 6 is still ahead on Oct 30
    expect(deadlineHeadline('pnp', afterAll)).toBe('The grading-option deadline for Fall 2026 passed on Nov 6, 2026.');
  });
});

describe('icsCoverage', () => {
  it('splits planned terms into dated (on the calendar) and listed-only', () => {
    expect(icsCoverage(['WI27', 'SP27', 'FA27'])).toEqual({ dated: ['WI27', 'SP27'], undated: ['FA27'] });
    expect(icsCoverage([])).toEqual({ dated: [], undated: [] });
  });
});
