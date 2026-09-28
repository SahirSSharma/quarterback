import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OfferingEvidence } from '../types';
import { buildOfferingsFile, contentHash, readOfferingsFile, writeOfferingsFile } from './build';

const row = (course: string, term: string): OfferingEvidence => ({
  course,
  term,
  status: 'offered',
  quote: `${course} row`,
  url: 'https://example.ucsd.edu/offerings',
  fetchedAt: '2026-09-27T00:00:00.000Z',
  instructor: 'Staff',
  source: 'department-page',
});

describe('buildOfferingsFile', () => {
  it('produces the shared schema with terms in chronological order', () => {
    const file = buildOfferingsFile('CSE', [row('CSE 100', 'SP27'), row('CSE 100', 'FA26'), row('CSE 101', 'WI27')], {
      sourceUrl: 'https://example.ucsd.edu/offerings',
      fetchedAt: '2026-09-27T00:00:00.000Z',
      contentHash: contentHash('abc'),
      disclaimer: 'This page is tentative and subject to change.',
    });
    expect(file).toEqual({
      dept: 'CSE',
      sourceUrl: 'https://example.ucsd.edu/offerings',
      fetchedAt: '2026-09-27T00:00:00.000Z',
      contentHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      disclaimer: 'This page is tentative and subject to change.',
      terms: ['FA26', 'WI27', 'SP27'],
      rows: [row('CSE 100', 'SP27'), row('CSE 100', 'FA26'), row('CSE 101', 'WI27')],
    });
  });

  it('omits the disclaimer key when the page has none', () => {
    const file = buildOfferingsFile('MATH', [row('MATH 18', 'FA26')], { sourceUrl: 'u', fetchedAt: 't', contentHash: 'h' });
    expect('disclaimer' in file).toBe(false);
  });

  it('writes data/offerings/<DEPT>.json and reads it back; missing files read as null', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'offerings-'));
    const file = buildOfferingsFile('ECE', [row('ECE 5', 'FA26')], { sourceUrl: 'u', fetchedAt: 't', contentHash: 'h' });
    const p = writeOfferingsFile(file, dir);
    expect(p).toBe(path.join(dir, 'ECE.json'));
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(file);
    expect(readOfferingsFile('ECE', dir)).toEqual(file);
    expect(readOfferingsFile('COGS', dir)).toBeNull();
  });
});
