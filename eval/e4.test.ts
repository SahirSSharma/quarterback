import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StudentState } from '../lib/types';
import { demoStudents, fromAcademicHistory } from '../lib/engine/student';
import { LAYOUTS, makeCases, renderE4, renderPaste, runCase, scoreIntake, summarize, termName } from './e4';
import { makeStudents } from './synth';

const TERM = 'FA26';
const demoPaste = readFileSync(path.join(process.cwd(), 'lib/engine/fixtures/academic-history-demo.txt'), 'utf8');
const demoA = demoStudents().find((d) => d.majorFile === 'computer-science-and-engineering-artificial-intelligence.json') as StudentState;

describe('scoreIntake on the known demo paste', () => {
  it('scores the recorded paste against its own student as perfect', () => {
    const s = scoreIntake(demoA, fromAcademicHistory(demoPaste, { currentTerm: TERM }));
    expect(s).toMatchObject({ expectedRows: 17, gotRows: 17, matched: 17, precision: 1, recall: 1, gradeAcc: 1, unitsAcc: 1, majorMatch: true, collegeMatch: true, majorsMatch: true, gpaMatch: true, transferExpected: 0, transferGot: 0, confidence: 'high' });
  });
  it('a dropped row lowers recall, not precision; a changed grade lowers grade accuracy only; a wrong college is a mismatch', () => {
    const dropped = demoPaste.replace(/^CHEM 11 .*\n/m, '');
    expect(scoreIntake(demoA, fromAcademicHistory(dropped, { currentTerm: TERM }))).toMatchObject({ matched: 16, precision: 1, recall: 16 / 17, gradeAcc: 1 });
    const regraded = demoPaste.replace('MATH 20B Calculus/Science & Engineering 4.00 B 12.00', 'MATH 20B Calculus/Science & Engineering 4.00 A 16.00');
    expect(scoreIntake(demoA, fromAcademicHistory(regraded, { currentTerm: TERM }))).toMatchObject({ matched: 17, recall: 1, gradeAcc: 16 / 17, unitsAcc: 1 });
    const extra = demoPaste.replace('Term Credits Passed: 18.00 Term GPA: 3.371', 'CSE 8B Intro to Programming 2 4.00 A 16.00\nTerm Credits Passed: 18.00 Term GPA: 3.371');
    expect(scoreIntake(demoA, fromAcademicHistory(extra, { currentTerm: TERM }))).toMatchObject({ gotRows: 18, matched: 17, precision: 17 / 18, recall: 1 });
    const college = demoPaste.replace('College: Revelle College', 'College: Ninth College');
    expect(scoreIntake(demoA, fromAcademicHistory(college, { currentTerm: TERM }))).toMatchObject({ collegeMatch: false, majorMatch: true });
  });
});

describe('renderPaste', () => {
  const students = makeStudents({ n: 12, seed: 3, currentTerm: TERM });

  it('spells quarters the way TritonLink does', () => {
    expect(termName('FA25')).toBe('Fall Qtr 2025');
    expect(termName('WI27')).toBe('Winter Qtr 2027');
    expect(termName('S126')).toBe('Summer Session I 2026');
  });

  it('round-trips the web layout through the deterministic parser for every synthetic student', () => {
    for (const s of students) {
      const got = fromAcademicHistory(renderPaste(s, { layout: 'web' }), { currentTerm: TERM });
      const score = scoreIntake(s, got);
      expect(score, s.majorFile ?? '').toMatchObject({ precision: 1, recall: 1, gradeAcc: 1, unitsAcc: 1, collegeMatch: true, gpaMatch: true, transferGot: s.transfer.length });
      expect(got.courses.filter((c) => c.status === 'wip').map((c) => c.code).sort()).toEqual(s.courses.filter((c) => c.status === 'wip').map((c) => c.code).sort());
    }
  });

  it('renders the same student differently per layout and the wrapped layout really wraps long titles', () => {
    const s = students.find((x) => x.courses.some((c) => (c.title ?? '').length > 24)) as StudentState;
    const web = renderPaste(s, { layout: 'web' });
    const wrapped = renderPaste(s, { layout: 'wrapped' });
    const pdf = renderPaste(s, { layout: 'pdf' });
    expect(new Set([web, wrapped, pdf, renderPaste(s, { layout: 'reordered' })]).size).toBe(4);
    expect(wrapped.split('\n').length).toBeGreaterThan(web.split('\n').length);
    expect(pdf).toContain('\t');
    expect(pdf).toMatch(/page \d+ of \d+/);
    const got = fromAcademicHistory(wrapped, { currentTerm: TERM });
    expect(scoreIntake(s, got)).toMatchObject({ recall: 1, precision: 1 }); // joinWrappedRows() re-joins the wrapped rows before the parser
  });

  it('writes a second Major: line and a transfer block the parser reads back', () => {
    const s = students[0];
    const dm = renderPaste(s, { layout: 'double-major', secondMajor: 'Mathematics' });
    expect(dm.match(/^Major: /gm)?.length).toBe(2);
    expect(fromAcademicHistory(dm, { currentTerm: TERM }).majors).toEqual([s.major, 'Mathematics']);
    const cases = makeCases({ n: 6, seed: 3, currentTerm: TERM });
    const transfer = cases.find((c) => c.layout === 'transfer')!;
    expect(transfer.expected.transfer.length).toBeGreaterThan(0);
    expect(transfer.paste).toContain('Transfer Courses');
    const got = fromAcademicHistory(transfer.paste, { currentTerm: TERM });
    expect(got.transfer.length).toBe(transfer.expected.transfer.length);
    expect(scoreIntake(transfer.expected, got).recall).toBe(1);
  });
});

describe('makeCases / runCase / summarize', () => {
  it('cycles the six layouts, gives the double-major case two majors, and is deterministic', async () => {
    const cases = makeCases({ n: 12, seed: 1, currentTerm: TERM });
    expect(cases.map((c) => c.layout)).toEqual([...LAYOUTS, ...LAYOUTS]);
    expect(cases.filter((c) => c.layout === 'double-major').every((c) => c.expected.majors.length === 2)).toBe(true);
    expect(makeCases({ n: 12, seed: 1, currentTerm: TERM })).toEqual(cases);
    const rows = [];
    for (const c of cases) rows.push(await runCase(c, { live: false }));
    expect(rows.every((r) => r.ai === 'skipped (mock)' || r.ai === 'not needed')).toBe(true);
    expect(rows.filter((r) => r.layout === 'web').every((r) => r.recall === 1 && r.precision === 1)).toBe(true);
    const summary = summarize(rows);
    expect(summary.map((s) => s.layout)).toEqual([...LAYOUTS, 'all']);
    const all = summary.find((s) => s.layout === 'all')!;
    expect(all.pastes).toBe(12);
    expect(all.rows).toBe(rows.reduce((n, r) => n + r.expectedRows, 0));
    expect(summary.find((s) => s.layout === 'wrapped')!.recall).toBe(100); // the pre-normalizer recovers every wrapped row
    expect(summary.find((s) => s.layout === 'web')!.recall).toBe(100);
    const md = renderE4(rows, { mode: 'mock', at: 'now', jsonl: 'x.jsonl', spent: 0 });
    expect(md).toContain('| Layout | Pastes |');
    expect(md).toContain('| all | 12 |');
    expect(md).toContain('ai-intake fallback skipped');
  });
});
