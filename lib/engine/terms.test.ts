import { describe, expect, it } from 'vitest';
import { between, compare, deadlinesFor, isTerm, label, mainQuartersAfter, next, pacificDate } from './terms';

describe('quarter arithmetic', () => {
  it('steps through main quarters only', () => {
    expect(next('FA26')).toBe('WI27');
    expect(next('FA26', 2)).toBe('SP27');
    expect(next('FA26', 3)).toBe('FA27');
    expect(next('WI27', -1)).toBe('FA26');
    expect(mainQuartersAfter('FA26', 3)).toEqual(['WI27', 'SP27', 'FA27']);
  });
  it('orders chronologically, XFER last', () => {
    expect(compare('FA26', 'WI27')).toBeLessThan(0);
    expect(compare('SP27', 'WI27')).toBeGreaterThan(0);
    expect(compare('FA26', 'XFER')).toBeLessThan(0);
    expect(isTerm('XFER')).toBe(false);
    expect(label('FA26')).toBe('Fall 2026');
  });
  it('counts quarters between terms in both directions', () => {
    expect(between('FA26', 'FA26')).toBe(0);
    expect(between('FA26', 'SP27')).toBe(2);
    expect(between('SP27', 'FA26')).toBe(-2);
    expect(between('SP26', 'S126')).toBe(1); // a summer rounds up to the next main quarter
  });
  it('rejects non-quarters', () => {
    expect(() => next('XFER')).toThrow();
  });
});

describe('deadlinesFor', () => {
  it('returns the four FA26 deadlines, none passed on Oct 1', () => {
    const d = deadlinesFor('FA26', '2026-10-01T12:00:00-07:00');
    expect(d.map((x) => [x.key, x.date])).toEqual([
      ['dropWithoutW', '2026-10-23'],
      ['changeUnits', '2026-11-06'],
      ['changeGradingOption', '2026-11-06'],
      ['dropWithW', '2026-11-06'],
    ]);
    expect(d.every((x) => !x.passed)).toBe(true);
    expect(d.every((x) => x.term === 'FA26')).toBe(true);
  });
  it('keeps Oct 23 open until midnight Pacific and closes it on Oct 24', () => {
    const late = deadlinesFor('FA26', '2026-10-23T23:30:00-07:00');
    expect(late.find((x) => x.key === 'dropWithoutW')!.passed).toBe(false);
    // 06:30 UTC on Oct 24 is still 23:30 PDT on Oct 23.
    expect(deadlinesFor('FA26', '2026-10-24T06:30:00Z').find((x) => x.key === 'dropWithoutW')!.passed).toBe(false);
    const after = deadlinesFor('FA26', '2026-10-24T08:00:00-07:00');
    expect(after.find((x) => x.key === 'dropWithoutW')!.passed).toBe(true);
    expect(after.find((x) => x.key === 'dropWithW')!.passed).toBe(false);
  });
  it('marks everything passed after Nov 6 and handles a Date object', () => {
    const d = deadlinesFor('FA26', new Date('2026-11-07T12:00:00-08:00'));
    expect(d.every((x) => x.passed)).toBe(true);
  });
  it('returns [] for a term the calendar does not carry', () => {
    expect(deadlinesFor('FA27', '2026-10-01')).toEqual([]);
  });
  it('converts instants to Pacific calendar dates', () => {
    expect(pacificDate('2026-10-24T06:59:00Z')).toBe('2026-10-23');
    expect(pacificDate('2026-10-24T07:00:00Z')).toBe('2026-10-24');
  });
});
