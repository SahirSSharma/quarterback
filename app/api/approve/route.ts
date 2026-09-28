import { NextResponse } from 'next/server';
import type { ApprovalRecord, ImportPayload } from '@/lib/types';
import type { ApproveResponse } from '@/app/lib/contracts';
import { planHash } from '@/app/lib/planHash';
import { formatUnits, termName } from '@/app/lib/format';
import { newId, store } from '../_lib/store';

const IMPORT_BASE = 'https://tritonplan.com/tools/quarterback-import';

/** Stub token: base64url payload with a placeholder signature. The real one is Ed25519-signed. */
function mintToken(payload: ImportPayload): string {
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.unsigned-stub`;
}

/** POST /api/approve {runId, planId, overrides} → {approvalId, importUrl, icsUrl, mailto} */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string; planId?: string; overrides?: ApprovalRecord['overrides'] } | null;
  const run = body?.runId ? store.runs.get(body.runId) : undefined;
  if (!run) return NextResponse.json({ error: 'Unknown run' }, { status: 404 });
  const plan = run.plans.find((p) => p.id === body?.planId);
  if (!plan) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
  const overrides = body?.overrides ?? [];
  const refused = run.verdict?.refused.find((r) => r.planId === plan.id);
  if (refused && !overrides.some((o) => o.refusalPlanId === plan.id && o.phrase === 'I understand' && o.reason.trim())) {
    return NextResponse.json({ error: 'This plan was refused. Approving it needs an override with the phrase "I understand" and a reason.' }, { status: 409 });
  }

  const at = new Date().toISOString();
  const record: ApprovalRecord = {
    id: newId('apr'),
    at,
    planHash: planHash(plan.terms),
    planId: plan.id,
    studentId: run.state.id,
    overrides,
    ledger: run.ledger,
  };
  run.approval = record;
  store.approvals.set(record.id, { record, runId: run.runId });

  const token = mintToken({ v: 1, approvalId: record.id, issuedAt: at, plan: plan.terms.map((t) => ({ term: t.term, courses: t.courses })), label: plan.label });
  const lines = [
    `Hi,`,
    ``,
    `I am planning to ${run.action.kind === 'drop' ? 'drop' : run.action.kind === 'pnp' ? 'switch to P/NP' : 'keep'} ${run.action.course} this quarter and wanted to check the plan below with you before the deadline.`,
    ``,
    ...plan.terms.map((t) => `${termName(t.term)}: ${t.courses.join(', ')} (${formatUnits(t.units)})`),
    ``,
    `Could we meet briefly this week?`,
    ``,
    `Thank you,`,
  ];
  const res: ApproveResponse = {
    approvalId: record.id,
    importUrl: `${IMPORT_BASE}?plan=${encodeURIComponent(token)}`,
    icsUrl: `/api/ics/${record.id}`,
    mailto: `mailto:?subject=${encodeURIComponent(`Plan check before the ${run.action.course} deadline`)}&body=${encodeURIComponent(lines.join('\n'))}`,
  };
  return NextResponse.json(res);
}
