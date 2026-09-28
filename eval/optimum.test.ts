import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Action, Plan, StudentState } from '../lib/types';
import { applyAction, horizonTerms } from '../lib/agents/context';
import { catalogUnits } from '../lib/engine/data';
import { offeringStatus } from '../lib/engine/offerings';
import { demoStudents } from '../lib/engine/student';
import { UNIT_CAP_ERROR, verify } from '../lib/engine/verifier';
import { openSlots, optimum, planProgress } from './optimum';

const demoA = demoStudents().find((d) => d.majorFile === 'computer-science-and-engineering-artificial-intelligence.json') as StudentState;
const drop: Action = { kind: 'drop', course: 'CSE 29' };
const after = applyAction(demoA, drop);
const terms = horizonTerms(demoA);

// Verified by lib/agents/planner.test.ts as the passing draft: retake CSE 29, then the chain.
const HAND: Plan = {
  id: 'hand', label: 'balanced', rationale: '', graduationTerm: null,
  terms: [
    { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'], units: 16 },
    { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'MATH 183', 'HUM 5'], units: 16 },
    { term: 'FA27', courses: ['CSE 101', 'CSE 151A', 'CSE 55', 'COGS 1'], units: 16 },
  ],
};

describe('planProgress', () => {
  it('scores closed requirement slots per term with the engine allocator, and the terms sum to the total', () => {
    const p = planProgress(after, HAND);
    expect(p.perTerm.map((t) => t.term)).toEqual(['WI27', 'SP27', 'FA27']);
    expect(p.perTerm.every((t) => t.slots > 0)).toBe(true);
    expect(p.total).toBe(p.perTerm.reduce((n, t) => n + t.slots, 0));
    expect(p.total).toBeLessThanOrEqual(12);
    expect(p.total).toBeGreaterThanOrEqual(9);
    expect(planProgress(after, { terms: [] }).total).toBe(0);
  });
  it('an already-earned or duplicated course closes nothing', () => {
    const dup: Plan = { ...HAND, terms: [{ term: 'WI27', courses: ['CSE 11', 'CSE 12', 'HUM 4', 'HUM 4'], units: 16 }] };
    expect(planProgress(after, dup).total).toBe(1);
  });
});

describe('optimum', () => {
  const opt = optimum(after, terms);

  it('is at least the hand-made verified plan on the tiny one-quarter case and on the full horizon', () => {
    expect(verify(HAND, after).ok).toBe(true);
    const one = optimum(after, ['WI27']);
    expect(one.total).toBeGreaterThanOrEqual(planProgress(after, { terms: HAND.terms.slice(0, 1) }).total);
    expect(opt.total).toBeGreaterThanOrEqual(planProgress(after, HAND).total);
    expect(opt.total).toBeLessThanOrEqual(openSlots(after));
  });

  it('obeys the verifier\'s hard rules: prerequisites by term, no not_offered placement, units at or under the cap, one fixed unit value', () => {
    const asPlan: Plan = { id: 'opt', label: 'optimum', terms: opt.plan, rationale: '', graduationTerm: null };
    const report = verify(asPlan, after);
    expect(report.violations.filter((v) => v.severity === 'error')).toEqual([]);
    for (const t of opt.plan) {
      expect(t.units).toBeLessThanOrEqual(UNIT_CAP_ERROR);
      expect(t.units).toBe(t.courses.reduce((n, c) => n + (catalogUnits(c) ?? 0), 0));
      for (const c of t.courses) expect(offeringStatus(c, t.term).status).not.toBe('not_offered');
    }
    expect(new Set(opt.plan.flatMap((t) => t.courses)).size).toBe(opt.plan.flatMap((t) => t.courses).length);
  });

  it('a tighter unit cap never closes more slots, and the reference is deterministic', () => {
    const tight = optimum(after, terms, { unitCap: 12 });
    expect(tight.total).toBeLessThanOrEqual(opt.total);
    expect(tight.plan.every((t) => t.units <= 12)).toBe(true);
    expect(optimum(after, terms)).toEqual(opt);
  });

  it('is at least every recorded demo plan that passed the verifier', () => {
    for (const id of ['a', 'b', 'c']) {
      const file = path.join(process.cwd(), `fixtures/runs/demo-${id}.json`);
      if (!existsSync(file)) continue;
      const run = JSON.parse(readFileSync(file, 'utf8')) as { state: StudentState; action: Action; plans: Plan[] };
      const post = applyAction(run.state, run.action);
      const best = optimum(post, horizonTerms(run.state)).total;
      for (const p of run.plans) expect(best, `demo ${id} ${p.id}`).toBeGreaterThanOrEqual(planProgress(post, p).total);
    }
  });
});
