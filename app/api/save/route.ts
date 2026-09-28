import { NextResponse } from 'next/server';
import { getRun, saveRun } from '@/lib/store/runs';
import type { SaveResponse } from '@/app/lib/contracts';

export const runtime = 'nodejs';

/** POST /api/save {runId} → {id, url}. Mints the shareable qb_ id (idempotent) and copies the run under it. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string } | null;
  const run = body?.runId ? await getRun(body.runId) : null;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const id = await saveRun(run.runId);
  const res: SaveResponse = { id, url: `/plan/${id}` };
  return NextResponse.json(res);
}
