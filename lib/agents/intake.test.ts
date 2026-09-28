import { describe, expect, it } from 'vitest';
import { intakeSchema, toStudentState, toTermCode, type IntakeRecord } from './intake';

describe('toTermCode', () => {
  it('keeps quarter codes, reads spelled-out quarters, and maps transfer rows to XFER', () => {
    expect(toTermCode('FA25')).toBe('FA25');
    expect(toTermCode('wi26')).toBe('WI26');
    expect(toTermCode('S126')).toBe('S126');
    expect(toTermCode('Fall 2025')).toBe('FA25');
    expect(toTermCode('Winter Qtr 2026')).toBe('WI26');
    expect(toTermCode('Spring 26')).toBe('SP26');
    expect(toTermCode('Summer Session I 2026')).toBe('S126');
    expect(toTermCode('XFER')).toBe('XFER');
    expect(toTermCode('Transfer credit')).toBe('XFER');
  });
});

describe('toStudentState', () => {
  const record: IntakeRecord = {
    college: 'Revelle College',
    major: 'Artificial Intelligence',
    degree: 'Bachelor of Science',
    gpa: 3.35,
    courses: [
      { code: 'cse 11', title: 'Intro to Programming: Accelerated', term: 'Fall 2025', units: 4, grade: 'A', inProgress: false },
      { code: 'MATH 20A', title: null, term: 'FA25', units: 4, grade: 'B+', inProgress: false },
      { code: 'CSE 29', title: 'Systems Programming', term: 'FA26', units: 4, grade: null, inProgress: true },
      { code: 'MATH 1A', title: 'Calculus I', term: 'transfer', units: 0, grade: 'P', inProgress: false },
    ],
  };

  it('builds an ai-intake state with the matched major and college files at medium confidence', () => {
    const s = toStudentState(record, 'fa26');
    expect(s.source).toBe('ai-intake');
    expect(s.confidence).toBe('medium');
    expect(s.majorFile).toBe('computer-science-and-engineering-artificial-intelligence.json');
    expect(s.collegeFile).toBe('revelle-college.json');
    expect(s.currentTerm).toBe('FA26');
    expect(s.gpa).toBe(3.35);
    expect(s.majors).toEqual(['Artificial Intelligence']);
    expect(s.courses).toEqual([
      { code: 'CSE 11', title: 'Intro to Programming: Accelerated', term: 'FA25', units: 4, grade: 'A', status: 'earned' },
      { code: 'MATH 20A', term: 'FA25', units: 4, grade: 'B+', status: 'earned' },
      { code: 'CSE 29', title: 'Systems Programming', term: 'FA26', units: 4, grade: null, status: 'wip' },
      { code: 'MATH 1A', title: 'Calculus I', term: 'XFER', units: 0, grade: 'P', status: 'earned' },
    ]);
    expect(s.warnings).toEqual([
      'Confirm the major: the record reads "Artificial Intelligence", matched to the "Artificial Intelligence" requirement set.',
      'A model read this paste, not the parser: confirm the 4 course rows (codes, quarters, units, grades) before planning.',
    ]);
  });

  it('treats a row without a real grade as in progress, whatever the model said', () => {
    const s = toStudentState(
      {
        ...record,
        courses: [
          { code: 'CSE 29', title: null, term: 'Fall Qtr 2026', units: 4, grade: '0.00', inProgress: false }, // the grade-points column, as Lightning read it
          { code: 'CSE 20', title: null, term: 'FA26', units: 4, grade: 'IP', inProgress: false },
          { code: 'MATH 20C', title: null, term: 'FA26', units: 4, grade: '', inProgress: false },
          { code: 'HUM 3', title: null, term: 'FA26', units: 4, grade: null, inProgress: true },
          { code: 'CSE 12', title: null, term: 'WI26', units: 4, grade: 'a-', inProgress: false },
        ],
      },
      'FA26',
    );
    expect(s.courses.map((c) => `${c.code}:${c.grade}:${c.status}`)).toEqual(['CSE 29:null:wip', 'CSE 20:null:wip', 'MATH 20C:null:wip', 'HUM 3:null:wip', 'CSE 12:A-:earned']);
    expect(s.warnings).not.toContain('No in-progress courses were found for FA26.');
  });

  it('stays low confidence and says what to confirm when nothing matches', () => {
    const s = toStudentState({ ...record, college: 'Hogwarts', major: 'Potions', degree: null, gpa: null, courses: record.courses.slice(0, 2) }, 'FA26');
    expect(s.confidence).toBe('low');
    expect(s.majorFile).toBeNull();
    expect(s.collegeFile).toBeNull();
    expect(s.warnings).toEqual([
      'No requirement set matches the major "Potions".',
      'College "Hogwarts" did not match a GE file.',
      'A model read this paste, not the parser: confirm the 2 course rows (codes, quarters, units, grades) before planning.',
      'No in-progress courses were found for FA26.',
    ]);
    const none = toStudentState({ ...record, college: null, major: null }, 'FA26');
    expect(none.warnings[0]).toBe('No major found on the record.');
    expect(none.warnings[1]).toBe('No college found on the record.');
    expect(none.major).toBe('');
    expect(none.majors).toEqual([]);
  });

  it('refuses to guess between the Cognitive Science B.A. and B.S. without a degree', () => {
    const s = toStudentState({ ...record, major: 'Cognitive Science', degree: null }, 'FA26');
    expect(s.majorFile).toBeNull();
    expect(s.confidence).toBe('low');
    expect(s.warnings[0]).toMatch(/"Cognitive Science" matches \d+ requirement sets: .*Pick one\./);
  });
});

it('intakeSchema is strict-friendly: every field required, nulls where a value may be missing', () => {
  expect(intakeSchema.safeParse({ college: null, major: null, degree: null, gpa: null, courses: [] }).success).toBe(true);
  expect(intakeSchema.safeParse({ college: 'x', courses: [] }).success).toBe(false);
  expect(intakeSchema.safeParse({ college: null, major: null, degree: null, gpa: null, courses: [{ code: 'CSE 11', term: 'FA25', units: 4, grade: 'A', inProgress: false }] }).success).toBe(false); // title missing
});
