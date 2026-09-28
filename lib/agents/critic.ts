// stressTest: Ultra reads the verifier-approved plans plus the offering evidence and either recommends a plan or
// refuses one with evidence. The model cites evidence by id; the quote the student sees is ALWAYS the stored
// OfferingEvidence resolved from `evidenceIndex`, never model text.
//
//   stressTest({state, plans, reports, evidenceIndex, onEvent, tf}) → Verdict
//   resolveVerdict(args, plans, evidenceIndex)                       → the post-processing, exported for tests:
//       unknown ids are dropped (and noted as a risk); a refusal with no resolved evidence becomes a risk; a
//       refusal of an unknown plan becomes a risk; `recommend` must be a shown, non-refused plan or null
//   verdictCacheKey(plans, evidenceIndex)                            → sha256(planset + evidence ids) for the caller's cache
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Action, CourseCode, OfferingEvidence, Plan, Refusal, StudentState, TermCode, TraceEvent, Verdict, VerifierReport } from '../types';
import { catalogUnits, normalizeCode } from '../engine/data';
import { prereqGroups } from '../engine/prereqs';
import { earnedCodes, inProgress } from '../engine/student';
import { compare } from '../engine/terms';
import { readOfferingsFile } from '../offerings/build';
import type { ChatMessage } from '../tf/client';
import { type ForcedToolSpec, forcedTool } from '../tf/helpers';
import { stableStringify } from '../tf/replay';
import { applyAction, evidenceId, parseEvidenceId, statusText } from './context';

export const CRITIC_STEP = 'stress-test';
// Ultra with reasoning_effort 'high' and no budget deliberated past 6000 tokens over 45 evidence rows and never
// reached the forced call (recorded 2026-09-27: finish_reason 'length', reasoning in `content`). The budget makes
// it conclude; max_tokens leaves room for the verdict after it.
const THINKING = { enable: true, effort: 'high', budget: 3072 } as const;
const MAX_TOKENS = 8192;
const QUOTE_CHARS = 200;

export const submitVerdictSchema = z.object({
  recommend: z.string().nullable().describe('planId to recommend, or null when every plan is refused'),
  refused: z.array(
    z.object({
      planId: z.string(),
      reason: z.string().describe('Two or three sentences for the student'),
      evidenceIds: z.array(z.string()).describe('Evidence ids (ev_CODE_QUARTER) from the evidence table that justify the refusal; at least one'),
    }),
  ),
  risks: z.array(z.string()).describe('Risks the student should know about that do not refuse a plan; one sentence each, naming the plan'),
  summary: z.string().describe('Two or three sentences for the student'),
});
export type VerdictArgs = z.output<typeof submitVerdictSchema>;

export const submitVerdictTool: ForcedToolSpec<typeof submitVerdictSchema> = {
  name: 'submit_verdict',
  description: 'Submit the stress-test verdict: one recommended plan (or null), refusals with evidence ids, risks and a summary.',
  schema: submitVerdictSchema,
};

export interface StressInput {
  state: StudentState;
  /** The action the plans were made for; a drop is applied to the record shown to the critic. */
  action?: Action;
  plans: Plan[];
  reports: VerifierReport[];
  evidenceIndex: Record<string, OfferingEvidence>;
  onEvent?: (event: TraceEvent) => void;
  tf?: { forcedTool: typeof forcedTool };
}

const SYSTEM = `You are Quarterback's stress-tester for UC San Diego degree plans. Deterministic code has already verified every plan below (prerequisites, units, requirements, offerings). Your job is cross-quarter feasibility under uncertainty: which plan the student should trust, and which must be refused.

Evidence: the table lists, for each planned course and quarter, a status with an evidence id (ev_<CODE>_<QUARTER>), the source and the verbatim quote. Statuses: "offered" or "tentative" — a department page or the Schedule of Classes lists the course; "not_offered" — the department page has no instructor for that quarter; "unknown (not on dept page)" — the department's page covers that quarter and has no row for the course at all; plain "unknown" — nobody publishes anything for that quarter (beyond the page's published year, or a department with no page; the quote says what was consulted).

REFUSE a plan — list it in refused with at least one evidence id — when BOTH hold:
1. It places a course in a quarter whose evidence status is "not_offered" or "unknown (not on dept page)".
2. That course is load-bearing: a later course in the same plan needs it as a prerequisite, or it is why the plan graduates earlier than another plan, or moving it to its next evidenced quarter would push the plan's graduation quarter.
Cite evidence by id only. Never write a quote yourself; the student sees the stored quote, url and fetch time for each id you cite. Write each refusal's reason for that plan specifically.

Do NOT refuse for: plain "unknown" in a quarter beyond the published page or in a department with no page (a risk: name the course and quarter to re-check); a course whose status is offered on a page that calls itself tentative (a risk); unit loads within the cap; anything the next Schedule of Classes will settle (a risk).

Recommend exactly one plan that is not refused: the one whose placements have the most evidence; when tied, the balanced plan. Recommend null only when every plan is refused. Every plan that is neither recommended nor refused needs at least one risk line naming what to re-check. The summary is two or three plain sentences for the student.

Be decisive: check each plan against the two refusal conditions, decide, and call submit_verdict. Do not re-derive the evidence table.`;

function renderStudent(state: StudentState): string {
  const wip = inProgress(state).map((c) => c.code);
  return [
    `College: ${state.college || '(unknown)'}; major: ${state.major || '(unknown)'}; current quarter ${state.currentTerm}.`,
    `Earned: ${[...earnedCodes(state)].sort().join(', ') || 'nothing yet'}.`,
    `In progress (${state.currentTerm}): ${wip.join(', ') || 'nothing'}.`,
  ].join('\n');
}

/** Each prerequisite group of a planned course with what satisfies it: earned, in progress, an earlier planned quarter, or UNMET. */
function renderPrereqs(plan: Plan, state: StudentState): string {
  const earned = earnedCodes(state);
  const wip = new Set(inProgress(state).map((c) => c.code));
  const plannedIn = new Map<CourseCode, TermCode>();
  for (const t of plan.terms) for (const c of t.courses) plannedIn.set(normalizeCode(c), t.term);
  const lines: string[] = [];
  for (const t of [...plan.terms].sort((a, b) => compare(a.term, b.term))) {
    for (const raw of t.courses) {
      const code = normalizeCode(raw);
      const groups = prereqGroups(code);
      if (!groups.length) continue;
      const parts = groups.map((g) => {
        const by = g.find((m) => earned.has(m)) ?? g.find((m) => wip.has(m)) ?? g.find((m) => plannedIn.has(m) && compare(plannedIn.get(m) as TermCode, t.term) < 0);
        const how = !by ? 'UNMET' : earned.has(by) ? `${by} earned` : wip.has(by) ? `${by} in progress` : `${by} planned ${plannedIn.get(by)}`;
        return `${g.join('|')} ← ${how}`;
      });
      lines.push(`${code} (${t.term}): ${parts.join(' & ')}`);
    }
  }
  return lines.join('\n') || '(no prerequisites among the planned courses)';
}

function renderPlan(plan: Plan, report: VerifierReport | undefined, state: StudentState): string {
  const terms = plan.terms.map((t) => `${t.term} (${t.units}u${t.partTime ? ', part-time' : ''}): ${t.courses.join(', ')}`);
  const verifier = report
    ? report.violations.length
      ? report.violations.map((v) => `[${v.rule}/${v.severity}]${v.course ? ` ${v.course}` : ''}${v.term ? ` ${v.term}` : ''}: ${v.message}`).join('\n  ')
      : 'ok, no warnings'
    : 'no report';
  return [
    `### ${plan.id} (${plan.label}) — graduation ${plan.graduationTerm ?? 'not estimated'}`,
    ...terms,
    `Rationale: ${plan.rationale}`,
    `Verifier: ${verifier}`,
    `Prerequisites:\n${renderPrereqs(plan, state)}`,
  ].join('\n');
}

function renderEvidence(index: Record<string, OfferingEvidence>): string {
  const ids = Object.keys(index).sort();
  return ids
    .map((id) => {
      const e = index[id];
      const quote = e.quote.replace(/\s+/g, ' ').trim();
      return `${id} | ${e.course} ${e.term} | ${statusText(e)} | ${e.source}${e.instructor ? ` (${e.instructor})` : ''} | fetched ${e.fetchedAt.slice(0, 10)} | "${quote.length > QUOTE_CHARS ? `${quote.slice(0, QUOTE_CHARS)}…` : quote}"`;
    })
    .join('\n');
}

function renderCaveats(plans: Plan[]): string {
  const depts = [...new Set(plans.flatMap((p) => p.terms.flatMap((t) => t.courses.map((c) => normalizeCode(c).split(' ')[0]))))].sort();
  const withPage: string[] = [];
  const without: string[] = [];
  for (const d of depts) {
    const file = readOfferingsFile(d);
    if (!file) {
      without.push(d);
      continue;
    }
    withPage.push(`${d}: publishes ${file.terms.join(', ')} (${file.sourceUrl}); ${file.disclaimer ? `page caveat: "${file.disclaimer}"` : 'no caveat on the page'}`);
  }
  return [
    ...withPage,
    without.length ? `No offerings page on file for: ${without.join(', ')} (unknown status there is a risk, not a refusal).` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function verdictCacheKey(plans: Plan[], evidenceIndex: Record<string, OfferingEvidence>): string {
  const planset = plans.map((p) => ({ id: p.id, label: p.label, terms: p.terms, graduationTerm: p.graduationTerm }));
  return createHash('sha256').update(stableStringify({ planset, evidence: Object.keys(evidenceIndex).sort() })).digest('hex');
}

export function resolveVerdict(args: VerdictArgs, plans: Plan[], index: Record<string, OfferingEvidence>): Verdict {
  const known = new Set(plans.map((p) => p.id));
  const risks = [...args.risks];
  const refused: Refusal[] = [];
  const lookup = (id: string): OfferingEvidence | undefined => {
    const direct = index[id.trim()];
    if (direct) return direct;
    const parsed = parseEvidenceId(id);
    return parsed ? index[evidenceId(parsed.code, parsed.term)] : undefined;
  };
  for (const r of args.refused) {
    if (!known.has(r.planId)) {
      risks.push(`${r.reason} (the model named plan "${r.planId}", which is not one of the plans shown)`);
      continue;
    }
    const evidence: OfferingEvidence[] = [];
    const unknownIds: string[] = [];
    for (const id of r.evidenceIds) {
      const ev = lookup(id);
      if (!ev) unknownIds.push(id);
      else if (!evidence.includes(ev)) evidence.push(ev);
    }
    if (!evidence.length) {
      // No stored evidence, no refusal: the student never sees a refusal the code cannot back with a quote.
      risks.push(`${r.planId}: ${r.reason} (downgraded from a refusal: no stored evidence supports it${unknownIds.length ? `; unknown evidence ids ${unknownIds.join(', ')}` : ''})`);
      continue;
    }
    if (unknownIds.length) risks.push(`Evidence ids not on file were ignored for ${r.planId}: ${unknownIds.join(', ')}.`);
    refused.push({ planId: r.planId, reason: r.reason, evidence });
  }
  const refusedIds = new Set(refused.map((r) => r.planId));
  const recommend = args.recommend && known.has(args.recommend) && !refusedIds.has(args.recommend) ? args.recommend : null;
  return { recommend, refused, risks, summary: args.summary };
}

export async function stressTest(input: StressInput): Promise<Verdict> {
  const { plans, reports, evidenceIndex } = input;
  const state = input.action ? applyAction(input.state, input.action) : input.state;
  const tf = input.tf ?? { forcedTool };
  const emit = input.onEvent ?? (() => {});
  const now = () => new Date().toISOString();
  try {
    emit({ type: 'step', step: CRITIC_STEP, at: now(), message: `Stress-testing ${plans.length} plan${plans.length === 1 ? '' : 's'} against ${Object.keys(evidenceIndex).length} evidence rows.` });
    const user = [
      '## Student',
      renderStudent(state),
      '## Plans (all passed the verifier)',
      plans.map((p) => renderPlan(p, reports.find((r) => r.planId === p.id), state)).join('\n\n'),
      '## Evidence (cite by id)',
      renderEvidence(evidenceIndex),
      '## Department offerings pages on file',
      renderCaveats(plans),
      `Catalog units: ${[...new Set(plans.flatMap((p) => p.terms.flatMap((t) => t.courses)))].sort().map((c) => `${c}=${catalogUnits(c) ?? '?'}`).join(', ')}.`,
      'Call submit_verdict.',
    ].join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ];
    const { args, result } = await tf.forcedTool('critic', {
      messages,
      tool: submitVerdictTool,
      thinking: THINKING,
      maxTokens: MAX_TOKENS,
      step: CRITIC_STEP,
    });
    emit({ type: 'model', step: CRITIC_STEP, at: result.entry.at, entry: result.entry });
    const verdict = resolveVerdict(args, plans, evidenceIndex);
    emit({
      type: 'step',
      step: CRITIC_STEP,
      at: now(),
      message: `${verdict.recommend ? `Recommends ${verdict.recommend}` : 'Recommends no plan'}; refused ${verdict.refused.length}; ${verdict.risks.length} risk${verdict.risks.length === 1 ? '' : 's'}.`,
    });
    emit({ type: 'done', step: CRITIC_STEP, at: now() });
    return verdict;
  } catch (e) {
    emit({ type: 'error', step: CRITIC_STEP, at: now(), message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
