// E1 — plan validity and optimality. For each student × config: planRun (Super or Lightning, thinking budget per
// config, through the agents' `tf` injection point — no env var) and, when the config says so, stressTest (Ultra).
// Collects validity on the first submit and after ≤ 3 rounds, rounds, rejected drafts, requirement progress against
// the greedy optimum (eval/optimum.ts), planted-risk outcomes, refusal precision, tool-call success, tokens, cache
// hits, USD and wall time. Writes eval/results/e1-<stamp>.jsonl (one row per run, appended as it goes) and the
// 'E1' section of eval/results.md.
//
//   node --import ./scripts/node-ts.ts eval/e1.ts                       mock: the three recorded demo students × the
//                                                                      whole matrix; only the shipped config has
//                                                                      fixtures, every other cell is a 'no-fixture' row
//   QB_MODE=live node --import ./scripts/node-ts.ts eval/e1.ts --budget-usd 5 [--students 40] [--planted 20]
//                                                                      [--seed 1] [--configs super-b2048,lightning]
//                                                                      live: refuses without --budget-usd; stops at it
//
// The matrix (DESIGN.md E1): planner lightning-only | super; critic on | off; Super reasoning_budget 0 | 2048 | 8192,
// plus the shipped 4096 as the baseline row. reasoningBudget 0 means thinking OFF (enable_thinking:false), not a
// zero budget with thinking on. Lightning always runs thinking off (its reasoning leaks into content otherwise).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Action, Impact, OfferingEvidence, Plan, StudentState, TraceEvent, Verdict, VerifierReport } from '../lib/types';
import { applyAction, buildEvidenceIndex, horizonTerms, statusText } from '../lib/agents/context';
import { stressTest } from '../lib/agents/critic';
import { type PlannerTF, planRun } from '../lib/agents/planner';
import { impact as computeImpact } from '../lib/engine/impact';
import { UNIT_CAP_WARNING } from '../lib/engine/verifier';
import { loadEnv, mode } from '../lib/env';
import { BudgetExceededError } from '../lib/tf/budget';
import { type Thinking, forcedTool, toolLoop } from '../lib/tf/helpers';
import { MemoryLedger, setLedgerSink } from '../lib/tf/ledger';
import { LIGHTNING, SUPER } from '../lib/tf/models';
import { MissingFixtureError } from '../lib/tf/replay';
import { optimum, planProgress } from './optimum';
import { type Column, appendJsonl, jsonlPath, markdownTable, mean, pct, writeSection } from './results';
import { type PlantedRisk, chooseAction, makeStudents, plantedRisks } from './synth';

// ---------------------------------------------------------------------------------------------
// Configs

export interface E1Config {
  name: string;
  planner: 'lightning-only' | 'super';
  criticOn: boolean;
  /** Super's reasoning_budget; 0 = thinking off. Ignored for lightning-only (always off). */
  reasoningBudget: number;
}

export const SHIPPED_BUDGET = 4096;

export function configName(c: Omit<E1Config, 'name'>): string {
  return `${c.planner === 'super' ? `super-b${c.reasoningBudget}` : 'lightning'}${c.criticOn ? '+critic' : ''}`;
}

const CELLS: Omit<E1Config, 'name'>[] = [
  ...[SHIPPED_BUDGET, 0, 2048, 8192].flatMap((reasoningBudget) => [true, false].map((criticOn): Omit<E1Config, 'name'> => ({ planner: 'super', criticOn, reasoningBudget }))),
  ...[true, false].map((criticOn): Omit<E1Config, 'name'> => ({ planner: 'lightning-only', criticOn, reasoningBudget: 0 })),
];
export const MATRIX: E1Config[] = CELLS.map((c) => ({ ...c, name: configName(c) }));

/**
 * The agents' injection point carries the ablation: model id from the registry, thinking per config. `base` is for tests.
 * The shipped row runs planRun's own defaults (Lightning drafts in parallel, Super repair — lib/agents/planner.ts
 * DEFAULT_OPTIONS), which is what the recorded demo fixtures replay; the other cells force one model and one
 * thinking setting on every call, as before.
 */
export function plannerTf(cfg: E1Config, base: PlannerTF = { toolLoop, forcedTool }): PlannerTF {
  if (cfg.planner === 'super' && cfg.reasoningBudget === SHIPPED_BUDGET) return base;
  const model = cfg.planner === 'super' ? SUPER : LIGHTNING;
  const thinking: Thinking = cfg.planner === 'super' && cfg.reasoningBudget > 0 ? { enable: true, budget: cfg.reasoningBudget } : { enable: false };
  const wrappedForced: typeof forcedTool = (role, opts) => base.forcedTool(role, { ...opts, model, thinking });
  return {
    toolLoop: (role, opts) => base.toolLoop(role, { ...opts, model, thinking }),
    forcedTool: wrappedForced,
  };
}

// ---------------------------------------------------------------------------------------------
// Students

export interface E1Student {
  id: string;
  state: StudentState;
  action: Action;
  impact: Impact;
  planted: PlantedRisk | null;
}

interface DemoRun { demo: string; state: StudentState; action: Action; impact: Impact }

/** The three recorded demo runs: the only students with Token Factory fixtures. */
export function fixtureStudents(root = process.cwd()): E1Student[] {
  const dir = path.join(root, 'fixtures', 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^demo-[a-z]\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as DemoRun)
    .map((r) => ({ id: `demo-${r.demo}`, state: r.state, action: r.action, impact: r.impact, planted: null }));
}

export function syntheticStudents(opts: { n: number; planted: number; seed: number; now: string }): E1Student[] {
  const base = makeStudents({ n: opts.n, seed: opts.seed });
  const out: E1Student[] = [];
  const add = (id: string, state: StudentState, planted: PlantedRisk | null) => {
    const action = chooseAction(state);
    if (!action) return;
    out.push({ id, state, action, impact: computeImpact(state, action, opts.now), planted });
  };
  base.forEach((s, i) => add(`synth-${opts.seed}-${i}`, s, null));
  plantedRisks(base).slice(0, opts.planted).forEach((p, i) => add(`planted-${opts.seed}-${i}-${p.risk.kind}`, p.student, p.risk));
  return out;
}

// ---------------------------------------------------------------------------------------------
// One run

export type PlantOutcome = 'avoided' | 'verifier' | 'critic' | 'risk' | 'missed' | 'over-cap' | 'within-cap';

export interface E1Row {
  at: string;
  mode: string;
  student: string;
  majorFile: string | null;
  collegeFile: string | null;
  action: string;
  planted: PlantedRisk | null;
  config: string;
  planner: E1Config['planner'];
  criticOn: boolean;
  reasoningBudget: number;
  status: 'ok' | 'no-fixture' | 'error' | 'budget-stop';
  error?: string;
  drafts: number;
  plans: number;
  rejectedDrafts: number;
  rounds: number;
  /** Drafts submitted in the first submit_plans round and how many of them passed. */
  firstPass: { drafts: number; ok: number };
  validAfter: boolean;
  /** Best shown plan's closed slots over the greedy optimum's (ratio null when the optimum is 0), and both per horizon term. */
  progress: { best: number; mean: number; optimum: number; ratio: number | null; perTerm: { term: string; plan: number; optimum: number }[] } | null;
  verdict: { recommend: string | null; refused: number; justified: number; risks: number } | null;
  plant: PlantOutcome | null;
  /** Shown plans with a quarter above 19.5 units. */
  overCapPlans: number;
  toolCalls: number;
  toolCallsOk: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  usd: number;
  replayed: boolean;
  ms: number;
}

/** Which submit round each verifier report belongs to, from the planner's step messages. */
export function firstPassFromEvents(events: TraceEvent[]): { drafts: number; ok: number } {
  let round = 1;
  const out = { drafts: 0, ok: 0 };
  for (const e of events) {
    if (e.step !== 'plan') continue;
    if (e.type === 'step' && /^Round \d+: the verifier rejected/.test(e.message)) round += 1;
    if (e.type === 'verifier' && round === 1) {
      out.drafts += 1;
      if (e.report.ok) out.ok += 1;
    }
  }
  return out;
}

const NEGATIVE_EVIDENCE = (e: OfferingEvidence) => e.status === 'not_offered' || statusText(e) === 'unknown (not on dept page)';

export function plantOutcome(risk: PlantedRisk, plans: Plan[], reports: VerifierReport[], verdict: Verdict | null): PlantOutcome {
  const shown = plans.filter((p) => p.terms.some((t) => String(t.term).toUpperCase() === risk.term && t.courses.some((c) => c === risk.course)));
  if (risk.kind === 'heavy_load') return plans.some((p) => p.terms.some((t) => t.units > UNIT_CAP_WARNING)) ? 'over-cap' : 'within-cap';
  const attempted = reports.some((r) => r.violations.some((v) => v.course === risk.course && v.term === risk.term && (v.rule === 'not-offered' || v.rule === 'assumed-offered')));
  if (!attempted && !shown.length) return 'avoided';
  if (!shown.length) return 'verifier';
  const ids = new Set(shown.map((p) => p.id));
  if (verdict?.refused.some((r) => ids.has(r.planId) && r.evidence.some((e) => e.course === risk.course && e.term === risk.term))) return 'critic';
  if (verdict?.risks.some((s) => risk.course && s.includes(risk.course) && s.includes(risk.term))) return 'risk';
  return 'missed';
}

export async function runOne(s: E1Student, cfg: E1Config, sink: MemoryLedger): Promise<E1Row> {
  const t0 = Date.now();
  const from = sink.entries.length;
  const events: TraceEvent[] = [];
  const onEvent = (e: TraceEvent) => events.push(e);
  const base: E1Row = {
    at: new Date().toISOString(),
    mode: mode(),
    student: s.id,
    majorFile: s.state.majorFile,
    collegeFile: s.state.collegeFile,
    action: `${s.action.kind} ${s.action.course}`,
    planted: s.planted,
    config: cfg.name,
    planner: cfg.planner,
    criticOn: cfg.criticOn,
    reasoningBudget: cfg.reasoningBudget,
    status: 'ok',
    drafts: 0, plans: 0, rejectedDrafts: 0, rounds: 0,
    firstPass: { drafts: 0, ok: 0 },
    validAfter: false,
    progress: null,
    verdict: null,
    plant: null,
    overCapPlans: 0,
    toolCalls: 0, toolCallsOk: 0,
    calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, usd: 0, replayed: true,
    ms: 0,
  };
  const finish = (row: E1Row): E1Row => {
    const entries = sink.entries.slice(from);
    row.calls = entries.length;
    for (const e of entries) {
      row.promptTokens += e.promptTokens;
      row.completionTokens += e.completionTokens;
      row.reasoningTokens += e.reasoningTokens;
      row.cacheHitTokens += e.cacheHitTokens;
      row.usd += e.usd;
    }
    row.replayed = entries.length > 0 && entries.every((e) => e.replayed);
    row.toolCalls = events.filter((e) => e.type === 'tool_result').length;
    row.toolCallsOk = events.filter((e) => e.type === 'tool_result' && !e.summary.startsWith('Error')).length;
    row.ms = Date.now() - t0;
    return row;
  };

  try {
    const run = await planRun({ state: s.state, action: s.action, impact: s.impact, onEvent, tf: plannerTf(cfg) });
    let verdict: Verdict | null = null;
    if (cfg.criticOn && run.plans.length) {
      const index = buildEvidenceIndex(run.plans, horizonTerms(s.state));
      verdict = await stressTest({ state: s.state, action: s.action, plans: run.plans, reports: run.reports, evidenceIndex: index, onEvent });
    }
    const after = applyAction(s.state, s.action);
    const scored = run.plans.map((p) => planProgress(after, p));
    const scores = scored.map((p) => p.total);
    const best = scored[scores.indexOf(Math.max(...scores))];
    const opt = optimum(after, horizonTerms(s.state));
    return finish({
      ...base,
      drafts: run.reports.length,
      plans: run.plans.length,
      rejectedDrafts: run.rejectedDrafts,
      rounds: run.rounds,
      firstPass: firstPassFromEvents(events),
      validAfter: run.plans.length > 0,
      progress: run.plans.length
        ? {
            best: best.total,
            mean: mean(scores) ?? 0,
            optimum: opt.total,
            ratio: opt.total > 0 ? best.total / opt.total : null,
            perTerm: opt.perTerm.map((o) => ({ term: o.term, plan: best.perTerm.find((t) => t.term === o.term)?.slots ?? 0, optimum: o.slots })),
          }
        : null,
      verdict: verdict
        ? { recommend: verdict.recommend, refused: verdict.refused.length, justified: verdict.refused.filter((r) => r.evidence.some(NEGATIVE_EVIDENCE)).length, risks: verdict.risks.length }
        : null,
      plant: s.planted ? plantOutcome(s.planted, run.plans, run.reports, verdict) : null,
      overCapPlans: run.plans.filter((p) => p.terms.some((t) => t.units > UNIT_CAP_WARNING)).length,
    });
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    if (e instanceof MissingFixtureError || (e as Error).name === 'MissingFixtureError') return finish({ ...base, status: 'no-fixture', error: (e as Error).message.slice(0, 160) });
    return finish({ ...base, status: 'error', error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
  }
}

// ---------------------------------------------------------------------------------------------
// Summary

export interface E1Summary {
  config: string;
  runs: number;
  noFixture: number;
  errors: number;
  valid1st: number | null;
  validAfter: number | null;
  rounds: number | null;
  rejected: number | null;
  progressRatio: number | null;
  refusals: number;
  refusalPrecision: number | null;
  plantAttempted: number;
  plantRecall: number | null;
  plantAvoided: number;
  plantMissed: number;
  overCap: number;
  toolOk: number | null;
  cacheHitTokens: number;
  usdPerRun: number | null;
  secondsPerRun: number | null;
}

export function summarize(rows: E1Row[], configs: E1Config[] = MATRIX): E1Summary[] {
  return configs.map((cfg) => {
    const all = rows.filter((r) => r.config === cfg.name);
    const ok = all.filter((r) => r.status === 'ok');
    const plants = ok.filter((r) => r.plant && r.plant !== 'over-cap' && r.plant !== 'within-cap');
    const attempted = plants.filter((r) => r.plant !== 'avoided');
    const caught = attempted.filter((r) => r.plant === 'verifier' || r.plant === 'critic');
    const refusals = ok.reduce((n, r) => n + (r.verdict?.refused ?? 0), 0);
    const justified = ok.reduce((n, r) => n + (r.verdict?.justified ?? 0), 0);
    const toolCalls = ok.reduce((n, r) => n + r.toolCalls, 0);
    return {
      config: cfg.name,
      runs: ok.length,
      noFixture: all.filter((r) => r.status === 'no-fixture').length,
      errors: all.filter((r) => r.status === 'error' || r.status === 'budget-stop').length,
      valid1st: pct(ok.filter((r) => r.firstPass.ok > 0).length, ok.length),
      validAfter: pct(ok.filter((r) => r.validAfter).length, ok.length),
      rounds: mean(ok.map((r) => r.rounds)),
      rejected: mean(ok.map((r) => r.rejectedDrafts)),
      progressRatio: mean(ok.flatMap((r) => (r.progress?.ratio != null ? [r.progress.ratio] : []))),
      refusals,
      refusalPrecision: pct(justified, refusals),
      plantAttempted: attempted.length,
      plantRecall: pct(caught.length, attempted.length),
      plantAvoided: plants.filter((r) => r.plant === 'avoided').length,
      plantMissed: plants.filter((r) => r.plant === 'missed').length,
      overCap: ok.reduce((n, r) => n + r.overCapPlans, 0),
      toolOk: pct(ok.reduce((n, r) => n + r.toolCallsOk, 0), toolCalls),
      cacheHitTokens: ok.reduce((n, r) => n + r.cacheHitTokens, 0),
      usdPerRun: mean(ok.map((r) => r.usd)),
      secondsPerRun: mean(ok.map((r) => r.ms / 1000)),
    };
  });
}

const SUMMARY_COLUMNS: Column<E1Summary>[] = [
  { key: 'config', label: 'Config' },
  { key: 'runs', label: 'Runs' },
  { key: 'noFixture', label: 'No fixture' },
  { key: 'errors', label: 'Errors' },
  { key: 'valid1st', label: 'Valid 1st pass', fmt: 'pct' },
  { key: 'validAfter', label: 'Valid ≤3 rounds', fmt: 'pct' },
  { key: 'rounds', label: 'Rounds', fmt: 2 },
  { key: 'rejected', label: 'Rejected drafts', fmt: 2 },
  { key: 'progressRatio', label: 'Progress / optimum', fmt: 2 },
  { key: 'refusals', label: 'Refusals' },
  { key: 'refusalPrecision', label: 'Refusal precision', fmt: 'pct' },
  { key: 'plantRecall', label: 'Plant recall', fmt: 'pct' },
  { key: 'plantAvoided', label: 'Plants avoided' },
  { key: 'plantMissed', label: 'Plants missed' },
  { key: 'overCap', label: 'Plans > 19.5u' },
  { key: 'toolOk', label: 'Tool calls ok', fmt: 'pct' },
  { key: 'cacheHitTokens', label: 'Cache-hit tokens' },
  { key: 'usdPerRun', label: '$ / run', fmt: 'usd' },
  { key: 'secondsPerRun', label: 's / run', fmt: 1 },
];

const DETAIL_COLUMNS: Column<E1Row>[] = [
  { key: 'student', label: 'Student' },
  { key: 'config', label: 'Config' },
  { key: 'status', label: 'Status' },
  { key: 'plans', label: 'Plans' },
  { key: 'rejectedDrafts', label: 'Rejected' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'progress', label: 'Progress / optimum (per term)', get: (r) => (r.progress ? `${r.progress.best} / ${r.progress.optimum} (${r.progress.perTerm.map((t) => t.plan).join('+')} / ${r.progress.perTerm.map((t) => t.optimum).join('+')})` : null) },
  { key: 'verdict', label: 'Verdict', get: (r) => (r.verdict ? `${r.verdict.recommend ?? 'none'}; refused ${r.verdict.refused}; risks ${r.verdict.risks}` : r.criticOn ? (r.status === 'ok' ? 'no plan to test' : null) : 'critic off') },
  { key: 'plant', label: 'Plant' },
  { key: 'toolCalls', label: 'Tool calls', get: (r) => (r.status === 'ok' ? `${r.toolCallsOk}/${r.toolCalls}` : null) },
  { key: 'calls', label: 'Model calls' },
  { key: 'usd', label: '$', fmt: 'usd' },
  { key: 'ms', label: 's', get: (r) => r.ms / 1000, fmt: 1 },
];

export function renderE1(rows: E1Row[], meta: { mode: string; at: string; students: number; jsonl: string; budget?: number; spent: number }, configs: E1Config[] = MATRIX): string {
  const replayed = rows.some((r) => r.status === 'ok' && r.replayed);
  return [
    `_${meta.at} · mode ${meta.mode} · ${meta.students} students × ${configs.length} configs · ${rows.length} runs · ` +
      `${meta.mode === 'live' ? `spent $${meta.spent.toFixed(4)}${meta.budget != null ? ` of $${meta.budget.toFixed(2)}` : ''}` : `$0 spent (fixtures)`} · rows in ${meta.jsonl}_`,
    replayed ? '_Replayed runs report the USD and latency of the original recording (`replayed: true` in the JSONL); nothing was billed._' : '',
    '### Per config (losing configs kept)',
    markdownTable(SUMMARY_COLUMNS, summarize(rows, configs)),
    '### Per run',
    markdownTable(DETAIL_COLUMNS, rows),
    'Metric definitions: eval/README.md.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// CLI

export function parseArgs(argv: string[]): { budget?: number; students?: number; planted?: number; seed: number; configs?: string[] } {
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
  return { budget: num('--budget-usd'), students: num('--students'), planted: num('--planted'), seed: num('--seed') ?? 1, configs: get('--configs')?.split(',').map((s) => s.trim()).filter(Boolean) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // The shell decides the mode: a QB_MODE in .env.local never makes an eval spend money.
  const shellMode = process.env.QB_MODE;
  const live = shellMode === 'live';
  if (live && args.budget === undefined) {
    console.error('QB_MODE=live needs --budget-usd <usd>; the run stops when the ledger reaches it. Refusing to start.');
    process.exit(2);
  }
  if (live && process.env.QB_RECORD === '1' && !process.env.QB_FIXTURES_DIR) {
    console.error('QB_RECORD=1 would write eval traffic into fixtures/tf; set QB_FIXTURES_DIR to another directory. Refusing to start.');
    process.exit(2);
  }
  loadEnv();
  process.env.QB_MODE = shellMode ?? 'mock';
  if (live) process.env.QB_TOTAL_CAP_USD = String(args.budget);
  const sink = new MemoryLedger();
  setLedgerSink(sink);

  const configs = args.configs ? MATRIX.filter((c) => args.configs!.includes(c.name)) : MATRIX;
  if (args.configs && configs.length !== args.configs.length) {
    console.error(`Unknown config in --configs; known: ${MATRIX.map((c) => c.name).join(', ')}`);
    process.exit(2);
  }
  const at = new Date();
  const students = args.students !== undefined || live
    ? syntheticStudents({ n: args.students ?? 40, planted: args.planted ?? 20, seed: args.seed, now: at.toISOString() })
    : fixtureStudents();
  if (!students.length) {
    console.error('No students: no fixtures/runs/demo-*.json and no --students N.');
    process.exit(2);
  }
  const jsonl = jsonlPath('e1', at);
  console.log(`E1 mode=${mode()} students=${students.length} configs=${configs.length}${live ? ` budget=$${args.budget}` : ' ($0: fixtures only)'} → ${path.relative(process.cwd(), jsonl)}`);

  const rows: E1Row[] = [];
  let stopped = false;
  outer: for (const s of students) {
    for (const cfg of configs) {
      let row: E1Row;
      try {
        row = await runOne(s, cfg, sink);
      } catch (e) {
        if (!(e instanceof BudgetExceededError)) throw e;
        console.log(`  budget reached: ${e.message}`);
        stopped = true;
        break outer;
      }
      rows.push(row);
      appendJsonl(jsonl, row);
      console.log(`  ${s.id.padEnd(28)} ${cfg.name.padEnd(20)} ${row.status.padEnd(10)} plans ${row.plans} rejected ${row.rejectedDrafts} rounds ${row.rounds}${row.progress ? ` progress ${row.progress.best}/${row.progress.optimum}` : ''}${row.plant ? ` plant ${row.plant}` : ''} $${row.usd.toFixed(4)}${row.replayed && row.calls ? ' (replayed)' : ''} ${(row.ms / 1000).toFixed(1)}s${row.error ? `  ${row.error.slice(0, 80)}` : ''}`);
    }
  }
  const body = renderE1(rows, { mode: mode(), at: at.toISOString(), students: students.length, jsonl: path.relative(process.cwd(), jsonl), budget: args.budget, spent: sink.spent() })
    + (stopped ? '\n\n_Stopped: the spend cap was reached; remaining runs were not started._' : '');
  writeSection(path.join(process.cwd(), 'eval', 'results.md'), 'E1 — plan validity and optimality', body);
  console.log(`\nwrote eval/results.md (E1 section); spent $${sink.spent().toFixed(4)}${live ? '' : ' (mock)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}
