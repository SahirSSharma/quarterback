import { describe, expect, it } from 'vitest';
import type { Impact } from '../types';
import { BODY_LIMIT, advisorMailto } from './mailto';
import { impact, plans, state } from './test-fixture';

const parts = (url: string) => {
  const u = new URL(url);
  return { subject: u.searchParams.get('subject')!, body: u.searchParams.get('body')! };
};

describe('advisorMailto', () => {
  const url = advisorMailto({ state, plan: plans[1], impact });

  it('is a properly encoded mailto with no recipient, CRLF body lines and nothing unescaped', () => {
    expect(url.startsWith('mailto:?subject=')).toBe(true);
    expect(url).toContain('&body=');
    expect(url).not.toMatch(/[\s"<>]/);
    expect(url).toContain('%0D%0A');
    const { body } = parts(url);
    expect(body.split('\r\n').length).toBeGreaterThan(8);
    expect(body).not.toContain('\n\n\n');
  });

  it('says what the student intends, by which deadline, the planned courses by term, and asks two questions', () => {
    const { subject, body } = parts(url);
    expect(subject).toBe('Checking my plan before the Oct 23, 2026 deadline (CSE 29)');
    expect(body).toContain('I am a Revelle College Artificial Intelligence student.');
    expect(body).toContain('planning to drop CSE 29 (Systems Programming and Software Tools).');
    expect(body).toContain('The "Drop without a W" deadline is Oct 23, 2026');
    expect(body).toContain('12 units this quarter.');
    expect(body).toContain('CSE 30 (1 quarter later), CSE 100 (1 quarter later), CSE 150B (3 quarters later)');
    expect(body).toContain('Planned courses:\r\nWinter 2027: CSE 29, CSE 105, MATH 183, HUM 5 (16 units)\r\nSpring 2027: CSE 30, CSE 100, CSE 151A, COGS 1 (16 units)');
    expect(body).toContain('Expected graduation: Spring 2029.');
    expect(body).toContain('\r\n1. Does this keep me on track to graduate in Spring 2029');
    expect(body).toContain('\r\n2. Is retaking CSE 29 next quarter the right move, or is there a better sequence for CSE 30, CSE 100, CSE 150B?');
    expect(body.endsWith('Thank you,')).toBe(true);
    expect(body).not.toMatch(/nemotron|model|agent/i);
  });

  it('switches the deadline and the question for a P/NP action', () => {
    const pnp: Impact = { ...impact, action: { kind: 'pnp', course: 'CSE 29' }, unitsAfter: 16, blocks: [] };
    const { subject, body } = parts(advisorMailto({ state, plan: plans[1], impact: pnp }));
    expect(subject).toContain('Nov 6, 2026');
    expect(body).toContain('switch CSE 29 (Systems Programming and Software Tools) to P/NP');
    expect(body).toContain('The "Change grading option (P/NP)" deadline is Nov 6, 2026');
    expect(body).toContain('2. Will a P in CSE 29 still count toward my requirements? Major courses must be taken for a letter grade.');
    expect(body).not.toContain('It affects');
  });

  it('falls back to the W deadline once the no-W deadline has passed', () => {
    const late: Impact = { ...impact, deadlines: impact.deadlines.map((d) => (d.key === 'dropWithoutW' ? { ...d, passed: true } : d)) };
    const { body } = parts(advisorMailto({ state, plan: plans[1], impact: late }));
    expect(body).toContain('The "Drop with a W" deadline is Nov 6, 2026');
  });

  it(`keeps the body under ${BODY_LIMIT} characters by cutting at a line`, () => {
    const long = {
      ...plans[1],
      terms: Array.from({ length: 30 }, (_, i) => ({ term: `WI${27 + i}`, courses: ['CSE 100', 'CSE 101', 'CSE 105', 'CSE 110', 'MATH 183'], units: 20 })),
    };
    const { body } = parts(advisorMailto({ state, plan: long, impact }));
    expect(body.length).toBeLessThanOrEqual(BODY_LIMIT);
    expect(body.endsWith('...')).toBe(true);
    expect(body.split('\r\n').every((l) => l === '...' || !l.startsWith('Winter') || l.endsWith('(20 units)'))).toBe(true);
    expect(parts(url).body).not.toContain('...'); // a normal plan is never cut
  });
});
