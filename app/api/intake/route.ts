import { NextResponse } from 'next/server';
import type { StudentState } from '@/lib/types';
import type { DemoId } from '@/app/lib/contracts';
import { demo, demoIds } from '../_lib/mock';

/** POST /api/intake {text?, demo?} → StudentState */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; demo?: DemoId };
  if (body.demo && demoIds.includes(body.demo)) return NextResponse.json(demo(body.demo).state);
  if (typeof body.text === 'string' && body.text.trim().length > 0) {
    // Stub: the deterministic parser and the Lightning fallback are not wired yet, so the paste path
    // returns the first demo record and says so. The real intake replaces this branch.
    const state: StudentState = {
      ...demo('a').state,
      source: 'paste',
      confidence: 'low',
      warnings: ['Paste parsing is not connected in this build. Showing a demo record so you can explore; nothing you pasted was kept.'],
    };
    return NextResponse.json(state);
  }
  return NextResponse.json({ error: 'Send {text} or {demo: "a" | "b" | "c"}.' }, { status: 400 });
}
