import { getApproval } from '@/lib/store/approval';
import { icsFor } from '@/lib/store/ics';
import { getRun } from '@/lib/store/runs';

export const runtime = 'nodejs';

/** GET /api/ics/[approvalId] → text/calendar with the term's deadlines and the approved plan's courses. */
export async function GET(_req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  const approval = await getApproval(approvalId);
  const run = approval && (await getRun(approval.runId));
  if (!approval || !run) return new Response('Unknown approval', { status: 404 });
  return new Response(icsFor(run, approval), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="quarterback-${approvalId}.ics"`,
    },
  });
}
