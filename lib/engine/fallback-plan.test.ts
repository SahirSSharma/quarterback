import { describe, expect, it } from 'vitest';
import { chooseAction, makeStudents } from '../../eval/synth';
import type { Action, StudentState } from '../types';
import { FALLBACK_LABEL, FALLBACK_PLAN_ID, greedyPlan } from './fallback-plan';
import { offeringStatus } from './offerings';
import { missingGroups } from './prereqs';
import { remainingCourses } from './requirements';
import { demoStudents, earnedCodes, inProgress } from './student';
import { compare, mainQuartersAfter } from './terms';
import { verify } from './verifier';

// The recorded demo situations: (a) drop CSE 29, (b) drop COGS 109, (c) drop CSE 101.
const DEMO_ACTIONS: Action[] = [{ kind: 'drop', course: 'CSE 29' }, { kind: 'drop', course: 'COGS 109' }, { kind: 'drop', course: 'CSE 101' }];
const demos = demoStudents().map((state, i) => ({ name: `demo ${'abc'[i]}`, state, action: DEMO_ACTIONS[i] }));
const synth = makeStudents({ n: 20, seed: 11, currentTerm: 'FA26' })
  .map((state, i) => ({ name: `synth ${i} ${state.majorFile}`, state, action: chooseAction(state) as Action }))
  .filter((s) => s.action);

const after = (state: StudentState, action: Action): StudentState =>
  action.kind === 'drop' ? { ...state, courses: state.courses.filter((c) => !(c.code === action.course && c.status === 'wip' && c.term === state.currentTerm)) } : state;

describe('greedyPlan', () => {
  it('passes the verifier by construction for the three demo students', () => {
    for (const { name, state, action } of demos) {
      const plan = greedyPlan(state, action);
      expect(plan, name).not.toBeNull();
      const report = verify(plan!, after(state, action));
      expect(report.violations.filter((v) => v.severity === 'error'), name).toEqual([]);
      expect(report.ok).toBe(true);
    }
    // (a) and (c) fill every quarter; (b), a third-year, has every bucket covered after two, and the rationale says so.
    const [a, b, c] = demos.map(({ state, action }) => greedyPlan(state, action)!);
    expect(a.terms.map((t) => t.term)).toEqual(mainQuartersAfter(demos[0].state.currentTerm, 3));
    expect(c.terms.map((t) => t.term)).toEqual(mainQuartersAfter(demos[2].state.currentTerm, 3));
    expect(b.terms.map((t) => t.term)).toEqual(['WI27', 'SP27']);
    expect(b.rationale).toMatch(/From Fall 2027 on, every requirement in your major and college files is covered\.$/);
  });

  it('passes the verifier by construction for 20 synthetic students, and fills a plan for most of them', () => {
    expect(synth.length).toBe(20);
    let planned = 0;
    for (const { name, state, action } of synth) {
      const plan = greedyPlan(state, action);
      if (!plan) continue;
      planned += 1;
      const report = verify(plan, after(state, action));
      expect(report.violations.filter((v) => v.severity === 'error'), name).toEqual([]);
      expect(report.ok, name).toBe(true);
    }
    // Measured on seed 11: 17 of 20 (seeds 1 and 7: 19 of 20). The rest have their path gated by the catalog's
    // prerequisite rows (a dropped MATH 20A cannot be retaken: the parser reads the placement alternatives as required courses).
    expect(planned).toBeGreaterThanOrEqual(16);
  });

  it('is labelled code-built, keeps every quarter at 12–16 catalog units in horizon order, and never sets a graduation term', () => {
    for (const { state, action } of [...demos, ...synth]) {
      const plan = greedyPlan(state, action);
      if (!plan) continue;
      expect(plan.id).toBe(FALLBACK_PLAN_ID);
      expect(plan.label).toBe(FALLBACK_LABEL);
      expect(plan.graduationTerm).toBeNull();
      expect(plan.rationale).toMatch(/^Built by rule from your record/);
      const horizon = mainQuartersAfter(state.currentTerm, 3);
      for (const [i, t] of plan.terms.entries()) {
        expect(horizon).toContain(t.term);
        if (i) expect(compare(plan.terms[i - 1].term, t.term)).toBeLessThan(0);
        expect(t.units).toBeGreaterThanOrEqual(12);
        expect(t.units).toBeLessThanOrEqual(16);
        expect(t.partTime).toBeUndefined();
      }
    }
  });

  it('places only courses that fill an open bucket, with prerequisites met by earlier quarters and no not_offered evidence', () => {
    for (const { name, state, action } of demos) {
      const s = after(state, action);
      const plan = greedyPlan(state, action)!;
      const rolling = new Set([...earnedCodes(s), ...inProgress(s).map((c) => c.code)]);
      let cur = s;
      for (const t of plan.terms) {
        const open = new Set(remainingCourses(cur).flatMap((b) => b.candidates));
        for (const code of t.courses) {
          expect(open.has(code), `${name}: ${code} fills an open bucket in ${t.term}`).toBe(true);
          expect(missingGroups(code, rolling), `${name}: ${code} in ${t.term}`).toEqual([]);
          expect(offeringStatus(code, t.term).status).not.toBe('not_offered');
          expect(rolling.has(code)).toBe(false);
        }
        for (const code of t.courses) rolling.add(code);
        cur = { ...cur, courses: [...cur.courses, ...t.courses.map((code) => ({ code, term: t.term, units: 4, grade: null, status: 'earned' as const }))] };
      }
    }
  });

  it('is deterministic and independent of the horizon option only through the number of quarters', () => {
    const { state, action } = demos[0];
    expect(greedyPlan(state, action)).toEqual(greedyPlan(state, action));
    const two = greedyPlan(state, action, { horizonTerms: 2 })!;
    expect(two.terms.map((t) => t.term)).toEqual(mainQuartersAfter(state.currentTerm, 2));
    expect(two.terms).toEqual(greedyPlan(state, action)!.terms.slice(0, 2));
  });

  it('demo (a) retakes CSE 29 in the first quarter and never plans one requirement twice (alternatives, remote twins)', () => {
    const plan = greedyPlan(demos[0].state, demos[0].action)!;
    expect(plan.terms[0].courses).toContain('CSE 29');
    const all = plan.terms.flatMap((t) => t.courses);
    expect(all.filter((c) => c === 'MATH 18' || c === 'MATH 31AH')).toHaveLength(1); // one linear-algebra slot
    for (const { state, action } of [...demos, ...synth]) {
      const codes = greedyPlan(state, action)?.terms.flatMap((t) => t.courses) ?? [];
      for (const c of codes) expect(codes, `${c} and its remote twin`).not.toContain(c.endsWith('R') ? c.slice(0, -1) : `${c}R`);
    }
  });

  it('returns null when nothing is eligible', () => {
    const bare: StudentState = { ...demos[0].state, majorFile: null, collegeFile: null };
    expect(greedyPlan(bare, demos[0].action)).toBeNull();
  });
});
