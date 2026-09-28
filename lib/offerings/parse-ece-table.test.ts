import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEceTable } from './parse-ece-table';
import { stripMarkdownLinks } from './normalize';

const root = path.resolve(__dirname, '../..');
const raw = readFileSync(path.join(root, 'data/offerings/raw-ece-2026-27.md'), 'utf8');
const meta = { url: 'https://ece.ucsd.edu/ece-tentative-course-list', fetchedAt: '2026-09-27T00:00:00.000Z' };
const rows = parseEceTable(raw, meta);
const of = (course: string, term: string) => rows.find((r) => r.course === course && r.term === term)!;

describe('parseEceTable on the 2026-27 page', () => {
  it('yields one row per course per quarter and skips the sessionless summer column', () => {
    const courses = new Set(rows.map((r) => r.course));
    expect(courses.size).toBe(185);
    expect(rows.length).toBe(185 * 3);
    expect(new Set(rows.map((r) => r.term))).toEqual(new Set(['FA26', 'WI27', 'SP27']));
  });

  it('ECE 5 is offered in fall and winter, not spring', () => {
    expect(of('ECE 5', 'FA26')).toMatchObject({ status: 'offered', instructor: 'MORRIS' });
    expect(of('ECE 5', 'WI27')).toMatchObject({ status: 'offered', instructor: 'MORRIS' });
    expect(of('ECE 5', 'SP27').status).toBe('not_offered');
    expect(of('ECE 5', 'SP27').instructor).toBeUndefined();
  });

  it('recovers the course code from the catalog anchor when the code link is missing', () => {
    expect(of('ECE 111', 'FA26')).toMatchObject({ status: 'offered', instructor: 'KOUSHANFAR' });
    expect(of('ECE 111', 'SP27')).toMatchObject({ status: 'offered', instructor: 'TBD' });
  });

  it('quotes are the rendered row (links stripped); every cell is verbatim page text', () => {
    const page = stripMarkdownLinks(raw).replace(/\s+/g, ' ');
    for (const r of rows) {
      expect(r.quote.length).toBeLessThanOrEqual(300);
      expect(r.quote.includes('](')).toBe(false);
      for (const cell of r.quote.split(' | ').filter(Boolean)) expect(page.includes(cell)).toBe(true);
    }
    expect(of('ECE 5', 'FA26').quote).toBe('ECE 005 Experience ECE: Making, Breaking, Hacking Stuff | MORRIS | MORRIS |  | ');
  });

  it('never says offered without an instructor', () => {
    for (const r of rows) {
      expect(r.status === 'offered').toBe(r.instructor !== undefined);
      expect(r).toMatchObject({ url: meta.url, fetchedAt: meta.fetchedAt, source: 'department-page' });
    }
  });

  it('fails loudly when a row has a different number of cells than the header', () => {
    const md = '| COURSE | FALL 26 | WINTER 27 |\n| --- | --- | --- |\n| [ECE 1](http://x#ece1) | A |\n';
    expect(() => parseEceTable(md, meta)).toThrow(/expected 3 cells/);
  });
});
