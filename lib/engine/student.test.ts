import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { demoStudents, earnedCodes, fromAcademicHistory, inProgress } from './student';

const fixture = () => readFileSync(path.join(process.cwd(), 'lib/engine/fixtures/academic-history-demo.txt'), 'utf8');

describe('fromAcademicHistory', () => {
  it('parses the demo paste into the demo (a) student', () => {
    const s = fromAcademicHistory(fixture(), { currentTerm: 'FA26' });
    const demoA = demoStudents().find((d) => d.majorFile === 'computer-science-and-engineering-artificial-intelligence.json')!;
    expect({ ...s, source: 'demo' }).toEqual(demoA);
  });
  it('resolves college, major file, GPA and confidence', () => {
    const s = fromAcademicHistory(fixture(), { currentTerm: 'FA26' });
    expect(s.college).toBe('Revelle College');
    expect(s.collegeFile).toBe('revelle-college.json');
    expect(s.major).toBe('Artificial Intelligence');
    expect(s.majorFile).toBe('computer-science-and-engineering-artificial-intelligence.json');
    expect(s.gpa).toBe(3.346);
    expect(s.confidence).toBe('high');
    expect(s.warnings).toEqual([]);
    expect(s.source).toBe('paste');
  });
  it('normalizes course rows: 13 earned, 4 in progress in FA26, 16 units in progress', () => {
    const s = fromAcademicHistory(fixture(), { currentTerm: 'FA26' });
    expect(s.courses.filter((c) => c.status === 'earned').length).toBe(13);
    const wip = inProgress(s);
    expect(wip.map((c) => c.code)).toEqual(['CSE 29', 'CSE 20', 'MATH 20C', 'HUM 3']);
    expect(wip.reduce((n, c) => n + c.units, 0)).toBe(16);
    expect(s.courses.find((c) => c.code === 'HUM 1')).toMatchObject({ term: 'FA25', units: 6, grade: 'B', status: 'earned' });
    expect(s.courses.find((c) => c.code === 'CSE 89')).toMatchObject({ units: 2, grade: 'P' });
  });
  it('refuses to guess between the Cognitive Science B.A. and B.S. when the degree is missing', () => {
    const text = fixture()
      .replace('Major: Artificial Intelligence', 'Major: Cognitive Science')
      .replace('Intended Degree: Bachelor of Science\n', '');
    const s = fromAcademicHistory(text, { currentTerm: 'FA26' });
    expect(s.majorFile).toBeNull();
    expect(s.confidence).toBe('low');
    expect(s.warnings.some((w) => /Cognitive Science \(B\.A\.\)/.test(w) && /Cognitive Science \(B\.S\.\)/.test(w))).toBe(true);
  });
  it('picks the B.S. file when the degree line is present', () => {
    const text = fixture().replace('Major: Artificial Intelligence', 'Major: Cognitive Science');
    expect(fromAcademicHistory(text, { currentTerm: 'FA26' }).majorFile).toBe('cognitive-science-cognitive-science-2.json');
  });
  it('flags a double major and an unmatched college instead of throwing', () => {
    const text = fixture()
      .replace('Major: Artificial Intelligence', 'Major: Artificial Intelligence\nMajor: Mathematics')
      .replace('College: Revelle College', 'College: Ninth College');
    const s = fromAcademicHistory(text, { currentTerm: 'FA26' });
    expect(s.majorFile).toBe('computer-science-and-engineering-artificial-intelligence.json');
    expect(s.majors).toEqual(['Artificial Intelligence', 'Mathematics']);
    expect(s.collegeFile).toBeNull();
    expect(s.confidence).toBe('medium');
    expect(s.warnings.join(' ')).toMatch(/Second major "Mathematics"/);
    expect(s.warnings.join(' ')).toMatch(/Ninth College/);
  });
  it('warns when in-progress rows are not in the current term', () => {
    const s = fromAcademicHistory(fixture(), { currentTerm: 'WI27' });
    expect(s.warnings.join(' ')).toMatch(/recorded under FA26, not the current term WI27/);
  });
  it('returns a low-confidence state with warnings for an empty paste', () => {
    const s = fromAcademicHistory('', { currentTerm: 'FA26' });
    expect(s.courses).toEqual([]);
    expect(s.majorFile).toBeNull();
    expect(s.collegeFile).toBeNull();
    expect(s.confidence).toBe('low');
    expect(s.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe('demo students', () => {
  it('loads three synthetic students with matched files and 16 units in progress each', () => {
    const demos = demoStudents();
    expect(demos.length).toBe(3);
    for (const d of demos) {
      expect(d.source).toBe('demo');
      expect(d.currentTerm).toBe('FA26');
      expect(d.majorFile).not.toBeNull();
      expect(d.collegeFile).not.toBeNull();
      expect(inProgress(d).reduce((n, c) => n + c.units, 0)).toBe(16);
    }
    expect(demos.map((d) => d.college)).toEqual(['Revelle College', 'Thurgood Marshall College', 'Sixth College']);
  });
  it('gives the transfer student XFER rows that count as earned', () => {
    const c = demoStudents()[2];
    expect(c.transfer.length).toBeGreaterThan(5);
    const earned = earnedCodes(c);
    expect(earned.has('MATH 20A')).toBe(true);
    expect(c.courses.find((x) => x.code === 'MATH 20A')).toMatchObject({ term: 'XFER', units: 0, grade: 'P' });
  });
});

describe('earnedCodes', () => {
  it('excludes W / NP / F rows even though the parser marks them earned', () => {
    const s = fromAcademicHistory(fixture(), { currentTerm: 'FA26' });
    s.courses.find((c) => c.code === 'CHEM 11')!.grade = 'W';
    s.courses.find((c) => c.code === 'COGS 9')!.grade = 'NP';
    const earned = earnedCodes(s);
    expect(earned.has('CHEM 11')).toBe(false);
    expect(earned.has('COGS 9')).toBe(false);
    expect(earned.has('CSE 12')).toBe(true);
    expect(earned.has('CSE 29')).toBe(false); // in progress
  });
});
