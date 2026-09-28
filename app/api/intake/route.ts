import { NextResponse } from 'next/server';
import { aiIntake } from '@/lib/agents/intake';
import { demoStudents, fromAcademicHistory } from '@/lib/engine/student';
import type { DemoId } from '@/app/lib/contracts';
import { currentTermFromCalendar } from '@/app/lib/deadlines';
import { demo, demoIds } from '../_lib/mock';
// Installs the persistent ledger sink before the first model call.
import '../_lib/pipeline';

export const runtime = 'nodejs';

/** POST /api/intake {text?, demo?} → StudentState */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; demo?: DemoId };
  if (body.demo && demoIds.includes(body.demo)) {
    const student = demoStudents().find((s) => s.majorFile === demo(body.demo!).state.majorFile);
    if (!student) return NextResponse.json({ error: `Demo ${body.demo} has no record under data/demo.` }, { status: 500 });
    return NextResponse.json(student);
  }
  if (typeof body.text === 'string' && body.text.trim().length > 0) {
    const currentTerm = currentTermFromCalendar(new Date());
    const parsed = fromAcademicHistory(body.text, { currentTerm });
    if (parsed.confidence !== 'low' && parsed.majorFile) return NextResponse.json(parsed);
    // The structured parser could not place the record: Lightning reads it and the UI asks for confirmation.
    try {
      return NextResponse.json(await aiIntake(body.text, { currentTerm }));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ...parsed, warnings: [...parsed.warnings, `The model read of the paste was not available (${why}); showing what the parser found.`] });
    }
  }
  return NextResponse.json({ error: 'Send {text} or {demo: "a" | "b" | "c"}.' }, { status: 400 });
}
