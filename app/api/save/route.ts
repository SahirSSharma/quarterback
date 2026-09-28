import { NextResponse } from 'next/server';
import type { SaveResponse } from '@/app/lib/contracts';
import { newId, store } from '../_lib/store';

/** POST /api/save {runId} → {id, url}. Nothing is kept before this call. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string } | null;
  const run = body?.runId ? store.runs.get(body.runId) : undefined;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const existing = [...store.saved].find(([, target]) => target === run.runId)?.[0];
  const id = existing ?? newId('qb');
  store.saved.set(id, run.runId);
  run.state = { ...run.state, id };
  const res: SaveResponse = { id, url: `/plan/${id}` };
  return NextResponse.json(res);
}
