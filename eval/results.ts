// Results writer shared by the eval runners: one JSONL row per run under eval/results/, and a markdown section
// per eval in eval/results.md (each runner replaces only its own '## …' section, so E1 and E4 coexist).
//
//   resultsDir() / jsonlPath(name, at)     → eval/results, eval/results/<name>-<UTC stamp, no colons>.jsonl
//   appendJsonl(file, row)                 → one line per call (a run that dies keeps every finished row)
//   markdownTable(columns, rows)           → GitHub table; numbers right-aligned; 'n/a' for null
//   pct(num, den) / num(x, digits)         → formatting that never prints NaN (0/0 → null → 'n/a')
//   writeSection(file, heading, body)      → replace the '## <heading>' section in place, or append it
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const resultsDir = (root = process.cwd()): string => path.join(root, 'eval', 'results');

export function stamp(at: Date = new Date()): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function jsonlPath(name: string, at: Date = new Date(), root = process.cwd()): string {
  return path.join(resultsDir(root), `${name}-${stamp(at)}.jsonl`);
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + '\n');
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** num/den as a percentage string, or null when den is 0 (rendered 'n/a'). */
export function pct(num: number, den: number): number | null {
  return den > 0 ? (100 * num) / den : null;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type Cell = string | number | boolean | null | undefined;

export interface Column<R> {
  key: string;
  label: string;
  /** Reads the cell; default row[key]. */
  get?: (row: R) => Cell;
  /** Decimal places for numbers (default 0); 'pct' appends %; 'usd' prefixes $. */
  fmt?: number | 'pct' | 'usd';
}

export function formatCell(v: Cell, fmt?: Column<unknown>['fmt']): string {
  if (v === null || v === undefined) return 'n/a';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'n/a';
    if (fmt === 'pct') return `${v.toFixed(Number.isInteger(v) ? 0 : 1)}%`;
    if (fmt === 'usd') return `$${v.toFixed(4)}`;
    return v.toFixed(typeof fmt === 'number' ? fmt : 0);
  }
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function markdownTable<R>(columns: Column<R>[], rows: R[]): string {
  const cells = rows.map((r) => columns.map((c) => formatCell(c.get ? c.get(r) : (r as Record<string, Cell>)[c.key], c.fmt)));
  const numeric = columns.map((c, i) => rows.length > 0 && rows.every((r, j) => {
    const v = c.get ? c.get(r) : (r as Record<string, Cell>)[c.key];
    return typeof v === 'number' || v === null || v === undefined || cells[j][i] === 'n/a';
  }));
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const rule = `| ${columns.map((_, i) => (numeric[i] ? '---:' : '---')).join(' | ')} |`;
  return [header, rule, ...cells.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

/** Replace the section that starts with '## <heading>' (up to the next '## ' or the end), or append it. */
export function writeSection(file: string, heading: string, body: string, title = '# Eval results'): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const section = `## ${heading}\n\n${body.trim()}\n`;
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : `${title}\n\n_Written by the runners in eval/; see eval/README.md. Mock runs cost $0._\n`;
  const lines = existing.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  let out: string;
  if (start === -1) {
    out = `${existing.replace(/\s*$/, '')}\n\n${section}`;
  } else {
    let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    if (end === -1) end = lines.length;
    out = [...lines.slice(0, start), ...section.split('\n'), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
  }
  writeFileSync(file, out.replace(/\s*$/, '') + '\n');
}
