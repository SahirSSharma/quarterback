// impact(state, action, now): what dropping / P-NP-ing / keeping a current-term course does. Deterministic,
// no model calls; every judgment it makes is also written out in `notes` so the UI and the critic can quote it.
import type { Action, BlockedCourse, CourseCode, Impact, StudentState, TermCode } from '../types';
import { catalogByCode, catalogUnits, gradingRestrictions, loadMajor, normalizeCode } from './data';
import { nextOffered, offeringStatus } from './offerings';
import { dependents, missingGroups, transitiveDependents } from './prereqs';
import { type BucketProgress, bucketProgress, bucketsFor, remainingChainQuarters } from './requirements';
import { earnedCodes, inProgress } from './student';
import { between, deadlinesFor, label, next } from './terms';

export const FULL_TIME_FLOOR = 12;
/** Main quarters the scheduler looks ahead before giving up on a course. */
const HORIZON = 12;
/** Graduation-risk rule: quarters left ≈ units still needed for a 180-unit degree at 15 units a quarter. */
const DEGREE_UNITS = 180;
const PACE_UNITS = 15;

interface Scheduler { memo: Map<CourseCode, TermCode | null>; assumedUnknown: boolean }

/**
 * The earliest main quarter after `from` in which `code` can be completed: the quarter after its slowest
 * unmet prerequisite group (each group via its quickest member), then the first quarter from there with no
 * evidence AGAINST the course being offered. 'unknown' is treated as possible and recorded on the scheduler
 * so the caller can say so; it is never reported as offered. null = not within HORIZON quarters.
 */
function earliestTerm(code: CourseCode, done: Set<CourseCode>, from: TermCode, s: Scheduler, visiting = new Set<CourseCode>()): TermCode | null {
  if (done.has(code)) return from;
  if (s.memo.has(code)) return s.memo.get(code) as TermCode | null;
  if (visiting.has(code)) return null;
  visiting.add(code);
  let ready: TermCode = from;
  for (const group of missingGroups(code, done)) {
    let best: TermCode | null = null;
    for (const m of group) {
      const t = earliestTerm(m, done, from, s, visiting);
      if (t && (!best || between(best, t) < 0)) best = t;
    }
    if (best && between(ready, best) > 0) ready = best;
  }
  visiting.delete(code);
  let result: TermCode | null = null;
  for (let t = next(ready, 1); between(from, t) <= HORIZON; t = next(t, 1)) {
    const status = offeringStatus(code, t).status;
    if (status === 'not_offered') continue;
    if (status === 'unknown') s.assumedUnknown = true;
    result = t;
    break;
  }
  s.memo.set(code, result);
  return result;
}

const progressValue = (p: BucketProgress) => Math.min(p.needed, p.earned + p.inProgress);

function transferUnits(transfer: unknown[]): number {
  return transfer.reduce<number>((n, t) => n + (Number((t as { units?: unknown }).units) || 0), 0);
}

export function impact(state: StudentState, action: Action, now: Date | string): Impact {
  const code = normalizeCode(action.course);
  const term = state.currentTerm;
  const wip = inProgress(state);
  const onRecord = wip.find((c) => c.code === code);
  const cat = catalogByCode().get(code);
  const units = onRecord?.units ?? catalogUnits(code) ?? 0;
  const title = onRecord?.title ?? cat?.title;
  const notes: string[] = [];
  if (!onRecord) notes.push(`${code} is not in progress in ${label(term)}; the impact is computed as if it were.`);

  // Prerequisite graph: the term completes as enrolled ("before"); a drop removes the course ("after").
  // A P satisfies prerequisites like a letter grade, so the P/NP graph is unchanged.
  const before = new Set([...earnedCodes(state), ...wip.map((c) => c.code)]);
  const after = new Set(before);
  if (action.kind === 'drop') after.delete(code);

  const stateAfter: StudentState = action.kind === 'drop'
    ? { ...state, courses: state.courses.filter((c) => !(c.code === code && c.status === 'wip' && c.term === term)) }
    : state;
  const progressBefore = bucketProgress(state);
  const progressAfter = bucketProgress(stateAfter);
  const openBefore = progressBefore.filter((p) => p.remaining > 0);
  const openAfter = progressAfter.filter((p) => p.remaining > 0);

  const progressDelta: Impact['progressDelta'] = [];
  for (const pb of progressBefore) {
    const pa = progressAfter.find((p) => p.band === pb.band && p.label === pb.label);
    if (!pa || progressValue(pa) === progressValue(pb)) continue;
    progressDelta.push({ bucket: pb.label, band: pb.band, before: progressValue(pb), after: progressValue(pa), needed: pb.needed });
    notes.push(`"${pb.label}" (${pb.band}) goes from ${progressValue(pb)} to ${progressValue(pa)} of ${pb.needed}.`);
  }

  // Blocked courses: everything downstream of the dropped course that could still fill an open bucket.
  const blocks: BlockedCourse[] = [];
  const sBefore: Scheduler = { memo: new Map(), assumedUnknown: false };
  const sAfter: Scheduler = { memo: new Map(), assumedUnknown: false };
  if (action.kind === 'drop') {
    const candidates = new Set(openAfter.flatMap((p) => p.candidates));
    const direct = new Set(dependents(code));
    const order = new Map<CourseCode, number>();
    for (const dep of transitiveDependents(code, candidates)) {
      order.set(dep, order.size);
      const tBefore = earliestTerm(dep, before, term, sBefore);
      const tAfter = earliestTerm(dep, after, term, sAfter);
      let delayQuarters = 0;
      if (tBefore && tAfter) delayQuarters = Math.max(0, between(tBefore, tAfter));
      else if (tBefore && !tAfter) delayQuarters = HORIZON - between(term, tBefore) + 1;
      const nx = nextOffered(dep, term, 6);
      blocks.push({
        code: dep,
        ...(catalogByCode().get(dep)?.title ? { title: catalogByCode().get(dep)!.title } : {}),
        buckets: bucketsFor(dep, state).map((b) => b.label),
        nextOffered: nx?.term ?? null,
        evidence: nx?.evidence ?? offeringStatus(dep, next(term, 1)),
        delayQuarters,
      });
      // One line per delayed course; for a direct dependent that is NOT delayed, say what is really gating it.
      if (delayQuarters > 0 && tBefore) {
        notes.push(`${dep}: earliest ${label(tBefore)} → ${tAfter ? label(tAfter) : 'beyond the planning horizon'} (+${delayQuarters} quarter${delayQuarters === 1 ? '' : 's'}).`);
      } else if (tBefore && direct.has(dep)) {
        const other = missingGroups(dep, after).filter((g) => !g.includes(code)).map((g) => (g.length > 3 ? `${g.slice(0, 3).join(' or ')} or …` : g.join(' or ')));
        if (other.length) notes.push(`${dep} is not delayed by this alone: it still needs ${other.join('; ')} (earliest ${label(tBefore)}).`);
      }
    }
    // Delayed courses first (largest delay), then direct dependents, then the rest of the walk.
    blocks.sort((a, b) => b.delayQuarters - a.delayQuarters
      || Number(direct.has(b.code)) - Number(direct.has(a.code))
      || (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
    const retake = nextOffered(code, term, 6);
    notes.push(retake
      ? `${code} itself is next listed for ${label(retake.term)} (${retake.evidence.source}: "${retake.evidence.quote}").`
      : `No evidence yet of a future offering of ${code}; retake timing assumes it returns next quarter.`);
    if (sBefore.assumedUnknown || sAfter.assumedUnknown) {
      notes.push('Quarters with no offering evidence were treated as possible, never as confirmed offered.');
    }
  }

  // Units
  const unitsNow = wip.reduce((n, c) => n + c.units, 0);
  const unitsAfter = action.kind === 'drop' ? unitsNow - (onRecord ? units : 0) : unitsNow;
  const belowFullTime = unitsAfter < FULL_TIME_FLOOR;
  if (action.kind === 'drop') {
    notes.push(`Dropping ${code} (${units} units) leaves ${unitsAfter} units in ${label(term)}${belowFullTime ? `, below the ${FULL_TIME_FLOOR}-unit full-time floor` : ''}.`);
  }

  // P/NP: only the catalog's own grading restriction is a verdict; everything else is a flag to check.
  const majorBuckets = bucketsFor(code, state).filter((b) => b.band === 'major').map((b) => b.label);
  const dept = state.majorFile ? loadMajor(state.majorFile).program.department : 'your department';
  const restriction = gradingRestrictions()[code];
  let pnpAllowed: Impact['pnpAllowed'] = 'unknown';
  let pnpNote: string;
  if (restriction === 'L' || restriction === 'S') {
    pnpAllowed = 'no';
    pnpNote = `The General Catalog lists ${code} as "${restriction === 'L' ? 'letter' : 'S/U'} grades only", so it cannot be switched to P/NP.`;
  } else if (restriction === 'P') {
    pnpAllowed = 'yes';
    pnpNote = `The General Catalog lists ${code} as "P/NP grades only"; it is already graded P/NP.`;
  } else if (majorBuckets.length) {
    pnpNote = `${code} fills "${majorBuckets.join('", "')}" for the major. Courses taken P/NP generally may not satisfy major requirements; confirm with ${dept} advising before changing the grading option. UC San Diego also caps P/NP at one-quarter of your UC San Diego units.`;
  } else {
    pnpNote = `The requirement files say nothing about P/NP for ${code}; confirm with your college advising. UC San Diego caps P/NP at one-quarter of your UC San Diego units.`;
  }

  // Deadlines for the current term, judged against `now`.
  const deadlines = deadlinesFor(term, now);
  const noW = deadlines.find((d) => d.key === 'dropWithoutW');
  const withW = deadlines.find((d) => d.key === 'dropWithW');
  if (action.kind === 'drop' && noW?.passed) {
    notes.push(withW?.passed
      ? `Both drop deadlines for ${label(term)} have passed (${noW.date}, ${withW.date}); a drop now needs college approval.`
      : `The no-W drop deadline (${noW.date}) has passed; a drop before ${withW?.date} records a W.`);
  }
  if (action.kind === 'pnp') {
    const gd = deadlines.find((d) => d.key === 'changeGradingOption');
    if (gd) notes.push(gd.passed ? `The grading-option deadline (${gd.date}) has passed.` : `Grading option can be changed until ${gd.date}.`);
  }

  // Graduation risk: longest remaining chain against a simple quarters-left estimate.
  const chainQuartersBefore = remainingChainQuarters(before, openBefore);
  const chainQuartersAfter = remainingChainQuarters(after, openAfter);
  const unitsBanked = state.courses.filter((c) => c.status === 'earned').reduce((n, c) => n + c.units, 0)
    + transferUnits(state.transfer) + unitsAfter;
  const quartersLeft = Math.max(1, Math.ceil((DEGREE_UNITS - unitsBanked) / PACE_UNITS));
  const delayed = blocks.some((b) => b.delayQuarters > 0);
  const graduationRisk: Impact['graduationRisk'] =
    chainQuartersAfter > quartersLeft ? 'likely' : chainQuartersAfter > chainQuartersBefore || delayed ? 'possible' : 'none';
  notes.push(`Longest remaining prerequisite chain: ${chainQuartersBefore} → ${chainQuartersAfter} quarters. About ${quartersLeft} quarters remain at ${PACE_UNITS} units/quarter to ${DEGREE_UNITS} units (${unitsBanked} banked), so graduation risk is "${graduationRisk}".`);

  return {
    action,
    course: { code, ...(title ? { title } : {}), units },
    blocks,
    unitsAfter,
    fullTimeFloor: FULL_TIME_FLOOR,
    belowFullTime,
    pnpAllowed,
    pnpNote,
    deadlines,
    progressDelta,
    chainQuartersBefore,
    chainQuartersAfter,
    graduationRisk,
    notes,
  };
}
