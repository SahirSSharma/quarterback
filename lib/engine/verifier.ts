// verify(plan, state): the deterministic veto over every proposed plan. Rules run in a fixed order — per term
// chronologically, per course in listed order, then plan-wide — so two runs over the same input are identical.
import type { Plan, PlanTerm, StudentState, VerifierReport, Violation } from '../types';
import { catalogByCode, catalogUnits, normalizeCode } from './data';
import { offeringStatus } from './offerings';
import { missingGroups } from './prereqs';
import { bucketProgress, bucketsFor, remainingChainQuarters, remainingCourses } from './requirements';
import { earnedCodes, inProgress } from './student';
import { between, compare, isTerm } from './terms';

export const UNIT_FLOOR = 12;
/** More than 22 units needs college (provost) approval — General Catalog, "Undergraduate and Graduate Registration". */
export const UNIT_CAP_ERROR = 22;
/** ASSUMPTION: 19.5 is the standard cap during initial enrollment; not verified against a primary source. */
export const UNIT_CAP_WARNING = 19.5;

// PlanTerm has no part-time flag yet (requested in notes/engine.md); a plan may set it structurally.
type PlanTermExt = PlanTerm & { partTime?: boolean };

export function verify(plan: Plan, state: StudentState, _opts: { now?: Date | string } = {}): VerifierReport {
  const violations: Violation[] = [];
  const add = (rule: string, severity: Violation['severity'], message: string, course?: string, term?: string) =>
    violations.push({ rule, message, severity, ...(course ? { course } : {}), ...(term ? { term } : {}) });

  const earned = earnedCodes(state);
  const earnedRow = (code: string) => state.courses.find((c) => c.code === code && c.status === 'earned');
  // The current term completes as enrolled; each planned term then adds to what later terms may rely on.
  const rolling = new Set([...earned, ...inProgress(state).map((c) => c.code)]);
  const placed = new Map<string, string>();
  const terms = [...plan.terms].sort((a, b) => compare(a.term, b.term));

  for (const t of terms as PlanTermExt[]) {
    const term = String(t.term).toUpperCase();
    const codes = t.courses.map(normalizeCode);
    for (const code of codes) {
      const row = earnedRow(code);
      if (row && earned.has(code)) add('already-earned', 'error', `${code} is already earned (${row.grade ?? 'P'}, ${row.term}).`, code, term);
      if (placed.has(code)) add('duplicate', 'error', `${code} is planned twice (${placed.get(code)} and ${term}).`, code, term);
      else placed.set(code, term);
      const missing = missingGroups(code, rolling);
      if (missing.length) {
        add('prereq-unsatisfied', 'error', `${code} in ${term} still needs ${missing.map((g) => g.join(' or ')).join('; and ')}.`, code, term);
      }
      const ev = offeringStatus(code, term);
      if (ev.status === 'not_offered') {
        add('not-offered', 'error', `${code} is not offered in ${term}: "${ev.quote}" (${ev.url}, fetched ${ev.fetchedAt}).`, code, term);
      } else if (ev.status === 'unknown') {
        add('assumed-offered', 'warning', `${code} in ${term} has no offering evidence: ${ev.quote}.`, code, term);
      }
    }
    // Units come from the catalog whenever every course has one fixed value; the plan's own number is trusted
    // only when a course is unknown or variable-unit ('1-4', '2, 4') — the model never gets to assert a fact
    // the engine can check.
    const fixed = codes.length > 0 && codes.every((c) => /^\d+(\.\d+)?$/.test(catalogByCode().get(c)?.units ?? ''));
    const catalogSum = codes.reduce((n, c) => n + (catalogUnits(c) ?? 0), 0);
    const units = fixed || !(t.units > 0) ? catalogSum : t.units;
    if (units < UNIT_FLOOR && t.partTime !== true) add('unit-floor', 'error', `${term} has ${units} units, below the ${UNIT_FLOOR}-unit full-time floor.`, undefined, term);
    if (units > UNIT_CAP_ERROR) add('unit-cap', 'error', `${term} has ${units} units; more than ${UNIT_CAP_ERROR} needs college approval.`, undefined, term);
    else if (units > UNIT_CAP_WARNING) add('unit-cap', 'warning', `${term} has ${units} units, above the ${UNIT_CAP_WARNING}-unit standard enrollment cap.`, undefined, term);
    for (const code of codes) rolling.add(code);
  }

  // Double-counting: the engine credits a course to ONE major bucket. A planned course listed in another
  // bucket that is still open after the plan is being counted on twice.
  if (state.majorFile && placed.size) {
    const onRecord = new Set(state.courses.map((c) => c.code));
    const withPlan: StudentState = {
      ...state,
      courses: [
        ...state.courses,
        ...[...placed].filter(([code]) => !onRecord.has(code)).map(([code, term]) => ({ code, term, units: catalogUnits(code) ?? 4, grade: null, status: 'earned' as const })),
      ],
    };
    const progress = bucketProgress(withPlan);
    for (const [code, term] of placed) {
      const listed = bucketsFor(code, state).filter((b) => b.band === 'major').map((b) => b.label);
      if (listed.length < 2) continue;
      const credited = progress.find((p) => p.band === 'major' && p.earnedCodes.includes(code));
      if (!credited) continue;
      const alsoOpen = listed.filter((l) => l !== credited.label && progress.some((p) => p.band === 'major' && p.label === l && p.remaining > 0));
      for (const other of alsoOpen) {
        add('double-count', 'warning', `${code} is credited to "${credited.label}" only; "${other}" also lists it but the engine will not count it twice.`, code, term);
      }
    }
  }

  if (plan.graduationTerm && isTerm(plan.graduationTerm) && isTerm(state.currentTerm)) {
    const quarters = between(state.currentTerm, plan.graduationTerm);
    const done = new Set([...earned, ...inProgress(state).map((c) => c.code)]);
    const chain = remainingChainQuarters(done, remainingCourses(state));
    if (chain > quarters) {
      add('graduation-infeasible', 'error', `The longest remaining prerequisite chain is ${chain} quarters, but ${plan.graduationTerm} is ${quarters} quarters away.`, undefined, plan.graduationTerm);
    }
  }

  return { planId: plan.id, ok: !violations.some((v) => v.severity === 'error'), violations };
}
