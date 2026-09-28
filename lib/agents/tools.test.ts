import { describe, expect, it } from 'vitest';
import type { LoopTool } from '../tf/helpers';
import { offeringStatus } from '../engine/offerings';
import { demoStudents, earnedCodes, inProgress } from '../engine/student';
import { applyAction, horizonTerms } from './context';
import { plannerTools, submitPlansSchema, submitPlansTool } from './tools';

const demoA = demoStudents()[0];
const after = applyAction(demoA, { kind: 'drop', course: 'CSE 29' });
const tools = plannerTools(after, horizonTerms(after));
const tool = (name: string): LoopTool => tools.find((t) => t.def.function.name === name)!;
const run = <T>(name: string, args: unknown) => tool(name).run(args) as T;

describe('tool definitions', () => {
  it('expose the six planner tools with JSON-schema parameters, and submit_plans separately', () => {
    expect(tools.map((t) => t.def.function.name)).toEqual(['eligible_courses', 'check_prereqs', 'requirement_progress', 'offering_status', 'unit_check', 'grade_history']);
    for (const t of tools) {
      expect(t.def.type).toBe('function');
      expect(t.def.function.parameters).toMatchObject({ type: 'object' });
      expect(t.def.function.parameters).not.toHaveProperty('$schema');
      expect(t.def.function.description).toBeTruthy();
    }
    expect(submitPlansTool.name).toBe('submit_plans');
    expect(submitPlansSchema.safeParse({ plans: [] }).success).toBe(false);
    expect(submitPlansSchema.safeParse({ plans: [{ label: 'fastest', terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4 }], rationale: 'r', graduationTerm: null }] }).success).toBe(true);
  });
  it('reject invalid arguments with a readable error', () => {
    expect(() => run('check_prereqs', { code: 'CSE 100' })).toThrow(/invalid arguments/);
    expect(() => run('unit_check', { plan: 'nope' })).toThrow(/invalid arguments/);
  });
});

describe('eligible_courses', () => {
  type Out = { term: string; buckets: { band: string; label: string; remaining: string; eligible: { code: string; units: number | null; status: string }[]; more: number }[] };
  it('excludes earned and in-progress courses and anything not_offered, and honours planned prerequisites', () => {
    const out = run<Out>('eligible_courses', { term: 'WI27' });
    expect(out.term).toBe('WI27');
    const codes = out.buckets.flatMap((b) => b.eligible.map((e) => e.code));
    for (const c of earnedCodes(after)) expect(codes, `${c} is earned`).not.toContain(c);
    for (const c of inProgress(after)) expect(codes, `${c.code} is in progress`).not.toContain(c.code);
    expect(codes).toContain('CSE 29'); // dropped, so it can be retaken
    expect(codes).not.toContain('CSE 30'); // needs CSE 29 again
    expect(codes).not.toContain('CSE 194'); // not_offered in WI27 on the CSE sheet
    const ethics = out.buckets.find((b) => b.label === 'Ethics')!;
    expect(ethics.eligible.map((e) => e.code)).toEqual(expect.arrayContaining(['PHIL 174', 'POLI 121D']));
    expect(out.buckets.find((b) => b.label === 'Computer organization (CSE 30)')!.eligible).toEqual([]);

    const sp = run<Out>('eligible_courses', { term: 'SP27', planned: ['CSE 29', 'CSE 21'] });
    const spCodes = sp.buckets.flatMap((b) => b.eligible.map((e) => e.code));
    expect(spCodes).toContain('CSE 30');
    expect(spCodes).toContain('CSE 100');
    expect(spCodes).not.toContain('CSE 29'); // planned earlier, so not eligible again
  });
  it('caps each bucket and reports how many more there are', () => {
    const out = run<Out>('eligible_courses', { term: 'WI27' });
    for (const b of out.buckets) expect(b.eligible.length).toBeLessThanOrEqual(12);
    expect(out.buckets.some((b) => b.more > 0)).toBe(true);
  });
});

describe('check_prereqs', () => {
  it('on CSE 100 after dropping CSE 29: two groups missing, satisfied once both are planned earlier', () => {
    const out = run<{ code: string; satisfied: boolean; missing: string[][]; prereqs: string[][]; prereqText: string | null }>('check_prereqs', { code: 'cse100', term: 'WI27' });
    expect(out.code).toBe('CSE 100');
    expect(out.satisfied).toBe(false);
    expect(out.missing).toEqual([
      ['CSE 21', 'MATH 154', 'MATH 158', 'MATH 184', 'MATH 188'],
      ['CSE 15L', 'CSE 29', 'ECE 15'],
    ]);
    expect(out.prereqs).toHaveLength(3);
    expect(out.prereqText).toMatch(/CSE 21 or MATH 154/);
    const ok = run<{ satisfied: boolean; missing: string[][] }>('check_prereqs', { code: 'CSE 100', term: 'SP27', planned: ['CSE 21', 'CSE 29'] });
    expect(ok).toMatchObject({ satisfied: true, missing: [] });
  });
});

describe('offering_status', () => {
  it('returns the engine evidence with a stable id', () => {
    const out = run<{ id: string; course: string; term: string; status: string; quote: string; url: string; fetchedAt: string }>('offering_status', { code: 'CSE 194', term: 'wi27' });
    expect(out.id).toBe('ev_CSE194_WI27');
    expect(out).toMatchObject(offeringStatus('CSE 194', 'WI27'));
    expect(out.status).toBe('not_offered');
    expect(out.quote).toMatch(/^CSE-194,/);
    expect(run<{ id: string; status: string }>('offering_status', { code: 'CSE 100', term: 'WI27' })).toMatchObject({ id: 'ev_CSE100_WI27', status: 'offered' });
  });
});

describe('unit_check', () => {
  it('sums catalog units per quarter and flags the floor and both caps', () => {
    const out = run<{ terms: { term: string; units: number; floor: string; cap: string; unknownUnits?: string[] }[] }>('unit_check', {
      plan: [
        { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'] },
        { term: 'SP27', courses: ['CSE 30', 'CSE 100'] },
        { term: 'FA27', courses: ['CSE 101', 'CSE 151A', 'CSE 105', 'CSE 110', 'CSE 120', 'CSE 123'] },
      ],
    });
    expect(out.terms[0]).toMatchObject({ term: 'WI27', units: 16, floor: 'ok', cap: 'ok' });
    expect(out.terms[1]).toMatchObject({ term: 'SP27', units: 8 });
    expect(out.terms[1].floor).toMatch(/below the 12-unit floor/);
    expect(out.terms[2]).toMatchObject({ units: 24 });
    expect(out.terms[2].cap).toMatch(/above 22 \(rejected\)/);
    const warn = run<{ terms: { units: number; cap: string }[] }>('unit_check', { plan: [{ term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4', 'COGS 1'] }] });
    expect(warn.terms[0]).toMatchObject({ units: 20 });
    expect(warn.terms[0].cap).toMatch(/above 19.5 \(warning\)/);
  });
});

describe('requirement_progress', () => {
  it('scores a draft against the open buckets', () => {
    const out = run<{ buckets: { label: string; remainingBefore: number; remainingAfter: number }[]; stillOpen: number }>('requirement_progress', {
      plan: [{ term: 'WI27', courses: ['CSE 29', 'CSE 21'] }, { term: 'SP27', courses: ['CSE 30'] }],
    });
    const by = Object.fromEntries(out.buckets.map((b) => [b.label, b]));
    expect(by['Software tools / systems programming']).toMatchObject({ remainingBefore: 1, remainingAfter: 0 });
    expect(by['Mathematics for algorithms']).toMatchObject({ remainingBefore: 1, remainingAfter: 0 });
    expect(by['Computer organization (CSE 30)']).toMatchObject({ remainingBefore: 1, remainingAfter: 0 });
    expect(by['Machine learning (CSE 151A)']).toMatchObject({ remainingBefore: 1, remainingAfter: 1 });
    expect(out.stillOpen).toBeLessThan(out.buckets.length);
  });
});

describe('grade_history', () => {
  it('returns the CAPE row or history: null', () => {
    expect(run<{ code: string; averageGrade: string; lastEvaluated: string }>('grade_history', { code: 'CSE 100' })).toMatchObject({ code: 'CSE 100', averageGrade: expect.any(String), lastEvaluated: expect.stringMatching(/^[A-Z]{2}\d{2}$/) });
    expect(run('grade_history', { code: 'CSE 999' })).toEqual({ code: 'CSE 999', history: null });
  });
});
