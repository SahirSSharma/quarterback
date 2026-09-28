import { NextResponse } from 'next/server';
import { findRun, store } from '../../_lib/store';

/** GET /api/run/[id] → RunRecord; `id` may be a runId or a saved id. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = findRun(runId);
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  return NextResponse.json(run);
}

/** DELETE /api/run/[id] → {ok:true}. Removes the run, its approvals and saved aliases. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = findRun(runId);
  if (run) {
    store.runs.delete(run.runId);
    for (const [id, target] of store.saved) if (target === run.runId) store.saved.delete(id);
    for (const [id, a] of store.approvals) if (a.runId === run.runId) store.approvals.delete(id);
  }
  return NextResponse.json({ ok: true });
}
