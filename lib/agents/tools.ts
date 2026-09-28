// Planner tools: zod schemas (→ JSON schema through lib/tf's jsonSchemaOf) and runners bound to one student.
// Every runner is a pure call into lib/engine that returns compact JSON; nothing here reads the clock, so a
// tool result is the same bytes in live and mock mode (the fixture key depends on it).
//
//   plannerTools(state, terms)  → LoopTool[] for the one lookup round a draft may take: eligible_courses,
//                                 check_prereqs, offering_status. Unit arithmetic and requirement progress are in
//                                 the context pack, not tools.
//   submitPlanTool              → ForcedToolSpec for the terminal submit_plan call (one plan; the strategy names it)
//   submitPlanLoopTool          → the same tool as a LoopTool, so toolLoop can end on it (`terminal`); never run
//   DraftPlan                   → what the model submits plus its label; planner.ts turns it into a Plan
import { z } from 'zod';
import type { CourseCode, StudentState, TermCode } from '../types';
import { catalogByCode, catalogUnits, normalizeCode } from '../engine/data';
import { offeringStatus } from '../engine/offerings';
import { missingGroups, prereqGroups } from '../engine/prereqs';
import { remainingCourses } from '../engine/requirements';
import { earnedCodes, inProgress } from '../engine/student';
import { jsonSchemaOf, type ForcedToolSpec, type LoopTool } from '../tf/helpers';
import { evidenceId, statusText } from './context';

const ELIGIBLE_PER_BUCKET = 12;

const termArg = z.string().describe('Quarter code, e.g. WI27');
const codeArg = z.string().describe('Course code, e.g. CSE 100');
const plannedArg = z.array(z.string()).optional().describe('Courses assumed complete before this quarter (planned in earlier quarters)');

const eligibleArgs = z.object({ term: termArg, planned: plannedArg });
const prereqArgs = z.object({ code: codeArg, term: termArg, planned: plannedArg });
const offeringArgs = z.object({ code: codeArg, term: termArg });

export const submitPlanSchema = z.object({
  terms: z.array(
    z.object({
      term: termArg,
      courses: z.array(codeArg),
      units: z.number().describe('Sum of catalog units'),
      partTime: z.boolean().optional().describe('True only when the student should take a reduced load this quarter'),
    }),
  ),
  rationale: z.string().describe('Two sentences for the student: why this plan, and what it assumes'),
  graduationTerm: z.string().nullable().describe('Estimated graduation quarter code, or null'),
});
export type SubmitArgs = z.output<typeof submitPlanSchema>;
export type DraftPlan = SubmitArgs & { label: string };

export const submitPlanTool: ForcedToolSpec<typeof submitPlanSchema> = {
  name: 'submit_plan',
  description: 'Submit the plan for the requested strategy. The verifier checks it.',
  schema: submitPlanSchema,
};

export const submitPlanLoopTool: LoopTool = {
  def: { type: 'function', function: { name: submitPlanTool.name, description: submitPlanTool.description, parameters: jsonSchemaOf(submitPlanSchema) } },
  run: () => {
    throw new Error('submit_plan ends the loop; the planner validates its arguments');
  },
};

function tool<S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.output<S>) => unknown): LoopTool {
  return {
    def: { type: 'function', function: { name, description, parameters: jsonSchemaOf(schema) } },
    run: (raw) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error(`invalid arguments: ${z.prettifyError(parsed.error)}`);
      return run(parsed.data);
    },
  };
}

const norm = (codes: string[] | undefined) => (codes ?? []).map(normalizeCode);

/** Earned + in progress + whatever the model says it has planned earlier. */
function completedBy(state: StudentState, planned?: string[]): Set<CourseCode> {
  return new Set([...earnedCodes(state), ...inProgress(state).map((c) => c.code), ...norm(planned)]);
}

export function plannerTools(state: StudentState, terms: TermCode[]): LoopTool[] {
  return [
    tool('eligible_courses', 'Courses that could fill one of the student\'s open requirements in a quarter, with prerequisites met and not marked not_offered.', eligibleArgs, ({ term, planned }) => {
      const t = term.toUpperCase();
      const done = completedBy(state, planned);
      const buckets = remainingCourses(state).map((b) => {
        const eligible = b.candidates.filter((c) => !done.has(c) && missingGroups(c, done).length === 0 && offeringStatus(c, t).status !== 'not_offered');
        return {
          band: b.band,
          label: b.label,
          remaining: `${b.remaining} ${b.kind}`,
          eligible: eligible.slice(0, ELIGIBLE_PER_BUCKET).map((c) => ({ code: c, units: catalogUnits(c), status: offeringStatus(c, t).status })),
          more: Math.max(0, eligible.length - ELIGIBLE_PER_BUCKET),
        };
      });
      return { term: t, horizon: terms, buckets };
    }),

    tool('check_prereqs', 'Whether a course\'s prerequisites are met by the record (plus any courses listed as planned earlier), and what is missing.', prereqArgs, ({ code, term, planned }) => {
      const c = normalizeCode(code);
      const missing = missingGroups(c, completedBy(state, planned));
      return { code: c, term: term.toUpperCase(), satisfied: missing.length === 0, prereqs: prereqGroups(c), missing, prereqText: catalogByCode().get(c)?.prereqText ?? null };
    }),

    tool('offering_status', 'Offering evidence for a course in a quarter: status, verbatim quote, url and fetch time, with its evidence id.', offeringArgs, ({ code, term }) => {
      const ev = offeringStatus(code, term);
      return { id: evidenceId(ev.course, ev.term), ...ev, statusText: statusText(ev) };
    }),
  ];
}
