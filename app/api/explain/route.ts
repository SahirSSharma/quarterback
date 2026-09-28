import { NextResponse } from 'next/server';
import { applyAction, buildPlannerContext } from '@/lib/agents/context';
import { whyNot } from '@/lib/agents/explain';
import { catalogByCode, normalizeCode } from '@/lib/engine/data';
import { getRun, updateRun } from '@/lib/store/runs';
import { MissingFixtureError } from '@/lib/tf/replay';
import type { LedgerEntry } from '@/lib/types';
import type { ExplainResponse } from '@/app/lib/contracts';
import { fixtureFor } from '../_lib/mock';
// Installs the persistent ledger sink before the first model call.
import '../_lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/explain {runId, code} → {code, text, entry}. "Why not <code>?" answered by the extraction model over the
 * run's eligibility table (the same one the planner saw, built from the stored run); the call's ledger entry is
 * appended to the run. Outside live mode only a recorded question has an answer.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string; code?: string } | null;
  const run = body?.runId ? await getRun(body.runId) : null;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const raw = (body?.code ?? '').trim();
  if (!/^[A-Za-z]{2,6}\s*\d{1,3}[A-Za-z]{0,3}$/.test(raw)) return NextResponse.json({ error: 'Send a course code such as CSE 105.' }, { status: 400 });
  const code = normalizeCode(raw);
  if (!catalogByCode().has(code)) return NextResponse.json({ error: `${code} is not in the catalog.` }, { status: 400 });

  const { eligibility } = buildPlannerContext(run.state, run.action, run.impact, { horizonTerms: run.options?.horizonTerms });
  const entries: LedgerEntry[] = [];
  try {
    const text = await whyNot({
      state: applyAction(run.state, run.action),
      code,
      eligibility,
      onEvent: (e) => { if (e.type === 'model') entries.push(e.entry); },
    });
    if (entries.length) await updateRun(run.runId, { ledger: [...run.ledger, ...entries] });
    const res: ExplainResponse = { code, text, entry: entries[entries.length - 1] ?? null };
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof MissingFixtureError) {
      const hint = fixtureFor(run.state, run.action)?.explain?.code;
      return NextResponse.json({ error: `No recorded answer for ${code} in this mode${hint ? `; try ${hint}` : ''}.` }, { status: 503 });
    }
    return NextResponse.json({ error: `The answer is not available right now (${e instanceof Error ? e.message : String(e)}).` }, { status: 502 });
  }
}
