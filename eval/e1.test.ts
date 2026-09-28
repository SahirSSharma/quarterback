import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry, OfferingEvidence, Plan, TraceEvent, Verdict, VerifierReport } from '../lib/types';
import { applyAction, horizonTerms } from '../lib/agents/context';
import type { PlannerTF } from '../lib/agents/planner';
import { deps } from '../lib/tf/client';
import { MemoryLedger, setLedgerSink } from '../lib/tf/ledger';
import { LIGHTNING, SUPER, ULTRA } from '../lib/tf/models';
import { MATRIX, type E1Row, SHIPPED_BUDGET, configName, firstPassFromEvents, fixtureStudents, parseArgs, plantOutcome, plannerTf, renderE1, runOne, summarize } from './e1';
import { optimum, planProgress } from './optimum';

describe('matrix', () => {
  it('covers planner × critic × budget plus the shipped baseline, with unique names', () => {
    expect(MATRIX).toHaveLength(10);
    expect(new Set(MATRIX.map((c) => c.name)).size).toBe(10);
    expect(MATRIX[0]).toEqual({ name: 'super-b4096+critic', planner: 'super', criticOn: true, reasoningBudget: SHIPPED_BUDGET });
    for (const b of [0, 2048, 8192]) for (const critic of [true, false]) expect(MATRIX.map((c) => c.name)).toContain(configName({ planner: 'super', criticOn: critic, reasoningBudget: b }));
    expect(MATRIX.filter((c) => c.planner === 'lightning-only').map((c) => c.name)).toEqual(['lightning+critic', 'lightning']);
  });

  it('plannerTf forwards the registry model id and the thinking setting through the agents\' tf seam', async () => {
    const seen: { fn: string; role: string; model?: string; thinking?: unknown }[] = [];
    const base: PlannerTF = {
      toolLoop: async (role, opts) => {
        seen.push({ fn: 'toolLoop', role, model: opts.model, thinking: opts.thinking });
        return { message: { role: 'assistant', content: '' }, messages: opts.messages, rounds: 1, exhausted: false };
      },
      forcedTool: (async (role: string, opts: { model?: string; thinking?: unknown }) => {
        seen.push({ fn: 'forcedTool', role, model: opts.model, thinking: opts.thinking });
        throw new Error('stop');
      }) as unknown as PlannerTF['forcedTool'],
    };
    const call = async (name: string) => {
      const tf = plannerTf(MATRIX.find((c) => c.name === name)!, base);
      await tf.toolLoop('plan', { messages: [], tools: [], thinking: { enable: true, budget: 4096 }, maxTokens: 1 });
      await tf.forcedTool('plan', { messages: [], tool: { name: 'x', schema: {} as never }, thinking: { enable: true, budget: 4096 } }).catch(() => undefined);
    };
    await call('super-b2048+critic');
    await call('super-b0');
    await call('lightning');
    expect(seen).toEqual([
      { fn: 'toolLoop', role: 'plan', model: SUPER, thinking: { enable: true, budget: 2048 } },
      { fn: 'forcedTool', role: 'plan', model: SUPER, thinking: { enable: true, budget: 2048 } },
      { fn: 'toolLoop', role: 'plan', model: SUPER, thinking: { enable: false } },
      { fn: 'forcedTool', role: 'plan', model: SUPER, thinking: { enable: false } },
      { fn: 'toolLoop', role: 'plan', model: LIGHTNING, thinking: { enable: false } },
      { fn: 'forcedTool', role: 'plan', model: LIGHTNING, thinking: { enable: false } },
    ]);
  });

  it('parses the CLI flags and rejects a negative budget', () => {
    expect(parseArgs(['--budget-usd', '2.5', '--students', '10', '--configs', 'lightning, super-b0'])).toEqual({ budget: 2.5, students: 10, planted: undefined, seed: 1, configs: ['lightning', 'super-b0'] });
    expect(parseArgs([])).toEqual({ budget: undefined, students: undefined, planted: undefined, seed: 1, configs: undefined });
    expect(() => parseArgs(['--budget-usd', '-1'])).toThrow(/non-negative/);
  });
});

describe('metrics', () => {
  const at = '2026-10-01T00:00:00.000Z';
  const verifier = (planId: string, ok: boolean): TraceEvent => ({ type: 'verifier', step: 'plan', at, report: { planId, ok, violations: [] } });

  it('attributes verifier reports to submit rounds from the planner\'s step messages', () => {
    const events: TraceEvent[] = [
      { type: 'step', step: 'plan', at, message: 'Context pack built' },
      verifier('p-fastest', false), verifier('p-balanced', false),
      { type: 'step', step: 'plan', at, message: 'Round 1: the verifier rejected all 2 drafts; asking for corrected plans.' },
      verifier('p-fastest-2', true),
      { type: 'done', step: 'plan', at },
    ];
    expect(firstPassFromEvents(events)).toEqual({ drafts: 2, ok: 0 });
    expect(firstPassFromEvents([verifier('a', true), verifier('b', false)])).toEqual({ drafts: 2, ok: 1 });
    expect(firstPassFromEvents([])).toEqual({ drafts: 0, ok: 0 });
  });

  it('classifies a planted risk: avoided, verifier, critic, risk, missed, and the heavy-load cap check', () => {
    const risk = { kind: 'not_offered' as const, course: 'CSE 194', term: 'WI27' };
    const plan = (id: string, courses: string[], units = 16): Plan => ({ id, label: id, terms: [{ term: 'WI27', courses, units }], rationale: '', graduationTerm: null });
    const report = (planId: string, ok: boolean, rule?: string): VerifierReport => ({ planId, ok, violations: rule ? [{ rule, message: '', course: 'CSE 194', term: 'WI27', severity: ok ? 'warning' : 'error' }] : [] });
    const ev: OfferingEvidence = { course: 'CSE 194', term: 'WI27', status: 'not_offered', quote: '', url: '', fetchedAt: at, source: 'department-page' };
    const verdict = (refused: Verdict['refused'], risks: string[] = []): Verdict => ({ recommend: null, refused, risks, summary: '' });

    expect(plantOutcome(risk, [plan('a', ['CSE 30'])], [report('a', true)], null)).toBe('avoided');
    expect(plantOutcome(risk, [], [report('a', false, 'not-offered')], null)).toBe('verifier');
    const shown = [plan('a', ['CSE 194'])];
    const warned = [report('a', true, 'assumed-offered')];
    expect(plantOutcome({ ...risk, kind: 'unknown' }, shown, warned, verdict([{ planId: 'a', reason: '', evidence: [ev] }]))).toBe('critic');
    expect(plantOutcome({ ...risk, kind: 'unknown' }, shown, warned, verdict([], ['a: CSE 194 in WI27 has no row on the CSE page']))).toBe('risk');
    expect(plantOutcome({ ...risk, kind: 'unknown' }, shown, warned, verdict([]))).toBe('missed');
    expect(plantOutcome({ ...risk, kind: 'unknown' }, shown, warned, null)).toBe('missed');
    const heavy = { kind: 'heavy_load' as const, course: null, term: 'WI27' };
    expect(plantOutcome(heavy, [plan('a', [], 20)], [], null)).toBe('over-cap');
    expect(plantOutcome(heavy, [plan('a', [], 19.5)], [], null)).toBe('within-cap');
  });

  it('summarises per config without NaN and renders every config into the table', () => {
    const row = (config: string, patch: Partial<E1Row>): E1Row => ({
      at, mode: 'mock', student: 's', majorFile: null, collegeFile: null, action: 'drop X', planted: null, config, planner: 'super', criticOn: true, reasoningBudget: 4096,
      status: 'ok', drafts: 3, plans: 2, rejectedDrafts: 1, rounds: 1, firstPass: { drafts: 3, ok: 2 }, validAfter: true,
      progress: { best: 10, mean: 9, optimum: 20, ratio: 0.5, perTerm: [{ term: 'WI27', plan: 10, optimum: 20 }] }, verdict: { recommend: 'p', refused: 1, justified: 1, risks: 0 }, plant: null, overCapPlans: 0,
      toolCalls: 4, toolCallsOk: 3, calls: 5, promptTokens: 100, completionTokens: 10, reasoningTokens: 5, cacheHitTokens: 7, usd: 0.02, replayed: true, ms: 1500,
      ...patch,
    });
    const rows = [
      row('super-b4096+critic', {}),
      row('super-b4096+critic', { plans: 0, validAfter: false, firstPass: { drafts: 3, ok: 0 }, rounds: 3, rejectedDrafts: 9, progress: null, verdict: null, planted: { kind: 'not_offered', course: 'X', term: 'WI27' }, plant: 'verifier' }),
      row('super-b0', { status: 'no-fixture', plans: 0, calls: 0, usd: 0 }),
    ];
    const s = summarize(rows);
    const shipped = s.find((x) => x.config === 'super-b4096+critic')!;
    expect(shipped).toMatchObject({ runs: 2, valid1st: 50, validAfter: 50, rounds: 2, rejected: 5, progressRatio: 0.5, refusals: 1, refusalPrecision: 100, plantAttempted: 1, plantRecall: 100, cacheHitTokens: 14, usdPerRun: 0.02, secondsPerRun: 1.5, toolOk: 75 });
    const b0 = s.find((x) => x.config === 'super-b0')!;
    expect(b0).toMatchObject({ runs: 0, noFixture: 1, valid1st: null, refusalPrecision: null, plantRecall: null, usdPerRun: null });
    const md = renderE1(rows, { mode: 'mock', at, students: 1, jsonl: 'x.jsonl', spent: 0 });
    for (const c of MATRIX) expect(md).toContain(`| ${c.name} |`);
    expect(md).not.toContain('NaN');
    expect(md).toContain('$0 spent (fixtures)');
    expect(md).toContain('| s | super-b0 | no-fixture |');
  });
});

const demoFile = path.join(process.cwd(), 'fixtures/runs/demo-a.json');
const recorded = existsSync(demoFile);
interface RecordedRun { plans: Plan[]; reports: VerifierReport[]; rejectedDrafts: number; verdict: Verdict; ledger: LedgerEntry[]; events: { event: TraceEvent }[] }
describe.skipIf(!recorded)('runOne in mock mode with the network disabled', () => {
  const originalFetch = deps.fetch;
  let sink: MemoryLedger;
  beforeEach(() => {
    vi.stubEnv('QB_MODE', 'mock');
    vi.stubEnv('QB_FIXTURES_DIR', '');
    sink = new MemoryLedger();
    setLedgerSink(sink);
    deps.fetch = vi.fn(async () => {
      throw new Error('network call in mock mode');
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    deps.fetch = originalFetch;
  });

  it('replays the shipped config for demo (a) at $0 with the recorded result, and marks every other config no-fixture without a network call', async () => {
    const student = fixtureStudents().find((s) => s.id === 'demo-a')!;
    // The recording is the oracle: what it stored is what a replay must reproduce, whatever the numbers are.
    const run = JSON.parse(readFileSync(demoFile, 'utf8')) as RecordedRun;
    const ok = await runOne(student, MATRIX.find((c) => c.name === 'super-b4096+critic')!, sink);
    expect(ok.status).toBe('ok');
    expect(ok.plans).toBeGreaterThanOrEqual(1);
    expect(ok.plans).toBe(run.plans.length);
    expect(ok.drafts).toBe(run.reports.length);
    expect(ok.rejectedDrafts).toBe(run.rejectedDrafts);
    expect(ok.firstPass).toEqual(firstPassFromEvents(run.events.map((e) => e.event)));
    expect(ok.firstPass.drafts).toBe(3);
    expect(ok.validAfter).toBe(true);
    const after = applyAction(student.state, student.action);
    const terms = horizonTerms(student.state);
    const best = Math.max(...run.plans.map((p) => planProgress(after, p).total));
    const opt = optimum(after, terms).total;
    expect(ok.progress).toMatchObject({ best, optimum: opt });
    expect(ok.progress?.perTerm.map((t) => t.term)).toEqual(terms);
    expect(ok.progress?.perTerm.reduce((n, t) => n + t.plan, 0)).toBe(best);
    expect(ok.progress?.perTerm.reduce((n, t) => n + t.optimum, 0)).toBe(opt);
    expect(ok.verdict).toMatchObject({ recommend: run.verdict.recommend, refused: run.verdict.refused.length, risks: run.verdict.risks.length });
    expect(ok.replayed).toBe(true);
    // planRun's calls plus the critic's, each carrying the USD and latency of the original recording.
    const replayed = run.ledger.filter((e) => e.step === 'plan' || e.step === 'stress-test');
    expect(ok.calls).toBe(replayed.length);
    expect(ok.calls).toBeGreaterThanOrEqual(4); // three drafts and the critic at the very least
    expect(ok.usd).toBeCloseTo(replayed.reduce((n, e) => n + e.usd, 0), 6);
    expect(ok.usd).toBeGreaterThan(0);
    expect(sink.spent()).toBe(0); // and nothing spent now
    expect(sink.entries.some((e) => e.model === ULTRA)).toBe(true);
    const results = run.events.filter((e) => e.event.type === 'tool_result').map((e) => e.event as { summary: string });
    expect(ok.toolCalls).toBe(results.length);
    expect(ok.toolCallsOk).toBe(results.filter((r) => !r.summary.startsWith('Error')).length);

    const missing = await runOne(student, MATRIX.find((c) => c.name === 'super-b2048')!, sink);
    expect(missing.status).toBe('no-fixture');
    expect(missing.calls).toBe(0);
    expect(missing.error).toMatch(/No Token Factory fixture/);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
