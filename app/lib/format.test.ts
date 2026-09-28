import { describe, it, expect } from 'vitest';
import { daysUntil, formatCents, formatDate, formatDateTime, formatMs, formatTokens, formatUnits, laDateString, termName } from './format';

describe('format', () => {
  it('pluralises units', () => {
    expect(formatUnits(1)).toBe('1 unit');
    expect(formatUnits(16)).toBe('16 units');
    expect(formatUnits(2.5)).toBe('2.5 units');
  });

  it('renders ledger cost in cents until a dollar', () => {
    expect(formatCents(0)).toBe('0¢');
    expect(formatCents(0.011)).toBe('1.1¢');
    expect(formatCents(0.00025)).toBe('<0.1¢');
    expect(formatCents(0.0325)).toBe('3.3¢');
    expect(formatCents(1.234)).toBe('$1.23');
  });

  it('switches ms to seconds at one second', () => {
    expect(formatMs(380)).toBe('380 ms');
    expect(formatMs(999)).toBe('999 ms');
    expect(formatMs(6400)).toBe('6.4 s');
  });

  it('abbreviates tokens', () => {
    expect(formatTokens(900)).toBe('900');
    expect(formatTokens(21800)).toBe('21.8k');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });

  it('keeps a date-only deadline on its own calendar day in LA', () => {
    // A naive new Date('2026-10-23') is midnight UTC = Oct 22 in LA; the deadline is Oct 23.
    expect(formatDate('2026-10-23')).toBe('Oct 23, 2026');
    expect(formatDate('2026-11-06')).toBe('Nov 6, 2026');
  });

  it('renders instants in LA, flipping the day near LA midnight', () => {
    expect(formatDate('2026-09-27T23:30:00Z')).toBe('Sep 27, 2026'); // 16:30 PDT
    expect(formatDate('2026-09-28T05:30:00Z')).toBe('Sep 27, 2026'); // 22:30 PDT the day before
    expect(formatDateTime('2026-09-28T05:30:00Z')).toBe('Sep 27, 2026, 10:30 PM PT');
    expect(laDateString(new Date('2026-09-28T05:30:00Z'))).toBe('2026-09-27');
  });

  it('counts days to a deadline from the LA calendar day', () => {
    expect(daysUntil('2026-10-23', new Date('2026-09-27T12:00:00Z'))).toBe(26);
    expect(daysUntil('2026-10-23', new Date('2026-10-24T06:00:00Z'))).toBe(0); // still Oct 23 in LA
    expect(daysUntil('2026-10-23', new Date('2026-10-24T08:00:00Z'))).toBe(-1);
  });

  it('names terms from TritonPlan quarter codes', () => {
    expect(termName('FA26')).toBe('Fall 2026');
    expect(termName('WI27')).toBe('Winter 2027');
    expect(termName('SP27')).toBe('Spring 2027');
    expect(termName('S127')).toBe('Summer Session I 2027');
    expect(termName('XFER')).toBe('Transfer credit');
    expect(termName('??')).toBe('??');
  });
});
