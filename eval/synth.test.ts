import { describe, expect, it } from 'vitest';
import type { Plan } from '../lib/types';
import { majorsIndex } from '../lib/engine/data';
import { satisfied } from '../lib/engine/prereqs';
import { earnedCodes, inProgress } from '../lib/engine/student';
import { compare } from '../lib/engine/terms';
import { verify } from '../lib/engine/verifier';
import { chooseAction, currentTermFromCalendar, highMajors, makeStudents, plantedRisks, synthStudent } from './synth';

const TERM = 'FA26';
const students = makeStudents({ n: 30, seed: 1, currentTerm: TERM });

describe('makeStudents', () => {
  it('is deterministic: same seed → identical students, different seed → different ones, and a longer run keeps the same prefix', () => {
    expect(makeStudents({ n: 30, seed: 1, currentTerm: TERM })).toEqual(students);
    expect(makeStudents({ n: 5, seed: 1, currentTerm: TERM })).toEqual(students.slice(0, 5));
    const other = makeStudents({ n: 5, seed: 2, currentTerm: TERM });
    expect(other.map((s) => `${s.majorFile}|${s.collegeFile}|${s.courses.length}`)).not.toEqual(students.slice(0, 5).map((s) => `${s.majorFile}|${s.collegeFile}|${s.courses.length}`));
  });

  it('uses only high-confidence major files and the eight college files, and reports the index count', () => {
    const high = new Set(highMajors().map((m) => m.file));
    expect(high.size).toBe(majorsIndex().majors.filter((m) => m.confidence === 'high').length);
    expect(high.size).toBeGreaterThanOrEqual(120);
    for (const s of students) {
      expect(high.has(s.majorFile ?? '')).toBe(true);
      expect(s.collegeFile).toMatch(/college\.json$/);
      expect(s.currentTerm).toBe(TERM);
      expect(s.source).toBe('demo');
    }
    expect(new Set(students.map((s) => s.collegeFile)).size).toBeGreaterThan(3);
  });

  it('gives every earned course its prerequisites in an EARLIER quarter (or transfer credit), and in-progress rows in the current term', () => {
    let checked = 0;
    for (const s of students) {
      for (const c of s.courses) {
        if (c.term === 'XFER') continue;
        const before = new Set(s.courses.filter((x) => x.term === 'XFER' || (x.status === 'earned' && compare(x.term, c.term) < 0)).map((x) => x.code));
        expect(satisfied(c.code, before), `${s.majorFile}: ${c.code} in ${c.term}`).toBe(true);
        checked += 1;
      }
      const wip = inProgress(s);
      expect(wip.length).toBeGreaterThan(0);
      expect(s.courses.filter((c) => c.status === 'wip').every((c) => c.term === TERM)).toBe(true);
      expect(wip.every((c) => c.grade === null)).toBe(true);
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('records 2–8 quarters of history, passing grades only (they must count for prerequisites), and a GPA from the letter grades', () => {
    for (const s of students) {
      const history = new Set(s.courses.filter((c) => c.status === 'earned' && c.term !== 'XFER').map((c) => c.term));
      expect(history.size).toBeGreaterThanOrEqual(2);
      expect(history.size).toBeLessThanOrEqual(8);
      for (const c of s.courses.filter((x) => x.status === 'earned')) expect(earnedCodes(s).has(c.code)).toBe(true);
      expect(s.gpa).not.toBeNull();
      expect(s.gpa as number).toBeGreaterThan(1.5);
      expect(s.gpa as number).toBeLessThanOrEqual(4);
    }
  });

  it('shapes transfer rows like the vendored parser: XFER rows with 0 units and a P that satisfy prerequisites', () => {
    const withTransfer = students.filter((s) => s.transfer.length);
    expect(withTransfer.length).toBeGreaterThan(0);
    for (const s of withTransfer) {
      for (const t of s.transfer as { approx: string[]; units: number; grade: string; term: string; level: string }[]) {
        expect(t.grade).toBe('P');
        expect(t.level).toBe('LD');
        for (const k of t.approx) expect(s.courses.find((c) => c.code === k)).toMatchObject({ term: 'XFER', units: 0, grade: 'P', status: 'earned', title: `${k} (transfer credit)` });
      }
    }
    const forced = synthStudent({ major: highMajors()[0], college: { college: 'Revelle College', file: 'revelle-college.json', matchKey: '', slug: '', confidence: 'high', found: true, bucketCount: 0 }, seed: 3, currentTerm: TERM, transfer: false });
    expect(forced.transfer).toEqual([]);
  });

  it('derives the current term from the registrar calendar, never a constant', () => {
    expect(currentTermFromCalendar('2026-10-15T12:00:00-07:00')).toBe('FA26');
    expect(currentTermFromCalendar('2027-02-01T12:00:00-08:00')).toBe('WI27');
    expect(currentTermFromCalendar('2026-08-01T12:00:00-07:00')).toBe('FA26'); // next to begin
  });
});

describe('plantedRisks', () => {
  const planted = plantedRisks(students);
  const plan = (course: string, term: string): Plan => ({ id: 'p', label: 'plant', terms: [{ term, courses: [course], units: 4, partTime: true }], rationale: '', graduationTerm: null });

  it('plants all three kinds and keeps each plant otherwise legal on the record', () => {
    const kinds = new Set(planted.map((p) => p.risk.kind));
    expect(kinds).toEqual(new Set(['not_offered', 'unknown', 'heavy_load']));
    for (const p of planted) {
      expect(p.risk.term).toBe('WI27');
      if (p.risk.course) expect(p.student.courses.some((c) => c.code === p.risk.course)).toBe(false);
    }
  });

  it('a not_offered plant is exactly what verify() rejects — the not-offered error on that course and nothing else', () => {
    const cases = planted.filter((p) => p.risk.kind === 'not_offered');
    expect(cases.length).toBeGreaterThan(3);
    for (const p of cases) {
      const report = verify(plan(p.risk.course as string, p.risk.term), p.student);
      // Errors on the planted course: the offering rule and nothing else (no prereq-unsatisfied, no already-earned).
      const errors = (r: typeof report) => r.violations.filter((v) => v.course === p.risk.course && v.severity === 'error');
      expect(errors(report).map((v) => v.rule)).toEqual(['not-offered']);
      expect(errors(report)[0].message).toContain(p.risk.quote as string);
      expect(report.violations.some((v) => v.rule === 'assumed-offered' && v.course === p.risk.course)).toBe(false);
      expect(report.ok).toBe(false);
      // Any drop of an in-progress course leaves the plant eligible: prerequisites come from EARNED rows only.
      const action = chooseAction(p.student);
      const after = { ...p.student, courses: p.student.courses.filter((c) => !(c.code === action?.course && c.status === 'wip')) };
      expect(errors(verify(plan(p.risk.course as string, p.risk.term), after)).map((v) => v.rule)).toEqual(['not-offered']);
    }
  });

  it('an unknown plant passes verify() with only the assumed-offered warning on that course', () => {
    const cases = planted.filter((p) => p.risk.kind === 'unknown');
    expect(cases.length).toBeGreaterThan(2);
    for (const p of cases) {
      const report = verify(plan(p.risk.course as string, p.risk.term), p.student);
      expect(report.ok).toBe(true);
      const own = report.violations.filter((v) => v.course === p.risk.course);
      expect(own.filter((v) => v.severity === 'error')).toEqual([]);
      expect(own.filter((v) => v.rule !== 'double-count').map((v) => `${v.rule}/${v.severity}`)).toEqual(['assumed-offered/warning']);
      expect(own.find((v) => v.rule === 'assumed-offered')?.message).toContain(p.risk.quote as string);
    }
  });

  it('a heavy-load student carries ≥ 18 units in every quarter on record; a 20-unit quarter trips the unit-cap warning', () => {
    const cases = planted.filter((p) => p.risk.kind === 'heavy_load');
    expect(cases.length).toBeGreaterThan(3);
    for (const p of cases) {
      const terms = [...new Set(p.student.courses.filter((c) => c.term !== 'XFER').map((c) => c.term))];
      expect(terms.length).toBe(4);
      for (const t of terms) expect(p.student.courses.filter((c) => c.term === t).reduce((n, c) => n + c.units, 0)).toBeGreaterThanOrEqual(18);
      expect(inProgress(p.student).length).toBeGreaterThanOrEqual(4);
      expect(p.risk.course).toBeNull();
      const heavyPlan: Plan = { id: 'h', label: 'heavy', terms: [{ term: 'WI27', courses: [], units: 20, partTime: false }], rationale: '', graduationTerm: null };
      expect(verify(heavyPlan, p.student).violations.map((v) => v.rule)).toContain('unit-cap');
    }
  });
});

describe('chooseAction', () => {
  it('drops the in-progress course with the most downstream courses, deterministically', () => {
    for (const s of students.slice(0, 10)) {
      const a = chooseAction(s);
      expect(a?.kind).toBe('drop');
      expect(inProgress(s).map((c) => c.code)).toContain(a?.course);
      expect(chooseAction(s)).toEqual(a);
    }
    expect(chooseAction({ ...students[0], courses: students[0].courses.filter((c) => c.status !== 'wip') })).toBeNull();
  });
});
