import { NextResponse } from 'next/server';
import { impact } from '@/lib/engine/impact';
import { situation } from '../_lib/situation';

/** POST /api/impact {state, action} → Impact. Deterministic and $0; deadlines are judged against now. */
export async function POST(req: Request) {
  const s = situation(await req.json().catch(() => null));
  if ('error' in s) return NextResponse.json({ error: s.error }, { status: 400 });
  return NextResponse.json(impact(s.state, s.action, new Date()));
}
