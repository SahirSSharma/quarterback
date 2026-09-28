import { NextResponse } from 'next/server';
import { impact } from '@/lib/engine/impact';
import { createRun } from '@/lib/store/runs';
import type { Action, StudentState } from '@/lib/types';
import { situation } from '../_lib/situation';

export const runtime = 'nodejs';

/** POST /api/plan {state, action, options?} → {runId}. Creates the run only; GET /api/trace/[runId] does the model work. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { state?: StudentState; action?: Action; options?: { horizonTerms?: number } } | null;
  const s = situation(body);
  if ('error' in s) return NextResponse.json({ error: s.error }, { status: 400 });
  const runId = await createRun({
    state: s.state,
    action: s.action,
    impact: impact(s.state, s.action, new Date()),
    ...(body?.options ? { options: body.options } : {}),
  });
  return NextResponse.json({ runId });
}
