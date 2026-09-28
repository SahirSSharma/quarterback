// POST /api/explain through the real handler in mock mode: the recorded "why not CSE 105?" of demo (a) answers from
// its fixture and lands on the run's ledger; anything unrecorded fails loudly with a hint, bad input is a 400.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, setStore } from '@/lib/store/blob';
import { createRun, getRun } from '@/lib/store/runs';
import { deps as tf } from '@/lib/tf/client';
import type { ExplainResponse } from '@/app/lib/contracts';
import { demo } from '../_lib/mock';
import { POST as explain } from './route';

const post = (body: unknown) =>
  explain(new Request('http://qb/api/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

let dir: string;
const originalFetch = tf.fetch;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'qb-explain-'));
  setStore(createStore({ dir }));
});
afterAll(() => {
  setStore(null);
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv('QB_MODE', 'mock');
  tf.fetch = vi.fn(async () => { throw new Error('network call in a $0 test'); });
});
afterEach(() => {
  vi.unstubAllEnvs();
  tf.fetch = originalFetch;
});

describe('POST /api/explain', () => {
  const f = demo('a');
  const start = () => createRun({ state: f.state, action: f.action, impact: f.impact, plans: f.plans, reports: f.reports, ledger: f.ledger.filter((e) => e.step === 'plan') });

  it('answers the recorded question from the fixture and appends the Lightning entry to the run ledger', async () => {
    expect(f.explain).toBeDefined();
    const runId = await start();
    const res = await post({ runId, code: ' cse105 ' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExplainResponse;
    expect(body.code).toBe('CSE 105');
    expect(body.text).toBe(f.explain!.text);
    expect(body.entry).toMatchObject({ step: 'explain', replayed: true, model: expect.stringMatching(/lightning/i) });
    const run = (await getRun(runId))!;
    expect(run.ledger.at(-1)).toEqual(body.entry);
    expect(run.ledger).toHaveLength(f.ledger.filter((e) => e.step === 'plan').length + 1);
    expect(tf.fetch).not.toHaveBeenCalled();
  });

  it('fails loudly, with the recorded code as a hint, for a question that was never recorded', async () => {
    const runId = await start();
    const res = await post({ runId, code: 'CSE 30' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('No recorded answer for CSE 30 in this mode; try CSE 105.');
    expect((await getRun(runId))!.ledger.every((e) => e.step === 'plan')).toBe(true);
  });

  it('rejects a missing run, a malformed code and a course outside the catalog', async () => {
    expect((await post({ runId: 'missing', code: 'CSE 105' })).status).toBe(404);
    const runId = await start();
    expect((await post({ runId, code: 'not a code' })).status).toBe(400);
    expect((await post({ runId })).status).toBe(400);
    const res = await post({ runId, code: 'CSE 999' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('CSE 999 is not in the catalog.');
  });
});
