import { describe, it, expect } from 'vitest';
import { currentTermFromCalendar } from '@/app/lib/deadlines';
import { deadlinesFor } from '@/lib/engine/terms';
import { demoStudents } from '@/lib/engine/student';
import { impact } from '@/lib/engine/impact';
import { buildPlannerContext } from '@/lib/agents/context';
import { greedyPlan } from '@/lib/engine/fallback-plan';
import { verify } from '@/lib/engine/verifier';

// Judging runs Dec 1–15, 2026: inside Fall 2026 until Dec 12 (quarter ends), then in the gap before Winter
// 2027 (Jan 4). Nothing in the flow may throw or mis-state a deadline on those days.
const la = (s: string) => new Date(`${s}T12:00:00-08:00`);

describe('judging-window dates', () => {
  it('Dec 8: Fall 2026 is current and every fall deadline has passed', () => {
    const term = currentTermFromCalendar(la('2026-12-08'));
    expect(term).toBe('FA26');
    const dl = deadlinesFor(term, la('2026-12-08'));
    expect(dl.length).toBeGreaterThan(0);
    expect(dl.every((d) => d.passed)).toBe(true);
  });

  it('Dec 14 and Dec 20: the quarter has ended, so Winter 2027 is current with no deadline passed', () => {
    for (const day of ['2026-12-14', '2026-12-20']) {
      const term = currentTermFromCalendar(la(day));
      expect(term).toBe('WI27');
      const dl = deadlinesFor(term, la(day));
      expect(dl.map((d) => d.date)).toContain('2027-01-29');
      expect(dl.some((d) => d.passed)).toBe(false);
    }
  });

  it('Jan 5: Winter 2027 is current', () => {
    expect(currentTermFromCalendar(la('2027-01-05'))).toBe('WI27');
  });

  it('a recorded demo student (FA26 record) still gets an impact card, a context pack and a valid code-built plan in December', () => {
    const a = demoStudents()[0];
    for (const day of ['2026-12-08', '2026-12-14']) {
      const now = la(day);
      const imp = impact(a, { kind: 'drop', course: 'CSE 29' }, now);
      expect(imp.deadlines.every((d) => d.passed)).toBe(true);
      const ctx = buildPlannerContext(a, { kind: 'drop', course: 'CSE 29' }, imp, { horizonTerms: 3 });
      expect(ctx.prefix.length).toBeGreaterThan(1000);
      const plan = greedyPlan(a, { kind: 'drop', course: 'CSE 29' }, { horizonTerms: 3 });
      expect(plan).not.toBeNull();
      expect(plan!.terms.map((t) => t.term)).toEqual(['WI27', 'SP27', 'FA27']);
      expect(verify(plan!, a, { now }).ok).toBe(true);
    }
  });

  it('a pasted record parsed in the December gap gets WI27 as its current term and an empty in-progress list rather than a crash', () => {
    const a = demoStudents()[0];
    const state = { ...a, currentTerm: 'WI27' };
    const wip = state.courses.filter((c) => c.status === 'wip' && c.term === state.currentTerm);
    expect(wip).toEqual([]);
    const imp = impact(state, { kind: 'keep', course: 'CSE 29' }, la('2026-12-14'));
    expect(imp.deadlines.some((d) => d.passed)).toBe(false);
  });
});
