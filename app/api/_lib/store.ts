// In-memory run store for the stubs. Lives on globalThis so `next dev` module reloads keep it.
// The real implementation swaps this for the Blob/.data store described in DESIGN.md.
import type { ApprovalRecord } from '@/lib/types';
import type { RunRecord } from '@/app/lib/contracts';

interface Store {
  runs: Map<string, RunRecord>;
  approvals: Map<string, { record: ApprovalRecord; runId: string }>;
  /** Saved id → runId. */
  saved: Map<string, string>;
}

const g = globalThis as typeof globalThis & { __qbStore?: Store };
export const store: Store = (g.__qbStore ??= { runs: new Map(), approvals: new Map(), saved: new Map() });

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** A run by its runId or by a saved id. */
export function findRun(id: string): RunRecord | undefined {
  return store.runs.get(id) ?? store.runs.get(store.saved.get(id) ?? '');
}
