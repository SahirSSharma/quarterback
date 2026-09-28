// Records the three demo runs end to end and writes fixtures/runs/demo-{a,b,c}.json for replay mode.
//
//   QB_MODE=live QB_RECORD=1 node --import ./scripts/node-ts.ts scripts/record-demos.ts
//       LIVE: the planner drafts three plans in parallel (planRun defaults), the verifier judges, Super repairs what
//       failed, Ultra stress-tests, Lightning explains / reads the paste; every Token Factory call is recorded under
//       fixtures/tf (QB_FIXTURES_DIR redirects) and the run files are (re)written. Budget: QB_TOTAL_CAP_USD defaults
//       to 1.00 here; the client refuses calls once the cap is reached.
//   node --import ./scripts/node-ts.ts scripts/record-demos.ts
//       MOCK: the whole flow replays from fixtures/tf at $0 and is compared with the stored run files.
//   Add `--demo a` to run one demo.
//
// Re-record whenever a prompt, a tool result or the data snapshot changes (fixture keys are request bytes).
// Never prints a key. Impacts are computed at a fixed `now` so the stored deadlines are reproducible.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, mode } from '../lib/env';
import { applyAction, buildEvidenceIndex, buildPlannerContext, horizonTerms } from '../lib/agents/context';
import { stressTest } from '../lib/agents/critic';
import { whyNot } from '../lib/agents/explain';
import { aiIntake } from '../lib/agents/intake';
import { planRun } from '../lib/agents/planner';
import { impact } from '../lib/engine/impact';
import { demoStudents } from '../lib/engine/student';
import { MemoryLedger, setLedgerSink, totals } from '../lib/tf/ledger';
import { stableStringify } from '../lib/tf/replay';
import type { Action, LedgerEntry, StudentState, TraceEvent, Verdict } from '../lib/types';

loadEnv();
process.env.QB_TOTAL_CAP_USD ??= '1.00';

const NOW = '2026-10-01T12:00:00-07:00';
const OUT_DIR = path.join(process.cwd(), 'fixtures', 'runs');
const INTAKE_FILE = 'lib/engine/fixtures/academic-history-demo.txt';
const DEMOS: { id: 'a' | 'b' | 'c'; action: Action; explain?: string }[] = [
  { id: 'a', action: { kind: 'drop', course: 'CSE 29' }, explain: 'CSE 105' },
  { id: 'b', action: { kind: 'drop', course: 'COGS 109' } },
  { id: 'c', action: { kind: 'drop', course: 'CSE 101' } },
];

const only = process.argv.includes('--demo') ? process.argv[process.argv.indexOf('--demo') + 1] : null;
const live = mode() === 'live';
const ledger = new MemoryLedger();
setLedgerSink(ledger);
console.log(`mode=${mode()} record=${process.env.QB_RECORD === '1'} cap=$${process.env.QB_TOTAL_CAP_USD}`);

function describe(e: TraceEvent): string {
  switch (e.type) {
    case 'step': return e.message;
    case 'model': return `${e.entry.model} ${e.entry.ms} ms in ${e.entry.promptTokens} out ${e.entry.completionTokens} reasoning ${e.entry.reasoningTokens} cache ${e.entry.cacheHitTokens} $${e.entry.usd.toFixed(5)}${e.entry.replayed ? ' (replayed)' : ''}`;
    case 'tool_call': return `${e.name}(${JSON.stringify(e.args)})`;
    case 'tool_result': return `${e.name} → ${e.summary.slice(0, 120)}`;
    case 'verifier': return `${e.report.planId} ${e.report.ok ? 'ok' : 'REJECTED'} ${e.report.violations.map((v) => `[${v.rule}${v.course ? ` ${v.course}` : ''}${v.term ? ` ${v.term}` : ''}]`).join(' ')}`;
    case 'waiting': return `waiting ${e.seconds}s (${e.reason})`;
    case 'error': return `ERROR ${e.message}`;
    case 'done': return 'done';
  }
}

const students = demoStudents();
const byId = (id: string) => students.find((s) => s.majorFile?.startsWith({ a: 'computer-science-and-engineering-artificial', b: 'cognitive-science', c: 'mathematics-mathematics' }[id as 'a' | 'b' | 'c'] ?? '')) as StudentState;

for (const demo of DEMOS) {
  if (only && demo.id !== only) continue;
  const state = byId(demo.id);
  console.log(`\n=== demo ${demo.id}: ${state.major} / ${state.college} — ${demo.action.kind} ${demo.action.course} ===`);
  const t0 = Date.now();
  const events: { t: number; event: TraceEvent }[] = [];
  const onEvent = (event: TraceEvent) => {
    events.push({ t: Date.now() - t0, event });
    console.log(`  ${String(Date.now() - t0).padStart(6)} ms  ${event.step.padEnd(11)} ${event.type.padEnd(11)} ${describe(event)}`);
  };

  const imp = impact(state, demo.action, NOW);
  const run = await planRun({ state, action: demo.action, impact: imp, onEvent });
  const planMs = Date.now() - t0;
  console.log(`  planner: ${run.plans.length} plans, ${run.rejectedDrafts} rejected, ${run.rounds} round(s), ${planMs} ms wall, $${run.ledger.reduce((n, e) => n + e.usd, 0).toFixed(4)}`);

  // The record is written after every expensive step so a failure in a later, cheaper step never loses the
  // Super spend; in live mode the fixtures are on disk and the run file is the durable summary of them.
  const file = path.join(OUT_DIR, `demo-${demo.id}.json`);
  const record: Record<string, unknown> = {
    demo: demo.id,
    recordedAt: new Date().toISOString(),
    now: NOW,
    state,
    action: demo.action,
    impact: imp,
    plans: run.plans,
    reports: run.reports,
    rejectedDrafts: run.rejectedDrafts,
    rounds: run.rounds,
    verdict: null as Verdict | null,
    ledger: [] as LedgerEntry[],
    events,
    errors: [] as string[],
  };
  const save = () => {
    if (!live) return;
    record.ledger = events.flatMap((e) => (e.event.type === 'model' ? [e.event.entry as LedgerEntry] : []));
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const message = `${label}: ${e instanceof Error ? e.message : String(e)}`;
      (record.errors as string[]).push(message);
      console.log(`  FAILED ${message}`);
    }
    save();
  };
  save();

  if (run.plans.length) {
    await attempt('stress-test', async () => {
      const index = buildEvidenceIndex(run.plans, horizonTerms(state));
      record.verdict = await stressTest({ state, action: demo.action, plans: run.plans, reports: run.reports, evidenceIndex: index, onEvent });
    });
  }
  const verdict = record.verdict as Verdict | null;
  if (demo.explain) {
    const code = demo.explain;
    await attempt('explain', async () => {
      const { eligibility } = buildPlannerContext(state, demo.action, imp);
      const text = await whyNot({ state: applyAction(state, demo.action), code, eligibility, onEvent });
      record.explain = { code, text };
      console.log(`  why not ${code}? → ${text}`);
    });
    await attempt('intake', async () => {
      const read = await aiIntake(readFileSync(path.join(process.cwd(), INTAKE_FILE), 'utf8'), { currentTerm: state.currentTerm });
      record.intake = { file: INTAKE_FILE, state: read };
      console.log(`  intake → major file ${read.majorFile}, ${read.courses.length} rows, confidence ${read.confidence}`);
    });
  }

  if (live) {
    console.log(`  wrote ${path.relative(process.cwd(), file)}: ${run.plans.length} plans, ${run.rejectedDrafts} rejected, verdict ${verdict ? (verdict.recommend ?? 'no recommendation') : 'none'}${(record.errors as string[]).length ? `, ${(record.errors as string[]).length} step(s) failed` : ''}`);
  } else if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { plans: unknown; reports: unknown; verdict: unknown; rejectedDrafts: number };
    const same =
      stableStringify(stored.plans) === stableStringify(run.plans) &&
      stableStringify(stored.reports) === stableStringify(run.reports) &&
      stableStringify(stored.verdict) === stableStringify(verdict) &&
      stored.rejectedDrafts === run.rejectedDrafts;
    console.log(same ? `  replay matches ${path.relative(process.cwd(), file)}` : `  DRIFT: replay differs from ${path.relative(process.cwd(), file)}`);
    if (!same) process.exitCode = 1;
    // The explain text and the intake state are code's reading of recorded model output; a matching replay
    // refreshes them so a mapping fix never needs a re-record.
    else if (record.explain || record.intake) {
      writeFileSync(file, JSON.stringify({ ...stored, ...(record.explain ? { explain: record.explain } : {}), ...(record.intake ? { intake: record.intake } : {}) }, null, 2) + '\n');
    }
  } else {
    console.log(`  no stored run at ${path.relative(process.cwd(), file)} (record with QB_MODE=live QB_RECORD=1)`);
  }
}

console.log('\nledger by model');
const { byModel } = totals(ledger.entries);
let total = 0;
for (const [model, t] of Object.entries(byModel)) {
  total += t.usd;
  console.log(`  ${model.padEnd(40)} calls ${String(t.calls).padStart(3)}  in ${String(t.promptTokens).padStart(7)}  out ${String(t.completionTokens).padStart(6)}  reasoning ${String(t.reasoningTokens).padStart(6)}  cache ${String(t.cacheHitTokens).padStart(6)}  $${t.usd.toFixed(4)}`);
}
console.log(`  total $${total.toFixed(4)} over ${ledger.entries.length} calls${live ? '' : ' (replayed: $0 spent)'}`);
