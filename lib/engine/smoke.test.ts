import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

describe('data snapshot', () => {
  it('ships the verified Fall 2026 registrar deadlines', () => {
    const cal = JSON.parse(readFileSync(path.join(root, 'data/registrar-calendar.json'), 'utf8'));
    expect(cal.terms.FA26.dropWithoutW).toBe('2026-10-23');
    expect(cal.terms.FA26.dropWithW).toBe('2026-11-06');
    expect(cal.terms.WI27.dropWithoutW).toBe('2027-01-29');
  });
  it('ships every major and college file with buckets', () => {
    const majors = readdirSync(path.join(root, 'data/majors')).filter((f: string) => f.endsWith('.json') && !['index.json', 'uncovered.json'].includes(f));
    expect(majors.length).toBe(142);
    for (const f of majors) {
      const m = JSON.parse(readFileSync(path.join(root, 'data/majors', f), 'utf8'));
      expect(Array.isArray(m.buckets)).toBe(true);
    }
  });
});
