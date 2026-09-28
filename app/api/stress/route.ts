import { NextResponse } from 'next/server';
import { fixtureFor } from '../_lib/mock';
import { store } from '../_lib/store';

/** POST /api/stress {runId} → Verdict. The only step that spends the Ultra model; click-gated. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string } | null;
  const run = body?.runId ? store.runs.get(body.runId) : undefined;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const f = fixtureFor(run.state);
  if (!run.verdict) {
    run.verdict = f.verdict;
    run.ledger = [...run.ledger, { ...f.stressLedger, at: new Date().toISOString() }];
  }
  return NextResponse.json(run.verdict);
}
