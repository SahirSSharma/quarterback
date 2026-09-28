import { describe, expect, it } from 'vitest';
import type { Action, StudentState } from '../types';
import { impact } from '../engine/impact';
import { offeringStatus } from '../engine/offerings';
import { demoStudents } from '../engine/student';
import { verify } from '../engine/verifier';
import {
  applyAction,
  buildEvidenceIndex,
  buildPlannerContext,
  departmentPageTerms,
  eligibilityRows,
  estimateTokens,
  evidenceId,
  horizonTerms,
  parseEvidenceId,
  repairBrief,
  replacementMenu,
  STRATEGIES,
  statusText,
  strategyBrief,
} from './context';

const NOW = '2026-10-01T12:00:00-07:00';
const [demoA, demoB, demoC] = demoStudents();
const dropA: Action = { kind: 'drop', course: 'CSE 29' };
const packA = () => buildPlannerContext(demoA, dropA, impact(demoA, dropA, NOW));

/** A different Revelle AI student: other grades, fewer courses, nothing in common with demo (a) but the two files. */
function sibling(): StudentState {
  return {
    ...demoA,
    gpa: 2.9,
    courses: [
      { code: 'CSE 8A', term: 'FA25', units: 4, grade: 'B', status: 'earned' },
      { code: 'MATH 20A', term: 'FA25', units: 4, grade: 'C+', status: 'earned' },
      { code: 'CSE 8B', term: 'WI26', units: 4, grade: 'B-', status: 'earned' },
      { code: 'CSE 12', term: 'FA26', units: 4, grade: null, status: 'wip' },
      { code: 'MATH 20B', term: 'FA26', units: 4, grade: null, status: 'wip' },
      { code: 'HUM 1', term: 'FA26', units: 6, grade: null, status: 'wip' },
    ],
  };
}

describe('context pack size', () => {
  it.each([
    ['a', demoA, { kind: 'drop', course: 'CSE 29' } as Action],
    ['b', demoB, { kind: 'drop', course: 'COGS 109' } as Action],
    ['c', demoC, { kind: 'drop', course: 'CSE 101' } as Action],
  ])('demo %s stays under 30k tokens with headroom', (_id, state, action) => {
    const { prefix, suffix, eligibility } = buildPlannerContext(state, action, impact(state, action, NOW));
    expect(estimateTokens(prefix) + estimateTokens(suffix)).toBeLessThanOrEqual(24_000);
    expect(eligibility.length).toBeGreaterThan(50);
    expect(prefix.length).toBeGreaterThan(5_000);
  });
});

describe('shared prefix', () => {
  it('is byte-identical for two different students with the same major, college, term and horizon', () => {
    const a = packA();
    const sib = sibling();
    const act: Action = { kind: 'drop', course: 'CSE 12' };
    const b = buildPlannerContext(sib, act, impact(sib, act, NOW));
    expect(b.prefix).toBe(a.prefix);
    expect(b.suffix).not.toBe(a.suffix);
    // Student facts live only in the suffix.
    expect(a.prefix).not.toMatch(/3\.346|Earned: FA25|in progress, 12 units/);
    expect(a.suffix).toMatch(/GPA 3\.346/);
  });
  it('changes when the horizon or the current term changes', () => {
    const a = packA();
    const longer = buildPlannerContext(demoA, dropA, impact(demoA, dropA, NOW), { horizonTerms: 4 });
    expect(longer.prefix).not.toBe(a.prefix);
    expect(longer.prefix).toMatch(/WI28/);
    const wi = { ...demoA, currentTerm: 'WI27' };
    expect(buildPlannerContext(wi, dropA, impact(wi, dropA, NOW)).prefix).not.toBe(a.prefix);
  });
  it('renders every bucket of both files with candidate codes, and a course table with evidence ids per term', () => {
    const { prefix } = packA();
    expect(prefix).toMatch(/\[major\] Ethics — needs 1 course; candidates: .*CSE 194/);
    expect(prefix).toMatch(/\[college\] Humanities Sequence/);
    expect(prefix).toMatch(/CSE 100 \(4u\) \| prereqs: .*CSE 21\|MATH 154.* & CSE 12 & CSE 15L\|CSE 29\|ECE 15 \| WI27 offered ev_CSE100_WI27; SP27 offered ev_CSE100_SP27; FA27 unknown ev_CSE100_FA27/);
    expect(prefix).toMatch(/CSE 194 \(4u\).*WI27 not_offered ev_CSE194_WI27/);
    // CSE 15L is absent from the CSE sheet, which covers WI27: the cell says so; HUM has no page at all.
    expect(prefix).toMatch(/CSE 15L \(2u\).*WI27 unknown \(not on dept page\) ev_CSE15L_WI27/);
    expect(prefix).toMatch(/HUM 4 \(4u\).*WI27 unknown ev_HUM4_WI27/);
  });
});

describe('statusText', () => {
  it('distinguishes a course missing from a covering department page from a quarter nobody publishes', () => {
    expect(statusText(offeringStatus('CSE 15L', 'WI27'))).toBe('unknown (not on dept page)');
    expect(statusText(offeringStatus('CSE 100', 'FA27'))).toBe('unknown'); // beyond the 2026-27 sheet
    expect(statusText(offeringStatus('HUM 4', 'WI27'))).toBe('unknown'); // no HUM page
    expect(statusText(offeringStatus('CSE 100', 'WI27'))).toBe('offered');
    expect(statusText(offeringStatus('CSE 194', 'WI27'))).toBe('not_offered');
    expect(departmentPageTerms('CSE 100')).toEqual(new Set(['FA26', 'WI27', 'SP27']));
    expect(departmentPageTerms('HUM 4')).toBeNull();
  });
});

describe('student suffix', () => {
  it('shows the record after the action: the dropped course is gone, its bucket is open again, and it can be retaken', () => {
    const { suffix, eligibility } = packA();
    expect(suffix).toMatch(/Action: drop CSE 29/);
    expect(suffix).toMatch(/Current quarter FA26 \(in progress, 12 units\): CSE 20 \(4u\), MATH 20C \(4u\), HUM 3 \(4u\)\./);
    expect(suffix).toMatch(/\[major\] Software tools \/ systems programming — 1 course still needed/);
    expect(suffix).not.toMatch(/Already on the record \(do not plan\): .*CSE 29/);
    const cse29 = eligibility.find((r) => r.code === 'CSE 29')!;
    expect(cse29.onRecord).toBe(false);
    expect(cse29.earliestTerm).toBe('WI27');
    // CSE 30 needs CSE 29 again, so it moves to the quarter after the retake.
    expect(eligibility.find((r) => r.code === 'CSE 30')!.earliestTerm).toBe('SP27');
    expect(suffix).toMatch(/Eligible from SP27 \(only with the named prerequisite planned in an earlier quarter\): .*CSE 30 \(4u, needs CSE 15L\|CSE 29\|ECE 15 planned earlier\)/);
    expect(suffix).toMatch(/Eligible from WI27 \(prerequisites met by the record\): .*CSE 29 \(4u\)/);
    // A course eligible now but not offered later says which quarters to avoid, so the model never has to read the table for it.
    expect(suffix).toMatch(/CSE 194 \(4u; not in SP27\)|CSE 194 \(4u\)/);
    expect(suffix).toMatch(/Place a course no earlier than its "Eligible from" quarter/);
  });
  it('lists only delayed downstream courses and the constraints; the strategy brief is appended per draft', () => {
    const { prefix, suffix } = packA();
    expect(suffix).toMatch(/Downstream courses delayed: CSE 30 \(\+1 quarter; next listed WI27\)/);
    expect(suffix).not.toMatch(/\+0 quarter/);
    expect(suffix).toMatch(/12 units minimum per quarter/);
    expect(suffix).toMatch(/above 22 is rejected/);
    expect(suffix).toMatch(/Submit one plan for the requested strategy/);
    expect(suffix).toMatch(/Registrar deadlines FA26: Drop without a W 2026-10-23/);
    expect(suffix).not.toMatch(/## Your draft/);
    // The unit arithmetic lives in the prompt: there is no unit tool any more.
    expect(prefix).toMatch(/there is no unit tool: three 4-unit courses are 12 units/);
    expect(prefix).toMatch(/ONE round of lookups/);
    expect(prefix).not.toMatch(/unit_check|requirement_progress|grade_history/);
    expect(STRATEGIES).toEqual(['fastest', 'balanced', 'lightest']);
    const briefs = STRATEGIES.map(strategyBrief);
    expect(new Set(briefs).size).toBe(3);
    for (const [i, b] of briefs.entries()) {
      expect(b).toMatch(new RegExp(`^## Your draft\\nDraft the ${STRATEGIES[i].toUpperCase()} plan`));
      expect(b).toMatch(/call submit_plan now; make one round of lookups first/);
      expect(b).toMatch(/Pick every course from the "Eligible from" lists/);
    }
  });
  it('does not depend on the clock: the same impact computed on another day renders the same suffix', () => {
    const early = buildPlannerContext(demoA, dropA, impact(demoA, dropA, '2026-10-01T12:00:00-07:00'));
    const late = buildPlannerContext(demoA, dropA, impact(demoA, dropA, '2026-12-10T12:00:00-08:00'));
    expect(late.suffix).toBe(early.suffix);
    expect(late.suffix).not.toMatch(/has passed/);
  });
});

describe('applyAction', () => {
  it('removes a dropped in-progress course and leaves P/NP and keep alone', () => {
    const after = applyAction(demoA, dropA);
    expect(after.courses.some((c) => c.code === 'CSE 29')).toBe(false);
    expect(after.courses).toHaveLength(demoA.courses.length - 1);
    expect(applyAction(demoA, { kind: 'pnp', course: 'CSE 29' })).toBe(demoA);
    expect(applyAction(demoA, { kind: 'keep', course: 'CSE 29' })).toBe(demoA);
    // Demo (c) earned CSE 29 in FA25; a drop of a course not in progress changes nothing.
    expect(applyAction(demoC, dropA).courses).toEqual(demoC.courses);
  });
});

describe('evidence ids', () => {
  it('are stable, derived from the course and term, and parse back', () => {
    expect(evidenceId('cse100', 'wi27')).toBe('ev_CSE100_WI27');
    expect(evidenceId('MATH 20C', 'SP27')).toBe('ev_MATH20C_SP27');
    expect(parseEvidenceId('ev_CSE100_WI27')).toEqual({ code: 'CSE 100', term: 'WI27' });
    expect(parseEvidenceId(' ev_math20c_sp27 ')).toEqual({ code: 'MATH 20C', term: 'SP27' });
    expect(parseEvidenceId('CSE 100 WI27')).toBeNull();
  });
  it('index every planned course in every horizon term with the engine\'s evidence', () => {
    const plan = { id: 'p', label: 'balanced', rationale: '', graduationTerm: null, terms: [{ term: 'WI27', courses: ['CSE 194', 'HUM 4'], units: 8 }] };
    const index = buildEvidenceIndex([plan], horizonTerms(demoA));
    expect(Object.keys(index).sort()).toEqual(['ev_CSE194_FA27', 'ev_CSE194_SP27', 'ev_CSE194_WI27', 'ev_HUM4_FA27', 'ev_HUM4_SP27', 'ev_HUM4_WI27']);
    expect(index.ev_CSE194_WI27).toEqual(offeringStatus('CSE 194', 'WI27'));
    expect(index.ev_CSE194_WI27.status).toBe('not_offered');
  });
});

describe('eligibilityRows', () => {
  it('computes a row for any code, chaining prerequisites through earlier horizon terms', () => {
    const after = applyAction(demoA, dropA);
    const [row] = eligibilityRows(after, ['CSE 101'], horizonTerms(after));
    expect(row.prereqs.length).toBeGreaterThan(0);
    expect(row.missing).toEqual([['CSE 21', 'MATH 154', 'MATH 158', 'MATH 184', 'MATH 188']]);
    expect(row.earliestTerm).toBeNull(); // CSE 21 is not in this one-row table, so nothing chains
    const rows = eligibilityRows(after, ['CSE 29', 'CSE 21', 'CSE 30', 'CSE 100', 'CSE 101', 'CSE 110'], horizonTerms(after));
    // CSE 110 needs CSE 100, which needs CSE 21 and CSE 29: three quarters deep.
    expect(Object.fromEntries(rows.map((r) => [r.code, r.earliestTerm]))).toEqual({ 'CSE 29': 'WI27', 'CSE 21': 'WI27', 'CSE 30': 'SP27', 'CSE 100': 'SP27', 'CSE 101': 'SP27', 'CSE 110': 'FA27' });
  });
});

describe('repairBrief', () => {
  const after = applyAction(demoA, dropA);
  const plan = {
    id: 'p-fastest', label: 'fastest', rationale: '', graduationTerm: null,
    terms: [
      { term: 'WI27', courses: ['CSE 21', 'MATH 18', 'HUM 4', 'CSE 194'], units: 16 },
      { term: 'SP27', courses: ['CSE 100', 'CSE 30', 'COGS 9'], units: 12 },
      { term: 'FA27', courses: ['CSE 101', 'CSE 151A'], units: 8 },
    ],
  };
  it('lists the rejected attempt and, per error, a replacement menu computed by code that the verifier would accept', () => {
    const report = verify(plan, after);
    expect(report.ok).toBe(false);
    const text = repairBrief('fastest', plan, report, after);
    expect(text).toMatch(/^## Previous fastest attempt — REJECTED by the verifier\nWI27 \(16u\): CSE 21, MATH 18, HUM 4, CSE 194/);
    expect(text).toMatch(/\[not-offered\] CSE 194 in WI27: .* → replace CSE 194 in WI27 with one of: .*; or move it to FA27; or drop it if WI27 keeps 12\+ units\./); // not offered in SP27 either
    expect(text).toMatch(/\[not-offered\] COGS 9 in SP27: .* → replace COGS 9 in SP27 with one of: (?:[A-Z]+ \d+[A-Z]* \(4u\), ){4}/); // 4-unit picks come first
    expect(text).toMatch(/\[prereq-unsatisfied\] CSE 100 in SP27: .* → replace CSE 100 in SP27 with one of: /);
    expect(text).toMatch(/\[already-earned\] COGS 9 in SP27: .* → replace COGS 9 in SP27 with one of: /);
    expect(text).toMatch(/\[unit-floor\] in FA27: .* → add to FA27 one of: /);
    expect(text).not.toMatch(/assumed-offered|double-count/); // warnings are not repaired
    // The menu for WI27 never offers a course on the record, in the plan, not offered then, or with unmet prerequisites.
    const menu = replacementMenu(after, plan, 'WI27', ['CSE 194']);
    expect(menu.length).toBeGreaterThan(0);
    expect(menu.length).toBeLessThanOrEqual(8);
    const record = new Set(after.courses.map((c) => c.code));
    const inPlan = new Set(plan.terms.flatMap((t) => t.courses));
    for (const m of menu) {
      expect(record.has(m.code), m.code).toBe(false);
      expect(inPlan.has(m.code), m.code).toBe(false);
      expect(offeringStatus(m.code, 'WI27').status).not.toBe('not_offered');
      expect(verify({ ...plan, terms: [{ term: 'WI27', courses: ['CSE 21', 'MATH 18', 'HUM 4', m.code], units: 16 }] }, after).violations.filter((v) => v.severity === 'error' && v.course === m.code)).toEqual([]);
    }
    // SP27's menu may chain through WI27's planned courses (CSE 21 there makes CSE 101 eligible) but never repeats one.
    const sp = replacementMenu(after, plan, 'SP27', ['CSE 100', 'COGS 9']);
    expect(sp.map((m) => m.code)).not.toContain('CSE 21');
    expect(sp.every((m) => !inPlan.has(m.code))).toBe(true);
  });
});
