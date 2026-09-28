// planRun: models draft, the verifier disposes, and only failing drafts are repaired.
//
//   planRun({state, action, impact, options, onEvent, tf})
//     → { plans, reports, rejectedDrafts, rounds, ledger }
//
// Phases:
//   DRAFT  — the three strategies (fastest / balanced / lightest) are drafted CONCURRENTLY, each by a model call on
//            the draft role ('extract' = Lightning, thinking off; 'plan' = Super) that may spend ONE round of lookups
//            (offering_status / check_prereqs / eligible_courses) before submit_plan. A draft that ends without a
//            valid submit_plan call is forced to make one. The context pack already carries the eligibility table
//            and the unit arithmetic, so most drafts are a single call.
//   VERIFY — lib/engine verify() on every draft; a draft with an error is never returned as a plan.
//   REPAIR — failing drafts only, concurrently, on the repair role (Super; thinking off unless reasoningEffort says
//            otherwise) as a fresh request carrying the rejected attempt, its violations and a replacement menu code
//            computed for each bad slot, at most maxRepairRounds times; a draft still failing counts in
//            rejectedDrafts and its report (ok:false) is kept so the UI can say what the code rejected.
//
// Options: draftRole, repairRole, reasoningEffort, maxRepairRounds, horizonTerms; env QB_DRAFT_ROLE and
// QB_REPAIR_EFFORT override the defaults, which come from the measurement in eval/results.md ("Planner
// configuration (measured)").
//
// TraceEvents: 'step' per phase with elapsed ms (the first one starts "Context pack built"), 'model' for every call
// (toolLoop and forcedTool emit them), 'tool_call' / 'tool_result', 'verifier' per verified draft, then 'done' or
// 'error'. Concurrent drafts interleave; the planId on each verifier event says which draft. `tf` lets tests inject
// a fake toolLoop / forcedTool.
import { z } from 'zod';
import type { Action, Impact, LedgerEntry, ModelRole, Plan, StudentState, TraceEvent, VerifierReport } from '../types';
import { catalogByCode, catalogUnits, normalizeCode } from '../engine/data';
import { verify } from '../engine/verifier';
import { BudgetExceededError } from '../tf/budget';
import type { ChatMessage, ReasoningEffort } from '../tf/client';
import { forcedTool, type Thinking, toolLoop } from '../tf/helpers';
import { resolveModel } from '../tf/models';
import { MissingFixtureError } from '../tf/replay';
import { applyAction, buildPlannerContext, estimateTokens, horizonTerms, repairBrief, STRATEGIES, type Strategy, strategyBrief } from './context';
import { type DraftPlan, plannerTools, submitPlanLoopTool, submitPlanSchema, submitPlanTool, type SubmitArgs } from './tools';

export const PLAN_STEP = 'plan';
// Super generates ≈ 200 completion tokens/s on Token Factory alone (recorded 2026-09-27: 5,767 tokens in 26.5 s,
// 6,174 in 31.9 s) and ≈ 90/s with three calls in flight, so 1,200 tokens bound a runaway thinking-on turn to 6–14 s;
// a submit_plan call itself needs ≈ 250–330 tokens (measured, thinking off).
const MAX_TOKENS = 1200;

export interface PlanOptions {
  /** Who drafts: 'extract' (Lightning, thinking off; byte-identical prefix cached) or 'plan' (Super). Env QB_DRAFT_ROLE. */
  draftRole?: ModelRole;
  /** Who repairs failing drafts. */
  repairRole?: ModelRole;
  /** reasoning_effort for 'plan'-role calls; 'none' turns thinking off. Env QB_REPAIR_EFFORT. */
  reasoningEffort?: ReasoningEffort;
  /** Repair rounds per failing draft; 0 never repairs. */
  maxRepairRounds?: number;
  horizonTerms?: number;
}

// Measured 2026-09-28 (eval/results.md, "Planner configuration (measured)"): Lightning drafts three plans in ≈ 6 s
// with the shared prefix cached; Super with thinking OFF repairs a failing draft in ≈ 2.5 s from the code-computed
// menu. Super with thinking ON is not usable here: reasoning_effort 'low' and reasoning_budget 512 both ran to the
// 1,200-token cap on every call (0 tool calls), so 'none' is the default and QB_REPAIR_EFFORT=low is an opt-in.
export const DEFAULT_OPTIONS: Required<Omit<PlanOptions, 'horizonTerms'>> = {
  draftRole: 'extract',
  repairRole: 'plan',
  reasoningEffort: 'none',
  maxRepairRounds: 2,
};

export interface PlannerTF {
  toolLoop: typeof toolLoop;
  forcedTool: typeof forcedTool;
}

export interface PlanRunInput {
  state: StudentState;
  action: Action;
  impact: Impact;
  options?: PlanOptions;
  onEvent?: (event: TraceEvent) => void;
  tf?: PlannerTF;
}

export interface PlanRunResult {
  /** Only plans the verifier passed, in strategy order (fastest, balanced, lightest). */
  plans: Plan[];
  /** One report per verified draft, passing and failing: the draft phase first, then each repair round. */
  reports: VerifierReport[];
  /** Verified drafts that failed (= reports with ok:false). */
  rejectedDrafts: number;
  /** 1 for the draft phase plus one per repair round run. */
  rounds: number;
  ledger: LedgerEntry[];
}

const ROLES: ModelRole[] = ['extract', 'plan', 'critic'];
const EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

function fromEnv<T extends string>(name: string, allowed: T[]): T | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (!allowed.includes(raw as T)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got '${raw}'`);
  return raw as T;
}

/** Explicit option, else the env override, else the measured default. Read per run so tests can stub the env. */
export function resolveOptions(options: PlanOptions = {}): Required<Omit<PlanOptions, 'horizonTerms'>> {
  return {
    draftRole: options.draftRole ?? fromEnv('QB_DRAFT_ROLE', ROLES) ?? DEFAULT_OPTIONS.draftRole,
    repairRole: options.repairRole ?? DEFAULT_OPTIONS.repairRole,
    reasoningEffort: options.reasoningEffort ?? fromEnv('QB_REPAIR_EFFORT', EFFORTS) ?? DEFAULT_OPTIONS.reasoningEffort,
    maxRepairRounds: options.maxRepairRounds ?? DEFAULT_OPTIONS.maxRepairRounds,
  };
}

/** Lightning never thinks (the client forces it off for 'extract'); Super thinks unless the effort is 'none'. */
function thinkingFor(role: ModelRole, effort: ReasoningEffort): Thinking {
  return role === 'extract' || effort === 'none' ? { enable: false } : { enable: true, effort };
}

function modelName(role: ModelRole): string {
  const id = resolveModel(role).id;
  return /lightning/i.test(id) ? 'Nemotron 3.5 Lightning' : /super/i.test(id) ? 'Nemotron 3 Super' : /ultra/i.test(id) ? 'Nemotron 3 Ultra' : /nano/i.test(id) ? 'Nemotron 3 Nano' : id;
}

const describeThinking = (t: Thinking) => (t.enable ? `thinking on, reasoning_effort ${t.effort}` : 'thinking off');
const ms = (since: number) => `${(Date.now() - since).toLocaleString('en-US')} ms`;
const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A fatal error ends the run: the spend cap (the app flips to replay on it) and a missing fixture (mock mode fails loudly). */
function fatal(e: unknown): boolean {
  const name = (e as Error)?.name;
  return e instanceof BudgetExceededError || e instanceof MissingFixtureError || name === 'BudgetExceededError' || name === 'MissingFixtureError';
}

/** A submitted draft, waiting for the verifier. */
interface Submission {
  label: Strategy;
  plan: Plan;
}

type Parsed = { ok: true; value: SubmitArgs } | { ok: false; error: string };
function parseSubmit(raw: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  const r = submitPlanSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

export async function planRun(input: PlanRunInput): Promise<PlanRunResult> {
  const { state, action, impact } = input;
  const opts = resolveOptions(input.options);
  const tf = input.tf ?? { toolLoop, forcedTool };
  const ledger: LedgerEntry[] = [];
  const emit = (event: TraceEvent) => {
    if (event.type === 'model') ledger.push(event.entry);
    input.onEvent?.(event);
  };
  const now = () => new Date().toISOString();
  const step = (message: string) => emit({ type: 'step', step: PLAN_STEP, at: now(), message });
  const t0 = Date.now();

  try {
    // Tools and the verifier see the record as it stands once the action is taken (a dropped course is gone).
    const after = applyAction(state, action);
    const terms = horizonTerms(state, input.options?.horizonTerms);
    const ctx = buildPlannerContext(state, action, impact, { horizonTerms: terms.length });
    const tools = [...plannerTools(after, terms), submitPlanLoopTool];
    const draftThinking = thinkingFor(opts.draftRole, opts.reasoningEffort);
    const repairThinking = thinkingFor(opts.repairRole, opts.reasoningEffort);
    const usedIds = new Set<string>();
    const plans = new Map<Strategy, Plan>();
    const reports: VerifierReport[] = [];

    const judge = (s: Submission): boolean => {
      const report = verify(s.plan, after);
      emit({ type: 'verifier', step: PLAN_STEP, at: now(), report });
      reports.push(report);
      if (report.ok) plans.set(s.label, s.plan);
      return report.ok;
    };
    /** A draft whose model call failed is a rejected draft with a report saying why, never a crash of the whole run. */
    const failed = (label: Strategy, e: unknown): void => {
      const report: VerifierReport = {
        planId: toPlan({ label, terms: [], rationale: '', graduationTerm: null }, usedIds).id,
        ok: false,
        violations: [{ rule: 'model-error', severity: 'error', message: `The ${label} draft produced no valid plan: ${e instanceof Error ? e.message : String(e)}` }],
      };
      emit({ type: 'verifier', step: PLAN_STEP, at: now(), report });
      reports.push(report);
    };
    /** Runs the drafts or repairs of one phase concurrently; fatal errors end the run once every call has settled. */
    const phase = async (jobs: { label: Strategy; run: () => Promise<Submission> }[]): Promise<Submission[]> => {
      const settled = await Promise.allSettled(jobs.map((j) => j.run()));
      const abort = settled.find((r) => r.status === 'rejected' && fatal(r.reason));
      if (abort && abort.status === 'rejected') throw abort.reason;
      const failing: Submission[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'rejected') failed(jobs[i].label, r.reason);
        else if (!judge(r.value)) failing.push(r.value);
      });
      return failing;
    };

    const draft = async (label: Strategy): Promise<Submission> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: ctx.prefix },
        { role: 'user', content: `${ctx.suffix}\n\n${strategyBrief(label)}` },
      ];
      const loop = await tf.toolLoop(opts.draftRole, { messages, tools, maxRounds: 1, terminal: [submitPlanTool.name], thinking: draftThinking, maxTokens: MAX_TOKENS, onEvent: emit, step: PLAN_STEP });
      const direct = loop.terminal ? parseSubmit(loop.terminal.function.arguments) : null;
      if (loop.terminal && direct?.ok) return { label, plan: toPlan({ label, ...direct.value }, usedIds) };
      // No submit_plan yet (a lookup round, or prose), or one with bad arguments: force the call on the same history.
      const history: ChatMessage[] = loop.terminal && direct && !direct.ok
        ? [...loop.messages, { role: 'tool', tool_call_id: loop.terminal.id, content: `Arguments rejected: ${direct.error}\nCall submit_plan again with corrected arguments.` }]
        : loop.messages;
      const { args } = await tf.forcedTool(opts.draftRole, { messages: history, tool: submitPlanTool, thinking: draftThinking, maxTokens: MAX_TOKENS, onEvent: emit, step: PLAN_STEP });
      return { label, plan: toPlan({ label, ...args }, usedIds) };
    };

    // A repair is a fresh request — the same prefix and suffix, then the rejected attempt with its violations — not a
    // continuation: a thinking-off model given its own submit_plan call in the history copied it verbatim (measured).
    const repair = async (s: Submission, report: VerifierReport, round: number): Promise<Submission> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: ctx.prefix },
        { role: 'user', content: `${ctx.suffix}\n\n${strategyBrief(s.label)}\n\n${repairBrief(s.label, s.plan, report, after, round)}` },
      ];
      const { args } = await tf.forcedTool(opts.repairRole, { messages, tool: submitPlanTool, thinking: repairThinking, maxTokens: MAX_TOKENS, onEvent: emit, step: PLAN_STEP });
      return { label: s.label, plan: toPlan({ label: s.label, ...args }, usedIds) };
    };

    // DRAFT + VERIFY
    const k = (text: string) => `${(estimateTokens(text) / 1000).toFixed(1)}k`;
    step(
      `Context pack built: ${ctx.eligibility.length} courses in the table across ${terms.join(', ')}; shared prefix ≈ ${k(ctx.prefix)} tokens, student suffix ≈ ${k(ctx.suffix)} tokens. ` +
        `Drafting ${STRATEGIES.length} plans in parallel on ${modelName(opts.draftRole)} (${describeThinking(draftThinking)}), one lookup round allowed before submit_plan.`,
    );
    const tDraft = Date.now();
    let failing = await phase(STRATEGIES.map((label) => ({ label, run: () => draft(label) })));
    let rounds = 1;
    step(`Drafted ${n(STRATEGIES.length, 'plan')} in ${ms(tDraft)}: ${plans.size} passed the verifier, ${reports.length - plans.size} rejected.`);

    // REPAIR
    let judged: number = STRATEGIES.length; // drafts verified in the previous phase
    while (failing.length && rounds <= opts.maxRepairRounds) {
      const round = rounds;
      step(
        `Round ${round}: the verifier rejected ${failing.length} of ${judged} ${round === 1 ? 'drafts' : 'repaired drafts'}; ` +
          `repairing ${failing.map((s) => s.label).join(', ')} on ${modelName(opts.repairRole)} (${describeThinking(repairThinking)}).`,
      );
      const tRepair = Date.now();
      judged = failing.length;
      failing = await phase(failing.map((s) => ({ label: s.label, run: () => repair(s, reports.find((r) => r.planId === s.plan.id) as VerifierReport, round) })));
      rounds += 1;
      step(`Repair round ${round} done in ${ms(tRepair)}: ${judged - failing.length} passed, ${failing.length} still failing.`);
    }

    const rejectedDrafts = reports.filter((r) => !r.ok).length;
    const ordered = STRATEGIES.flatMap((label) => (plans.has(label) ? [plans.get(label) as Plan] : []));
    step(
      ordered.length
        ? `${n(ordered.length, 'plan')} passed the verifier in ${ms(t0)}; ${n(rejectedDrafts, 'draft')} rejected.`
        : `No plan passed the verifier in ${n(rounds, 'round')} (${ms(t0)}); ${n(rejectedDrafts, 'draft')} rejected.`,
    );
    emit({ type: 'done', step: PLAN_STEP, at: now() });
    return { plans: ordered, reports, rejectedDrafts, rounds, ledger };
  } catch (e) {
    emit({ type: 'error', step: PLAN_STEP, at: now(), message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** A submitted draft as a Plan: stable id from the label, normalized codes and terms, catalog units where fixed. */
export function toPlan(draft: DraftPlan, used: Set<string>): Plan {
  const label = draft.label.trim().toLowerCase() || 'plan';
  const base = `p-${label.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  const terms = draft.terms.map((t) => {
    const courses = t.courses.map(normalizeCode);
    // The verifier trusts the model's unit count only for unknown / variable-unit courses; mirror that here.
    const fixed = courses.length > 0 && courses.every((c) => /^\d+(\.\d+)?$/.test(catalogByCode().get(c)?.units ?? ''));
    const units = fixed ? courses.reduce((n, c) => n + (catalogUnits(c) ?? 0), 0) : t.units;
    return { term: t.term.toUpperCase(), courses, units, ...(t.partTime ? { partTime: true } : {}) };
  });
  return { id, label, terms, rationale: draft.rationale, graduationTerm: draft.graduationTerm ? draft.graduationTerm.toUpperCase() : null };
}
