import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approve, getApproval } from './approval';
import { store } from './blob';
import { createRun, deleteRun, deleteSaved, getRun, saveRun, updateRun } from './runs';
import { impact, plans, reports, sampleRun, state, tempStore, verdict } from './test-fixture';

describe('runs', () => {
  let cleanup: () => void;
  beforeAll(() => { ({ cleanup } = tempStore()); });
  afterAll(() => cleanup());

  it('creates a run with a UUID and empty defaults, then reads it back', async () => {
    const id = await createRun({ state, action: impact.action, impact });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const run = await getRun(id);
    expect(run).toMatchObject({ runId: id, plans: [], reports: [], rejectedDrafts: 0, verdict: null, ledger: [], approval: null });
    expect(run!.state.major).toBe('Artificial Intelligence');
    expect(await store().list('runs/')).toContain(`runs/${id}`);
    expect(await getRun('nope')).toBeNull();
  });

  it('updateRun merges a patch and keeps the id', async () => {
    const id = await createRun({ state, action: impact.action, impact });
    const next = await updateRun(id, { plans, reports, rejectedDrafts: 2 });
    expect(next.runId).toBe(id);
    expect(next.plans).toHaveLength(3);
    expect((await getRun(id))!.rejectedDrafts).toBe(2);
    await expect(updateRun('missing', { verdict })).rejects.toThrow('Unknown run missing');
  });

  it('saveRun mints a qb_ id once, stores a separate copy, and later updates refresh it', async () => {
    const id = await createRun({ state, action: impact.action, impact, plans, reports });
    const saved = await saveRun(id);
    expect(saved).toMatch(/^qb_[0-9a-f]{12}$/);
    expect(await saveRun(id)).toBe(saved);
    expect((await getRun(id))!.state.id).toBe(saved);
    expect(await store().get(`saved/${saved}`)).toMatchObject({ runId: id });
    expect((await getRun(saved))!.runId).toBe(id);

    await updateRun(id, { verdict });
    expect((await getRun(saved))!.verdict?.recommend).toBe('p-balanced');

    // The saved copy is its own object: deleting only it leaves the run.
    await deleteSaved(saved);
    expect(await store().get(`saved/${saved}`)).toBeNull();
    expect(await getRun(id)).not.toBeNull();
  });

  it('deleteRun removes the run, its saved copy and every approval for it, and nothing else', async () => {
    const id = await createRun({ state, action: impact.action, impact, plans, reports, verdict });
    const other = await createRun({ state, action: impact.action, impact, plans, reports });
    const saved = await saveRun(id);
    const a1 = await approve({ run: (await getRun(id))!, planId: 'p-balanced' });
    const a2 = await approve({ run: (await getRun(id))!, planId: 'p-balanced' }); // "Approve again"
    const a3 = await approve({ run: (await getRun(other))!, planId: 'p-balanced' });

    await deleteRun(id);
    expect(await getRun(id)).toBeNull();
    expect(await getRun(saved)).toBeNull();
    expect(await getApproval(a1.id)).toBeNull();
    expect(await getApproval(a2.id)).toBeNull();
    expect(await getApproval(a3.id)).not.toBeNull();
    expect(await getRun(other)).not.toBeNull();
    await deleteRun(id); // idempotent
  });

  it('sampleRun is a complete RunRecord the other tests can rely on', () => {
    expect(sampleRun().plans.map((p) => p.id)).toEqual(['p-fastest', 'p-balanced', 'p-broken']);
  });
});
