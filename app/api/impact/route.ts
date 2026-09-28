import { NextResponse } from 'next/server';
import type { Action, StudentState } from '@/lib/types';
import { computeImpact } from '../_lib/impact';

/** POST /api/impact {state, action} → Impact */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { state?: StudentState; action?: Action } | null;
  if (!body?.state || !body.action) return NextResponse.json({ error: 'Send {state, action}.' }, { status: 400 });
  const impact = computeImpact(body.state, body.action);
  if (!impact) return NextResponse.json({ error: `${body.action.course} is not one of your ${body.state.currentTerm} courses.` }, { status: 400 });
  return NextResponse.json(impact);
}
