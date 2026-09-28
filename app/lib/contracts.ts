// Response shapes of the app/api route stubs. lib/types.ts holds the domain types; these are the
// envelopes the UI reads. The agents/routes owner keeps these exact shapes when swapping the internals.
import type { Action, ApprovalRecord, Impact, LedgerEntry, Mode, Plan, StudentState, Verdict, VerifierReport } from '@/lib/types';

export type DemoId = 'a' | 'b' | 'c';

/** GET /api/run/[runId] */
export interface RunRecord {
  runId: string;
  state: StudentState;
  action: Action;
  impact: Impact;
  plans: Plan[];
  reports: VerifierReport[];
  /** Drafts the verifier rejected; they are counted, never shown. */
  rejectedDrafts: number;
  verdict: Verdict | null;
  ledger: LedgerEntry[];
  approval: ApprovalRecord | null;
  /** How plans/verdict were produced: 'live' from Token Factory, 'replay' from a recorded run (show a banner). Absent until the trace ran. */
  mode?: Mode;
  options?: { horizonTerms?: number };
}

/** POST /api/approve */
export interface ApproveResponse {
  approvalId: string;
  importUrl: string;
  icsUrl: string;
  mailto: string;
}

/** POST /api/save */
export interface SaveResponse {
  id: string;
  url: string;
}

/** GET /api/ledger/summary — live (non-replayed) spend across every run, for the About page. */
export interface LedgerSummary {
  byModel: Record<string, { calls: number; promptTokens: number; completionTokens: number; reasoningTokens: number; cacheHitTokens: number; usd: number; ms: number }>;
  byStep: LedgerSummary['byModel'];
  usd: number;
  /** Tavily credits. */
  credits: number;
  today: { usd: number; capUsd: number | null };
  total: { usd: number; capUsd: number | null };
  stressTests: { today: number; cap: number };
}

/** POST /api/explain {runId, code} — "why not <code>?" answered by the extraction model over the run's eligibility table. */
export interface ExplainResponse {
  code: string;
  text: string;
  /** The call's ledger line, also appended to the run's ledger. Null only if the model emitted no usage. */
  entry: LedgerEntry | null;
}

/** Titles for plan courses, GET /api/catalog?codes=… (Plan carries codes only). */
export type CatalogTitles = Record<string, { title: string; units: string }>;
