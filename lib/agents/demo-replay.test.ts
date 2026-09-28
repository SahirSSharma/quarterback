// Replays the recorded demo (a) run (scripts/record-demos.ts, QB_MODE=live QB_RECORD=1) end to end from
// fixtures/tf in mock mode with the network disabled. Skipped until the fixture exists; once it does, any drift
// in a prompt, a tool result or the data snapshot surfaces here as MissingFixtureError.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, Impact, LedgerEntry, Plan, StudentState, TraceEvent, Verdict, VerifierReport } from '../types';
import { offeringStatus } from '../engine/offerings';
import { deps } from '../tf/client';
import { MemoryLedger, setLedgerSink } from '../tf/ledger';
import { MODELS } from '../tf/models';
import { stableStringify } from '../tf/replay';
import { applyAction, buildEvidenceIndex, buildPlannerContext, horizonTerms } from './context';
import { stressTest } from './critic';
import { whyNot } from './explain';
import { aiIntake } from './intake';
import { planRun } from './planner';

interface DemoRun {
  demo: string;
  state: StudentState;
  action: Action;
  impact: Impact;
  plans: Plan[];
  reports: VerifierReport[];
  rejectedDrafts: number;
  verdict: Verdict | null;
  ledger: LedgerEntry[];
  events: { t: number; event: TraceEvent }[];
  explain?: { code: string; text: string };
  intake?: { file: string; state: StudentState };
}

const file = path.join(process.cwd(), 'fixtures/runs/demo-a.json');
const recorded = existsSync(file);
const load = () => JSON.parse(readFileSync(file, 'utf8')) as DemoRun;

const originalFetch = deps.fetch;
let ledger: MemoryLedger;
beforeEach(() => {
  vi.stubEnv('QB_MODE', 'mock');
  vi.stubEnv('QB_FIXTURES_DIR', '');
  ledger = new MemoryLedger();
  setLedgerSink(ledger);
  deps.fetch = vi.fn(async () => {
    throw new Error('network call in mock mode');
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  deps.fetch = originalFetch;
});

describe.skipIf(!recorded)('recorded demo (a) replays at $0', () => {
  it('plans, verifies and stress-tests from fixtures with the same result as the recording', async () => {
    const run = load();
    expect(run.demo).toBe('a');
    const events: TraceEvent[] = [];
    const out = await planRun({ state: run.state, action: run.action, impact: run.impact, onEvent: (e) => events.push(e) });

    expect(out.plans.length).toBeGreaterThanOrEqual(1);
    expect(out.plans.length).toBeLessThanOrEqual(3);
    expect(stableStringify(out.plans)).toBe(stableStringify(run.plans));
    expect(out.rejectedDrafts).toBe(run.rejectedDrafts);
    for (const p of out.plans) expect(out.reports.find((r) => r.planId === p.id)).toMatchObject({ ok: true });
    for (const r of out.reports) if (!r.ok) expect(out.plans.map((p) => p.id)).not.toContain(r.planId);
    expect(events[0]).toMatchObject({ type: 'step', step: 'plan' });
    expect(events.at(-1)).toMatchObject({ type: 'done', step: 'plan' });
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
    expect(events.filter((e) => e.type === 'verifier').length).toBe(out.reports.length);

    const index = buildEvidenceIndex(out.plans, horizonTerms(run.state));
    const verdict = await stressTest({ state: run.state, action: run.action, plans: out.plans, reports: out.reports, evidenceIndex: index, onEvent: (e) => events.push(e) });
    expect(stableStringify(verdict)).toBe(stableStringify(run.verdict));
    expect(verdict.summary.length).toBeGreaterThan(20);
    expect(verdict.recommend === null || out.plans.some((p) => p.id === verdict.recommend)).toBe(true);
    for (const r of verdict.refused) {
      expect(out.plans.map((p) => p.id)).toContain(r.planId);
      expect(r.evidence.length).toBeGreaterThanOrEqual(1);
      for (const e of r.evidence) expect(e.quote).toBe(offeringStatus(e.course, e.term).quote);
    }

    // Every call replayed, priced from the registry, on a registry model. The sink may hold more entries than
    // the run's ledger: forcedTool's internal correction retry lands in the sink without a 'model' event.
    expect(ledger.entries.length).toBeGreaterThanOrEqual(out.ledger.length + 1);
    for (const e of ledger.entries) {
      expect(e.replayed).toBe(true);
      expect(MODELS[e.model]).toBeDefined();
      expect(e.usd).toBeGreaterThan(0);
      expect(e.promptTokens).toBeGreaterThan(0);
      expect(e.ms).toBeGreaterThan(0);
    }
    expect(ledger.spent()).toBe(0); // replayed entries never count as spend
  });

  it('answers "why not?" and reads the demo paste with Lightning from fixtures', async () => {
    const run = load();
    if (run.explain) {
      const after = applyAction(run.state, run.action);
      const { eligibility } = buildPlannerContext(run.state, run.action, run.impact);
      const text = await whyNot({ state: after, code: run.explain.code, eligibility });
      expect(text).toBe(run.explain.text);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/<think>/);
    }
    if (run.intake) {
      const s = await aiIntake(readFileSync(path.join(process.cwd(), run.intake.file), 'utf8'), { currentTerm: run.state.currentTerm });
      expect(s).toEqual(run.intake.state);
      expect(s.source).toBe('ai-intake');
      expect(s.majorFile).toBe(run.state.majorFile);
      expect(s.courses.filter((c) => c.status === 'wip').map((c) => c.code).sort()).toEqual(run.state.courses.filter((c) => c.status === 'wip').map((c) => c.code).sort());
    }
    expect(ledger.entries.every((e) => e.replayed && /lightning|nano/i.test(e.model))).toBe(true);
  });
});
