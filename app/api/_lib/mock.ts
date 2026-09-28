// The three recorded demo runs (fixtures/runs/demo-*.json, written by scripts/record-demos.ts from live Token
// Factory calls) and the Start-page cards for their students. Replay and mock mode serve these instead of
// calling models; app/_mock/mock.test.ts checks their invariants against the engine.
//
//   demo(id) / demoIds / demoCards        → the recorded run, the ids, the Start-page cards
//   fixtureFor(state, action)             → the recorded run for this exact demo situation, or null
//
// Static JSON imports (not readFileSync): Next's file tracing bundles them into the route functions on Vercel.
import type { Action, Impact, LedgerEntry, Plan, StudentState, TraceEvent, Verdict, VerifierReport } from '@/lib/types';
import type { DemoId } from '@/app/lib/contracts';
import { termName } from '@/app/lib/format';
import demoA from '@/fixtures/runs/demo-a.json';
import demoB from '@/fixtures/runs/demo-b.json';
import demoC from '@/fixtures/runs/demo-c.json';

export interface DemoRun {
  demo: DemoId;
  recordedAt: string;
  /** The `now` the impact was computed at; deadlines are recomputed at request time. */
  now: string;
  state: StudentState;
  action: Action;
  impact: Impact;
  plans: Plan[];
  reports: VerifierReport[];
  rejectedDrafts: number;
  rounds: number;
  verdict: Verdict;
  ledger: LedgerEntry[];
  /** Every TraceEvent with its offset (ms) from the start of the recording. */
  events: { t: number; event: TraceEvent }[];
  explain?: { code: string; text: string };
  intake?: { file: string; state: StudentState };
  errors: string[];
}

const fixtures: Record<DemoId, DemoRun> = {
  a: demoA as unknown as DemoRun,
  b: demoB as unknown as DemoRun,
  c: demoC as unknown as DemoRun,
};

export const demoIds: DemoId[] = ['a', 'b', 'c'];

export function demo(id: DemoId): DemoRun {
  return fixtures[id];
}

const CARD: Record<DemoId, { title: string; worry: string }> = {
  a: { title: 'Revelle · Artificial Intelligence · 2nd year', worry: 'Thinking about dropping CSE 29.' },
  b: { title: 'Marshall · Cognitive Science · 3rd year', worry: 'Modeling and data analysis is going badly.' },
  c: { title: 'Sixth · Mathematics–Computer Science · transfer', worry: 'Algorithms is not clicking; considering dropping CSE 101.' },
};

function list(codes: string[]): string {
  return codes.length > 1 ? `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}` : codes.join('');
}

export const demoCards = demoIds.map((id) => {
  const { state, action } = fixtures[id];
  const wip = state.courses.filter((c) => c.status === 'wip' && c.term === state.currentTerm).map((c) => c.code);
  return {
    id,
    title: CARD[id].title,
    blurb: `Taking ${list(wip)} in ${termName(state.currentTerm)}. ${CARD[id].worry}`,
    headline: { kind: action.kind, course: action.course },
  };
});

/** The recorded run for exactly this demo student and action; null for a pasted record or an unrecorded action. */
export function fixtureFor(state: StudentState, action: Action): DemoRun | null {
  if (state.source !== 'demo') return null;
  return demoIds.map(demo).find((f) => f.state.majorFile === state.majorFile && f.action.kind === action.kind && f.action.course === action.course) ?? null;
}
