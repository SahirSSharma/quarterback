import { NextResponse } from 'next/server';
import { ApprovalError, approve, buildImportUrl, importPayload } from '@/lib/store/approval';
import { advisorMailto } from '@/lib/store/mailto';
import { getRun } from '@/lib/store/runs';
import type { ApprovalRecord } from '@/lib/types';
import type { ApproveResponse } from '@/app/lib/contracts';

export const runtime = 'nodejs';

/**
 * POST /api/approve {runId, planId, overrides} → {approvalId, importUrl, icsUrl, mailto}.
 * 400 for an unknown or unverified plan; 409 for a refused plan without an "I understand" override.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string; planId?: string; overrides?: ApprovalRecord['overrides'] } | null;
  const run = body?.runId ? await getRun(body.runId) : null;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const planId = body?.planId ?? '';
  let record: ApprovalRecord;
  try {
    record = await approve({ run, planId, overrides: body?.overrides ?? [] });
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const plan = run.plans.find((p) => p.id === planId)!;
  // A demo student or a replayed run links to the staging mirror: production tritonplan.com needs a ucsd.edu sign-in.
  const demo = run.state.source === 'demo' || run.mode !== 'live';
  let importUrl: string;
  try {
    importUrl = buildImportUrl(importPayload(record, plan), { demo });
  } catch (e) {
    return NextResponse.json({ error: `Approved, but the TritonPlan link could not be signed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  const res: ApproveResponse = {
    approvalId: record.id,
    importUrl,
    icsUrl: `/api/ics/${record.id}`,
    mailto: advisorMailto({ state: run.state, plan, impact: run.impact }),
  };
  return NextResponse.json(res);
}
