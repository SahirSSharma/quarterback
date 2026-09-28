import { NextResponse } from 'next/server';
import type { Action, StudentState } from '@/lib/types';
import type { RunRecord } from '@/app/lib/contracts';
import { fixtureFor } from '../_lib/mock';
import { newId, store } from '../_lib/store';
import { computeImpact } from '../_lib/impact';

/** POST /api/plan {state, action, options?} → {runId}. The stub fills the run at once; the trace replays. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { state?: StudentState; action?: Action; options?: { horizonTerms?: number } } | null;
  if (!body?.state || !body.action) return NextResponse.json({ error: 'Send {state, action}.' }, { status: 400 });
  const impact = computeImpact(body.state, body.action);
  if (!impact) return NextResponse.json({ error: `${body.action.course} is not one of your ${body.state.currentTerm} courses.` }, { status: 400 });
  const f = fixtureFor(body.state);
  const now = Date.now();
  let t = 0;
  const ledger = f.trace.flatMap(({ delayMs, event }) => {
    t += delayMs;
    return event.type === 'model' ? [{ ...event.entry, at: new Date(now + t).toISOString() }] : [];
  });
  const run: RunRecord = {
    runId: newId('run'),
    state: body.state,
    action: body.action,
    impact,
    plans: f.plans,
    reports: f.reports,
    rejectedDrafts: f.rejectedDrafts,
    verdict: null,
    ledger,
    approval: null,
  };
  store.runs.set(run.runId, run);
  return NextResponse.json({ runId: run.runId });
}
