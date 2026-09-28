// Planner tools: zod schemas (→ JSON schema through lib/tf's jsonSchemaOf) and runners bound to one student.
// Every runner is a pure call into lib/engine that returns compact JSON; nothing here reads the clock, so a
// tool result is the same bytes in live and mock mode (the fixture key depends on it).
//
//   plannerTools(state, terms)  → LoopTool[] for toolLoop: eligible_courses, check_prereqs, requirement_progress,
//                                 offering_status, unit_check, grade_history
//   submitPlansTool             → ForcedToolSpec for the terminal submit_plans call (plans without ids)
//   DraftPlan                   → what the model submits; planner.ts turns it into a Plan
import { z } from 'zod';
import type { CourseCode, StudentState, TermCode } from '../types';
import { catalogByCode, catalogUnits, grades, normalizeCode } from '../engine/data';
import { offeringStatus } from '../engine/offerings';
import { missingGroups, prereqGroups } from '../engine/prereqs';
import { bucketProgress, remainingCourses } from '../engine/requirements';
import { earnedCodes, inProgress } from '../engine/student';
import { UNIT_CAP_ERROR, UNIT_CAP_WARNING, UNIT_FLOOR } from '../engine/verifier';
import { jsonSchemaOf, type ForcedToolSpec, type LoopTool } from '../tf/helpers';
import { evidenceId, statusText } from './context';

const ELIGIBLE_PER_BUCKET = 12;

const termArg = z.string().describe('Quarter code, e.g. WI27');
const codeArg = z.string().describe('Course code, e.g. CSE 100');
const plannedArg = z.array(z.string()).optional().describe('Courses assumed complete before this quarter (planned in earlier quarters)');
const draftTerms = z.array(z.object({ term: termArg, courses: z.array(codeArg) }));

const eligibleArgs = z.object({ term: termArg, planned: plannedArg });
const prereqArgs = z.object({ code: codeArg, term: termArg, planned: plannedArg });
const planArgs = z.object({ plan: draftTerms });
const offeringArgs = z.object({ code: codeArg, term: termArg });
const gradeArgs = z.object({ code: codeArg });

export const draftPlanSchema = z.object({
  label: z.string().describe('fastest | balanced | lightest'),
  terms: z.array(
    z.object({
      term: termArg,
      courses: z.array(codeArg),
      units: z.number().describe('Sum of catalog units'),
      partTime: z.boolean().optional().describe('True only when the student should take a reduced load this quarter'),
    }),
  ),
  rationale: z.string().describe('Two sentences: why this plan, and what it assumes'),
  graduationTerm: z.string().nullable().describe('Estimated graduation quarter code, or null'),
});
export type DraftPlan = z.output<typeof draftPlanSchema>;

export const submitPlansSchema = z.object({ plans: z.array(draftPlanSchema).min(1).max(3) });

export const submitPlansTool: ForcedToolSpec<typeof submitPlansSchema> = {
  name: 'submit_plans',
  description: 'Submit the final plans (at most three, labelled fastest / balanced / lightest). The verifier checks each one.',
  schema: submitPlansSchema,
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

/** The student with a draft's courses added as earned, so the requirement engine can score the draft. */
function withPlan(state: StudentState, plan: z.output<typeof draftTerms>): StudentState {
  const onRecord = new Set(state.courses.map((c) => c.code));
  const added = plan.flatMap((t) =>
    norm(t.courses)
      .filter((code) => !onRecord.has(code))
      .map((code) => ({ code, term: t.term.toUpperCase(), units: catalogUnits(code) ?? 4, grade: null, status: 'earned' as const })),
  );
  return { ...state, courses: [...state.courses, ...added] };
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

    tool('requirement_progress', 'Requirement progress if the draft plan were completed: each open bucket with what it still needs afterwards.', planArgs, ({ plan }) => {
      const before = bucketProgress(state);
      const after = bucketProgress(withPlan(state, plan));
      const rows = before
        .filter((b) => b.remaining > 0)
        .map((b) => {
          const a = after.find((x) => x.band === b.band && x.label === b.label);
          return { band: b.band, label: b.label, needed: b.needed, kind: b.kind, remainingBefore: b.remaining, remainingAfter: a?.remaining ?? b.remaining };
        });
      return { buckets: rows, stillOpen: rows.filter((r) => r.remainingAfter > 0).length };
    }),

    tool('offering_status', 'Offering evidence for a course in a quarter: status, verbatim quote, url and fetch time, with its evidence id.', offeringArgs, ({ code, term }) => {
      const ev = offeringStatus(code, term);
      return { id: evidenceId(ev.course, ev.term), ...ev, statusText: statusText(ev) };
    }),

    tool('unit_check', 'Catalog units per quarter of a draft plan against the 12-unit floor and the 19.5 / 22 unit caps.', planArgs, ({ plan }) => ({
      terms: plan.map((t) => {
        const codes = norm(t.courses);
        const unknown = codes.filter((c) => catalogUnits(c) === null);
        const units = codes.reduce((n, c) => n + (catalogUnits(c) ?? 0), 0);
        return {
          term: t.term.toUpperCase(),
          courses: codes.length,
          units,
          floor: units < UNIT_FLOOR ? `below the ${UNIT_FLOOR}-unit floor (error unless partTime)` : 'ok',
          cap: units > UNIT_CAP_ERROR ? `above ${UNIT_CAP_ERROR} (rejected)` : units > UNIT_CAP_WARNING ? `above ${UNIT_CAP_WARNING} (warning)` : 'ok',
          ...(unknown.length ? { unknownUnits: unknown } : {}),
        };
      }),
    })),

    tool('grade_history', 'CAPE grade history for a course: average grade, students and quarters on record, last quarter evaluated.', gradeArgs, ({ code }) => {
      const c = normalizeCode(code);
      const g = grades()[c];
      return g ? { code: c, averageGrade: g.l, gradePoints: g.p, students: g.n, quarters: g.q, lastEvaluated: g.lq } : { code: c, history: null };
    }),
  ];
}
