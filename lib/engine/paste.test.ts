import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { joinWrappedRows } from './paste';

const fixture = () => readFileSync(path.join(process.cwd(), 'lib/engine/fixtures/academic-history-demo.txt'), 'utf8');
const lines = (...l: string[]) => l.join('\n');

describe('joinWrappedRows', () => {
  it('returns the demo paste byte-for-byte: complete rows are never touched', () => {
    const text = fixture();
    expect(joinWrappedRows(text)).toBe(text);
  });

  it('re-joins a title that continues on the next line with the units/grade tail', () => {
    expect(joinWrappedRows(lines('CSE 29 Systems Programming', 'and Software Tools 4.00 A 16.00'))).toBe('CSE 29 Systems Programming and Software Tools 4.00 A 16.00');
  });

  it('re-joins a units/grade tail that dropped to the next line, graded or in progress', () => {
    expect(joinWrappedRows(lines('MATH 20A Calculus/Science & Engineering', '4.00 B+ 13.20'))).toBe('MATH 20A Calculus/Science & Engineering 4.00 B+ 13.20');
    expect(joinWrappedRows(lines('CSE 29 Systems Programming and Software Tools', '4.00 0.00'))).toBe('CSE 29 Systems Programming and Software Tools 4.00 0.00');
    expect(joinWrappedRows(lines('CSE 12 Basic Data Struct & OO Design 4.00', 'A- 14.80'))).toBe('CSE 12 Basic Data Struct & OO Design 4.00 A- 14.80');
  });

  it('re-joins a row split over three lines (title, rest of title, tail)', () => {
    expect(joinWrappedRows(lines('HUM 2 Rome and the', 'Medieval World', '6.00 B+ 19.80'))).toBe('HUM 2 Rome and the Medieval World 6.00 B+ 19.80');
  });

  it('keeps a title fragment that ends in a Roman numeral out of the subject column', () => {
    const wrapped = lines('ETHN 112B History of Native Americans and', 'Indigenous Peoples in the U.S. II 4.00 A 16.00');
    expect(joinWrappedRows(wrapped)).toBe('ETHN 112B History of Native Americans and Indigenous Peoples in the U.S. II 4.00 A 16.00');
  });

  it('never joins two complete rows, and never swallows the next row into an orphan head', () => {
    const two = lines('CSE 20 Discrete Mathematics 4.00 0.00', 'MATH 20C Calculus & Analytic Geometry 4.00 0.00');
    expect(joinWrappedRows(two)).toBe(two);
    const orphan = lines('CSE 29 Systems Programming', 'CSE 20 Discrete Mathematics 4.00 0.00', 'Term Credits Passed: 4.00 Term GPA: 0.000');
    expect(joinWrappedRows(orphan)).toBe(orphan);
  });

  it('stops at section labels and blank lines instead of reaching across them', () => {
    const atLabel = lines('CSE 29 Systems Programming', 'Term: Winter Qtr 2027', 'CSE 30 Computer Organization 4.00 A 16.00');
    expect(joinWrappedRows(atLabel)).toBe(atLabel);
    const blank = lines('CSE 29 Systems Programming', '', 'and Software Tools 4.00 A 16.00');
    expect(joinWrappedRows(blank)).toBe(blank);
  });

  it('leaves a transfer block (head / spine / equivalents) exactly as pasted', () => {
    const transfer = lines(
      'Transfer Courses',
      'Subject Course Course Title / Transferred From Units Grade Term Level UCSD Approx',
      'MATH 1B Calculus II',
      'De Anza College 7.50 P WI23 LD MATH 20B',
      'PHYS 4A Physics for Scientists and Engineers: Mechanics',
      'De Anza College 7.50 P SP23 LD PHYS 2A',
      'PHYS 2B',
      'Academic Events',
    );
    expect(joinWrappedRows(transfer)).toBe(transfer);
  });

  it('trims padded PDF lines only where it joins, and joins across tab-separated cells', () => {
    expect(joinWrappedRows(lines(' CSE 29\tSystems Programming  ', ' and Software Tools\t4.00\t0.00  '))).toBe('CSE 29\tSystems Programming and Software Tools\t4.00\t0.00');
    const padded = lines(' CSE 20\tDiscrete Mathematics\t4.00\t0.00  ', ' Academic Status: Good Standing  ');
    expect(joinWrappedRows(padded)).toBe(padded);
  });
});
