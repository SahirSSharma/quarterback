import { describe, expect, it } from 'vitest';
import type { Impact } from '../types';
import { gradingRestrictions, offeringsRows } from './data';
import { impact } from './impact';
import { demoStudents } from './student';

const demoA = () => demoStudents()[0];
const NOW = '2026-10-01T12:00:00-07:00';
const drop29 = () => impact(demoA(), { kind: 'drop', course: 'CSE 29' }, NOW);

describe('impact: drop CSE 29 for demo (a)', () => {
  it('describes the course and the unit consequence', () => {
    const r = drop29();
    expect(r.course).toEqual({ code: 'CSE 29', title: 'Systems Programming and Software Tools', units: 4 });
    expect(r.unitsAfter).toBe(12);
    expect(r.belowFullTime).toBe(false);
    expect(r.fullTimeFloor).toBe(12);
  });
  it('lists CSE 30 and CSE 100 as blocked, with their requirement buckets', () => {
    const r = drop29();
    const codes = r.blocks.map((b) => b.code);
    expect(codes).toContain('CSE 30');
    expect(codes).toContain('CSE 100');
    expect(codes.indexOf('CSE 30')).toBeLessThan(codes.indexOf('CSE 141')); // direct dependents first
    expect(r.blocks.find((b) => b.code === 'CSE 30')!.buckets).toEqual(['Computer organization (CSE 30)']);
    expect(r.blocks.find((b) => b.code === 'CSE 100')!.buckets).toContain('Data structures (upper-division)');
    for (const b of r.blocks) expect(b.evidence).not.toBeNull();
  });
  it('never blocks a course already on the record', () => {
    const onRecord = new Set(demoA().courses.map((c) => c.code));
    for (const b of drop29().blocks) expect(onRecord.has(b.code)).toBe(false);
  });
  it('gives next offerings from the department page when the offerings file exists', () => {
    const r = drop29();
    const cse30 = r.blocks.find((b) => b.code === 'CSE 30')!;
    const cse100 = r.blocks.find((b) => b.code === 'CSE 100')!;
    if (offeringsRows().has('CSE 30')) {
      expect(['WI27', 'SP27']).toContain(cse30.nextOffered);
      expect(cse30.evidence!.source).toBe('department-page');
      expect(cse30.delayQuarters).toBeGreaterThanOrEqual(1); // CSE 29 must be retaken first
      expect(['WI27', 'SP27']).toContain(cse100.nextOffered);
      expect(cse100.evidence!.source).toBe('department-page');
    } else {
      expect(cse30.nextOffered).toBeNull(); // CAPE history alone never says "offered"
      expect(cse30.evidence!.status).toBe('unknown');
      expect(cse30.delayQuarters).toBe(1); // unknown quarters are assumed possible: WI27 → SP27
    }
    // CSE 100 also waits on CSE 21 (planned after CSE 20), so CSE 29 alone does not delay it.
    expect(cse100.delayQuarters).toBe(0);
    expect(r.notes.join('\n')).toMatch(/CSE 100 is not delayed by this alone/);
  });
  it('shows the requirement bucket that loses progress', () => {
    const r = drop29();
    expect(r.progressDelta).toEqual([
      { bucket: 'Software tools / systems programming', band: 'major', before: 1, after: 0, needed: 1 },
    ]);
  });
  it('carries the FA26 deadlines with passed flags from `now`', () => {
    expect(drop29().deadlines.map((d) => d.passed)).toEqual([false, false, false, false]);
    const late = impact(demoA(), { kind: 'drop', course: 'CSE 29' }, '2026-10-30T12:00:00-07:00');
    expect(late.deadlines.find((d) => d.key === 'dropWithoutW')!.passed).toBe(true);
    expect(late.notes.join('\n')).toMatch(/no-W drop deadline \(2026-10-23\) has passed/);
  });
  it('flags P/NP as unknown for CSE 29 and names the department', () => {
    const r = drop29();
    expect(r.pnpAllowed).toBe('unknown');
    expect(r.pnpNote).toMatch(/Computer Science and Engineering/);
    expect(r.pnpNote).toMatch(/generally may not satisfy major requirements/);
  });
  it('reports chain lengths and a graduation-risk judgment with an explanatory note', () => {
    const r = drop29();
    expect(r.chainQuartersAfter).toBeGreaterThanOrEqual(r.chainQuartersBefore);
    expect(['none', 'possible', 'likely']).toContain(r.graduationRisk);
    expect(r.notes.join('\n')).toMatch(/Longest remaining prerequisite chain/);
    expect(r.notes.join('\n')).toMatch(/CSE 29 itself/);
  });
});

describe('impact: other actions and edge cases', () => {
  it('a drop below 12 units is flagged', () => {
    const s = demoA();
    s.courses.find((c) => c.code === 'HUM 3')!.units = 2;
    const r = impact(s, { kind: 'drop', course: 'CSE 29' }, NOW);
    expect(r.unitsAfter).toBe(10);
    expect(r.belowFullTime).toBe(true);
    expect(r.notes.join('\n')).toMatch(/below the 12-unit full-time floor/);
  });
  it('keep changes nothing: no blocks, no delta, units unchanged', () => {
    const r = impact(demoA(), { kind: 'keep', course: 'CSE 29' }, NOW);
    expect(r.blocks).toEqual([]);
    expect(r.progressDelta).toEqual([]);
    expect(r.unitsAfter).toBe(16);
    expect(r.chainQuartersAfter).toBe(r.chainQuartersBefore);
  });
  it('P/NP keeps the prerequisite graph but notes the grading-option deadline', () => {
    const r = impact(demoA(), { kind: 'pnp', course: 'MATH 20C' }, NOW);
    expect(r.blocks).toEqual([]);
    expect(r.pnpAllowed).toBe('unknown');
    expect(r.notes.join('\n')).toMatch(/Grading option can be changed until 2026-11-06/);
  });
  it('says no when the catalog says "letter grades only"', () => {
    const letterOnly = Object.entries(gradingRestrictions()).find(([, v]) => v === 'L')![0];
    const r = impact(demoA(), { kind: 'pnp', course: letterOnly }, NOW);
    expect(r.pnpAllowed).toBe('no');
    expect(r.pnpNote).toMatch(/letter grades only/);
  });
  it('works for a course not in progress and for a student with no matched files', () => {
    const r = impact(demoA(), { kind: 'drop', course: 'CSE 30' }, NOW);
    expect(r.notes[0]).toMatch(/CSE 30 is not in progress/);
    expect(r.unitsAfter).toBe(16);
    const bare = impact({ ...demoA(), majorFile: null, collegeFile: null }, { kind: 'drop', course: 'CSE 29' }, NOW);
    expect(bare.blocks).toEqual([]);
    expect(bare.progressDelta).toEqual([]);
    expect(bare.pnpNote).toMatch(/college advising/);
  });
});

describe('golden: drop CSE 29 for demo (a)', () => {
  // Evidence text/timestamps are stripped so the snapshot survives a refresh of the offerings files; whether the
  // CSE department page was present when the golden was generated is stated in the file itself.
  const project = (r: Impact) => ({
    hadDepartmentRows: offeringsRows().has('CSE 30'),
    course: r.course,
    unitsAfter: r.unitsAfter,
    belowFullTime: r.belowFullTime,
    pnpAllowed: r.pnpAllowed,
    deadlines: r.deadlines.map((d) => [d.key, d.date, d.passed]),
    progressDelta: r.progressDelta,
    chainQuartersBefore: r.chainQuartersBefore,
    chainQuartersAfter: r.chainQuartersAfter,
    graduationRisk: r.graduationRisk,
    blocks: r.blocks.map((b) => ({
      code: b.code, buckets: b.buckets, nextOffered: b.nextOffered, delayQuarters: b.delayQuarters,
      evidence: b.evidence ? { source: b.evidence.source, status: b.evidence.status } : null,
    })),
  });
  it('matches the recorded snapshot', async () => {
    await expect(JSON.stringify(project(drop29()), null, 2) + '\n').toMatchFileSnapshot('./fixtures/impact-demo-a.golden.json');
  });
});
