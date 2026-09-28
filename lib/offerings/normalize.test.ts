import { describe, it, expect } from 'vitest';
import { normalizeCourseCode, stripMarkdownLinks, termCode, termOrder } from './normalize';

describe('normalizeCourseCode', () => {
  it.each([
    ['CSE-003', 'CSE 3'],
    ['CSE-008A', 'CSE 8A'],
    ['CSE-004GS', 'CSE 4GS'],
    ['CSE-100R', 'CSE 100R'],
    ['CSE-190', 'CSE 190'],
    ['ECE 005', 'ECE 5'],
    ['ECE111', 'ECE 111'],
    ['ece159', 'ECE 159'],
    ['MATH 20C', 'MATH 20C'],
    ['math 18', 'MATH 18'],
    ['[MATH 18](http://www.ucsd.edu/catalog/courses/MATH.html#math18)', 'MATH 18'],
    ['[ECE 005](http://x/#ece5)  [Experience ECE: Making, Breaking, Hacking Stuff](http://x/#ece5)', 'ECE 5'],
  ])('%s → %s', (raw, code) => {
    expect(normalizeCourseCode(raw)).toBe(code);
  });

  it('returns null when there is no course code', () => {
    expect(normalizeCourseCode('Advanced Digital Design Project')).toBeNull();
    expect(normalizeCourseCode('Course #')).toBeNull();
    expect(normalizeCourseCode('')).toBeNull();
  });
});

describe('stripMarkdownLinks', () => {
  it('keeps the link text', () => {
    expect(stripMarkdownLinks('a [b](http://c) d')).toBe('a b d');
  });
});

describe('termCode', () => {
  it.each<[string, string | undefined, string | null]>([
    ['Fall 2026', undefined, 'FA26'],
    ['Winter 2027', undefined, 'WI27'],
    ['Spring 2027', undefined, 'SP27'],
    ['FALL 26', undefined, 'FA26'],
    ['WINTER 27', undefined, 'WI27'],
    ['SPRING 27', undefined, 'SP27'],
    ['FALL', '2026-2027', 'FA26'],
    ['WINTER', '2026-2027', 'WI27'],
    ['SPRING', '2026-2027', 'SP27'],
    ['FA26', undefined, 'FA26'],
    ['s127', undefined, 'S127'],
    ['SU27 (TBD)', undefined, null], // summer session unknown
    ['FALL', undefined, null], // bare season without an academic year
    ['COURSE NAME', '2026-2027', null],
    ['LECT', undefined, null],
    ['Title', undefined, null],
    ['Course #', undefined, null],
  ])('%s (%s) → %s', (label, year, code) => {
    expect(termCode(label, year)).toBe(code);
  });
});

describe('termOrder', () => {
  it('sorts quarters chronologically across the year boundary', () => {
    const sorted = ['SP27', 'FA27', 'FA26', 'S127', 'WI27'].sort((a, b) => termOrder(a) - termOrder(b));
    expect(sorted).toEqual(['FA26', 'WI27', 'SP27', 'S127', 'FA27']);
  });
});
