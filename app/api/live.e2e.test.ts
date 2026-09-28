// ONE live end-to-end run of demo (a) through the real route handlers against Token Factory: Super plans, the
// verifier judges, Ultra stress-tests, then approve / ics at $0. Spends money (≈ $0.10–0.15), so it runs only when
// BOTH are set explicitly:
//
//   QB_LIVE_E2E=1 QB_MODE=live QB_TOTAL_CAP_USD=0.30 QB_DATA_DIR=/tmp/qb-live npx vitest run app/api/live.e2e.test.ts
//   (QB_DATA_DIR is where the run, trace and ledger land; the test never uses the Blob backend)
//
// QB_RECORD must stay unset (it would overwrite the recorded fixtures/tf keys). The ledger totals are printed.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '@/lib/env';
import { createStore, setStore } from '@/lib/store/blob';
import type { StudentState, TraceEvent, Verdict } from '@/lib/types';
import type { ApproveResponse, LedgerSummary, RunRecord } from '@/app/lib/contracts';
import { demo } from './_lib/mock';
import { sink } from './_lib/pipeline';
import { POST as approve } from './approve/route';
import { GET as ics } from './ics/[approvalId]/route';
import { POST as intake } from './intake/route';
import { GET as ledgerSummary } from './ledger/summary/route';
import { POST as plan } from './plan/route';
import { GET as readRun } from './run/[runId]/route';
import { POST as stress } from './stress/route';
import { GET as trace } from './trace/[runId]/route';

loadEnv();
const enabled = process.env.QB_LIVE_E2E === '1' && process.env.QB_MODE === 'live' && process.env.QB_RECORD !== '1' && !process.env.VERCEL_ENV;
// Always the disk store: a BLOB_READ_WRITE_TOKEN in .env.local would otherwise route the run and the ledger to Vercel Blob.
if (enabled) setStore(createStore({ dir: process.env.QB_DATA_DIR || mkdtempSync(path.join(os.tmpdir(), 'qb-live-')) }));

const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
  handler(new Request('http://qb/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const param = <K extends string>(handler: (req: Request, ctx: { params: Promise<Record<K, string>> }) => Promise<Response>, key: K, value: string) =>
  handler(new Request(`http://qb/api/${value}`), { params: Promise.resolve({ [key]: value } as Record<K, string>) });

describe.skipIf(!enabled)('live demo (a) end to end', () => {
  it('plans with Super, verifies, stress-tests with Ultra and approves, under $0.20', { timeout: 600_000 }, async () => {
    const before = await sink.totals();
    const state = (await (await post(intake, { demo: 'a' })).json()) as StudentState;
    const { runId } = (await (await post(plan, { state, action: demo('a').action })).json()) as { runId: string };

    const res = await param(trace, 'runId', runId);
    expect(res.status).toBe(200);
    const events: TraceEvent[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) if (p.startsWith('data: ')) events.push(JSON.parse(p.slice(6)) as TraceEvent);
    }
    console.log(events.map((e) => `${e.type.padEnd(11)} ${e.type === 'step' ? e.message : e.type === 'model' ? `${e.entry.model} ${e.entry.ms} ms $${e.entry.usd.toFixed(4)} replayed=${e.entry.replayed}` : e.type === 'verifier' ? `${e.report.planId} ${e.report.ok}` : e.type === 'tool_call' ? e.name : ''}`).join('\n'));
    expect(events.at(-1)).toMatchObject({ type: 'done', step: 'plan' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const modelEvents = events.filter((e) => e.type === 'model');
    expect(modelEvents.length).toBeGreaterThanOrEqual(2);
    for (const e of modelEvents) if (e.type === 'model') expect(e.entry.replayed).toBe(false);

    const run = (await (await param(readRun, 'runId', runId)).json()) as RunRecord;
    expect(run.mode).toBe('live');
    expect(run.plans.length).toBeGreaterThanOrEqual(1);
    for (const p of run.plans) expect(run.reports.find((r) => r.planId === p.id)?.ok).toBe(true);
    expect(run.ledger.length).toBe(modelEvents.length);

    const verdict = (await (await post(stress, { runId })).json()) as Verdict;
    console.log('verdict', JSON.stringify(verdict, null, 1));
    expect(verdict.summary.length).toBeGreaterThan(20);
    const stressed = (await (await param(readRun, 'runId', runId)).json()) as RunRecord;
    expect(stressed.verdict).toEqual(verdict);
    expect(stressed.ledger.filter((e) => e.step === 'stress-test')).toHaveLength(1);

    const after = await sink.totals();
    const summary = (await (await ledgerSummary()).json()) as LedgerSummary;
    const spent = after.usd - before.usd;
    console.log('LEDGER TOTALS', JSON.stringify({ spentThisRun: spent, byModel: after.byModel, byStep: after.byStep, today: summary.today, stressTests: summary.stressTests }, null, 1));
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(0.2);

    const planId = verdict.recommend ?? run.plans.find((p) => !verdict.refused.some((r) => r.planId === p.id))!.id;
    const approval = (await (await post(approve, { runId, planId, overrides: [] })).json()) as ApproveResponse;
    expect(approval.approvalId).toMatch(/^apr_/);
    // A demo student links to the staging mirror even when planned live (production tritonplan.com needs a ucsd.edu sign-in).
    expect(approval.importUrl).toMatch(/^https:\/\/sahirssharma\.github\.io\/tritonplan-staging\/tools\/quarterback-import\?plan=/);
    const cal = await param(ics, 'approvalId', approval.approvalId);
    expect(cal.status).toBe(200);
    expect(await cal.text()).toContain('BEGIN:VCALENDAR');
  });
});
