import { describe, expect, it } from 'vitest';
import type { LoopTool } from '../tf/helpers';
import { offeringStatus } from '../engine/offerings';
import { demoStudents, earnedCodes, inProgress } from '../engine/student';
import { applyAction, horizonTerms } from './context';
import { plannerTools, submitPlanLoopTool, submitPlanSchema, submitPlanTool } from './tools';

const demoA = demoStudents()[0];
const after = applyAction(demoA, { kind: 'drop', course: 'CSE 29' });
const tools = plannerTools(after, horizonTerms(after));
const tool = (name: string): LoopTool => tools.find((t) => t.def.function.name === name)!;
const run = <T>(name: string, args: unknown) => tool(name).run(args) as T;

describe('tool definitions', () => {
  it('expose the three lookup tools with JSON-schema parameters, and submit_plan separately (as a forced tool and as the loop terminal)', () => {
    expect(tools.map((t) => t.def.function.name)).toEqual(['eligible_courses', 'check_prereqs', 'offering_status']);
    for (const t of [...tools, submitPlanLoopTool]) {
      expect(t.def.type).toBe('function');
      expect(t.def.function.parameters).toMatchObject({ type: 'object' });
      expect(t.def.function.parameters).not.toHaveProperty('$schema');
      expect(t.def.function.description).toBeTruthy();
    }
    expect(submitPlanTool.name).toBe('submit_plan');
    expect(submitPlanLoopTool.def.function).toMatchObject({ name: 'submit_plan', parameters: expect.objectContaining({ required: ['terms', 'rationale', 'graduationTerm'] }) });
    expect(() => submitPlanLoopTool.run({})).toThrow(/ends the loop/);
    expect(submitPlanSchema.safeParse({ terms: 'nope' }).success).toBe(false);
    expect(submitPlanSchema.safeParse({ label: 'fastest', terms: [] }).success).toBe(false); // no label, no rationale
    expect(submitPlanSchema.safeParse({ terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4 }], rationale: 'r', graduationTerm: null }).success).toBe(true);
  });
  it('reject invalid arguments with a readable error', () => {
    expect(() => run('check_prereqs', { code: 'CSE 100' })).toThrow(/invalid arguments/);
    expect(() => run('offering_status', { code: 'CSE 100' })).toThrow(/invalid arguments/);
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
