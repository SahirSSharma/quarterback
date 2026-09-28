import { describe, it, expect } from 'vitest';
import { planHash } from './planHash';

const terms = [
  { term: 'WI27', courses: ['CSE 29', 'CSE 105', 'MATH 183', 'HUM 5'], units: 16 },
  { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'CSE 151A', 'COGS 1'], units: 16 },
];

describe('planHash', () => {
  it('is eight lowercase hex characters', () => {
    expect(planHash(terms)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('ignores course order within a term', () => {
    const shuffled = terms.map((t) => ({ ...t, courses: [...t.courses].reverse() }));
    expect(planHash(shuffled)).toBe(planHash(terms));
  });
  it('changes when a course moves between terms', () => {
    const moved = [
      { ...terms[0], courses: ['CSE 29', 'CSE 105', 'MATH 183'] },
      { ...terms[1], courses: [...terms[1].courses, 'HUM 5'] },
    ];
    expect(planHash(moved)).not.toBe(planHash(terms));
  });
  it('is deterministic', () => {
    expect(planHash(terms)).toBe(planHash(JSON.parse(JSON.stringify(terms))));
  });
});
