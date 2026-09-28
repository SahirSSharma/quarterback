import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  catalogByCode, catalogEntries, catalogOverrides, catalogUnits, collegesIndex, grades, gradingRestrictions, loadCollege,
  loadMajor, majorsIndex, normalizeCode, offeringsRows, registrarCalendar, sectionsByCode,
} from './data';

describe('normalizeCode', () => {
  it('upper-cases, collapses whitespace and inserts the space', () => {
    expect(normalizeCode('cse100')).toBe('CSE 100');
    expect(normalizeCode('  Math   20c ')).toBe('MATH 20C');
    expect(normalizeCode('CSE 100R')).toBe('CSE 100R');
  });
  it('drops the leading zeros department pages use', () => {
    expect(normalizeCode('CSE-003')).toBe('CSE 3');
    expect(normalizeCode('CSE-029')).toBe('CSE 29');
    expect(normalizeCode('CSE-100R')).toBe('CSE 100R');
  });
  it('leaves non-codes alone apart from case and spacing', () => {
    expect(normalizeCode('MATH 100-199')).toBe('MATH 100 199');
    expect(normalizeCode('')).toBe('');
  });
});

describe('catalog', () => {
  it('loads every department page and the bare search index (≥ 15,000 records)', () => {
    expect(catalogEntries().length).toBeGreaterThanOrEqual(15_000);
  });
  it('indexes at least 7,500 distinct codes with normalized prereqs', () => {
    const map = catalogByCode();
    expect(map.size).toBeGreaterThanOrEqual(7_500);
    const c100 = map.get('CSE 100')!;
    expect(c100.title).toBe('Advanced Data Structures');
    expect(c100.prereqs).toEqual([
      ['CSE 21', 'MATH 154', 'MATH 158', 'MATH 184', 'MATH 188'],
      ['CSE 12'],
      ['CSE 15L', 'CSE 29', 'ECE 15'],
    ]);
  });
  it('prefers the course’s own department page for a cross-listed course', () => {
    expect(catalogByCode().get('CSE 282')!.page).toBe('CSE');
    expect(catalogByCode().get('BENG 202')!.page).toBe('BENG');
  });
  it('reads units as a number where the catalog prints one', () => {
    expect(catalogUnits('CSE 100')).toBe(4);
    expect(catalogUnits('HUM 1')).toBe(6);
    expect(catalogUnits('CSE 15L')).toBe(2);
    expect(catalogUnits('NOPE 1')).toBeNull();
  });
  it('applies data/catalog-overrides.json over a mis-parsed snapshot row, leaving the raw entries as scraped', () => {
    // CSE 29: "…; two units of credit offered for CSE 29 if CSE 15L taken previously" is not a prerequisite.
    expect(catalogByCode().get('CSE 29')!.prereqs).toEqual([['CSE 11', 'CSE 8B', 'ECE 15']]);
    // MATH 180A: "Math 20C or MATH 31BH" — the lower-case mention was dropped upstream.
    expect(catalogByCode().get('MATH 180A')!.prereqs).toEqual([['MATH 20C', 'MATH 31BH']]);
    const raw = catalogEntries().find((c) => c.code === 'CSE 29' && c.prereqText)!;
    expect(raw.prereqs).toEqual([['CSE 11', 'CSE 8B', 'ECE 15'], ['CSE 15L']]);
    // Every override names a real catalog course and is normalized.
    for (const [code, groups] of catalogOverrides()) {
      expect(catalogByCode().has(code)).toBe(true);
      expect(catalogByCode().get(code)!.prereqs).toEqual(groups);
      for (const g of groups) for (const m of g) expect(m).toBe(normalizeCode(m));
    }
  });
  it('exposes catalog grading restrictions keyed by normalized code', () => {
    const r = gradingRestrictions();
    expect(Object.keys(r).length).toBeGreaterThan(400);
    expect(new Set(Object.values(r))).toEqual(new Set(['P', 'S', 'L']));
  });
});

describe('requirement files', () => {
  it('indexes 140 of the 142 major files (2 are excluded on purpose), all loadable with buckets', () => {
    const { majors, excluded } = majorsIndex();
    expect(majors.length).toBe(140);
    expect(excluded!.length).toBe(2);
    const onDisk = readdirSync(path.join(process.cwd(), 'data/majors')).filter((f) => f.endsWith('.json') && !['index.json', 'uncovered.json'].includes(f));
    expect(onDisk.length).toBe(142);
    for (const m of majors) expect(Array.isArray(loadMajor(m.file).buckets)).toBe(true);
  });
  it('lists 8 college files with campuswide buckets', () => {
    const colleges = collegesIndex().colleges;
    expect(colleges.length).toBe(8);
    for (const c of colleges) {
      const file = loadCollege(c.file);
      expect(file.buckets.filter((b) => b.scope === 'university').length).toBe(3);
    }
  });
  it('resolves the AI major to its file', () => {
    const ai = majorsIndex().majors.find((m) => m.matchKey === 'artificial intelligence')!;
    expect(loadMajor(ai.file).program.department).toContain('Computer Science');
  });
});

describe('grades, sections, calendar, offerings', () => {
  it('has CAPE history for CSE 100 and none for CSE 29', () => {
    expect(grades()['CSE 100'].lq).toBe('SP23');
    expect(grades()['CSE 29']).toBeUndefined();
  });
  it('loads FA26 sections and returns null for a term without a file', () => {
    const fa = sectionsByCode('FA26')!;
    expect(fa.size).toBeGreaterThan(2_000);
    expect(fa.get('CSE 29')!.sections.some((s) => s.meeting_type === 'LE')).toBe(true);
    expect(sectionsByCode('WI27')).toBeNull();
  });
  it('ships the verified FA26 deadlines', () => {
    expect(registrarCalendar().terms.FA26.dropWithoutW).toBe('2026-10-23');
    expect(registrarCalendar().terms.FA26.dropWithW).toBe('2026-11-06');
  });
  it('loads whatever offerings evidence exists without throwing', () => {
    const rows = offeringsRows();
    expect(rows).toBeInstanceOf(Map);
    for (const byTerm of rows.values()) {
      for (const [term, ev] of byTerm) {
        expect(term).toMatch(/^(FA|WI|SP|S1|S2)\d{2}$/);
        expect(['offered', 'tentative', 'not_offered', 'unknown']).toContain(ev.status);
        expect(ev.source).toBe('department-page');
      }
    }
  });
});
