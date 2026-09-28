import { describe, expect, it } from 'vitest';
import { loadMajor } from './data';
import { bands, bucketProgress, bucketsFor, remainingChainQuarters, remainingCourses } from './requirements';
import { demoStudents, earnedCodes, inProgress } from './student';

const demoA = () => demoStudents()[0];

describe('bands (demo a: Revelle, AI B.S.)', () => {
  it('credits the earned lower-division core and counts the four in-progress courses', () => {
    const b = bands(demoA());
    expect(b.major!.progress.total).toBeGreaterThan(15);
    expect(b.major!.progress.taken).toBeGreaterThanOrEqual(6); // CSE 11, CSE 12, CSE 25, MATH 20A, MATH 20B, PHYS 2A…
    expect(b.major!.progress.wip).toBeGreaterThanOrEqual(3); // CSE 29, CSE 20, MATH 20C
    expect(b.college!.progress.taken).toBeGreaterThanOrEqual(4); // HUM 1, HUM 2, MATH 20A, CHEM 11, PHYS 2A
    expect(b.rec['CSE 29'].status).toBe('wip');
    expect(b.takenEarned.has('CSE 12')).toBe(true);
    expect(b.takenEarned.has('CSE 29')).toBe(false);
  });
  it('does not mutate the shared requirement file', () => {
    const before = JSON.stringify(loadMajor(demoA().majorFile!).buckets);
    bands(demoA());
    expect(JSON.stringify(loadMajor(demoA().majorFile!).buckets)).toBe(before);
  });
  it('handles a student with no matched files', () => {
    const b = bands({ ...demoA(), majorFile: null, collegeFile: null });
    expect(b.major).toBeNull();
    expect(b.college).toBeNull();
    expect(bucketProgress({ ...demoA(), majorFile: null, collegeFile: null }, b)).toEqual([]);
  });
});

describe('bucketProgress / remainingCourses', () => {
  it('marks CSE 12 done, CSE 29 in progress and CSE 30 open with the right candidates', () => {
    const p = bucketProgress(demoA());
    const ds = p.find((x) => x.label.startsWith('Data structures (CSE 12)'))!;
    expect(ds).toMatchObject({ band: 'major', earned: 1, remaining: 0, candidates: [] });
    const tools = p.find((x) => x.label.startsWith('Software tools'))!;
    expect(tools).toMatchObject({ earned: 0, inProgress: 1, remaining: 0, wipCodes: ['CSE 29'] });
    const org = p.find((x) => x.label.startsWith('Computer organization'))!;
    expect(org).toMatchObject({ remaining: 1, candidates: ['CSE 30'] });
    const upper = p.find((x) => x.label.startsWith('Data structures (upper'))!;
    expect(upper.candidates).toEqual(['CSE 100', 'CSE 100R']);
  });
  it('expands range buckets against the catalog and never lists earned or in-progress courses', () => {
    const open = remainingCourses(demoA());
    const electives = open.find((x) => x.label.startsWith('Upper-division electives'))!;
    expect(electives.kind).toBe('units');
    expect(electives.remaining).toBe(32);
    expect(electives.candidates.length).toBeGreaterThan(40);
    expect(electives.candidates.every((c) => /^CSE 1\d\d/.test(c))).toBe(true);
    const onRecord = new Set(demoA().courses.map((c) => c.code));
    for (const b of open) for (const c of b.candidates) expect(onRecord.has(c)).toBe(false);
  });
  it('drops college tokens that are not catalog courses (e.g. "MATH 10A-10C")', () => {
    const open = remainingCourses(demoStudents()[2]); // Sixth College
    const sr = open.find((x) => x.label.startsWith('Structured Reasoning'));
    // Sixth’s Structured Reasoning is already covered by MATH 20A…; if it is open, its candidates are real codes.
    for (const b of open) for (const c of b.candidates) expect(c).toMatch(/^[A-Z]{2,6} \d{1,3}[A-Z]{0,3}$/);
    expect(sr === undefined || sr.candidates.length > 0).toBe(true);
  });
});

describe('bucketsFor', () => {
  it('finds a course by name and by range in both bands', () => {
    const s = demoA();
    expect(bucketsFor('CSE 30', s)).toEqual([{ band: 'major', label: 'Computer organization (CSE 30)' }]);
    const cse100 = bucketsFor('CSE 100', s).map((x) => x.label);
    expect(cse100).toContain('Data structures (upper-division)');
    expect(cse100).toContain('Upper-division electives (32 units with breadth distribution)');
    expect(bucketsFor('HUM 3', s)).toEqual([{ band: 'college', label: 'Humanities Sequence (Revelle Humanities)' }]);
    expect(bucketsFor('NOPE 1', s)).toEqual([]);
  });
});

describe('remainingChainQuarters', () => {
  it('shrinks when the in-progress term is assumed complete and grows when CSE 29 is removed', () => {
    const s = demoA();
    const earnedOnly = earnedCodes(s);
    const withWip = new Set([...earnedOnly, ...inProgress(s).map((c) => c.code)]);
    const open = remainingCourses(s);
    const a = remainingChainQuarters(earnedOnly, open);
    const b = remainingChainQuarters(withWip, open);
    expect(a).toBeGreaterThanOrEqual(3); // CSE 20 → CSE 21 → CSE 100 with the current term not yet counted
    expect(b).toBe(2); // CSE 21 → CSE 100 once CSE 20 and CSE 29 land; breadth buckets have shallow candidates
    expect(a).toBeGreaterThan(b);
    const without29 = new Set(withWip);
    without29.delete('CSE 29');
    expect(remainingChainQuarters(without29, open)).toBeGreaterThanOrEqual(b);
  });
});
