import { describe, expect, it } from 'vitest';
import type { Plan, PlanTerm } from '../types';
import { offeringsRows } from './data';
import { demoStudents } from './student';
import { verify } from './verifier';

const demoA = () => demoStudents()[0];
const NOW = '2026-10-01T12:00:00-07:00';
const plan = (terms: PlanTerm[], graduationTerm: string | null = null): Plan =>
  ({ id: 'p1', label: 'balanced', terms, rationale: 'test', graduationTerm });
const rules = (p: Plan, severity?: 'error' | 'warning') =>
  verify(p, demoA(), { now: NOW }).violations.filter((v) => !severity || v.severity === severity).map((v) => v.rule);

describe('verify: a sound plan', () => {
  it('passes with only assumed-offered warnings where evidence is missing', () => {
    const r = verify(plan([
      { term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
      { term: 'SP27', courses: ['CSE 100', 'CSE 101', 'CSE 55', 'HUM 5'], units: 16 },
    ]), demoA(), { now: NOW });
    expect(r.planId).toBe('p1');
    expect(r.ok).toBe(true);
    expect(r.violations.every((v) => v.severity === 'warning')).toBe(true);
    expect(r.violations.filter((v) => v.rule === 'assumed-offered').map((v) => v.course)).toContain('HUM 4');
  });
  it('is deterministic and ordered by term', () => {
    const p = plan([
      { term: 'SP27', courses: ['CSE 100'], units: 4 },
      { term: 'WI27', courses: ['CSE 12', 'CSE 21'], units: 8 },
    ]);
    const a = verify(p, demoA(), { now: NOW });
    const b = verify(p, demoA(), { now: NOW });
    expect(a).toEqual(b);
    const termsInOrder = a.violations.map((v) => v.term);
    expect(termsInOrder.indexOf('WI27')).toBeLessThan(termsInOrder.indexOf('SP27'));
  });
});

describe('verify: each rule', () => {
  it('prereq-unsatisfied by the term it is planned, honouring earlier planned terms', () => {
    // CSE 100 needs CSE 21, which is neither earned nor in progress.
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 100', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 }]), 'error')).toContain('prereq-unsatisfied');
    // Planned in the term before, it counts.
    const ok = verify(plan([
      { term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
      { term: 'SP27', courses: ['CSE 100', 'CSE 101', 'CSE 55', 'HUM 5'], units: 16 },
    ]), demoA(), { now: NOW });
    expect(ok.violations.map((v) => v.rule)).not.toContain('prereq-unsatisfied');
    // Same term does not count.
    const same = verify(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 100', 'MATH 18', 'HUM 4'], units: 16 }]), demoA(), { now: NOW });
    expect(same.violations.find((v) => v.rule === 'prereq-unsatisfied')!.message).toMatch(/CSE 100 in WI27 still needs CSE 21 or MATH 154/);
  });
  it('lets demo (a) retake CSE 29 after dropping it (the snapshot’s spurious CSE 15L group is overridden)', () => {
    const s = demoA();
    s.courses = s.courses.filter((c) => c.code !== 'CSE 29');
    const r = verify(plan([{ term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'], units: 16 }]), s, { now: NOW });
    expect(r.violations.filter((v) => v.rule === 'prereq-unsatisfied')).toEqual([]);
  });
  it('not-offered cites the department quote (runs once the offerings module has a not_offered row)', () => {
    let found: { code: string; term: string; quote: string } | null = null;
    for (const [code, byTerm] of offeringsRows()) {
      for (const [term, ev] of byTerm) if (ev.status === 'not_offered' && !found) found = { code, term, quote: ev.quote };
    }
    // The CSE sheet leaves CSE 109 blank for WI27, so once that file exists this test must not be vacuous.
    if (offeringsRows().has('CSE 109')) expect(found).not.toBeNull();
    if (!found) return;
    const r = verify(plan([{ term: found.term, courses: [found.code], units: 12, partTime: true }]), demoA(), { now: NOW });
    const v = r.violations.find((x) => x.rule === 'not-offered')!;
    expect(v).toMatchObject({ severity: 'error', course: found.code, term: found.term });
    expect(v.message).toContain(found.quote);
    expect(r.ok).toBe(false);
  });
  it('assumed-offered is a warning, not an error', () => {
    const r = verify(plan([{ term: 'WI27', courses: ['HUM 4', 'HUM 5', 'MATH 18', 'CSE 21'], units: 16 }]), demoA(), { now: NOW });
    const w = r.violations.filter((v) => v.rule === 'assumed-offered');
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((v) => v.severity === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
  });
  it('unit-floor unless the term is marked part-time', () => {
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30'], units: 8 }]), 'error')).toContain('unit-floor');
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30'], units: 8, partTime: true }]))).not.toContain('unit-floor');
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30'], units: 8, partTime: false }]), 'error')).toContain('unit-floor');
    // Units are summed from the catalog when the plan leaves them at 0.
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30'], units: 0 }]), 'error')).toContain('unit-floor');
    // …and the catalog overrides a plan that claims 16 units for two 4-unit courses.
    const lied = verify(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30'], units: 16 }]), demoA(), { now: NOW });
    expect(lied.violations.find((v) => v.rule === 'unit-floor')!.message).toMatch(/WI27 has 8 units/);
  });
  it('unit-cap: error above 22, warning above 19.5', () => {
    const r22 = verify(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4', 'HUM 5', 'MUS 4'], units: 24 }]), demoA(), { now: NOW });
    expect(r22.violations.find((v) => v.rule === 'unit-cap')).toMatchObject({ severity: 'error', term: 'WI27' });
    const r20 = verify(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4', 'HUM 5'], units: 20 }]), demoA(), { now: NOW });
    expect(r20.violations.find((v) => v.rule === 'unit-cap')).toMatchObject({ severity: 'warning' });
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 19.5 }]))).not.toContain('unit-cap');
  });
  it('duplicate across terms', () => {
    const r = verify(plan([
      { term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
      { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'CSE 55', 'HUM 5'], units: 16 },
    ]), demoA(), { now: NOW });
    expect(r.violations.find((v) => v.rule === 'duplicate')).toMatchObject({ course: 'CSE 30', term: 'SP27', severity: 'error' });
  });
  it('already-earned, but not for a W', () => {
    expect(verify(plan([{ term: 'WI27', courses: ['CSE 12', 'CSE 21', 'CSE 30', 'HUM 4'], units: 16 }]), demoA(), { now: NOW })
      .violations.find((v) => v.rule === 'already-earned')).toMatchObject({ course: 'CSE 12', message: expect.stringContaining('A-, WI26') });
    const s = demoA();
    s.courses.find((c) => c.code === 'CHEM 11')!.grade = 'W';
    expect(verify(plan([{ term: 'WI27', courses: ['CHEM 11', 'CSE 21', 'CSE 30', 'HUM 4'], units: 16 }]), s, { now: NOW })
      .violations.map((v) => v.rule)).not.toContain('already-earned');
  });
  it('double-count when a course listed in two open major buckets is credited to one', () => {
    // CSE 150A sits in "Artificial intelligence core" and "AI electives (12 units)"; it is credited to the core.
    // CSE 103 is blank on the CSE sheet for SP27, so it sits in FA27 and the AI courses follow it.
    const r = verify(plan([
      { term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
      { term: 'SP27', courses: ['CSE 100', 'CSE 101', 'CSE 55', 'HUM 5'], units: 16 },
      { term: 'FA27', courses: ['CSE 103', 'CSE 110', 'CSE 105', 'CSE 120'], units: 16 },
      { term: 'WI28', courses: ['CSE 150A', 'CSE 151A', 'CSE 130', 'CSE 140'], units: 16 },
    ]), demoA(), { now: NOW });
    expect(r.violations.filter((x) => x.severity === 'error')).toEqual([]);
    const dc = r.violations.filter((x) => x.rule === 'double-count');
    const v = dc.find((x) => x.course === 'CSE 150A')!;
    expect(v).toMatchObject({ term: 'WI28', severity: 'warning' });
    expect(v.message).toMatch(/credited to "Artificial intelligence core" only; "AI electives \(12 units\)"/);
    // The 32-unit "CSE 100-199" range bucket also lists CSE 100 and CSE 103, so they are flagged too — a
    // caveat for the planner's arithmetic, never an error.
    expect(dc.map((x) => x.course)).toEqual(expect.arrayContaining(['CSE 100', 'CSE 103']));
    expect(r.ok).toBe(true);
  });
  it('graduation-infeasible when the chain outruns the claimed graduation term', () => {
    const p = plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 }], 'WI27');
    const r = verify(p, demoA(), { now: NOW });
    expect(r.violations.find((v) => v.rule === 'graduation-infeasible')).toMatchObject({ severity: 'error', term: 'WI27' });
    expect(rules(plan([{ term: 'WI27', courses: ['CSE 21', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 }], 'SP29'))).not.toContain('graduation-infeasible');
  });
  it('handles a student with no requirement files and an empty plan', () => {
    const r = verify(plan([]), { ...demoA(), majorFile: null, collegeFile: null }, { now: NOW });
    expect(r).toEqual({ planId: 'p1', ok: true, violations: [] });
  });
});
