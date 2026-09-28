// Demo fixtures for the route stubs. Everything the stubs return comes from app/_mock/*.json, which
// match lib/types.ts (app/_mock/mock.test.ts checks them). The real implementation replaces this file.
import type { Action, CourseCode, Impact, LedgerEntry, Plan, StudentState, TraceEvent, Verdict, VerifierReport } from '@/lib/types';
import type { DemoId } from '@/app/lib/contracts';
import demoA from '@/app/_mock/demo-a.json';
import demoB from '@/app/_mock/demo-b.json';
import demoC from '@/app/_mock/demo-c.json';

export interface DemoFixture {
  id: DemoId;
  card: { title: string; blurb: string; headline: { kind: Action['kind']; course: CourseCode } };
  state: StudentState;
  /** Rich impacts keyed `${kind}:${course}`; deadlines are computed from the calendar at request time. */
  impacts: Record<string, Omit<Impact, 'deadlines'>>;
  /** Grading-option rule per current course; `bucket` is the requirement that would stop counting on P/NP. */
  pnp: Record<CourseCode, { pnpAllowed: Impact['pnpAllowed']; pnpNote: string; bucket?: { name: string; band: 'major' | 'college' } }>;
  plans: Plan[];
  reports: VerifierReport[];
  rejectedDrafts: number;
  verdict: Verdict;
  trace: { delayMs: number; event: TraceEvent }[];
  stressLedger: LedgerEntry;
}

const fixtures: Record<DemoId, DemoFixture> = {
  a: demoA as unknown as DemoFixture,
  b: demoB as unknown as DemoFixture,
  c: demoC as unknown as DemoFixture,
};

export const demoIds: DemoId[] = ['a', 'b', 'c'];

export function demo(id: DemoId): DemoFixture {
  return fixtures[id];
}

export const demoCards = demoIds.map((id) => ({ id, ...fixtures[id].card }));

/** The fixture whose student matches `state`; the stubs key everything off the major file. */
export function fixtureFor(state: StudentState): DemoFixture {
  return demoIds.map(demo).find((f) => f.state.majorFile === state.majorFile) ?? fixtures.a;
}
