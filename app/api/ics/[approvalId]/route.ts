import { buildIcs } from '@/app/lib/ics';
import { termStart } from '@/app/lib/deadlines';
import { store } from '../../_lib/store';

/** GET /api/ics/[approvalId] → text/calendar with the term's deadlines and the approved plan. */
export async function GET(_req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  const hit = store.approvals.get(approvalId);
  const run = hit && store.runs.get(hit.runId);
  const plan = run?.plans.find((p) => p.id === hit!.record.planId);
  if (!run || !plan) return new Response('Unknown approval', { status: 404 });
  const ics = buildIcs({
    uid: approvalId,
    label: `${plan.label[0].toUpperCase()}${plan.label.slice(1)} plan`,
    deadlines: run.impact.deadlines,
    terms: plan.terms,
    termStarts: Object.fromEntries(plan.terms.map((t) => [t.term, termStart(t.term)])),
    now: new Date(),
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="quarterback-${approvalId}.ics"`,
    },
  });
}
