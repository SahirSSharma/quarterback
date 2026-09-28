// Wiring shared by the route handlers: the persistent spend ledger, how a run is served (live or from the
// recorded demo), the planner step itself, and the small objects kept beside a run in the store.
//
//   sink                          → the Blob/disk ledger sink, installed once here so every Token Factory call persists
//   serveMode(run)                → 'live' | 'replay' | 'mock' for this run (production never spends on a recorded demo)
//   planWork(run, emit)           → runs Super + the verifier (live) or replays the recording; returns the RunRecord patch
//   getTrace / putTrace / deleteTrace   → traces/<runId>: the emitted events, so a reconnect replays instead of re-running
//   stressQuota / bumpStressQuota       → critic-quota/<UTC day>: live Ultra calls today (cap STRESS_DAILY_CAP)
//   deps.sleep                    → replay pacing and reconnect polling; tests stub it
import { planRun } from '@/lib/agents/planner';
import { mode } from '@/lib/env';
import { store } from '@/lib/store/blob';
import { installLedgerSink } from '@/lib/store/ledger-sink';
import { BudgetExceededError } from '@/lib/tf/budget';
import type { LedgerEntry, Mode, TraceEvent } from '@/lib/types';
import type { RunRecord } from '@/app/lib/contracts';
import { type DemoRun, fixtureFor } from './mock';

export const sink = installLedgerSink();

export const deps = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

export const PLAN_STEP = 'plan';
/** Recorded gaps between events (Super turns took up to 38 s) are capped so a replay stays watchable. */
export const REPLAY_GAP_CAP_MS = 1500;
export const STRESS_DAILY_CAP = 20;

export type Emit = (event: TraceEvent) => void;

/** Production serves a recorded demo situation from the fixture even in live mode, so judging never spends on it. */
export function serveMode(run: Pick<RunRecord, 'state' | 'action'>): Mode {
  const m = mode();
  if (m === 'live' && process.env.VERCEL_ENV === 'production' && fixtureFor(run.state, run.action)) return 'replay';
  return m;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The planner step for one run. Live: planRun() streams its events (except its own done/error, which the route
 * emits after the results are stored). On a spend-cap or Token Factory failure, or when live mode is off, a
 * recorded demo replays with its timing; a record with no recording ends in an 'error' event.
 */
export async function planWork(run: RunRecord, emit: Emit): Promise<Partial<RunRecord>> {
  const now = () => new Date().toISOString();
  const fixture = fixtureFor(run.state, run.action);
  if (serveMode(run) !== 'live') {
    if (fixture) return replayPlan(fixture, emit);
    emit({ type: 'error', step: PLAN_STEP, at: now(), message: 'Live mode is off and there is no recorded run for this record.' });
    return { mode: 'replay' };
  }
  try {
    const result = await planRun({
      state: run.state,
      action: run.action,
      impact: run.impact,
      options: run.options,
      onEvent: (e) => { if (e.type !== 'done' && e.type !== 'error') emit(e); },
    });
    return { plans: result.plans, reports: result.reports, rejectedDrafts: result.rejectedDrafts, ledger: result.ledger, mode: 'live' };
  } catch (e) {
    const reason = e instanceof BudgetExceededError
      ? `Live mode is paused for the day: ${e.message}.`
      : `Live planning failed: ${errorMessage(e)}.`;
    emit({ type: 'step', step: PLAN_STEP, at: now(), message: fixture ? `${reason} Showing the recorded run for this demo student.` : reason });
    if (fixture) return replayPlan(fixture, emit);
    emit({ type: 'error', step: PLAN_STEP, at: now(), message: reason });
    return { mode: 'replay' };
  }
}

/** Re-emits the recording's planner events at their recorded pace (gaps capped), stamped with the replay's clock. */
async function replayPlan(fixture: DemoRun, emit: Emit): Promise<Partial<RunRecord>> {
  const start = Date.now();
  const events = fixture.events.filter(({ event }) => event.step === PLAN_STEP && event.type !== 'done' && event.type !== 'error');
  const ledger: LedgerEntry[] = [];
  let prev = events[0]?.t ?? 0;
  let elapsed = 0;
  for (const { t, event } of events) {
    const gap = Math.min(t - prev, REPLAY_GAP_CAP_MS);
    await deps.sleep(gap);
    prev = t;
    elapsed += gap;
    // The replay's own clock (capped gaps), never the recording's: distinct `at` per model entry (the UI dedupes
    // ledger rows by it) and no timestamp ahead of the wall clock.
    const at = new Date(start + elapsed).toISOString();
    if (event.type === 'model') {
      const entry = { ...event.entry, at, replayed: true };
      ledger.push(entry);
      emit({ ...event, at, entry });
    } else {
      emit({ ...event, at });
    }
  }
  return { plans: fixture.plans, reports: fixture.reports, rejectedDrafts: fixture.rejectedDrafts, ledger, mode: 'replay' };
}

// ---------------------------------------------------------------------------------------------
// Objects kept beside a run

export interface StoredTrace {
  status: 'running' | 'done' | 'error';
  startedAt: string;
  events: TraceEvent[];
}

const traceKey = (runId: string) => `traces/${runId}`;
export const getTrace = (runId: string) => store().get<StoredTrace>(traceKey(runId));
export const putTrace = (runId: string, trace: StoredTrace) => store().put(traceKey(runId), trace);
export const deleteTrace = (runId: string) => store().del(traceKey(runId));

const quotaKey = () => `critic-quota/${new Date().toISOString().slice(0, 10)}`;
export async function stressQuota(): Promise<number> {
  return (await store().get<{ count: number }>(quotaKey()))?.count ?? 0;
}
export async function bumpStressQuota(): Promise<void> {
  await store().put(quotaKey(), { count: (await stressQuota()) + 1 });
}
