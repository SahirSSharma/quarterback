import { NextResponse } from 'next/server';
import { deleteRun, getRun } from '@/lib/store/runs';
import { deleteTrace } from '../../_lib/pipeline';

export const runtime = 'nodejs';

/** GET /api/run/[id] → RunRecord (with approval and ledger); `id` may be a runId or a saved id. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  return NextResponse.json(run);
}

/** DELETE /api/run/[id] → {ok:true}. Removes the run, its saved copy, its approvals and its stored trace. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (run) {
    await deleteRun(run.runId);
    await deleteTrace(run.runId);
  }
  return NextResponse.json({ ok: true });
}
