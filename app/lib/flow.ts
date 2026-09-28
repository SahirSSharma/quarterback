// The plan flow's state machine, in one place and pure so it can be tested without a browser.
// PlanFlow.tsx owns the effects (fetches, SSE) and dispatches these messages.
import type { Action, ApprovalRecord, Impact, LedgerEntry, StudentState, TraceEvent, Verdict } from '@/lib/types';
import type { ApproveResponse, CatalogTitles, RunRecord, SaveResponse } from './contracts';

export type Kind = Action['kind'];
export type Override = ApprovalRecord['overrides'][number];

export interface Flow {
  student: StudentState | null;
  loadError: string | null;
  readOnly: boolean;
  course: string | null;
  kind: Kind;
  impact: Impact | null;
  impactLoading: boolean;
  runId: string | null;
  planning: boolean;
  trace: TraceEvent[];
  traceDone: boolean;
  /** The browser lost the trace stream and is retrying; the server replays or waits, so nothing is lost. */
  traceReconnecting: boolean;
  run: RunRecord | null;
  titles: CatalogTitles;
  verdict: Verdict | null;
  stressing: boolean;
  selectedPlanId: string | null;
  overrides: Override[];
  approving: boolean;
  approval: ApproveResponse | null;
  saved: SaveResponse | null;
  busy: boolean;
  deleted: boolean;
  error: string | null;
}

export type Msg =
  | { type: 'student'; state: StudentState; course: string | null; kind: Kind }
  | { type: 'load-error'; message: string }
  | { type: 'hydrate'; run: RunRecord }
  | { type: 'select'; course?: string; kind?: Kind }
  | { type: 'impact-loading' }
  | { type: 'impact'; impact: Impact }
  | { type: 'plan-start'; runId: string }
  | { type: 'trace'; event: TraceEvent }
  | { type: 'trace-reset' }
  | { type: 'trace-connection'; reconnecting: boolean }
  | { type: 'ledger'; entry: LedgerEntry }
  | { type: 'run'; run: RunRecord }
  | { type: 'titles'; titles: CatalogTitles }
  | { type: 'stress-start' }
  | { type: 'verdict'; verdict: Verdict; run: RunRecord }
  | { type: 'select-plan'; planId: string }
  | { type: 'override'; override: Override }
  | { type: 'approve-start' }
  | { type: 'approval'; approval: ApproveResponse; run: RunRecord | null }
  | { type: 'busy' }
  | { type: 'saved'; saved: SaveResponse }
  | { type: 'deleted' }
  | { type: 'error'; message: string | null };

/** Everything that depends on the chosen course and action; changing either wipes it. */
const downstream = {
  impact: null, impactLoading: false, runId: null, planning: false, trace: [], traceDone: false, traceReconnecting: false, run: null,
  verdict: null, stressing: false, selectedPlanId: null, overrides: [], approving: false, approval: null, saved: null, error: null,
} satisfies Partial<Flow>;

export const initial: Flow = {
  student: null, loadError: null, readOnly: false, course: null, kind: 'drop', titles: {}, busy: false, deleted: false, ...downstream,
};

export function currentCourses(state: StudentState) {
  return state.courses.filter((c) => c.term === state.currentTerm && c.status === 'wip');
}

export function reduce(s: Flow, m: Msg): Flow {
  switch (m.type) {
    case 'student': {
      const course = currentCourses(m.state).some((c) => c.code === m.course) ? m.course : null;
      return { ...s, student: m.state, loadError: null, course, kind: m.kind, ...downstream };
    }
    case 'load-error':
      return { ...s, loadError: m.message };
    case 'hydrate':
      return {
        ...s, student: m.run.state, readOnly: true, course: m.run.action.course, kind: m.run.action.kind, impact: m.run.impact,
        runId: m.run.runId, run: m.run, trace: [], traceDone: true, verdict: m.run.verdict,
        selectedPlanId: m.run.verdict?.recommend ?? m.run.approval?.planId ?? null,
        overrides: m.run.approval?.overrides ?? [],
        saved: m.run.state.id ? { id: m.run.state.id, url: `/plan/${m.run.state.id}` } : null,
      };
    case 'select': {
      const course = m.course ?? s.course;
      const kind = m.kind ?? s.kind;
      if (course === s.course && kind === s.kind) return s;
      return { ...s, course, kind, ...downstream };
    }
    case 'impact-loading':
      return { ...s, impactLoading: true, error: null };
    case 'impact':
      return { ...s, impact: m.impact, impactLoading: false };
    case 'plan-start':
      return { ...s, runId: m.runId, planning: true, trace: [], traceDone: false, traceReconnecting: false, run: null, verdict: null, selectedPlanId: null, overrides: [], approval: null, saved: null, error: null };
    case 'trace':
      return { ...s, trace: [...s.trace, m.event], traceDone: s.traceDone || m.event.type === 'done' || m.event.type === 'error' };
    case 'trace-reset':
      // A reconnected stream replays the stored trace from its first event.
      return { ...s, trace: [] };
    case 'trace-connection':
      return { ...s, traceReconnecting: m.reconnecting };
    case 'ledger':
      // A model call made after planning (a "why not?" answer): one more trace row and ledger line.
      return {
        ...s,
        trace: [...s.trace, { type: 'model', step: m.entry.step, at: m.entry.at, entry: m.entry }],
        run: s.run ? { ...s.run, ledger: [...s.run.ledger, m.entry] } : s.run,
      };
    case 'run':
      return { ...s, run: m.run, planning: false, verdict: m.run.verdict ?? s.verdict, selectedPlanId: s.selectedPlanId ?? m.run.verdict?.recommend ?? null };
    case 'titles':
      return { ...s, titles: { ...s.titles, ...m.titles } };
    case 'stress-start':
      return { ...s, stressing: true, error: null };
    case 'verdict':
      return { ...s, verdict: m.verdict, run: m.run, stressing: false, selectedPlanId: m.verdict.recommend ?? s.selectedPlanId };
    case 'select-plan':
      return { ...s, selectedPlanId: m.planId };
    case 'override':
      return { ...s, overrides: [...s.overrides.filter((o) => o.refusalPlanId !== m.override.refusalPlanId), m.override] };
    case 'approve-start':
      return { ...s, approving: true, error: null };
    case 'approval':
      return { ...s, approval: m.approval, approving: false, run: m.run ?? s.run };
    case 'busy':
      return { ...s, busy: true, error: null };
    case 'saved':
      return { ...s, saved: m.saved, busy: false };
    case 'deleted':
      return { ...s, deleted: true, busy: false };
    case 'error':
      return { ...s, error: m.message, impactLoading: false, planning: false, stressing: false, approving: false, busy: false };
  }
}
