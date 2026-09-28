// Response shapes of the app/api route stubs. lib/types.ts holds the domain types; these are the
// envelopes the UI reads. The agents/routes owner keeps these exact shapes when swapping the internals.
import type { Action, ApprovalRecord, Impact, LedgerEntry, Plan, StudentState, Verdict, VerifierReport } from '@/lib/types';

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

/** Titles for plan courses, GET /api/catalog?codes=… (Plan carries codes only). */
export type CatalogTitles = Record<string, { title: string; units: string }>;
