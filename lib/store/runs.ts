// Run records: one per planning session, keyed runs/<runId>; a Save copies the run to saved/<qb_id> so the
// shareable link has its own object and survives the working record.
//
//   createRun(init)              → runId (crypto.randomUUID); plans/reports/verdict/ledger/approval default empty
//   getRun(id)                   → RunRecord | null; `id` may be a runId or a saved id
//   updateRun(runId, patch)      → the merged record; also refreshes the saved copy when the run has one
//   saveRun(runId)               → saved id `qb_…` (idempotent: reuses run.state.id); sets state.id on the run
//   deleteRun(runId)             → removes the run, its saved copy and every approval record for it
//   deleteSaved(id)              → removes the saved copy only
//
// RunRecord is the app owner's envelope (app/lib/contracts.ts), imported as a type only. All functions read
// the process-wide store() from ./blob; tests point it at a temp directory with setStore().
import type { RunRecord } from '../../app/lib/contracts';
import type { StoredApproval } from './approval';
import { store } from './blob';

export type { RunRecord };

export type RunInit = Pick<RunRecord, 'state' | 'action' | 'impact'> & Partial<Omit<RunRecord, 'runId'>>;

const runKey = (runId: string) => `runs/${runId}`;
const savedKey = (id: string) => `saved/${id}`;

/** `qb_3f9c…` style ids, the shape the app already shows for saved plans and approvals. */
export function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export async function createRun(init: RunInit): Promise<string> {
  const run: RunRecord = {
    plans: [],
    reports: [],
    rejectedDrafts: 0,
    verdict: null,
    ledger: [],
    approval: null,
    ...init,
    runId: crypto.randomUUID(),
  };
  await store().put(runKey(run.runId), run);
  return run.runId;
}

export async function getRun(id: string): Promise<RunRecord | null> {
  return (await store().get<RunRecord>(runKey(id))) ?? (await store().get<RunRecord>(savedKey(id)));
}

export async function updateRun(runId: string, patch: Partial<Omit<RunRecord, 'runId'>>): Promise<RunRecord> {
  const run = await store().get<RunRecord>(runKey(runId));
  if (!run) throw new Error(`Unknown run ${runId}`);
  const next: RunRecord = { ...run, ...patch, runId };
  await store().put(runKey(runId), next);
  if (next.state.id) await store().put(savedKey(next.state.id), next);
  return next;
}

export async function saveRun(runId: string): Promise<string> {
  const run = await store().get<RunRecord>(runKey(runId));
  if (!run) throw new Error(`Unknown run ${runId}`);
  const id = run.state.id ?? shortId('qb');
  await updateRun(runId, { state: { ...run.state, id } });
  return id;
}

export async function deleteRun(runId: string): Promise<void> {
  const s = store();
  const run = await s.get<RunRecord>(runKey(runId));
  if (!run) return;
  for (const key of await s.list('approvals/')) {
    const a = await s.get<StoredApproval>(key);
    if (a?.runId === runId) await s.del(key);
  }
  if (run.state.id) await s.del(savedKey(run.state.id));
  await s.del(runKey(runId));
}

export async function deleteSaved(id: string): Promise<void> {
  await store().del(savedKey(id));
}
