import { NextResponse } from 'next/server';
import { buildEvidenceIndex, horizonTerms } from '@/lib/agents/context';
import { CRITIC_STEP, stressTest, verdictCacheKey } from '@/lib/agents/critic';
import { store } from '@/lib/store/blob';
import { getRun, updateRun } from '@/lib/store/runs';
import { BudgetExceededError } from '@/lib/tf/budget';
import type { LedgerEntry, Verdict } from '@/lib/types';
import type { RunRecord } from '@/app/lib/contracts';
import { type DemoRun, fixtureFor } from '../_lib/mock';
import { STRESS_DAILY_CAP, bumpStressQuota, serveMode, stressQuota } from '../_lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/stress {runId} → Verdict. The only step that spends the Ultra model: at most one live call per run
 * (a run's verdict is final), one per plan set (critic-cache/<key>), and STRESS_DAILY_CAP live calls a day.
 * Outside live mode, over the cap or after a failure, a recorded demo returns its recorded verdict and says so.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string } | null;
  const run = body?.runId ? await getRun(body.runId) : null;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  if (run.verdict) return NextResponse.json(run.verdict);
  if (run.plans.length === 0) return NextResponse.json({ error: 'No plans to stress-test.' }, { status: 400 });

  const fixture = fixtureFor(run.state, run.action);
  const serve = serveMode(run);
  if (serve !== 'live') {
    if (fixture) return NextResponse.json(await keep(run, fixture.verdict, recordedEntries(fixture)));
    if (serve === 'mock') return NextResponse.json({ error: 'No recorded stress-test for this run in QB_MODE=mock.' }, { status: 500 });
    return NextResponse.json(unavailable('Live mode is off and there is no recorded stress-test for this record.'));
  }

  const index = buildEvidenceIndex(run.plans, horizonTerms(run.state, run.options?.horizonTerms));
  const cacheKey = `critic-cache/${verdictCacheKey(run.plans, index)}`;
  const cached = await store().get<{ verdict: Verdict; at: string }>(cacheKey);
  if (cached) return NextResponse.json(await keep(run, cached.verdict, []));

  if ((await stressQuota()) >= STRESS_DAILY_CAP) {
    const note = `The daily limit of ${STRESS_DAILY_CAP} live stress-tests is reached.`;
    if (fixture) return NextResponse.json(await keep(run, withNote(fixture.verdict, `${note} This is the recorded verdict for this demo.`), recordedEntries(fixture)));
    return NextResponse.json(unavailable(`${note} Try again tomorrow; every plan shown has passed the verifier.`));
  }

  await bumpStressQuota();
  const entries: LedgerEntry[] = [];
  try {
    const verdict = await stressTest({
      state: run.state,
      action: run.action,
      plans: run.plans,
      reports: run.reports,
      evidenceIndex: index,
      onEvent: (e) => { if (e.type === 'model') entries.push(e.entry); },
    });
    await store().put(cacheKey, { verdict, at: new Date().toISOString() });
    return NextResponse.json(await keep(run, verdict, entries));
  } catch (e) {
    const why = e instanceof BudgetExceededError ? 'Live mode is paused for the day' : `The live stress-test failed (${e instanceof Error ? e.message : String(e)})`;
    if (fixture) return NextResponse.json(await keep(run, withNote(fixture.verdict, `${why}; this is the recorded verdict for this demo.`), recordedEntries(fixture)));
    return NextResponse.json({ error: `${why}.` }, { status: 502 });
  }
}

/** Stores a real verdict (model or recording) on the run with its ledger entries. */
async function keep(run: RunRecord, verdict: Verdict, entries: LedgerEntry[]): Promise<Verdict> {
  await updateRun(run.runId, { verdict, ledger: [...run.ledger, ...entries] });
  return verdict;
}

/** Not a judgment and never stored, so the button stays available once live mode is back. */
const unavailable = (summary: string): Verdict => ({ recommend: null, refused: [], risks: [], summary });

const withNote = (verdict: Verdict, note: string): Verdict => ({ ...verdict, summary: `${verdict.summary} ${note}` });

/** The recording's Ultra call(s), marked replayed and stamped now (distinct `at` per entry). */
function recordedEntries(fixture: DemoRun): LedgerEntry[] {
  const now = Date.now();
  return fixture.ledger.filter((e) => e.step === CRITIC_STEP).map((e, i) => ({ ...e, at: new Date(now + i).toISOString(), replayed: true }));
}
