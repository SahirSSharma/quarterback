import { NextResponse } from 'next/server';
import type { LedgerSummary } from '@/app/lib/contracts';
import { STRESS_DAILY_CAP, sink, stressQuota } from '../../_lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cap(name: string): number | null {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) ? n : null;
}

/** GET /api/ledger/summary → live spend by model and step, Tavily credits, today's and total spend against the caps. */
export async function GET() {
  const totals = await sink.totals();
  const startOfDay = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const res: LedgerSummary = {
    ...totals,
    today: { usd: await sink.spent(startOfDay), capUsd: cap('QB_DAILY_CAP_USD') },
    total: { usd: totals.usd, capUsd: cap('QB_TOTAL_CAP_USD') },
    stressTests: { today: await stressQuota(), cap: STRESS_DAILY_CAP },
  };
  return NextResponse.json(res);
}
