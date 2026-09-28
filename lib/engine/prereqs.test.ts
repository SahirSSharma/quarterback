import { describe, expect, it } from 'vitest';
import {
  chainQuarters, dependents, longestRemainingChain, missingGroups, prereqGroups, satisfied, transitiveDependents, unlocks,
} from './prereqs';

const set = (...codes: string[]) => new Set(codes);

describe('satisfied / missingGroups on real catalog rows', () => {
  it('CSE 100 needs (CSE 21|MATH 154|…) AND CSE 12 AND (CSE 15L|CSE 29|ECE 15)', () => {
    expect(satisfied('CSE 100', set('CSE 21', 'CSE 12', 'CSE 29'))).toBe(true);
    expect(satisfied('CSE 100', set('MATH 154', 'CSE 12', 'ECE 15'))).toBe(true);
    expect(satisfied('CSE 100', set('CSE 21', 'CSE 12'))).toBe(false);
    expect(missingGroups('CSE 100', set('CSE 12', 'CSE 29'))).toEqual([['CSE 21', 'MATH 154', 'MATH 158', 'MATH 184', 'MATH 188']]);
    expect(missingGroups('CSE 100', set('CSE 21', 'CSE 12', 'CSE 29'))).toEqual([]);
  });
  it('a course with no listed prerequisites is always satisfied, and so is an unknown code', () => {
    expect(prereqGroups('CSE 11')).toEqual([]);
    expect(satisfied('CSE 11', set())).toBe(true);
    expect(satisfied('NOPE 999', set())).toBe(true);
  });
  it('accepts unnormalized codes', () => {
    expect(satisfied('cse 30', set('CSE 29'))).toBe(true);
    expect(satisfied('CSE 30', set('cse 29'))).toBe(false); // the earned set itself must be normalized
  });
});

describe('dependents', () => {
  it('CSE 29 unlocks CSE 30 and CSE 100 among others', () => {
    const d = dependents('CSE 29');
    expect(d).toContain('CSE 30');
    expect(d).toContain('CSE 100');
    expect(d).toContain('CSE 55');
    expect(d).toEqual([...d].sort());
  });
  it('walks transitively, direct dependents first, and can filter the result', () => {
    const all = transitiveDependents('CSE 29');
    expect(all.indexOf('CSE 30')).toBeLessThan(all.indexOf('CSE 141')); // CSE 141 needs CSE 30
    expect(all).toContain('CSE 141');
    expect(all).not.toContain('CSE 29');
    const only = transitiveDependents('CSE 29', set('CSE 141', 'CSE 100'));
    expect(only).toEqual(['CSE 100', 'CSE 141']);
  });
  it('unlocks lists only courses whose last missing group this course fills', () => {
    // CSE 30 needs (CSE 15L|CSE 29|ECE 15) only; CSE 100 also needs CSE 21 and CSE 12.
    expect(unlocks('CSE 29', set('CSE 11', 'CSE 12'))).toContain('CSE 30');
    expect(unlocks('CSE 29', set('CSE 11', 'CSE 12'))).not.toContain('CSE 100');
    expect(unlocks('CSE 29', set('CSE 11', 'CSE 12', 'CSE 21'))).toContain('CSE 100');
    expect(unlocks('CSE 29', set('CSE 30'))).not.toContain('CSE 30'); // already earned
  });
});

describe('chain length in quarters', () => {
  it('counts the quickest path through each AND group', () => {
    const earned = set('CSE 11', 'CSE 12', 'CSE 20', 'MATH 20A', 'MATH 20B');
    expect(chainQuarters('CSE 12', earned)).toBe(0);
    expect(chainQuarters('CSE 29', earned)).toBe(1); // CSE 11 is earned; the snapshot's spurious [CSE 15L] group is overridden
    expect(chainQuarters('CSE 21', earned)).toBe(1);
    expect(chainQuarters('CSE 100', earned)).toBe(2); // quickest: CSE 21 and CSE 15L (or ECE 15) in one quarter, then CSE 100
    expect(chainQuarters('CSE 141', earned)).toBe(4); // … → CSE 30 → CSE 141 (CSE 140 branch is shorter)
  });
  it('longestRemainingChain takes the slowest target', () => {
    const earned = set('CSE 11', 'CSE 12', 'CSE 20', 'CSE 29', 'CSE 21');
    expect(longestRemainingChain(['CSE 100', 'CSE 30'], earned)).toBe(1);
    expect(longestRemainingChain(['CSE 100', 'CSE 141'], earned)).toBe(3); // CSE 30 → CSE 140 → CSE 141
    expect(longestRemainingChain([], earned)).toBe(0);
  });
});
