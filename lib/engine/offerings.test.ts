import { describe, expect, it } from 'vitest';
import { offeringsRows } from './data';
import { nextOffered, offeringStatus } from './offerings';

const hasDeptRow = (code: string, term: string) => offeringsRows().get(code)?.has(term) ?? false;

describe('offeringStatus', () => {
  it('uses the FA26 Schedule of Classes when no department row exists', () => {
    const ev = offeringStatus('HUM 3', 'FA26'); // no department page covers HUM
    expect(ev).toMatchObject({ course: 'HUM 3', term: 'FA26', status: 'offered', source: 'schedule-of-classes' });
    expect(ev.quote).toMatch(/^HUM 3 A00 LE /);
    expect(ev.instructor).toBeTruthy();
    expect(ev.url).toMatch(/^https:\/\//);
  });
  it('falls back to CAPE history with status unknown for a future term', () => {
    const ev = offeringStatus('HUM 3', 'WI27');
    expect(ev.status).toBe('unknown');
    expect(ev.source).toBe('cape-history');
    expect(ev.quote).toContain('S222'); // the last quarter CAPE evaluated HUM 3
  });
  it('never invents an offering for a course with no history at all', () => {
    const ev = offeringStatus('CSE 29', 'WI27');
    if (hasDeptRow('CSE 29', 'WI27')) {
      expect(ev.source).toBe('department-page');
    } else {
      // No source at all: the type has no value for it, so 'cape-history' stands in and the quote says so.
      expect(ev).toMatchObject({ status: 'unknown', source: 'cape-history' });
      expect(ev.quote).toMatch(/^CSE 29: no source found — .*no WI27 section.*no CAPE history/);
    }
  });
  it('says plainly when no source was found at all (source stays cape-history; the type has no value for none)', () => {
    // No department page covers NOPE, sections exist for FA26 only, and CAPE has no such row.
    const ev = offeringStatus('NOPE 1', 'WI27');
    expect(ev).toMatchObject({ course: 'NOPE 1', term: 'WI27', status: 'unknown', source: 'cape-history' });
    expect(ev.quote).toBe('NOPE 1: no source found — no department page row, no WI27 section, no CAPE history');
  });
  it('prefers the department page row whenever the offerings module has written one', () => {
    for (const [code, byTerm] of offeringsRows()) {
      for (const [term, row] of byTerm) {
        expect(offeringStatus(code, term)).toEqual(row);
      }
    }
  });
  it('normalizes the code and term it is asked about', () => {
    expect(offeringStatus('hum 3', 'fa26').status).toBe('offered');
  });
});

describe('nextOffered', () => {
  it('finds nothing for a course with only CAPE history, and something for FA26 sections from SP26', () => {
    expect(nextOffered('HUM 3', 'FA26', 3)).toBeNull();
    const hit = nextOffered('HUM 3', 'SP26', 3)!;
    expect(hit.term).toBe('FA26');
    expect(hit.evidence.source).toBe('schedule-of-classes');
  });
  it('reports the first offered/tentative term from department evidence when it exists', () => {
    const rows = offeringsRows().get('CSE 30');
    if (!rows) return; // offerings module has not written CSE yet; the stronger claim waits for the file
    const hit = nextOffered('CSE 30', 'FA26', 3);
    const expected = ['WI27', 'SP27', 'FA27'].find((t) => ['offered', 'tentative'].includes(rows.get(t)?.status ?? '')) ?? null;
    expect(hit?.term ?? null).toBe(expected);
    if (hit) expect(hit.evidence.source).toBe('department-page');
  });
});
