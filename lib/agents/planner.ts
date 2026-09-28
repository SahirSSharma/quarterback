// planRun: Super proposes, the verifier disposes.
//
//   planRun({state, action, impact, options, onEvent, tf})
//     → { plans, reports, rejectedDrafts, rounds, ledger }
//
// One tool loop (≤ 6 rounds, thinking on) over the context pack, then a forced submit_plans on the same history.
// Every submitted draft goes through lib/engine verify(); a draft with an error is never returned as a plan — it
// counts in rejectedDrafts and its report (ok:false) is returned so the UI can say what the code rejected.
// When no draft passes, the violations go back as a user message and the model is asked again, up to three
// submit rounds in total. Warnings ('assumed-offered', 'unit-cap' > 19.5, 'double-count') never fail a plan.
//
// TraceEvents: 'step' (context built, retry, outcome), 'model' (every call), 'tool_call' / 'tool_result' (from
// toolLoop), 'verifier' (one per draft), then 'done' or 'error'. `tf` lets tests inject a fake toolLoop / forcedTool.
import type { Action, Impact, LedgerEntry, Plan, StudentState, TraceEvent, VerifierReport } from '../types';
import { catalogByCode, catalogUnits, normalizeCode } from '../engine/data';
import { verify } from '../engine/verifier';
import type { AssistantMessage, ChatMessage } from '../tf/client';
import { forcedTool, toolLoop } from '../tf/helpers';
import { applyAction, buildPlannerContext, estimateTokens, horizonTerms } from './context';
import { type DraftPlan, plannerTools, submitPlansTool } from './tools';

export const PLAN_STEP = 'plan';
const TOOL_ROUNDS = 6;
const SUBMIT_ROUNDS = 3;
const THINKING = { enable: true, budget: 4096 } as const;
// Reasoning counts toward completion tokens and the budget is advisory: a recorded loop turn spent 6000 tokens
// thinking against a 4096 budget and hit a 6000 cap before any tool call. Leave room for the overshoot plus the calls.
const MAX_TOKENS = 8192;

export interface PlannerTF {
  toolLoop: typeof toolLoop;
  forcedTool: typeof forcedTool;
}

export interface PlanRunInput {
  state: StudentState;
  action: Action;
  impact: Impact;
  options?: { horizonTerms?: number };
  onEvent?: (event: TraceEvent) => void;
  tf?: PlannerTF;
}

export interface PlanRunResult {
  /** Only plans the verifier passed. */
  plans: Plan[];
  /** One report per submitted draft, passing and failing, in submission order. */
  reports: VerifierReport[];
  rejectedDrafts: number;
  /** submit_plans rounds used (1–3). */
  rounds: number;
  ledger: LedgerEntry[];
}

export async function planRun(input: PlanRunInput): Promise<PlanRunResult> {
  const { state, action, impact } = input;
  const tf = input.tf ?? { toolLoop, forcedTool };
  const ledger: LedgerEntry[] = [];
  const emit = (event: TraceEvent) => {
    if (event.type === 'model') ledger.push(event.entry);
    input.onEvent?.(event);
  };
  const now = () => new Date().toISOString();
  const step = (message: string) => emit({ type: 'step', step: PLAN_STEP, at: now(), message });

  try {
    // Tools and the verifier see the record as it stands once the action is taken (a dropped course is gone).
    const after = applyAction(state, action);
    const terms = horizonTerms(state, input.options?.horizonTerms);
    const ctx = buildPlannerContext(state, action, impact, { horizonTerms: terms.length });
    const k = (text: string) => `${(estimateTokens(text) / 1000).toFixed(1)}k`;
    step(`Context pack built: ${ctx.eligibility.length} courses in the table across ${terms.join(', ')}; shared prefix ≈ ${k(ctx.prefix)} tokens, student suffix ≈ ${k(ctx.suffix)} tokens.`);

    const messages: ChatMessage[] = [
      { role: 'system', content: ctx.prefix },
      { role: 'user', content: ctx.suffix },
    ];
    const loop = await tf.toolLoop('plan', {
      messages,
      tools: plannerTools(after, terms),
      maxRounds: TOOL_ROUNDS,
      thinking: THINKING,
      maxTokens: MAX_TOKENS,
      onEvent: emit,
      step: PLAN_STEP,
    });
    let history = loop.messages;

    const plans: Plan[] = [];
    const reports: VerifierReport[] = [];
    const usedIds = new Set<string>();
    let rejectedDrafts = 0;
    let round = 0;
    while (round < SUBMIT_ROUNDS) {
      round += 1;
      const { args, result } = await tf.forcedTool('plan', {
        messages: history,
        tool: submitPlansTool,
        thinking: THINKING,
        maxTokens: MAX_TOKENS,
        step: PLAN_STEP,
      });
      emit({ type: 'model', step: PLAN_STEP, at: result.entry.at, entry: result.entry });
      const drafts = args.plans.map((d) => toPlan(d, usedIds));
      const failing: VerifierReport[] = [];
      for (const plan of drafts) {
        const report = verify(plan, after);
        emit({ type: 'verifier', step: PLAN_STEP, at: now(), report });
        reports.push(report);
        if (report.ok) plans.push(plan);
        else failing.push(report);
      }
      rejectedDrafts += failing.length;
      if (plans.length >= 1 || round === SUBMIT_ROUNDS) break;
      step(`Round ${round}: the verifier rejected all ${drafts.length} draft${drafts.length === 1 ? '' : 's'}; asking for corrected plans.`);
      history = [...history, ...correction(result.message, failing)];
    }

    step(
      plans.length
        ? `${plans.length} plan${plans.length === 1 ? '' : 's'} passed the verifier; ${rejectedDrafts} draft${rejectedDrafts === 1 ? '' : 's'} rejected.`
        : `No plan passed the verifier in ${round} round${round === 1 ? '' : 's'}; ${rejectedDrafts} drafts rejected.`,
    );
    emit({ type: 'done', step: PLAN_STEP, at: now() });
    return { plans, reports, rejectedDrafts, rounds: round, ledger };
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

/** The rejected submit_plans turn, its tool result, and the user message listing every error. */
function correction(message: AssistantMessage, failing: VerifierReport[]): ChatMessage[] {
  const { reasoning: _r, reasoning_content: _rc, ...assistant } = message;
  const call = message.tool_calls?.find((tc) => tc.function.name === submitPlansTool.name);
  const lines = failing.flatMap((r) => [
    `${r.planId}:`,
    ...r.violations
      .filter((v) => v.severity === 'error')
      .map((v) => `  - [${v.rule}]${v.course ? ` ${v.course}` : ''}${v.term ? ` in ${v.term}` : ''}: ${v.message}`),
  ]);
  const user =
    `The verifier rejected every plan:\n${lines.join('\n')}\n\n` +
    'Fix each violation: move the course to a later quarter, replace it with another course from the table or from eligible_courses, or drop it — then keep every quarter at or above 12 units. ' +
    'Call submit_plans again with three corrected plans that still differ as fastest / balanced / lightest require, each with a rationale written for the student (why this plan, what it assumes), not a description of the fix.';
  return [
    ...(call ? [assistant, { role: 'tool' as const, tool_call_id: call.id, content: 'Rejected by the verifier; the violations follow.' }] : []),
    { role: 'user', content: user },
  ];
}
