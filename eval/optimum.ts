// A reference for "how much requirement progress could this student have made?" so E1 can score a plan against
// something other than another plan.
//
//   openSlots(state)                 → open requirement slots still to fill (courses; a units bucket counts ceil(remaining/4))
//   planProgress(state, plan)        → slots a plan closes, in total and per term, scored by the engine's own allocator
//   optimum(state, terms, {unitCap}) → greedy reference plan under the verifier's hard rules, scored the same way
//
// Approximation, stated plainly: per quarter, the eligible courses (prerequisites met by earned + in-progress +
// earlier optimum quarters, not `not_offered`, one fixed unit value, not on the record) are taken cheapest-units
// first while each still has an open slot in some bucket and the quarter stays at or under the cap (22, the
// verifier's error line; 19.5 only warns). That maximises the COUNT of slot-filling courses in the quarter but
// (a) assigns a multi-bucket course to the scarcest bucket by a heuristic rather than a matching, (b) does not
// look ahead — a course taken now for one slot may have unlocked more later — and (c) ignores unknown-status
// evidence, exactly as verify() lets a plan through with a warning. So it is a strong greedy reference, not a
// proven maximum; a plan can beat it on a term in rare cases, and the E1 ratio is reported as such.
import type { CourseCode, Plan, PlanTerm, StudentState, TermCode } from '../lib/types';
import { catalogByCode, catalogUnits, normalizeCode } from '../lib/engine/data';
import { offeringStatus } from '../lib/engine/offerings';
import { missingGroups } from '../lib/engine/prereqs';
import { type BucketProgress, bucketProgress } from '../lib/engine/requirements';
import { earnedCodes, inProgress } from '../lib/engine/student';
import { compare } from '../lib/engine/terms';
import { UNIT_CAP_ERROR } from '../lib/engine/verifier';

const slotsOf = (p: BucketProgress) => (p.kind === 'units' ? Math.ceil(p.remaining / 4) : p.remaining);

export function openSlots(state: StudentState): number {
  return bucketProgress(state).reduce((n, p) => n + slotsOf(p), 0);
}

/** The student with `codes` added as earned rows in `term` (the same shape the planner's tools score a draft with). */
function withCourses(state: StudentState, term: TermCode, codes: CourseCode[]): StudentState {
  const onRecord = new Set(state.courses.map((c) => c.code));
  const added = codes
    .map(normalizeCode)
    .filter((code) => !onRecord.has(code))
    .map((code) => ({ code, term, units: catalogUnits(code) ?? 4, grade: null, status: 'earned' as const }));
  return { ...state, courses: [...state.courses, ...added] };
}

export interface ProgressResult {
  total: number;
  perTerm: { term: TermCode; slots: number }[];
}

export function planProgress(state: StudentState, plan: Pick<Plan, 'terms'>): ProgressResult {
  let cur = state;
  let before = openSlots(cur);
  const perTerm: ProgressResult['perTerm'] = [];
  for (const t of [...plan.terms].sort((a, b) => compare(a.term, b.term))) {
    cur = withCourses(cur, String(t.term).toUpperCase(), t.courses);
    const after = openSlots(cur);
    perTerm.push({ term: String(t.term).toUpperCase(), slots: before - after });
    before = after;
  }
  return { total: perTerm.reduce((n, p) => n + p.slots, 0), perTerm };
}

const FIXED_UNITS = /^\d+(\.\d+)?$/;

export interface OptimumResult extends ProgressResult {
  plan: PlanTerm[];
}

export function optimum(state: StudentState, terms: TermCode[], opts: { unitCap?: number } = {}): OptimumResult {
  const cap = opts.unitCap ?? UNIT_CAP_ERROR;
  const rolling = new Set([...earnedCodes(state), ...inProgress(state).map((c) => c.code)]);
  const onRecord = new Set(state.courses.map((c) => c.code));
  let cur = state;
  const plan: PlanTerm[] = [];
  for (const term of terms) {
    const open = bucketProgress(cur).filter((p) => p.remaining > 0);
    const slots = new Map(open.map((p) => [`${p.band}:${p.label}`, slotsOf(p)]));
    const listed = new Map<CourseCode, string[]>();
    for (const p of open) for (const c of p.candidates) listed.set(c, [...(listed.get(c) ?? []), `${p.band}:${p.label}`]);
    const eligible = [...listed.keys()]
      .filter((c) => {
        const cat = catalogByCode().get(c);
        return cat && FIXED_UNITS.test(cat.units) && (catalogUnits(c) ?? 0) > 0 && !onRecord.has(c) && !rolling.has(c)
          && missingGroups(c, rolling).length === 0 && offeringStatus(c, term).status !== 'not_offered';
      })
      .sort((a, b) => (catalogUnits(a) ?? 0) - (catalogUnits(b) ?? 0) || (listed.get(a)?.length ?? 0) - (listed.get(b)?.length ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    const picked: CourseCode[] = [];
    let units = 0;
    for (const c of eligible) {
      const u = catalogUnits(c) ?? 0;
      if (units + u > cap) continue;
      // Scarcest open bucket first: the one with the fewest still-eligible alternatives.
      const keys = (listed.get(c) ?? []).filter((k) => (slots.get(k) ?? 0) > 0);
      if (!keys.length) continue;
      const key = keys.sort((x, y) => open.find((p) => `${p.band}:${p.label}` === x)!.candidates.length - open.find((p) => `${p.band}:${p.label}` === y)!.candidates.length)[0];
      slots.set(key, (slots.get(key) ?? 0) - 1);
      picked.push(c);
      units += u;
    }
    plan.push({ term, courses: picked, units });
    cur = withCourses(cur, term, picked);
    for (const c of picked) rolling.add(c);
  }
  const scored = planProgress(state, { terms: plan });
  return { ...scored, plan };
}
