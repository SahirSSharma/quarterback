// Measures the planner configurations that decide planRun's defaults (DEFAULT_OPTIONS in lib/agents/planner.ts):
//
//   A  Lightning drafts (thinking off) + Super repair, thinking off        {draftRole:'extract', repairRole:'plan', reasoningEffort:'none', maxRepairRounds:2}
//   C  Lightning drafts, no repair                                         {draftRole:'extract', maxRepairRounds:0}
//   D  Lightning drafts + Lightning repair                                 {draftRole:'extract', repairRole:'extract', maxRepairRounds:2}
//   B  Super drafts (thinking off) + Super repair, thinking off            {draftRole:'plan', repairRole:'plan', reasoningEffort:'none', maxRepairRounds:2}
//   L  Lightning drafts + Super repair with reasoning_effort 'low'         {draftRole:'extract', repairRole:'plan', reasoningEffort:'low', maxRepairRounds:2}
//                                                                          (not in the default set: every thinking-on Super call
//                                                                          ran to the 1,200-token cap in the pilot, 0 tool calls)
//
// on the three demo students plus N synthetic students (eval/synth.ts) spanning at least six major/college pairs.
// Per student the order is A, C, D, B: A is the cold run of the Lightning drafts, C and D repeat the byte-identical
// draft requests right after it (the cache-warm case a judge re-running a demo hits), B is the Super alternative.
//
//   QB_MODE=live node --import ./scripts/node-ts.ts scripts/measure-planner.ts --budget-usd 3 [--students 12] [--seed 3]
//       [--configs A,C,D,B] [--demos a,b,c]
//   node --import ./scripts/node-ts.ts scripts/measure-planner.ts --render eval/results/planner-configs-<date>.jsonl
//       re-renders the results.md section from an existing JSONL at $0 (a run stopped early still has every finished row)
//
// Refuses to run without QB_MODE=live in the shell and --budget-usd (which becomes QB_TOTAL_CAP_USD; the client stops
// at it). Never records fixtures. Writes eval/results/planner-configs-<UTC date>.jsonl (one row per run, appended as
// it goes) and the 'Planner configuration (measured)' section of eval/results.md.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chooseAction, makeStudents } from '../eval/synth';
import { type Column, appendJsonl, markdownTable, mean, pct, readJsonl, resultsDir, writeSection } from '../eval/results';
import { type PlanOptions, planRun } from '../lib/agents/planner';
import { impact } from '../lib/engine/impact';
import { demoStudents } from '../lib/engine/student';
import { loadEnv, mode } from '../lib/env';
import { BudgetExceededError } from '../lib/tf/budget';
import { MemoryLedger, setLedgerSink } from '../lib/tf/ledger';
import type { Action, StudentState, TraceEvent } from '../lib/types';

const CONFIGS: Record<string, { label: string; options: PlanOptions }> = {
  A: { label: 'Lightning drafts + Super repair (thinking off)', options: { draftRole: 'extract', repairRole: 'plan', reasoningEffort: 'none', maxRepairRounds: 2 } },
  C: { label: 'Lightning drafts, no repair (warm repeat)', options: { draftRole: 'extract', maxRepairRounds: 0 } },
  D: { label: 'Lightning drafts + Lightning repair (warm repeat)', options: { draftRole: 'extract', repairRole: 'extract', maxRepairRounds: 2 } },
  B: { label: 'Super drafts (thinking off) + Super repair (thinking off)', options: { draftRole: 'plan', repairRole: 'plan', reasoningEffort: 'none', maxRepairRounds: 2 } },
  L: { label: 'Lightning drafts + Super repair (reasoning_effort low)', options: { draftRole: 'extract', repairRole: 'plan', reasoningEffort: 'low', maxRepairRounds: 2 } },
};
const DEMO_ACTIONS: Record<string, Action> = {
  a: { kind: 'drop', course: 'CSE 29' },
  b: { kind: 'drop', course: 'COGS 109' },
  c: { kind: 'drop', course: 'CSE 101' },
};
const DEMO_PREFIX: Record<string, string> = { a: 'computer-science-and-engineering-artificial', b: 'cognitive-science', c: 'mathematics-mathematics' };

interface Row {
  at: string;
  student: string;
  majorFile: string | null;
  collegeFile: string | null;
  action: string;
  config: string;
  status: 'ok' | 'error';
  error?: string;
  /** Verified drafts in the draft phase and how many passed (first-pass validity). */
  firstPass: { drafts: number; ok: number };
  plans: number;
  drafts: number;
  rejectedDrafts: number;
  rounds: number;
  draftMs: number;
  wallMs: number;
  calls: number;
  toolCalls: number;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  /** Per Super call: reasoning tokens (to verify what reasoning_effort 'low' spends). */
  superReasoning: number[];
  lightningCacheHits: number[];
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string) => {
    const v = get(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number, got '${v}'`);
    return n;
  };
  return {
    render: get('--render'),
    budget: num('--budget-usd'),
    students: num('--students') ?? 12,
    seed: num('--seed') ?? 3,
    configs: (get('--configs') ?? 'A,C,D,B').split(',').map((s) => s.trim()).filter(Boolean),
    demos: (get('--demos') ?? 'a,b,c').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** N synthetic students with distinct (majorFile, collegeFile) pairs and something in progress to drop. */
function synthetic(n: number, seed: number): { id: string; state: StudentState; action: Action }[] {
  const out: { id: string; state: StudentState; action: Action }[] = [];
  const pairs = new Set<string>();
  const pool = makeStudents({ n: n * 5, seed });
  for (const [i, s] of pool.entries()) {
    const action = chooseAction(s);
    const pair = `${s.majorFile}|${s.collegeFile}`;
    if (!action || pairs.has(pair)) continue;
    pairs.add(pair);
    out.push({ id: `synth-${seed}-${i}`, state: s, action });
    if (out.length === n) break;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.render) {
    const rows = readJsonl<Row>(path.resolve(args.render));
    const students = new Set(rows.map((r) => r.student));
    const pairs = new Set(rows.map((r) => `${r.majorFile}|${r.collegeFile}`));
    const md = render(rows, { at: rows[0]?.at ?? new Date().toISOString(), students: students.size, pairs: pairs.size, jsonl: path.relative(process.cwd(), path.resolve(args.render)), budget: args.budget, spent: rows.reduce((n, r) => n + r.usd, 0), stopped: null });
    writeSection(path.join(process.cwd(), 'eval', 'results.md'), 'Planner configuration (measured)', md);
    console.log(md.split('\n### Per run')[0]);
    return;
  }
  if (process.env.QB_MODE !== 'live' || args.budget === undefined) {
    console.error('Needs QB_MODE=live in the shell and --budget-usd <usd>. Refusing to start.');
    process.exit(2);
  }
  if (process.env.QB_RECORD === '1') {
    console.error('QB_RECORD=1 would write measurement traffic into fixtures/tf. Refusing to start.');
    process.exit(2);
  }
  loadEnv();
  process.env.QB_TOTAL_CAP_USD = String(args.budget);
  const sink = new MemoryLedger();
  setLedgerSink(sink);
  const now = new Date();
  const demos = demoStudents();
  const students = [
    ...args.demos.map((id) => ({ id: `demo-${id}`, state: demos.find((s) => s.majorFile?.startsWith(DEMO_PREFIX[id]))!, action: DEMO_ACTIONS[id] })),
    ...synthetic(args.students, args.seed),
  ];
  const pairs = new Set(students.map((s) => `${s.state.majorFile}|${s.state.collegeFile}`));
  const jsonl = path.join(resultsDir(), `planner-configs-${now.toISOString().slice(0, 10)}.jsonl`);
  console.log(`mode=${mode()} students=${students.length} (${pairs.size} major/college pairs) configs=${args.configs.join(',')} budget=$${args.budget} → ${path.relative(process.cwd(), jsonl)}`);

  const rows: Row[] = [];
  let stopped: string | null = null;
  outer: for (const s of students) {
    const imp = impact(s.state, s.action, now.toISOString());
    for (const key of args.configs) {
      const cfg = CONFIGS[key];
      if (!cfg) throw new Error(`unknown config ${key}; known: ${Object.keys(CONFIGS).join(', ')}`);
      const events: TraceEvent[] = [];
      const from = sink.entries.length;
      const t0 = Date.now();
      const row: Row = {
        at: new Date().toISOString(), student: s.id, majorFile: s.state.majorFile, collegeFile: s.state.collegeFile, action: `${s.action.kind} ${s.action.course}`, config: key,
        status: 'ok', firstPass: { drafts: 0, ok: 0 }, plans: 0, drafts: 0, rejectedDrafts: 0, rounds: 0, draftMs: 0, wallMs: 0, calls: 0, toolCalls: 0,
        usd: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, superReasoning: [], lightningCacheHits: [],
      };
      try {
        const out = await planRun({ state: s.state, action: s.action, impact: imp, options: cfg.options, onEvent: (e) => events.push(e) });
        row.plans = out.plans.length;
        row.drafts = out.reports.length;
        row.rejectedDrafts = out.rejectedDrafts;
        row.rounds = out.rounds;
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          stopped = e.message;
          break outer;
        }
        row.status = 'error';
        row.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
      row.wallMs = Date.now() - t0;
      const drafted = events.find((e) => e.type === 'step' && /^Drafted /.test(e.message));
      row.draftMs = drafted ? Date.parse(drafted.at) - Date.parse(events[0].at) : row.wallMs;
      for (const e of events) {
        if (e.type !== 'verifier') continue;
        if (drafted && Date.parse(e.at) > Date.parse(drafted.at)) continue;
        row.firstPass.drafts += 1;
        if (e.report.ok) row.firstPass.ok += 1;
      }
      row.toolCalls = events.filter((e) => e.type === 'tool_call').length;
      for (const e of sink.entries.slice(from)) {
        row.calls += 1;
        row.usd += e.usd;
        row.promptTokens += e.promptTokens;
        row.completionTokens += e.completionTokens;
        row.reasoningTokens += e.reasoningTokens;
        row.cacheHitTokens += e.cacheHitTokens;
        if (/super/i.test(e.model)) row.superReasoning.push(e.reasoningTokens);
        if (/lightning/i.test(e.model)) row.lightningCacheHits.push(e.cacheHitTokens);
      }
      rows.push(row);
      appendJsonl(jsonl, row);
      console.log(
        `  ${s.id.padEnd(14)} ${key}  ${row.status.padEnd(5)} plans ${row.plans}/${row.drafts} first-pass ${row.firstPass.ok}/${row.firstPass.drafts} rejected ${row.rejectedDrafts} rounds ${row.rounds} ` +
          `draft ${String(row.draftMs).padStart(6)} ms wall ${String(row.wallMs).padStart(6)} ms $${row.usd.toFixed(4)} cache ${row.cacheHitTokens} tools ${row.toolCalls}` +
          `${row.superReasoning.length ? ` super-reasoning [${row.superReasoning.join(',')}]` : ''}${row.error ? `  ${row.error.slice(0, 100)}` : ''}`,
      );
    }
  }

  const md = render(rows, { at: now.toISOString(), students: students.length, pairs: pairs.size, jsonl: path.relative(process.cwd(), jsonl), budget: args.budget, spent: sink.spent(), stopped });
  writeSection(path.join(process.cwd(), 'eval', 'results.md'), 'Planner configuration (measured)', md);
  console.log(`\nwrote eval/results.md; spent $${sink.spent().toFixed(4)} of $${args.budget}${stopped ? ` — stopped: ${stopped}` : ''}`);
}

interface Summary {
  config: string;
  label: string;
  runs: number;
  errors: number;
  firstPass: number | null;
  plansPerStudent: number | null;
  withPlans: number | null;
  withThree: number | null;
  rejected: number;
  repairRounds: number | null;
  draftMs: number | null;
  wallMs: number | null;
  wallP50: number | null;
  wallMax: number | null;
  usd: number | null;
  usdTotal: number;
  cacheHits: number;
  cacheRuns: number;
  superReasoningMean: number | null;
  superReasoningMax: number | null;
  toolCalls: number;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);

export function summarize(rows: Row[], configs = Object.keys(CONFIGS)): Summary[] {
  return configs.map((config) => {
    const all = rows.filter((r) => r.config === config);
    const ok = all.filter((r) => r.status === 'ok');
    const superR = ok.flatMap((r) => r.superReasoning);
    return {
      config,
      label: CONFIGS[config].label,
      runs: all.length,
      errors: all.length - ok.length,
      firstPass: pct(ok.reduce((n, r) => n + r.firstPass.ok, 0), ok.reduce((n, r) => n + r.firstPass.drafts, 0)),
      plansPerStudent: mean(ok.map((r) => r.plans)),
      withPlans: pct(ok.filter((r) => r.plans > 0).length, ok.length),
      withThree: pct(ok.filter((r) => r.plans === 3).length, ok.length),
      rejected: ok.reduce((n, r) => n + r.rejectedDrafts, 0),
      repairRounds: mean(ok.map((r) => r.rounds - 1)),
      draftMs: mean(ok.map((r) => r.draftMs)),
      wallMs: mean(ok.map((r) => r.wallMs)),
      wallP50: median(ok.map((r) => r.wallMs)),
      wallMax: ok.length ? Math.max(...ok.map((r) => r.wallMs)) : null,
      usd: mean(all.map((r) => r.usd)),
      usdTotal: all.reduce((n, r) => n + r.usd, 0),
      cacheHits: all.reduce((n, r) => n + r.cacheHitTokens, 0),
      cacheRuns: all.filter((r) => r.cacheHitTokens > 0).length,
      superReasoningMean: mean(superR),
      superReasoningMax: superR.length ? Math.max(...superR) : null,
      toolCalls: all.reduce((n, r) => n + r.toolCalls, 0),
    };
  });
}

const SUMMARY: Column<Summary>[] = [
  { key: 'config', label: 'Config' },
  { key: 'label', label: 'Drafts + repair' },
  { key: 'runs', label: 'Students' },
  { key: 'errors', label: 'Errors' },
  { key: 'firstPass', label: 'First-pass validity (drafts passing verify)', fmt: 'pct' },
  { key: 'plansPerStudent', label: 'Final plans / student', fmt: 2 },
  { key: 'withPlans', label: 'Students with ≥ 1 plan', fmt: 'pct' },
  { key: 'withThree', label: 'Students with 3 plans', fmt: 'pct' },
  { key: 'rejected', label: 'Rejected drafts' },
  { key: 'repairRounds', label: 'Repair rounds / student', fmt: 2 },
  { key: 'draftMs', label: 'Draft phase ms (mean)' },
  { key: 'wallMs', label: 'Wall-clock ms (mean)' },
  { key: 'wallP50', label: 'p50' },
  { key: 'wallMax', label: 'max' },
  { key: 'usd', label: '$ / student', fmt: 'usd' },
  { key: 'usdTotal', label: '$ total', fmt: 'usd' },
  { key: 'cacheHits', label: 'Cache-hit tokens' },
  { key: 'cacheRuns', label: 'Runs with a cache hit' },
  { key: 'superReasoningMean', label: 'Super reasoning tokens / call (mean)' },
  { key: 'superReasoningMax', label: 'max' },
  { key: 'toolCalls', label: 'Tool calls' },
];

const DETAIL: Column<Row>[] = [
  { key: 'student', label: 'Student' },
  { key: 'majorFile', label: 'Major file', get: (r) => (r.majorFile ?? '').replace(/\.json$/, '').slice(0, 48) },
  { key: 'collegeFile', label: 'College', get: (r) => (r.collegeFile ?? '').replace(/-college\.json$/, '') },
  { key: 'action', label: 'Action' },
  { key: 'config', label: 'Config' },
  { key: 'status', label: 'Status' },
  { key: 'firstPass', label: 'First pass', get: (r) => `${r.firstPass.ok}/${r.firstPass.drafts}` },
  { key: 'plans', label: 'Plans' },
  { key: 'rejectedDrafts', label: 'Rejected' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'draftMs', label: 'Draft ms' },
  { key: 'wallMs', label: 'Wall ms' },
  { key: 'calls', label: 'Calls' },
  { key: 'toolCalls', label: 'Tool calls' },
  { key: 'cacheHitTokens', label: 'Cache hits' },
  { key: 'superReasoning', label: 'Super reasoning tokens', get: (r) => r.superReasoning.join(', ') || null },
  { key: 'usd', label: '$', fmt: 'usd' },
  { key: 'error', label: 'Error', get: (r) => r.error?.slice(0, 80) ?? null },
];

function render(rows: Row[], meta: { at: string; students: number; pairs: number; jsonl: string; budget?: number; spent: number; stopped: string | null }): string {
  const configs = [...new Set(rows.map((r) => r.config))];
  return [
    `_${meta.at} · mode live · ${meta.students} students (${meta.pairs} major/college pairs; 3 demos + synthetic from eval/synth.ts) × ${configs.length} configs · ${rows.length} runs · spent $${meta.spent.toFixed(4)}${meta.budget !== undefined ? ` of $${meta.budget.toFixed(2)}` : ''} · rows in ${meta.jsonl}_`,
    'Order per student: A (cold), then C and D (the same Lightning draft requests again, cache-warm), then B. Wall-clock is planRun() end to end; the draft phase is the first step to the "Drafted" step. Default choice: highest final validity, then latency, then cost (see the paragraph after the tables and notes/agents.md).',
    '### Per config',
    markdownTable(SUMMARY, summarize(rows, configs)),
    '### Per run',
    markdownTable(DETAIL, rows),
    meta.stopped ? `_Stopped: ${meta.stopped}; remaining runs were not started._` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}
