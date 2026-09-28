// greedyPlan(state, action, {horizonTerms}): the code-built plan shown when no model draft survives the verifier,
// so a student never leaves with nothing. Quarter by quarter it fills 12–16 units with courses that (a) sit in an
// open requirement bucket of the major or college, (b) have every prerequisite complete in an EARLIER quarter
// (earned, in progress, or planned earlier in this plan), (c) are not marked not_offered for the quarter, and
// (d) are not on the record. Within a quarter: the courses that unblock the most courses still on the requirement
// path first, then the ones a bucket cannot do without (as many candidates as it still needs — a required course, a
// fixed sequence) before electives, then the strongest offering evidence, then code; one seat per open requirement
// slot, so two alternatives for one requirement are never both planned. Every rule mirrors verify(), so the plan
// passes it by construction (fallback-plan.test.ts asserts that); deterministic given the data snapshot.
import type { Action, CourseCode, OfferingEvidence, Plan, PlanTerm, StudentState, TermCode } from '../types';
import { catalogByCode, catalogUnits, normalizeCode, offeringsRows } from './data';
import { offeringStatus } from './offerings';
import { dependents, missingGroups } from './prereqs';
import { type BucketProgress, remainingCourses } from './requirements';
import { earnedCodes, inProgress } from './student';
import { label, mainQuartersAfter } from './terms';

export const FALLBACK_LABEL = 'code-built';
export const FALLBACK_PLAN_ID = 'p-code-built';
const MIN_UNITS = 12;
const MAX_UNITS = 16;
const FIXED_UNITS = /^\d+(\.\d+)?$/;

/** The record once the action is taken: a drop removes the course from the current quarter (impact()'s rule). */
function afterAction(state: StudentState, action: Action): StudentState {
  if (action.kind !== 'drop') return state;
  const code = normalizeCode(action.course);
  return { ...state, courses: state.courses.filter((c) => !(normalizeCode(c.code) === code && c.status === 'wip' && c.term === state.currentTerm)) };
}

// A department page that covers a quarter and has no row for a course is the critic's refusal case ("very likely
// not running"), so that kind of 'unknown' ranks below an 'unknown' where nothing is published at all.
let covered: Set<string> | null = null;
function pageCovers(code: CourseCode, term: TermCode): boolean {
  if (!covered) {
    covered = new Set();
    for (const [c, byTerm] of offeringsRows()) for (const t of byTerm.keys()) covered.add(`${c.split(' ')[0]}:${t}`);
  }
  return covered.has(`${code.split(' ')[0]}:${term}`);
}

/** 0 offered, 1 tentative, 2 unknown with nothing published, 3 unknown although the department page covers the quarter. */
function evidenceTier(ev: OfferingEvidence): number {
  if (ev.status === 'offered') return 0;
  if (ev.status === 'tentative') return 1;
  return pageCovers(ev.course, ev.term) ? 3 : 2;
}

/** Courses a bucket still needs (a units bucket counts 4 units a course). */
const slotsOf = (b: BucketProgress) => (b.kind === 'units' ? Math.ceil(b.remaining / 4) : b.remaining);
const keyOf = (b: BucketProgress) => `${b.band}:${b.label}`;
/** The remote-section twin of a course (CSE 100 ⇄ CSE 100R): the same course under two codes, never both. */
const twin = (c: CourseCode) => (c.endsWith('R') ? c.slice(0, -1) : `${c}R`);

/** One quarter's courses under the rules above, up to MAX_UNITS; may come back short of MIN_UNITS. */
function pickTerm(open: BucketProgress[], rolling: Set<CourseCode>, term: TermCode): CourseCode[] {
  // The requirement path still ahead: what "downstream" is measured against.
  const remaining = new Set(open.flatMap((b) => b.candidates));
  const listed = new Map<CourseCode, BucketProgress[]>();
  for (const b of open) for (const c of b.candidates) listed.set(c, [...(listed.get(c) ?? []), b]);
  const eligible = [...remaining].filter((c) => {
    const cat = catalogByCode().get(c);
    // Fixed catalog units only: the verifier sums those itself, so the plan's units are what it will see.
    return !!cat && FIXED_UNITS.test(cat.units) && (catalogUnits(c) ?? 0) > 0 && !rolling.has(c) && !rolling.has(twin(c))
      && missingGroups(c, rolling).length === 0 && offeringStatus(c, term).status !== 'not_offered';
  });
  // How much a bucket depends on this course: 1 when it needs every candidate it has left (a required course, a
  // fixed sequence), small for a wide elective. A course listed in several buckets takes the highest.
  const necessity = (c: CourseCode) => Math.max(...(listed.get(c) ?? []).map((b) => slotsOf(b) / b.candidates.length));
  const rank = new Map(eligible.map((c) => [c, {
    unblocks: dependents(c).filter((d) => remaining.has(d)).length,
    necessity: necessity(c),
    tier: evidenceTier(offeringStatus(c, term)),
  }]));
  eligible.sort((a, b) => {
    const ka = rank.get(a)!;
    const kb = rank.get(b)!;
    return kb.unblocks - ka.unblocks || kb.necessity - ka.necessity || ka.tier - kb.tier || (a < b ? -1 : 1);
  });
  // A course only earns its seat while some bucket listing it still has a slot this quarter, so two alternatives
  // for one requirement (MATH 18 / MATH 31AH) are never both planned; the pick is charged to the scarcest bucket.
  const slots = new Map(open.map((b) => [keyOf(b), slotsOf(b)]));
  const picked: CourseCode[] = [];
  let units = 0;
  for (const c of eligible) {
    const u = catalogUnits(c) as number;
    if (units + u > MAX_UNITS || picked.includes(twin(c))) continue;
    const buckets = (listed.get(c) ?? []).filter((b) => (slots.get(keyOf(b)) ?? 0) > 0).sort((x, y) => x.candidates.length - y.candidates.length);
    if (!buckets.length) continue;
    slots.set(keyOf(buckets[0]), (slots.get(keyOf(buckets[0])) ?? 0) - 1);
    picked.push(c);
    units += u;
  }
  return picked;
}

export function greedyPlan(state: StudentState, action: Action, opts: { horizonTerms?: number } = {}): Plan | null {
  const after = afterAction(state, action);
  const terms = mainQuartersAfter(after.currentTerm, opts.horizonTerms ?? 3);
  // What later quarters may rely on — the verifier's rolling set: earned, in progress, then each planned quarter.
  const rolling = new Set([...earnedCodes(after), ...inProgress(after).map((c) => c.code)]);
  let cur = after;
  const planned: PlanTerm[] = [];
  const skipped: TermCode[] = [];
  let done: TermCode | null = null;
  const tally = { offered: 0, tentative: 0, unknown: 0 };
  for (const term of terms) {
    const open = remainingCourses(cur);
    if (!open.length) {
      // Every bucket in the two files is covered; the quarters from here on have nothing left to plan.
      done ??= term;
      continue;
    }
    const courses = pickTerm(open, rolling, term);
    const units = courses.reduce((n, c) => n + (catalogUnits(c) ?? 0), 0);
    // A quarter that cannot reach the full-time floor is left out rather than planned part-time or under the floor.
    if (units < MIN_UNITS) {
      skipped.push(term);
      continue;
    }
    planned.push({ term, courses, units });
    for (const c of courses) {
      rolling.add(c);
      const status = offeringStatus(c, term).status;
      tally[status === 'offered' || status === 'tentative' ? status : 'unknown'] += 1;
    }
    // Planned courses count as earned for the next quarter's requirement progress (the verifier scores a plan the same way).
    cur = { ...cur, courses: [...cur.courses, ...courses.map((code) => ({ code, term, units: catalogUnits(code) ?? 4, grade: null, status: 'earned' as const }))] };
  }
  if (!planned.length) return null;

  const total = tally.offered + tally.tentative + tally.unknown;
  const rationale = [
    `Built by rule from your record and the department pages: each quarter takes 12–16 units of courses that fill a requirement you still need, whose prerequisites are complete in an earlier quarter, and that are not marked not offered for that quarter; required courses and the ones that unlock the most later courses come first.`,
    `Of the ${total} courses, ${tally.offered} are listed as offered, ${tally.tentative} tentative and ${tally.unknown} have no published schedule yet for their quarter.`,
    ...(skipped.length ? [`${skipped.map(label).join(' and ')} ${skipped.length === 1 ? 'is' : 'are'} left out: fewer than 12 units of eligible courses.`] : []),
    ...(done ? [`From ${label(done)} on, every requirement in your major and college files is covered.`] : []),
  ].join(' ');
  return { id: FALLBACK_PLAN_ID, label: FALLBACK_LABEL, terms: planned, rationale, graduationTerm: null };
}
