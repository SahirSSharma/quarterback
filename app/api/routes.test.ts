// The three demo flows end to end through the real route handlers in QB_MODE=mock, on a temp store, at $0:
// intake → impact → plan → trace (SSE) → run → stress → approve → ics → save → delete. Plus the approval gate on a
// refused plan, the live→replay fallbacks (spend cap, production demo, no recording) and the reconnect guard.
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEvidenceIndex, horizonTerms } from '@/lib/agents/context';
import { verdictCacheKey } from '@/lib/agents/critic';
import { IMPORT_BASE, IMPORT_BASE_STAGING, verifyImportToken } from '@/lib/store/approval';
import { createStore, setStore, store } from '@/lib/store/blob';
import { createRun, getRun } from '@/lib/store/runs';
import * as fx from '@/lib/store/test-fixture';
import { deps as tf } from '@/lib/tf/client';
import type { ImportPayload, StudentState, TraceEvent, Verdict } from '@/lib/types';
import type { ApproveResponse, LedgerSummary, RunRecord, SaveResponse } from '@/app/lib/contracts';
import { demo, demoIds } from './_lib/mock';
import { STRESS_DAILY_CAP, deps, putTrace } from './_lib/pipeline';
import { POST as approve } from './approve/route';
import { GET as ics } from './ics/[approvalId]/route';
import { POST as impact } from './impact/route';
import { POST as intake } from './intake/route';
import { GET as ledgerSummary } from './ledger/summary/route';
import { POST as plan } from './plan/route';
import { DELETE as deleteRun, GET as readRun } from './run/[runId]/route';
import { POST as save } from './save/route';
import { POST as stress } from './stress/route';
import { GET as trace } from './trace/[runId]/route';

const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
  handler(new Request('http://qb/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const withParam = <K extends string>(handler: (req: Request, ctx: { params: Promise<Record<K, string>> }) => Promise<Response>, key: K, value: string, method = 'GET') =>
  handler(new Request(`http://qb/api/${value}`, { method }), { params: Promise.resolve({ [key]: value } as Record<K, string>) });
const json = async <T>(res: Response): Promise<T> => {
  expect(res.headers.get('content-type')).toMatch(/json/);
  return res.json() as Promise<T>;
};
async function sse(res: Response): Promise<TraceEvent[]> {
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  const text = await res.text();
  return text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as TraceEvent);
}
const runRecord = (id: string) => withParam(readRun, 'runId', id).then((r) => json<RunRecord>(r));

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PKCS8 = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const SPKI = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let dir: string;
const originalSleep = deps.sleep;
const originalFetch = tf.fetch;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'qb-routes-'));
  setStore(createStore({ dir }));
});
afterAll(() => {
  setStore(null);
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv('QB_MODE', 'mock');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('QB_DAILY_CAP_USD', '');
  vi.stubEnv('QB_TOTAL_CAP_USD', '');
  vi.stubEnv('QB_SIGNING_KEY', PKCS8);
  vi.stubEnv('QB_IMPORT_BASE', '');
  deps.sleep = async () => {};
  tf.fetch = vi.fn(async () => { throw new Error('network call in a $0 test'); });
});
afterEach(() => {
  vi.unstubAllEnvs();
  deps.sleep = originalSleep;
  tf.fetch = originalFetch;
});

/** intake → impact → plan for a demo student; returns the new run's id. */
async function startRun(id: 'a' | 'b' | 'c', action = demo(id).action): Promise<{ state: StudentState; runId: string }> {
  const state = await json<StudentState>(await post(intake, { demo: id }));
  const { runId } = await json<{ runId: string }>(await post(plan, { state, action }));
  return { state, runId };
}

describe.each(demoIds)('demo %s through the routes in mock mode', (id) => {
  const f = demo(id);
  const startedAt = new Date().toISOString();

  it('runs intake → impact → plan → trace → run → stress → approve → ics → save → delete', async () => {
    const state = await json<StudentState>(await post(intake, { demo: id }));
    expect(state).toEqual(f.state);

    const imp = await json<Awaited<ReturnType<typeof import('@/lib/engine/impact').impact>>>(await post(impact, { state, action: f.action }));
    expect(imp.course.code).toBe(f.action.course);
    expect(imp.blocks.map((b) => b.code)).toEqual(f.impact.blocks.map((b) => b.code));
    expect(imp.deadlines.map((d) => d.key)).toEqual(['dropWithoutW', 'changeUnits', 'changeGradingOption', 'dropWithW']);
    for (const d of imp.deadlines) {
      expect(d.term).toBe(state.currentTerm);
      expect(d.passed).toBe(d.date < new Date().toISOString().slice(0, 10) || d.passed); // judged against today, never the recording
    }
    expect((await post(impact, { state, action: { kind: 'drop', course: 'CSE 999' } })).status).toBe(400);

    const { runId } = await json<{ runId: string }>(await post(plan, { state, action: f.action }));
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const created = await runRecord(runId);
    expect(created).toMatchObject({ runId, plans: [], reports: [], rejectedDrafts: 0, verdict: null, ledger: [], approval: null });
    expect(created.mode).toBeUndefined();

    // The trace performs the (replayed) work: planner events in recorded order, then done once the run is stored.
    const events = await sse(await withParam(trace, 'runId', runId));
    const recorded = f.events.filter((e) => e.event.step === 'plan');
    expect(events).toHaveLength(recorded.length);
    expect(events[0]).toMatchObject({ type: 'step', step: 'plan' });
    expect(events.at(-1)).toMatchObject({ type: 'done', step: 'plan' });
    expect(events.map((e) => e.type)).toEqual(recorded.map((e) => e.event.type));
    expect(events.filter((e) => e.type === 'verifier')).toHaveLength(f.reports.length);
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
    for (const e of events) expect(e.at >= startedAt, `fresh timestamp ${e.at}`).toBe(true);
    const modelEvents = events.filter((e) => e.type === 'model');
    expect(modelEvents.length).toBe(f.ledger.filter((e) => e.step === 'plan').length);
    for (const e of modelEvents) if (e.type === 'model') expect(e.entry.replayed).toBe(true);

    const planned = await runRecord(runId);
    expect(planned.mode).toBe('replay');
    expect(planned.plans).toEqual(f.plans);
    expect(planned.reports).toEqual(f.reports);
    expect(planned.rejectedDrafts).toBe(f.rejectedDrafts);
    expect(planned.ledger.map((e) => e.usd)).toEqual(f.ledger.filter((e) => e.step === 'plan').map((e) => e.usd));
    expect(planned.ledger.every((e) => e.replayed)).toBe(true);
    expect(new Set(planned.ledger.map((e) => e.at)).size).toBe(planned.ledger.length); // the UI dedupes rows by `at`

    // A reconnect replays what was stored instead of planning again.
    const again = await sse(await withParam(trace, 'runId', runId));
    expect(again).toEqual(events);

    const verdict = await json<Verdict>(await post(stress, { runId }));
    expect(verdict).toEqual(f.verdict);
    const stressed = await runRecord(runId);
    expect(stressed.verdict).toEqual(f.verdict);
    const ultra = stressed.ledger.filter((e) => e.step === 'stress-test');
    expect(ultra).toHaveLength(1);
    expect(ultra[0]).toMatchObject({ replayed: true, usd: f.ledger.find((e) => e.step === 'stress-test')!.usd });
    expect(ultra[0].model).toMatch(/ultra/i);
    // One verdict per run: a second click returns it without adding a call.
    expect(await json<Verdict>(await post(stress, { runId }))).toEqual(f.verdict);
    expect((await runRecord(runId)).ledger).toEqual(stressed.ledger);

    const planId = f.verdict.recommend!;
    const approval = await json<ApproveResponse>(await post(approve, { runId, planId, overrides: [] }));
    expect(approval.approvalId).toMatch(/^apr_[0-9a-f]{12}$/);
    expect(approval.icsUrl).toBe(`/api/ics/${approval.approvalId}`);
    expect(approval.mailto).toMatch(/^mailto:\?subject=/);
    // A demo student's link opens the staging mirror; production tritonplan.com needs a ucsd.edu sign-in.
    expect(approval.importUrl.startsWith(`${IMPORT_BASE_STAGING}?plan=`)).toBe(true);
    const token = decodeURIComponent(approval.importUrl.slice(`${IMPORT_BASE_STAGING}?plan=`.length));
    const payload = (await verifyImportToken(token, SPKI)) as ImportPayload;
    expect(payload).toMatchObject({ v: 1, approvalId: approval.approvalId, label: f.plans.find((p) => p.id === planId)!.label });
    expect(payload.plan).toEqual(f.plans.find((p) => p.id === planId)!.terms.map((t) => ({ term: t.term, courses: t.courses })));
    const approved = await runRecord(runId);
    expect(approved.approval).toMatchObject({ id: approval.approvalId, planId, overrides: [] });
    expect(approved.approval!.planHash).toMatch(/^[0-9a-f]{64}$/);

    const cal = await withParam(ics, 'approvalId', approval.approvalId);
    expect(cal.status).toBe(200);
    expect(cal.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const text = await cal.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain(f.plans.find((p) => p.id === planId)!.terms[0].courses[0]);
    expect((await withParam(ics, 'approvalId', 'apr_missing')).status).toBe(404);

    const saved = await json<SaveResponse>(await post(save, { runId }));
    expect(saved).toEqual({ id: expect.stringMatching(/^qb_[0-9a-f]{12}$/), url: expect.stringMatching(/^\/plan\/qb_/) });
    expect(await json<SaveResponse>(await post(save, { runId }))).toEqual(saved);
    expect((await runRecord(saved.id)).runId).toBe(runId);

    const summary = await json<LedgerSummary>(await ledgerSummary());
    expect(summary.usd).toBe(0); // everything replayed: no live spend
    expect(summary.today).toEqual({ usd: 0, capUsd: null });
    expect(summary.stressTests).toEqual({ today: 0, cap: STRESS_DAILY_CAP });

    expect(await json<{ ok: true }>(await withParam(deleteRun, 'runId', saved.id, 'DELETE'))).toEqual({ ok: true });
    expect((await withParam(readRun, 'runId', runId)).status).toBe(404);
    expect((await withParam(readRun, 'runId', saved.id)).status).toBe(404);
    expect((await withParam(ics, 'approvalId', approval.approvalId)).status).toBe(404);
    expect((await withParam(trace, 'runId', runId)).status).toBe(404);
    expect(await store().list(`traces/${runId}`)).toEqual([]);
  });
});

describe('the approval gate', () => {
  // No recorded verdict refuses a plan, so the 409 path runs on lib/store's hand-built refusing verdict.
  it('refuses a refused plan without the exact phrase and a reason, and an unverified plan outright', async () => {
    const runId = await createRun({ state: fx.state, action: fx.impact.action, impact: fx.impact, plans: fx.plans, reports: fx.reports, verdict: fx.verdict });
    expect((await post(approve, { runId, planId: 'p-fastest', overrides: [] })).status).toBe(409);
    expect((await post(approve, { runId, planId: 'p-fastest', overrides: [{ refusalPlanId: 'p-fastest', reason: 'x', phrase: 'i understand' }] })).status).toBe(409);
    expect((await post(approve, { runId, planId: 'p-fastest', overrides: [{ refusalPlanId: 'p-fastest', reason: '   ', phrase: 'I understand' }] })).status).toBe(409);
    expect((await post(approve, { runId, planId: 'p-broken', overrides: [] })).status).toBe(400);
    expect((await post(approve, { runId, planId: 'nope', overrides: [] })).status).toBe(400);
    expect((await post(approve, { runId: 'missing', planId: 'p-fastest', overrides: [] })).status).toBe(404);
    expect((await getRun(runId))!.approval).toBeNull();

    const override = { refusalPlanId: 'p-fastest', reason: 'My advisor confirmed CSE 194 runs.', phrase: 'I understand' as const };
    const res = await json<ApproveResponse>(await post(approve, { runId, planId: 'p-fastest', overrides: [override] }));
    expect(res.approvalId).toMatch(/^apr_/);
    expect((await getRun(runId))!.approval).toMatchObject({ planId: 'p-fastest', overrides: [override] });
  });

  it('links a pasted record planned live to production TritonPlan, and a replayed one to the staging mirror', async () => {
    const init = { state: { ...fx.state, source: 'paste' as const }, action: fx.impact.action, impact: fx.impact, plans: fx.plans, reports: fx.reports, verdict: fx.verdict };
    const live = await json<ApproveResponse>(await post(approve, { runId: await createRun({ ...init, mode: 'live' }), planId: 'p-balanced', overrides: [] }));
    expect(live.importUrl.startsWith(`${IMPORT_BASE}?plan=`)).toBe(true);
    const replayed = await json<ApproveResponse>(await post(approve, { runId: await createRun({ ...init, mode: 'replay' }), planId: 'p-balanced', overrides: [] }));
    expect(replayed.importUrl.startsWith(`${IMPORT_BASE_STAGING}?plan=`)).toBe(true);
  });

  it('reports a missing signing key instead of an unsigned link', async () => {
    vi.stubEnv('QB_SIGNING_KEY', '');
    const runId = await createRun({ state: fx.state, action: fx.impact.action, impact: fx.impact, plans: fx.plans, reports: fx.reports, verdict: fx.verdict });
    const res = await post(approve, { runId, planId: 'p-balanced', overrides: [] });
    expect(res.status).toBe(500);
    expect((await json<{ error: string }>(res)).error).toMatch(/QB_SIGNING_KEY/);
  });
});

describe('intake from a paste', () => {
  it('parses the demo Academic History deterministically and never calls a model for it', async () => {
    const text = readFileSync(path.join(process.cwd(), 'lib/engine/fixtures/academic-history-demo.txt'), 'utf8');
    const state = await json<StudentState>(await post(intake, { text }));
    expect(state.source).toBe('paste');
    expect(state.majorFile).toBe(demo('a').state.majorFile);
    expect(state.confidence).not.toBe('low');
    expect(state.courses.length).toBeGreaterThan(5);
    expect(tf.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the parser result with a warning when the model read is unavailable', async () => {
    const state = await json<StudentState>(await post(intake, { text: 'lorem ipsum, nothing like a transcript' }));
    expect(state.source).toBe('paste');
    expect(state.confidence).toBe('low');
    expect(state.warnings.at(-1)).toMatch(/model read of the paste was not available/);
    expect((await post(intake, {})).status).toBe(400);
    expect((await post(intake, { demo: 'z' })).status).toBe(400);
  });
});

describe('serving mode', () => {
  it('QB_MODE=mock fails loudly for a demo situation that was never recorded', async () => {
    const { runId } = await startRun('a', { kind: 'pnp', course: 'CSE 29' });
    const res = await withParam(trace, 'runId', runId);
    expect(res.status).toBe(500);
    expect((await json<{ error: string }>(res)).error).toMatch(/No recorded run for pnp CSE 29/);
  });

  it('QB_MODE=replay ends in an error event, not a re-plan, for a record with no recording', async () => {
    vi.stubEnv('QB_MODE', 'replay');
    const { runId } = await startRun('b', { kind: 'keep', course: 'COGS 109' });
    const events = await sse(await withParam(trace, 'runId', runId));
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((await runRecord(runId)).mode).toBe('replay');
    expect((await post(stress, { runId })).status).toBe(400); // no plans to stress-test
  });

  it('flips live to replay with an explanation when the spend cap is reached, for a demo student', async () => {
    vi.stubEnv('QB_MODE', 'live');
    vi.stubEnv('QB_TOTAL_CAP_USD', '0'); // assertBudget throws before any request leaves
    const { runId } = await startRun('a');
    const events = await sse(await withParam(trace, 'runId', runId));
    // The planner announces its context pack before the first call reaches the budget check; then the flip.
    expect(events[0]).toMatchObject({ type: 'step', message: expect.stringMatching(/^Context pack built/) });
    expect(events[1]).toMatchObject({ type: 'step', message: expect.stringMatching(/^Live mode is paused for the day: Token Factory total spend cap reached.*Showing the recorded run/) });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const run = await runRecord(runId);
    expect(run.mode).toBe('replay');
    expect(run.plans).toEqual(demo('a').plans);
    expect(tf.fetch).not.toHaveBeenCalled();

    // The stress-test falls back the same way and says so in the summary.
    const verdict = await json<Verdict>(await post(stress, { runId }));
    expect(verdict.recommend).toBe(demo('a').verdict.recommend);
    expect(verdict.summary).toMatch(/Live mode is paused for the day; this is the recorded verdict/);
    expect((await runRecord(runId)).verdict).toEqual(verdict);
  });

  it('flips live to replay and emits error for a pasted record with no recording', async () => {
    vi.stubEnv('QB_MODE', 'live');
    vi.stubEnv('QB_TOTAL_CAP_USD', '0');
    const state: StudentState = { ...demo('a').state, source: 'paste' };
    const { runId } = await json<{ runId: string }>(await post(plan, { state, action: demo('a').action }));
    const events = await sse(await withParam(trace, 'runId', runId));
    expect(events.map((e) => e.type)).toEqual(['step', 'step', 'error']);
    expect(events[2]).toMatchObject({ type: 'error', message: expect.stringMatching(/^Live mode is paused for the day/) });
    const run = await runRecord(runId);
    expect(run).toMatchObject({ mode: 'replay', plans: [] });
    expect((await post(stress, { runId })).status).toBe(400);
  });

  it('never spends on a recorded demo in production even in live mode', async () => {
    vi.stubEnv('QB_MODE', 'live');
    vi.stubEnv('VERCEL_ENV', 'production');
    const { runId } = await startRun('c');
    const events = await sse(await withParam(trace, 'runId', runId));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((await runRecord(runId)).mode).toBe('replay');
    expect(await json<Verdict>(await post(stress, { runId }))).toEqual(demo('c').verdict);
    expect(tf.fetch).not.toHaveBeenCalled();
  });
});

describe('stress-test limits in live mode', () => {
  async function plannedRun(id: 'a' | 'b' | 'c'): Promise<RunRecord> {
    const { runId } = await startRun(id);
    await sse(await withParam(trace, 'runId', runId)); // mock replay fills the plans
    vi.stubEnv('QB_MODE', 'live');
    return runRecord(runId);
  }

  it('serves a cached verdict for the same plan set without calling Ultra', async () => {
    const run = await plannedRun('b');
    const key = verdictCacheKey(run.plans, buildEvidenceIndex(run.plans, horizonTerms(run.state)));
    const cachedVerdict: Verdict = { recommend: run.plans[1].id, refused: [], risks: ['from cache'], summary: 'Cached earlier today.' };
    await store().put(`critic-cache/${key}`, { verdict: cachedVerdict, at: new Date().toISOString() });
    expect(await json<Verdict>(await post(stress, { runId: run.runId }))).toEqual(cachedVerdict);
    expect((await runRecord(run.runId)).verdict).toEqual(cachedVerdict);
    expect(tf.fetch).not.toHaveBeenCalled();
  });

  it('serves the recorded verdict, and says so, once the daily cap is reached', async () => {
    const run = await plannedRun('c');
    await store().put(`critic-quota/${new Date().toISOString().slice(0, 10)}`, { count: STRESS_DAILY_CAP });
    const verdict = await json<Verdict>(await post(stress, { runId: run.runId }));
    expect(verdict.recommend).toBe(demo('c').verdict.recommend);
    expect(verdict.summary).toMatch(new RegExp(`daily limit of ${STRESS_DAILY_CAP} live stress-tests is reached. This is the recorded verdict`));
    expect((await json<LedgerSummary>(await ledgerSummary())).stressTests.today).toBe(STRESS_DAILY_CAP);
    expect(tf.fetch).not.toHaveBeenCalled();

    // A pasted record gets a placeholder that is not stored, so the button works again tomorrow.
    const pasted = await createRun({ ...run, state: { ...run.state, source: 'paste' }, verdict: null });
    const placeholder = await json<Verdict>(await post(stress, { runId: pasted }));
    expect(placeholder).toMatchObject({ recommend: null, refused: [], risks: [] });
    expect(placeholder.summary).toMatch(/Try again tomorrow/);
    expect((await getRun(pasted))!.verdict).toBeNull();
  });
});

describe('trace reconnects', () => {
  it('waits for a trace another request is producing, then replays it', async () => {
    const { runId } = await startRun('a');
    const startedAt = new Date().toISOString();
    await putTrace(runId, { status: 'running', startedAt, events: [] });
    const finished: TraceEvent[] = [
      { type: 'step', step: 'plan', at: startedAt, message: 'from the other request' },
      { type: 'done', step: 'plan', at: startedAt },
    ];
    deps.sleep = async () => { await putTrace(runId, { status: 'done', startedAt, events: finished }); };
    const events = await sse(await withParam(trace, 'runId', runId));
    expect(events[0]).toMatchObject({ type: 'step', message: expect.stringMatching(/already in progress/) });
    expect(events.slice(1)).toEqual(finished);
    expect((await runRecord(runId)).plans).toEqual([]); // nothing was planned twice
  });

  it('starts over when a running trace is stale', async () => {
    const { runId } = await startRun('a');
    await putTrace(runId, { status: 'running', startedAt: new Date(Date.now() - 10 * 60_000).toISOString(), events: [] });
    const events = await sse(await withParam(trace, 'runId', runId));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((await runRecord(runId)).plans).toEqual(demo('a').plans);
  });
});
