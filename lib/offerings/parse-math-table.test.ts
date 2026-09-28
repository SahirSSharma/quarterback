import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { htmlText, parseMathHtml } from './parse-math-table';

const root = path.resolve(__dirname, '../..');
const raw = readFileSync(path.join(root, 'data/offerings/raw-math-2026-27.html'), 'utf8');
const meta = { url: 'https://math.ucsd.edu/students/planned-course-offerings?year=2026-2027', fetchedAt: '2026-09-27T00:00:00.000Z', academicYear: '2026-2027' };
const rows = parseMathHtml(raw, meta);
const of = (course: string, term: string) => rows.find((r) => r.course === course && r.term === term)!;

describe('parseMathHtml on the 2026-27 page', () => {
  it('yields one row per course per term across the three tables', () => {
    const courses = new Set(rows.map((r) => r.course));
    expect(courses.size).toBe(175);
    expect(rows.length).toBe(175 * 3);
    expect(courses.has('MATH 2')).toBe(true);
    expect(courses.has('MATH 282B')).toBe(true);
  });

  it('MATH 18 is offered all three terms, instructors merged across sections without duplicates', () => {
    expect(of('MATH 18', 'FA26')).toMatchObject({ status: 'offered', instructor: 'Dembski, Kevin; Mallory, Daniel; Teixeira, Ian; Anzaldo, Leesa' });
    expect(of('MATH 18', 'WI27').status).toBe('offered');
    expect(of('MATH 18', 'SP27').status).toBe('offered');
    const names = of('MATH 20C', 'FA26').instructor!.split('; ');
    expect(new Set(names).size).toBe(names.length);
  });

  it('places one-section courses in the right quarter (the case the markdown export loses)', () => {
    expect(rows.filter((r) => r.course === 'MATH 31A').map((r) => r.status)).toEqual(['offered', 'not_offered', 'not_offered']);
    expect(rows.filter((r) => r.course === 'MATH 31B').map((r) => r.status)).toEqual(['not_offered', 'offered', 'not_offered']);
    expect(rows.filter((r) => r.course === 'MATH 31C').map((r) => r.status)).toEqual(['not_offered', 'not_offered', 'offered']);
    expect(of('MATH 31B', 'WI27').instructor).toBe('Nava Trejo, Julio');
  });

  it('a continuation row adds its instructor to the term it sits in', () => {
    expect(of('MATH 4C', 'FA26').instructor).toBe('Anzaldo, Leesa; Weening, Fred');
    expect(of('MATH 4C', 'WI27').instructor).toBe('Anzaldo, Leesa');
    expect(of('MATH 4C', 'FA26').quote).toBe('MATH 4C | Pre-Calculus For Science & Engineering | 001 | Anzaldo, Leesa | Anzaldo, Leesa | Anzaldo, Leesa');
  });

  it('quotes are the rendered row; every cell is verbatim page text and blank cells keep their position', () => {
    const page = htmlText(raw);
    for (const r of rows) {
      expect(r.quote.length).toBeLessThanOrEqual(300);
      for (const cell of r.quote.split(' | ').filter(Boolean)) expect(page.includes(cell)).toBe(true);
    }
    expect(of('MATH 31B', 'WI27').quote).toBe('MATH 31B | Honors Multivariable Calculus | 001 |  | Nava Trejo, Julio | ');
  });

  it('never says offered without an instructor', () => {
    for (const r of rows) {
      expect(r.status === 'offered').toBe(r.instructor !== undefined);
      expect(r).toMatchObject({ url: meta.url, fetchedAt: meta.fetchedAt, source: 'department-page' });
    }
  });

  it('ignores tables that are not offering tables', () => {
    const html = '<table><tr><th>COURSE</th><th>UNITS</th></tr><tr><td>MATH 1</td><td>4</td></tr></table>';
    expect(() => parseMathHtml(html, meta)).toThrow(/no offering table/);
  });

  it('does not absorb rows outside an offering table as sections of the last course', () => {
    const html =
      '<table><tr><th>COURSE</th><th>COURSE NAME</th><th>LECT</th><th>FALL</th><th>WINTER</th><th>SPRING</th></tr>' +
      '<tr><td>MATH 9</td><td>X</td><td>001</td><td>A</td><td></td><td>C</td></tr></table>' +
      '<table><tr><td>002</td><td>Q</td><td>R</td><td>S</td></tr></table>';
    const rows = parseMathHtml(html, meta);
    expect(rows.map((r) => [r.term, r.status, r.instructor])).toEqual([['FA26', 'offered', 'A'], ['WI27', 'not_offered', undefined], ['SP27', 'offered', 'C']]);
  });

  it('fails loudly on a row whose shape does not match the header', () => {
    const html =
      '<table><tr><th>COURSE</th><th>COURSE NAME</th><th>LECT</th><th>FALL</th><th>WINTER</th><th>SPRING</th></tr>' +
      '<tr><td>MATH 9</td><td>X</td><td>001</td><td>A</td><td>B</td></tr></table>';
    expect(() => parseMathHtml(html, meta)).toThrow(/unexpected row shape/);
  });
});
