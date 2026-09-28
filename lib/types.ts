// Shared contracts for every Quarterback module. Changing a type here is a cross-module change: update
// DESIGN.md in the same commit and tell the other module owners.

/** Quarter code as TritonPlan uses it: 'FA26', 'WI27', 'SP27', 'S127'… or 'XFER' for transfer credit. */
export type TermCode = string;
/** Normalized course code: upper case, one space, e.g. 'CSE 100', 'MATH 20C'. */
export type CourseCode = string;

export type Mode = 'live' | 'mock' | 'replay';

// ---------------------------------------------------------------------------------------------
// Student

export interface StudentCourse {
  code: CourseCode;
  title?: string;
  term: TermCode;
  units: number;
  /** Letter grade, 'P', 'NP', 'W', 'IP' … or null when in progress. */
  grade: string | null;
  status: 'earned' | 'wip' | 'planned';
}

export interface StudentState {
  /** Random id assigned on Save; absent for unsaved sessions. */
  id?: string;
  college: string;
  /** File name under data/college-ge, or null when unmatched. */
  collegeFile: string | null;
  major: string;
  majors: string[];
  /** File name under data/majors, or null when unmatched. */
  majorFile: string | null;
  catalogYear?: string;
  courses: StudentCourse[];
  /** Raw transfer rows exactly as the vendored parser emits them. */
  transfer: unknown[];
  gpa: number | null;
  /** The quarter in progress right now, e.g. 'FA26'. Always a parameter, never a constant. */
  currentTerm: TermCode;
  source: 'paste' | 'demo' | 'ai-intake';
  confidence: 'high' | 'medium' | 'low';
  /** What the parser could not resolve and the UI should ask about. */
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Situation → impact (deterministic)

export type Action =
  | { kind: 'drop'; course: CourseCode }
  | { kind: 'pnp'; course: CourseCode }
  | { kind: 'keep'; course: CourseCode };

export interface Deadline {
  key: 'dropWithoutW' | 'changeUnits' | 'changeGradingOption' | 'dropWithW';
  label: string;
  date: string; // ISO date
  term: TermCode;
  passed: boolean;
}

export interface BlockedCourse {
  code: CourseCode;
  title?: string;
  /** Requirement buckets (major or college) this course could fill. */
  buckets: string[];
  /** Earliest term the course is next known to be offered, or null. */
  nextOffered: TermCode | null;
  evidence: OfferingEvidence | null;
  /** Quarters of delay this action introduces for this course, best estimate. */
  delayQuarters: number;
}

export interface Impact {
  action: Action;
  course: { code: CourseCode; title?: string; units: number };
  /** Courses whose prerequisites include the affected course (direct and transitive), in the student's requirement set. */
  blocks: BlockedCourse[];
  unitsAfter: number;
  fullTimeFloor: 12;
  belowFullTime: boolean;
  /** For 'pnp': whether the requirement bucket accepts P/NP. 'unknown' when the file is silent. */
  pnpAllowed: 'yes' | 'no' | 'unknown';
  pnpNote: string;
  deadlines: Deadline[];
  /** Requirement-progress delta: buckets that lose progress if the course is dropped. */
  progressDelta: { bucket: string; band: 'major' | 'college'; before: number; after: number; needed: number }[];
  /** Longest remaining prerequisite chain, in quarters, with and without the action. */
  chainQuartersBefore: number;
  chainQuartersAfter: number;
  graduationRisk: 'none' | 'possible' | 'likely';
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// Offerings (Tavily-derived evidence)

export type OfferingStatus = 'offered' | 'tentative' | 'not_offered' | 'unknown';

export interface OfferingEvidence {
  course: CourseCode;
  term: TermCode;
  status: OfferingStatus;
  /** Verbatim line from the source (the row of the table, or the sentence). */
  quote: string;
  url: string;
  fetchedAt: string; // ISO timestamp
  instructor?: string;
  source: 'department-page' | 'schedule-of-classes' | 'cape-history';
}

// ---------------------------------------------------------------------------------------------
// Plans, verification, verdicts

export interface PlanTerm {
  term: TermCode;
  courses: CourseCode[];
  units: number;
}

export interface Plan {
  id: string;
  label: 'fastest' | 'balanced' | 'lightest' | string;
  terms: PlanTerm[];
  rationale: string;
  graduationTerm: TermCode | null;
}

export interface Violation {
  /** Stable rule id, e.g. 'prereq-unsatisfied', 'not-offered', 'unit-floor', 'unit-cap', 'duplicate', 'already-earned', 'double-count', 'graduation-infeasible', 'assumed-offered'. */
  rule: string;
  message: string;
  course?: CourseCode;
  term?: TermCode;
  severity: 'error' | 'warning';
}

export interface VerifierReport {
  planId: string;
  ok: boolean;
  violations: Violation[];
}

export interface Refusal {
  planId: string;
  reason: string;
  evidence: OfferingEvidence[];
}

export interface Verdict {
  recommend: string | null; // plan id
  refused: Refusal[];
  risks: string[];
  summary: string;
}

// ---------------------------------------------------------------------------------------------
// Approval and actions

export interface ApprovalRecord {
  id: string;
  at: string;
  planHash: string;
  planId: string;
  studentId?: string;
  overrides: { violationRule?: string; refusalPlanId?: string; reason: string; phrase: 'I understand' }[];
  ledger: LedgerEntry[];
}

/** Payload embedded in the TritonPlan import token. Small: it travels in a URL. */
export interface ImportPayload {
  v: 1;
  approvalId: string;
  issuedAt: string;
  plan: { term: TermCode; courses: CourseCode[] }[];
  label: string;
}

// ---------------------------------------------------------------------------------------------
// Models, ledger, trace

export type ModelRole = 'extract' | 'plan' | 'critic';

export interface LedgerEntry {
  at: string;
  step: string;
  model: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  usd: number;
  /** Served from fixtures (mock/replay) rather than a live call. */
  replayed: boolean;
}

export type TraceEvent =
  | { type: 'step'; step: string; at: string; message: string }
  | { type: 'model'; step: string; at: string; entry: LedgerEntry }
  | { type: 'tool_call'; step: string; at: string; name: string; args: unknown }
  | { type: 'tool_result'; step: string; at: string; name: string; ms: number; summary: string }
  | { type: 'verifier'; step: string; at: string; report: VerifierReport }
  | { type: 'waiting'; step: string; at: string; reason: 'rate-limit' | 'queue'; seconds: number }
  | { type: 'done'; step: string; at: string }
  | { type: 'error'; step: string; at: string; message: string };
