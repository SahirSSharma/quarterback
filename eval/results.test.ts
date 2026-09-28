import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendJsonl, formatCell, jsonlPath, markdownTable, mean, pct, readJsonl, stamp, writeSection } from './results';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'qb-eval-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('formatting', () => {
  it('never prints NaN: 0/0 is n/a, percentages and dollars are formatted, pipes are escaped', () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
    expect(mean([])).toBeNull();
    expect(mean([1, 2])).toBe(1.5);
    expect(formatCell(null)).toBe('n/a');
    expect(formatCell(NaN)).toBe('n/a');
    expect(formatCell(33.333, 'pct')).toBe('33.3%');
    expect(formatCell(100, 'pct')).toBe('100%');
    expect(formatCell(0.05, 'usd')).toBe('$0.0500');
    expect(formatCell(1.2345, 2)).toBe('1.23');
    expect(formatCell(true)).toBe('yes');
    expect(formatCell('a|b\nc')).toBe('a\\|b c');
  });

  it('renders a GitHub table with a header rule and right-aligned numeric columns', () => {
    const table = markdownTable(
      [
        { key: 'name', label: 'Name' },
        { key: 'n', label: 'N' },
        { key: 'rate', label: 'Rate', fmt: 'pct' },
        { key: 'usd', label: '$', fmt: 'usd', get: (r: { usd: number }) => r.usd },
      ],
      [{ name: 'a', n: 3, rate: 50, usd: 0.1 }, { name: 'b', n: 0, rate: null, usd: 0 }],
    );
    expect(table.split('\n')).toEqual([
      '| Name | N | Rate | $ |',
      '| --- | ---: | ---: | ---: |',
      '| a | 3 | 50% | $0.1000 |',
      '| b | 0 | n/a | $0.0000 |',
    ]);
    expect(markdownTable([{ key: 'x', label: 'X' }], []).split('\n')).toEqual(['| X |', '| --- |']);
  });

  it('stamps file names without colons', () => {
    const at = new Date('2026-09-27T21:30:05.123Z');
    expect(stamp(at)).toBe('2026-09-27T21-30-05Z');
    expect(jsonlPath('e1', at, '/repo')).toBe(path.join('/repo', 'eval', 'results', 'e1-2026-09-27T21-30-05Z.jsonl'));
  });
});

describe('jsonl', () => {
  it('appends one line per row and reads them back', () => {
    const file = path.join(tmp(), 'out', 'x.jsonl');
    appendJsonl(file, { a: 1 });
    appendJsonl(file, { b: 'two' });
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n{"b":"two"}\n');
    expect(readJsonl(file)).toEqual([{ a: 1 }, { b: 'two' }]);
  });
});

describe('writeSection', () => {
  it('creates the file with a title, appends new sections, and replaces an existing section without touching the others', () => {
    const file = path.join(tmp(), 'results.md');
    writeSection(file, 'E1 — plans', 'first e1 body\n\n| a |\n| --- |\n| 1 |');
    writeSection(file, 'E4 — intake', 'e4 body');
    let text = readFileSync(file, 'utf8');
    expect(text.startsWith('# Eval results\n')).toBe(true);
    expect(text).toContain('## E1 — plans\n\nfirst e1 body');
    expect(text).toContain('## E4 — intake\n\ne4 body');
    expect(text.indexOf('## E1')).toBeLessThan(text.indexOf('## E4'));

    writeSection(file, 'E1 — plans', 'second e1 body');
    text = readFileSync(file, 'utf8');
    expect(text).not.toContain('first e1 body');
    expect(text).toContain('## E1 — plans\n\nsecond e1 body\n\n## E4 — intake\n\ne4 body');
    expect(text.match(/^## /gm)?.length).toBe(2);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\n{3,}/);
  });
});
