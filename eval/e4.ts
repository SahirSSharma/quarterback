// E4 — intake accuracy. Synthetic students (eval/synth.ts) are rendered as TritonLink "Academic History" pastes in
// six layouts, read back with lib/engine's deterministic fromAcademicHistory(), and scored against the student they
// came from: precision/recall on (course, quarter) rows, grade and unit accuracy on the matched rows, major-file,
// college-file, second-major and GPA matches. Rows the parser reads at low confidence are the ones the app would
// hand to the Lightning fallback (aiIntake); they are counted here and only run live.
//
//   node --import ./scripts/node-ts.ts eval/e4.ts [--n 30] [--seed 1]                 mock, $0
//   QB_MODE=live node --import ./scripts/node-ts.ts eval/e4.ts --budget-usd 0.25       also runs aiIntake on the
//                                                                                     low-confidence pastes
//
// Layouts: 'web' (select-all copy of the TSS page, like lib/engine/fixtures/academic-history-demo.txt), 'wrapped'
// (long titles wrap onto a second line, as PDF text does), 'reordered' (events and transfer block first, quarters
// newest-first), 'pdf' (tab/multi-space columns, repeated page headers and 'page N of M' footers between quarters),
// 'double-major' (two Major: lines), 'transfer' (a Transfer Courses block with head / spine / equivalents lines).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StudentState, TermCode } from '../lib/types';
import { aiIntake } from '../lib/agents/intake';
import { collegesIndex, loadMajor, majorsIndex } from '../lib/engine/data';
import { fromAcademicHistory } from '../lib/engine/student';
import { compare } from '../lib/engine/terms';
import { loadEnv, mode } from '../lib/env';
import { BudgetExceededError } from '../lib/tf/budget';
import { MemoryLedger, setLedgerSink } from '../lib/tf/ledger';
import { parseArgs } from './e1';
import { type Column, appendJsonl, jsonlPath, markdownTable, mean, pct, writeSection } from './results';
import { currentTermFromCalendar, highMajors, makeStudents, synthStudent } from './synth';

export type Layout = 'web' | 'wrapped' | 'reordered' | 'pdf' | 'double-major' | 'transfer';
export const LAYOUTS: Layout[] = ['web', 'wrapped', 'reordered', 'pdf', 'double-major', 'transfer'];

// ---------------------------------------------------------------------------------------------
// Rendering

const POINTS: Record<string, number> = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
const SEASON: Record<string, string> = { FA: 'Fall Qtr', WI: 'Winter Qtr', SP: 'Spring Qtr', S1: 'Summer Session I', S2: 'Summer Session II' };

const f2 = (n: number) => n.toFixed(2);

/** 'FA25' → 'Fall Qtr 2025' (the TritonLink spelling the parser's TERM_CODE reads back). */
export function termName(code: TermCode): string {
  const m = /^([A-Z][A-Z0-9])(\d{2})$/.exec(code);
  return m && SEASON[m[1]] ? `${SEASON[m[1]]} 20${m[2]}` : code;
}

function degreeText(majorFile: string | null): string {
  const d = majorFile ? loadMajor(majorFile).program.degree : '';
  return /^B\.?\s?A/i.test(d) ? 'Bachelor of Arts' : /^B\.?\s?S/i.test(d) ? 'Bachelor of Science' : d;
}

export interface PasteOpts {
  layout: Layout;
  name?: string;
  pid?: string;
  /** Second 'Major:' line for the double-major layout. */
  secondMajor?: string;
}

interface TransferRow { subject: string; number: string; title: string; from: string; units: number; grade: string; term: string; level: string; approx: string[] }

export function renderPaste(state: StudentState, opts: PasteOpts): string {
  const { layout } = opts;
  const sep = layout === 'pdf' ? '\t' : ' ';
  const row = (cells: string[]) => cells.join(sep);

  const graded = state.courses.filter((c) => c.status === 'earned' && c.term !== 'XFER');
  const letter = graded.filter((c) => c.grade && POINTS[c.grade] !== undefined);
  const pnp = graded.filter((c) => c.grade === 'P' || c.grade === 'NP');
  const lu = letter.reduce((n, c) => n + c.units, 0);
  const pts = letter.reduce((n, c) => n + POINTS[c.grade as string] * c.units, 0);
  const pu = pnp.reduce((n, c) => n + c.units, 0);
  const gpa = state.gpa ?? (lu ? pts / lu : 0);

  const head = [
    'Academic History',
    '***This is Not an Official Transcript***',
    `Student: ${opts.name ?? 'Synth, Student'}`,
    `PID: ${opts.pid ?? 'A18000000'}`,
    'Student Level: SO',
    `College: ${state.college}`,
    `Major: ${state.major}`,
    ...(opts.secondMajor ? [`Major: ${opts.secondMajor}`] : []),
    `Intended Degree: ${degreeText(state.majorFile)}`,
  ];
  const cumulative = [
    'Grade Option UC-Crdts Attm Crdts Pssd UC-GPA Crdts UC-Grade Points UC-GPA',
    row(['Letter', f2(lu), f2(lu), f2(lu), f2(pts), gpa.toFixed(3)]),
    row(['P/NP', f2(pu), f2(pu), '0.00', '0.00', '0.000']),
    row(['TOTAL', f2(lu + pu), f2(lu + pu), f2(lu), f2(pts), gpa.toFixed(3)]),
  ];

  const terms = [...new Set(state.courses.filter((c) => c.term !== 'XFER').map((c) => c.term))].sort(compare);
  const blocks = terms.map((term) => {
    const rows = state.courses.filter((c) => c.term === term);
    const wip = rows.every((c) => c.status === 'wip');
    const lines = [`Term: ${termName(term)}`, 'Subject Course Course Title Units Grade Points Repeat'];
    for (const c of rows) {
      const points = c.grade && POINTS[c.grade] !== undefined ? POINTS[c.grade] * c.units : 0;
      const [subject, ...num] = c.code.split(' ');
      let title = c.title || c.code;
      let wrap = '';
      if (layout === 'wrapped' && title.length > 24) {
        const cut = title.lastIndexOf(' ', Math.ceil(title.length / 2));
        if (cut > 0) [title, wrap] = [title.slice(0, cut), title.slice(cut + 1)];
      }
      const tail = [f2(c.units), ...(c.grade ? [c.grade] : []), f2(points)];
      if (wrap) lines.push(row([subject, num.join(' '), title]), row([wrap, ...tail]));
      else lines.push(row([subject, num.join(' '), title, ...tail]));
    }
    if (!wip) {
      const passed = rows.filter((c) => c.grade !== 'NP' && c.grade !== 'F' && c.grade !== 'W').reduce((n, c) => n + c.units, 0);
      const tl = rows.filter((c) => c.grade && POINTS[c.grade] !== undefined);
      const tu = tl.reduce((n, c) => n + c.units, 0);
      const tp = tl.reduce((n, c) => n + POINTS[c.grade as string] * c.units, 0);
      lines.push(`Term Credits Passed: ${f2(passed)} Term GPA: ${(tu ? tp / tu : 0).toFixed(3)}`, `Term Grade Points: ${f2(tp)} Term GPA Credits: ${f2(tu)}`, 'Academic Status: Good Standing');
    }
    return lines;
  });

  const transfer: string[] = [];
  if (state.transfer.length) {
    transfer.push('Transfer Courses', 'Subject Course Course Title / Transferred From Units Grade Term Level UCSD Approx');
    for (const t of state.transfer as TransferRow[]) {
      transfer.push(`${t.subject} ${t.number} ${t.title}`, row([t.from, f2(t.units), t.grade, t.term, t.level, ...(t.approx.length ? [t.approx[0]] : [])]));
      for (const k of t.approx.slice(1)) transfer.push(k);
    }
  }
  const events = ['Academic Events', 'Event Date', 'UC ENTRLVL WRITNG REQT SATISFD 09/10/2025'];
  const foot = ['Not an Official Transcript', 'page 1 of 1'];

  let lines: string[];
  if (layout === 'reordered') {
    lines = [...head, ...cumulative, ...events, ...transfer, ...[...blocks].reverse().flat(), ...foot];
  } else if (layout === 'pdf') {
    const pages = Math.max(1, Math.ceil(blocks.length / 2));
    lines = [...head, ...cumulative];
    blocks.forEach((b, i) => {
      if (i > 0 && i % 2 === 0) lines.push(`page ${i / 2} of ${pages}`, 'Academic History', '***This is Not an Official Transcript***');
      lines.push(...(i % 2 === 0 && i > 0 ? [`${b[0]} Not an Official Transcript`, ...b.slice(1)] : b));
    });
    lines.push(...transfer, ...events, 'Not an Official Transcript', `page ${pages} of ${pages}`);
    lines = lines.map((l) => (l.startsWith('Term:') ? l : ` ${l}  `));
  } else {
    lines = [...head, ...cumulative, ...blocks.flat(), ...transfer, ...events, ...foot];
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Scoring

export interface IntakeScore {
  expectedRows: number;
  gotRows: number;
  matched: number;
  precision: number | null;
  recall: number | null;
  /** Fraction of matched rows whose grade (null = in progress) agrees. */
  gradeAcc: number | null;
  unitsAcc: number | null;
  majorMatch: boolean;
  collegeMatch: boolean;
  /** Every program named on the record, in order (the double-major layout). */
  majorsMatch: boolean;
  gpaMatch: boolean;
  transferExpected: number;
  transferGot: number;
  confidence: StudentState['confidence'];
}

export function scoreIntake(expected: StudentState, got: StudentState): IntakeScore {
  const key = (c: { code: string; term: string }) => `${c.code}@${c.term}`;
  const exp = new Map(expected.courses.map((c) => [key(c), c]));
  const out = new Map(got.courses.map((c) => [key(c), c]));
  let matched = 0;
  let grades = 0;
  let units = 0;
  for (const [k, e] of exp) {
    const g = out.get(k);
    if (!g) continue;
    matched += 1;
    if ((g.grade ?? null) === (e.grade ?? null)) grades += 1;
    if (g.units === e.units) units += 1;
  }
  return {
    expectedRows: exp.size,
    gotRows: out.size,
    matched,
    precision: out.size ? matched / out.size : null,
    recall: exp.size ? matched / exp.size : null,
    gradeAcc: matched ? grades / matched : null,
    unitsAcc: matched ? units / matched : null,
    majorMatch: got.majorFile === expected.majorFile,
    collegeMatch: got.collegeFile === expected.collegeFile,
    majorsMatch: JSON.stringify(got.majors) === JSON.stringify(expected.majors),
    gpaMatch: got.gpa === expected.gpa,
    transferExpected: expected.transfer.length,
    transferGot: got.transfer.length,
    confidence: got.confidence,
  };
}

// ---------------------------------------------------------------------------------------------
// Runner

export interface E4Case {
  i: number;
  layout: Layout;
  expected: StudentState;
  paste: string;
}

/** n pastes, layouts round-robin; the transfer layout gets a student with transfer rows, the double-major layout a second Major: line. */
export function makeCases(opts: { n: number; seed: number; currentTerm?: TermCode }): E4Case[] {
  const currentTerm = opts.currentTerm ?? currentTermFromCalendar();
  const students = makeStudents({ n: opts.n, seed: opts.seed, currentTerm });
  const majors = new Map(majorsIndex().majors.map((m) => [m.file, m]));
  const colleges = new Map(collegesIndex().colleges.map((c) => [c.file, c]));
  const high = highMajors();
  return students.map((base, i) => {
    const layout = LAYOUTS[i % LAYOUTS.length];
    let expected = base;
    let secondMajor: string | undefined;
    if (layout === 'transfer' && !base.transfer.length) {
      const major = majors.get(base.majorFile ?? '');
      const college = colleges.get(base.collegeFile ?? '');
      if (major && college) expected = synthStudent({ major, college, seed: (opts.seed * 7919 + i) >>> 0, currentTerm, transfer: true });
    }
    if (layout === 'double-major') {
      secondMajor = high.map((m) => m.major ?? '').filter((m) => m && m !== base.major)[(i * 13) % (high.length - 1)];
      expected = { ...expected, majors: [expected.major, secondMajor] };
    }
    const paste = renderPaste(expected, { layout, name: `Synth, Student ${String(i).padStart(2, '0')}`, pid: `A18${String(100000 + i)}`, secondMajor });
    return { i, layout, expected, paste };
  });
}

export interface E4Row extends IntakeScore {
  at: string;
  mode: string;
  i: number;
  layout: Layout;
  majorFile: string | null;
  collegeFile: string | null;
  /** The parser read this paste at low confidence: the app would call aiIntake. */
  aiFallback: boolean;
  ai: 'skipped (mock)' | 'not needed' | IntakeScore | { error: string };
}

export async function runCase(c: E4Case, opts: { live: boolean }): Promise<E4Row> {
  const got = fromAcademicHistory(c.paste, { currentTerm: c.expected.currentTerm });
  const score = scoreIntake(c.expected, got);
  const aiFallback = got.confidence === 'low';
  let ai: E4Row['ai'] = aiFallback ? 'skipped (mock)' : 'not needed';
  if (aiFallback && opts.live) {
    try {
      ai = scoreIntake(c.expected, await aiIntake(c.paste, { currentTerm: c.expected.currentTerm }));
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      ai = { error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  }
  return { at: new Date().toISOString(), mode: mode(), i: c.i, layout: c.layout, majorFile: c.expected.majorFile, collegeFile: c.expected.collegeFile, ...score, aiFallback, ai };
}

export interface E4Summary {
  layout: string;
  pastes: number;
  rows: number;
  precision: number | null;
  recall: number | null;
  gradeAcc: number | null;
  unitsAcc: number | null;
  majorMatch: number | null;
  collegeMatch: number | null;
  majorsMatch: number | null;
  gpaMatch: number | null;
  lowConfidence: number;
  aiRecall: number | null;
}

export function summarize(rows: E4Row[]): E4Summary[] {
  const groups: [string, E4Row[]][] = [...LAYOUTS.map((l): [string, E4Row[]] => [l, rows.filter((r) => r.layout === l)]), ['all', rows]];
  return groups
    .filter(([, rs]) => rs.length)
    .map(([layout, rs]) => ({
      layout,
      pastes: rs.length,
      rows: rs.reduce((n, r) => n + r.expectedRows, 0),
      precision: pct(rs.reduce((n, r) => n + r.matched, 0), rs.reduce((n, r) => n + r.gotRows, 0)),
      recall: pct(rs.reduce((n, r) => n + r.matched, 0), rs.reduce((n, r) => n + r.expectedRows, 0)),
      gradeAcc: mean(rs.flatMap((r) => (r.gradeAcc == null ? [] : [100 * r.gradeAcc]))),
      unitsAcc: mean(rs.flatMap((r) => (r.unitsAcc == null ? [] : [100 * r.unitsAcc]))),
      majorMatch: pct(rs.filter((r) => r.majorMatch).length, rs.length),
      collegeMatch: pct(rs.filter((r) => r.collegeMatch).length, rs.length),
      majorsMatch: pct(rs.filter((r) => r.majorsMatch).length, rs.length),
      gpaMatch: pct(rs.filter((r) => r.gpaMatch).length, rs.length),
      lowConfidence: rs.filter((r) => r.aiFallback).length,
      aiRecall: mean(rs.flatMap((r) => (typeof r.ai === 'object' && 'recall' in r.ai && r.ai.recall != null ? [100 * r.ai.recall] : []))),
    }));
}

const SUMMARY_COLUMNS: Column<E4Summary>[] = [
  { key: 'layout', label: 'Layout' },
  { key: 'pastes', label: 'Pastes' },
  { key: 'rows', label: 'Course rows' },
  { key: 'precision', label: 'Row precision', fmt: 'pct' },
  { key: 'recall', label: 'Row recall', fmt: 'pct' },
  { key: 'gradeAcc', label: 'Grades', fmt: 'pct' },
  { key: 'unitsAcc', label: 'Units', fmt: 'pct' },
  { key: 'majorMatch', label: 'Major file', fmt: 'pct' },
  { key: 'collegeMatch', label: 'College file', fmt: 'pct' },
  { key: 'majorsMatch', label: 'All majors', fmt: 'pct' },
  { key: 'gpaMatch', label: 'GPA', fmt: 'pct' },
  { key: 'lowConfidence', label: 'Low confidence (→ ai-intake)' },
  { key: 'aiRecall', label: 'ai-intake row recall', fmt: 'pct' },
];

const DETAIL_COLUMNS: Column<E4Row>[] = [
  { key: 'i', label: '#' },
  { key: 'layout', label: 'Layout' },
  { key: 'majorFile', label: 'Major file', get: (r) => r.majorFile?.replace(/\.json$/, '') ?? null },
  { key: 'rows', label: 'Rows exp/got/match', get: (r) => `${r.expectedRows}/${r.gotRows}/${r.matched}` },
  { key: 'recall', label: 'Recall', get: (r) => (r.recall == null ? null : 100 * r.recall), fmt: 'pct' },
  { key: 'gradeAcc', label: 'Grades', get: (r) => (r.gradeAcc == null ? null : 100 * r.gradeAcc), fmt: 'pct' },
  { key: 'majorMatch', label: 'Major' },
  { key: 'collegeMatch', label: 'College' },
  { key: 'gpaMatch', label: 'GPA' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'ai', label: 'ai-intake', get: (r) => (typeof r.ai === 'string' ? r.ai : 'recall' in r.ai ? `recall ${((r.ai.recall ?? 0) * 100).toFixed(0)}%` : `error: ${r.ai.error.slice(0, 60)}`) },
];

export function renderE4(rows: E4Row[], meta: { mode: string; at: string; jsonl: string; spent: number }): string {
  return [
    `_${meta.at} · mode ${meta.mode} · ${rows.length} pastes · ${meta.mode === 'live' ? `spent $${meta.spent.toFixed(4)}` : '$0 spent (deterministic parser only; ai-intake fallback skipped)'} · rows in ${meta.jsonl}_`,
    '### Per layout',
    markdownTable(SUMMARY_COLUMNS, summarize(rows)),
    '### Per paste',
    markdownTable(DETAIL_COLUMNS, rows),
    'Metric definitions: eval/README.md.',
  ].join('\n\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const n = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 30) || 30;
  const shellMode = process.env.QB_MODE;
  const live = shellMode === 'live';
  if (live && args.budget === undefined) {
    console.error('QB_MODE=live needs --budget-usd <usd>. Refusing to start.');
    process.exit(2);
  }
  loadEnv();
  process.env.QB_MODE = shellMode ?? 'mock';
  if (live) process.env.QB_TOTAL_CAP_USD = String(args.budget);
  const sink = new MemoryLedger();
  setLedgerSink(sink);

  const at = new Date();
  const jsonl = jsonlPath('e4', at);
  const cases = makeCases({ n, seed: args.seed });
  console.log(`E4 mode=${mode()} pastes=${cases.length} seed=${args.seed} → ${path.relative(process.cwd(), jsonl)}`);
  const rows: E4Row[] = [];
  for (const c of cases) {
    let row: E4Row;
    try {
      row = await runCase(c, { live });
    } catch (e) {
      if (!(e instanceof BudgetExceededError)) throw e;
      console.log(`  budget reached: ${e.message}`);
      break;
    }
    rows.push(row);
    appendJsonl(jsonl, row);
    console.log(`  #${String(c.i).padStart(2)} ${c.layout.padEnd(12)} rows ${row.expectedRows}/${row.gotRows}/${row.matched} recall ${row.recall == null ? 'n/a' : (100 * row.recall).toFixed(0) + '%'} grades ${row.gradeAcc == null ? 'n/a' : (100 * row.gradeAcc).toFixed(0) + '%'} major ${row.majorMatch ? 'ok' : 'MISS'} college ${row.collegeMatch ? 'ok' : 'MISS'} gpa ${row.gpaMatch ? 'ok' : 'MISS'} ${row.confidence}${row.aiFallback ? ` ai-intake: ${typeof row.ai === 'string' ? row.ai : JSON.stringify(row.ai).slice(0, 60)}` : ''}`);
  }
  const body = renderE4(rows, { mode: mode(), at: at.toISOString(), jsonl: path.relative(process.cwd(), jsonl), spent: sink.spent() });
  writeSection(path.join(process.cwd(), 'eval', 'results.md'), 'E4 — intake accuracy', body);
  const all = summarize(rows).find((s) => s.layout === 'all');
  console.log(`\nwrote eval/results.md (E4 section): recall ${all?.recall?.toFixed(1)}% precision ${all?.precision?.toFixed(1)}% major ${all?.majorMatch?.toFixed(0)}% college ${all?.collegeMatch?.toFixed(0)}%; low confidence ${all?.lowConfidence}; spent $${sink.spent().toFixed(4)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}
