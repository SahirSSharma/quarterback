import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSheetCsv, parseCsvRecords } from './parse-sheet-csv';

const root = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(root, 'data/offerings', f), 'utf8');

describe('parseCsvRecords', () => {
  it('handles quoted commas, doubled quotes, embedded newlines and CRLF', () => {
    const records = parseCsvRecords('a,"b,c","d ""e""","f\ng"\r\nh,,,\r\n\r\n');
    expect(records.map((r) => r.fields)).toEqual([['a', 'b,c', 'd "e"', 'f\ng'], ['h', '', '', '']]);
    expect(records[0].raw).toBe('a,"b,c","d ""e""","f\ng"');
  });
});

describe('parseSheetCsv on the CSE 2026-27 sheet', () => {
  const raw = read('raw-cse-2026-27.csv');
  const meta = { url: 'https://cse.ucsd.edu/undergraduate/tentative-course-offerings', fetchedAt: '2026-09-27T00:00:00.000Z' };
  const rows = parseSheetCsv(raw, meta);
  const of = (course: string, term: string) => rows.find((r) => r.course === course && r.term === term)!;

  it('yields one row per course per term', () => {
    const courses = new Set(rows.map((r) => r.course));
    expect(courses.size).toBe(92);
    expect(rows.length).toBe(92 * 3);
    for (const c of courses) expect(rows.filter((r) => r.course === c).map((r) => r.term)).toEqual(['FA26', 'WI27', 'SP27']);
  });

  it('CSE 100 is offered in all three terms, with both spring instructors', () => {
    expect(of('CSE 100', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Paul Cao' });
    expect(of('CSE 100', 'WI27')).toMatchObject({ status: 'offered', instructor: 'Niema Moshiri' });
    expect(of('CSE 100', 'SP27')).toMatchObject({ status: 'offered', instructor: 'Debashis Sahoo; Paul Cao' });
  });

  it('a blank cell is not_offered (CSE 3 fall only)', () => {
    expect(of('CSE 3', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Christine Alvarado' });
    expect(of('CSE 3', 'WI27').status).toBe('not_offered');
    expect(of('CSE 3', 'SP27').status).toBe('not_offered');
    expect(of('CSE 3', 'WI27').instructor).toBeUndefined();
  });

  it('normalizes leading zeros and suffixes', () => {
    expect(of('CSE 8A', 'FA26').instructor).toBe('Leo Porter');
    expect(of('CSE 4GS', 'FA26').status).toBe('not_offered');
    expect(of('CSE 11', 'FA26').instructor).toBe('Benjamin Ochoa; Joe Politz');
  });

  it('quotes are the verbatim CSV record', () => {
    for (const r of rows) {
      expect(raw.includes(r.quote)).toBe(true);
      expect(r.quote.length).toBeLessThanOrEqual(300);
      expect(r.quote.startsWith('CSE-')).toBe(true);
    }
    expect(of('CSE 100', 'SP27').quote).toBe('CSE-100,Advanced Data Structures,Paul Cao,Niema Moshiri,"Debashis Sahoo\nPaul Cao"');
  });

  it('never says offered without an instructor, and carries url/fetchedAt/source', () => {
    for (const r of rows) {
      expect(r.status === 'offered').toBe(r.instructor !== undefined);
      expect(r).toMatchObject({ url: meta.url, fetchedAt: meta.fetchedAt, source: 'department-page' });
    }
  });

  it('fails loudly on a row without a course code', () => {
    expect(() => parseSheetCsv('Course #,Title,Fall 2026\nNote: see advisor,,\n', meta)).toThrow(/without a course code/);
  });
});

describe('parseSheetCsv on the COGS 2026-27 sheet', () => {
  const raw = read('raw-cogs-2026-27.csv');
  const meta = { url: 'https://cogsci.ucsd.edu/undergraduates/courses/index.html', fetchedAt: '2026-09-27T00:00:00.000Z' };
  const rows = parseSheetCsv(raw, meta);
  const of = (course: string, term: string) => rows.find((r) => r.course === course && r.term === term)!;

  it('yields the three quarters and skips the sessionless Summer 1/2 columns', () => {
    // 95 records; COGS 18, 108 and 160 are listed once per section (A00/B00) and merge into one course each.
    expect(new Set(rows.map((r) => r.course)).size).toBe(92);
    expect(rows.length).toBe(92 * 3);
    expect(new Set(rows.map((r) => r.term))).toEqual(new Set(['FA26', 'WI27', 'SP27']));
  });

  it('merges section rows: offered when any section names an instructor, quoting that row', () => {
    expect(of('COGS 18', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Morgan', quote: 'COGS 18 A00,Morgan,Morgan,Ellis,,' });
    expect(of('COGS 18', 'SP27')).toMatchObject({ status: 'offered', instructor: 'Ellis' });
    expect(of('COGS 108', 'SP27')).toMatchObject({ status: 'offered', instructor: 'Tomoschuk', quote: 'COGS 108 A00,Ellis,Fleischer,Tomoschuk,,' });
    expect(of('COGS 160', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Saygin', quote: 'COGS 160 B00,Saygin,,Saygin,,' });
    expect(of('COGS 160', 'SP27')).toMatchObject({ status: 'offered', instructor: 'Kirsh; Saygin' });
  });

  it('reads offered and blank cells', () => {
    expect(of('COGS 1', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Barrera' });
    expect(of('COGS 1', 'WI27')).toMatchObject({ status: 'offered', instructor: 'Boyle' });
    expect(of('COGS 1', 'SP27')).toMatchObject({ status: 'offered', instructor: 'Deak' });
    expect(rows.filter((r) => r.course === 'COGS 3').map((r) => r.status)).toEqual(['not_offered', 'not_offered', 'not_offered']);
    expect(of('COGS 118A', 'FA26').instructor).toBe('Tu');
    expect(of('COGS 118A', 'WI27').status).toBe('not_offered');
    expect(of('COGS 118A', 'SP27').instructor).toBe('Fleischer');
  });

  it('quotes are the verbatim record without the CR', () => {
    for (const r of rows) {
      expect(raw.includes(r.quote)).toBe(true);
      expect(r.quote.includes('\r')).toBe(false);
    }
    expect(of('COGS 1', 'FA26').quote).toBe('COGS 1,Barrera,Boyle,Deak,,');
  });
});
