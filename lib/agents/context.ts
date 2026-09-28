// The planner's context pack: a shared PREFIX (system instructions, requirement buckets, course table) that is
// byte-identical for every student with the same (majorFile, collegeFile, currentTerm, horizon) so Token
// Factory's prompt cache hits on Super, and a student SUFFIX (record, action, impact, eligibility, constraints).
//
//   buildPlannerContext(state, action, impact, {horizonTerms}) → { prefix, suffix, eligibility }
//   STRATEGIES / strategyBrief(label) / repairBrief(label, plan, report) → the three drafts' closing briefs, and the repair's
//   eligibilityRows(state, codes, terms)                       → EligibilityRow[] for any codes (explain uses it)
//   evidenceId(code, term) / parseEvidenceId(id)               → 'ev_CSE100_WI27' ⇄ {code, term}
//   buildEvidenceIndex(plans, terms)                           → id → OfferingEvidence for every planned course
//   horizonTerms(state, n) / estimateTokens(text)
//
// Nothing here reads the clock: `Impact.deadlines[].passed` and the engine's deadline notes depend on `now`,
// so they are left out (dates are rendered from the calendar instead) — a fixture key is the request bytes.
import type { Action, CourseCode, Impact, OfferingEvidence, OfferingStatus, Plan, StudentState, TermCode, VerifierReport } from '../types';
import { catalogByCode, catalogUnits, loadCollege, loadMajor, normalizeCode } from '../engine/data';
import { offeringStatus } from '../engine/offerings';
import { missingGroups, prereqGroups, satisfied } from '../engine/prereqs';
import { type Band, type BucketProgress, bucketProgress, remainingCourses } from '../engine/requirements';
import { earnedCodes, inProgress } from '../engine/student';
import { compare, deadlinesFor, label, mainQuartersAfter } from '../engine/terms';
import { readOfferingsFile } from '../offerings/build';

export const DEFAULT_HORIZON = 3;
/** Candidates rendered per bucket in the shared prefix; the rest are one eligible_courses call away. */
const SHORTLIST_CAP: Record<Band, number> = { major: 20, college: 8 };
const MAX_BLOCKS = 10;
const MAX_NOTES = 8;

export interface EligibilityRow {
  code: CourseCode;
  title: string;
  units: number | null;
  buckets: { band: Band; label: string }[];
  prereqs: string[][];
  /** Prerequisite groups with no member earned or in progress. */
  missing: string[][];
  /** First horizon term the course can be taken: prerequisites met by then (chaining through earlier horizon
   *  terms of this same table) and not not_offered. null = already on the record or not reachable in the horizon. */
  earliestTerm: TermCode | null;
  onRecord: boolean;
  evidence: Record<TermCode, { id: string; status: OfferingStatus }>;
}

export function evidenceId(code: CourseCode, term: TermCode): string {
  return `ev_${normalizeCode(code).replace(/\s+/g, '')}_${String(term).toUpperCase()}`;
}

/** Inverse of evidenceId; tolerant of case and stray spaces. null when the id is not of that shape. */
export function parseEvidenceId(id: string): { code: CourseCode; term: TermCode } | null {
  const m = /^ev_([A-Z]{2,6})\s*(\d{1,3}[A-Z]{0,3})_([A-Z][A-Z0-9]\d{2})$/i.exec(String(id).replace(/\s+/g, '').trim());
  return m ? { code: normalizeCode(`${m[1]} ${m[2]}`), term: m[3].toUpperCase() } : null;
}

export function horizonTerms(state: StudentState, n = DEFAULT_HORIZON): TermCode[] {
  return mainQuartersAfter(state.currentTerm, n);
}

const pageTerms = new Map<string, Set<TermCode> | null>();
/** The quarters the department's offerings page (data/offerings/<DEPT>.json) covers, or null when it has no page. */
export function departmentPageTerms(code: CourseCode): Set<TermCode> | null {
  const dept = normalizeCode(code).split(' ')[0];
  if (!pageTerms.has(dept)) {
    const file = readOfferingsFile(dept);
    pageTerms.set(dept, file ? new Set(file.terms.map((t) => String(t).toUpperCase())) : null);
  }
  return pageTerms.get(dept) ?? null;
}

/**
 * 'unknown' comes in two kinds the model must tell apart: the department page covers the quarter and simply has
 * no row for the course (very likely not running), or nobody publishes anything for that quarter. The status
 * text carries the difference so the planner, the critic and the tools all say the same thing.
 */
export function statusText(ev: OfferingEvidence): string {
  return ev.status === 'unknown' && departmentPageTerms(ev.course)?.has(String(ev.term).toUpperCase()) ? 'unknown (not on dept page)' : ev.status;
}

/**
 * The record the plan is made against: a drop removes the course from the current quarter (so it can be
 * retaken and no longer satisfies prerequisites); P/NP and keep leave the record as it is (a P satisfies
 * prerequisites). Same rule as lib/engine impact()'s "after" state.
 */
export function applyAction(state: StudentState, action: Action): StudentState {
  if (action.kind !== 'drop') return state;
  const code = normalizeCode(action.course);
  return { ...state, courses: state.courses.filter((c) => !(normalizeCode(c.code) === code && c.status === 'wip' && c.term === state.currentTerm)) };
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// ---------------------------------------------------------------------------------------------
// Shared (student-independent) view

/** Every countable bucket of the two files with all of its candidates: the requirement view with no student in it. */
function blankBuckets(state: StudentState): BucketProgress[] {
  const blank: StudentState = {
    college: '', collegeFile: state.collegeFile, major: '', majors: [], majorFile: state.majorFile,
    courses: [], transfer: [], gpa: null, currentTerm: state.currentTerm, source: 'demo', confidence: 'high', warnings: [],
  };
  return remainingCourses(blank);
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Student-independent order: evidenced as offered somewhere in the horizon, then fewer prerequisite groups, then code. */
function shortlist(candidates: CourseCode[], terms: TermCode[], cap: number): CourseCode[] {
  const key = (c: CourseCode) => [terms.some((t) => offeringStatus(c, t).status === 'offered') ? 0 : 1, prereqGroups(c).length] as const;
  return [...candidates]
    .sort((a, b) => {
      const [ea, pa] = key(a);
      const [eb, pb] = key(b);
      return ea - eb || pa - pb || byCode(a, b);
    })
    .slice(0, cap);
}

function renderPrereqs(groups: string[][]): string {
  return groups.length ? groups.map((g) => g.join('|')).join(' & ') : 'none';
}

function renderBuckets(buckets: BucketProgress[], picks: Map<string, CourseCode[]>): string {
  return buckets
    .map((b) => {
      const shown = picks.get(`${b.band}:${b.label}`) ?? [];
      const more = b.candidates.length - shown.length;
      const need = `${b.needed} ${b.kind === 'units' ? 'units' : b.needed === 1 ? 'course' : 'courses'}`;
      return `[${b.band}] ${b.label} — needs ${need}; candidates: ${shown.join(', ') || '(none in catalog)'}${more > 0 ? ` (+${more} more via eligible_courses)` : ''}`;
    })
    .join('\n');
}

function renderTable(codes: CourseCode[], terms: TermCode[]): string {
  const lines = codes.map((code) => {
    const units = catalogUnits(code);
    const cells = terms.map((t) => `${t} ${statusText(offeringStatus(code, t))} ${evidenceId(code, t)}`).join('; ');
    return `${code} (${units ?? '?'}u) | prereqs: ${renderPrereqs(prereqGroups(code))} | ${cells}`;
  });
  return lines.join('\n');
}

const SYSTEM = `You are Quarterback's degree planner for a UC San Diego undergraduate. You draft ONE quarter-by-quarter plan of the strategy named at the end of the request (fastest, balanced or lightest; the other two are drafted in parallel by someone else). Deterministic code (the verifier) then checks the plan and rejects it if it has an error, so the plan must be exactly right about prerequisites, units, offerings and requirements.

Facts you may rely on are in this prompt and in tool results. Never invent a course, a prerequisite, a unit count or an offering. Course codes are upper case with one space (CSE 100). Quarter codes are FA/WI/SP + two-digit year (WI27).

Offering evidence: each course/quarter cell below carries a status and an evidence id (ev_<CODE without space>_<QUARTER>). "offered" and "tentative" come from a department page or the Schedule of Classes; "not_offered" means the department page has no instructor for that quarter — never place a course there; "unknown (not on dept page)" means the department's page covers that quarter and has no row for the course at all — very likely not running, so treat it like not_offered unless nothing else fills the requirement; plain "unknown" means nobody publishes anything for that quarter (a quarter beyond the published year, or a department with no page) — allowed, say so in the rationale. When two courses fill the same requirement, prefer the one with "offered" evidence. Refer to evidence by id, never by retyping a quote.

Strategies: "fastest" reaches graduation earliest — every quarter carries as much major-chain progress as it can (up to 19.5 units), college requirements wait; "balanced" is about 16 units a quarter mixing major courses with college requirements; "lightest" is 12–13 units a quarter, the minimum full-time load, major chain first. The rationale is written for the student: why this plan and what it assumes, never a description of your edits.

Units: every course in the table carries its catalog units, e.g. "(4u)". Add them yourself per quarter — there is no unit tool: three 4-unit courses are 12 units (the minimum full-time load), four are 16, five are 20 (above the 19.5 flag); above 22 is rejected.

Tools: the table and the student sections already answer almost everything. If something is missing you may make ONE round of lookups — several calls in one reply — before submitting: eligible_courses(term, planned) lists every course that could fill an open requirement in that quarter; check_prereqs(code, term, planned) says what is still missing given the courses planned in earlier quarters; offering_status(code, term) returns the evidence row. submit_plan(terms, rationale, graduationTerm) is how you finish. Every reply is tool calls only; a reply without a tool call is wasted.`;

// ---------------------------------------------------------------------------------------------
// Student view

export function eligibilityRows(state: StudentState, codes: CourseCode[], terms: TermCode[]): EligibilityRow[] {
  const record = new Set([...earnedCodes(state), ...inProgress(state).map((c) => c.code)]);
  const onRecord = new Set(state.courses.map((c) => normalizeCode(c.code)));
  const open = remainingCourses(state);
  const bucketsOf = (code: CourseCode) => open.filter((b) => b.candidates.includes(code)).map((b) => ({ band: b.band, label: b.label }));
  const earliest = new Map<CourseCode, TermCode>();
  const rolling = new Set(record);
  for (const term of terms) {
    const newly = codes.filter((c) => !onRecord.has(c) && !earliest.has(c) && satisfied(c, rolling) && offeringStatus(c, term).status !== 'not_offered');
    for (const c of newly) earliest.set(c, term);
    for (const c of newly) rolling.add(c);
  }
  return codes.map((code) => {
    const evidence: EligibilityRow['evidence'] = {};
    for (const t of terms) evidence[t] = { id: evidenceId(code, t), status: offeringStatus(code, t).status };
    return {
      code,
      title: catalogByCode().get(code)?.title ?? '',
      units: catalogUnits(code),
      buckets: bucketsOf(code),
      prereqs: prereqGroups(code),
      missing: missingGroups(code, record),
      earliestTerm: earliest.get(code) ?? null,
      onRecord: onRecord.has(code),
      evidence,
    };
  });
}

function renderRecord(state: StudentState): string {
  const earned = state.courses.filter((c) => c.status === 'earned');
  const byTerm = new Map<TermCode, string[]>();
  for (const c of earned) {
    const list = byTerm.get(c.term) ?? [];
    list.push(`${c.code}${c.grade ? ` ${c.grade}` : ''}`);
    byTerm.set(c.term, list);
  }
  const wip = inProgress(state);
  const lines = [
    `College: ${state.college || '(unknown)'}; major: ${state.major || '(unknown)'}${state.gpa != null ? `; GPA ${state.gpa}` : ''}.`,
    `Current quarter ${state.currentTerm} (in progress, ${wip.reduce((n, c) => n + c.units, 0)} units): ${wip.map((c) => `${c.code} (${c.units}u)`).join(', ') || 'nothing'}.`,
    `Earned: ${[...byTerm].map(([t, cs]) => `${t}: ${cs.join(', ')}`).join(' · ') || 'nothing yet'}.`,
  ];
  if (state.transfer.length) lines.push(`Transfer rows on record: ${state.transfer.length} (their UCSD equivalents are listed under XFER above).`);
  return lines.join('\n');
}

function renderImpact(impact: Impact, state: StudentState): string {
  const a = impact.action;
  const verb = a.kind === 'drop' ? 'drop' : a.kind === 'pnp' ? 'switch to P/NP' : 'keep';
  const lines = [
    `Action: ${verb} ${impact.course.code}${impact.course.title ? ` (${impact.course.title})` : ''}, ${impact.course.units} units, in ${state.currentTerm} → ${impact.unitsAfter} units this quarter (${impact.belowFullTime ? `BELOW the ${impact.fullTimeFloor}-unit full-time floor` : `full-time floor ${impact.fullTimeFloor} met`}).`,
  ];
  if (impact.blocks.length) {
    const delayed = impact.blocks.filter((b) => b.delayQuarters > 0);
    const top = delayed.slice(0, MAX_BLOCKS).map((b) => `${b.code} (+${b.delayQuarters} quarter${b.delayQuarters === 1 ? '' : 's'}; next listed ${b.nextOffered ?? 'no evidence'})`);
    lines.push(
      delayed.length
        ? `Downstream courses delayed: ${top.join(', ')}${delayed.length > MAX_BLOCKS ? `, and ${delayed.length - MAX_BLOCKS} more` : ''}; ${impact.blocks.length - delayed.length} other downstream courses are gated by other prerequisites, not by this.`
        : `Downstream courses depend on it (${impact.blocks.length}) but none is delayed by this alone.`,
    );
  }
  if (impact.progressDelta.length) {
    lines.push(`Requirement progress lost: ${impact.progressDelta.map((d) => `"${d.bucket}" (${d.band}) ${d.before} → ${d.after} of ${d.needed}`).join('; ')}.`);
  }
  if (a.kind === 'pnp') lines.push(`P/NP allowed for the requirement: ${impact.pnpAllowed}. ${impact.pnpNote}`);
  lines.push(`Longest remaining prerequisite chain: ${impact.chainQuartersBefore} → ${impact.chainQuartersAfter} quarters; graduation risk: ${impact.graduationRisk}.`);
  // Deadline notes depend on today's date; the dates themselves do not.
  const dl = deadlinesFor(state.currentTerm, '2000-01-01');
  if (dl.length) lines.push(`Registrar deadlines ${state.currentTerm}: ${dl.map((d) => `${d.label} ${d.date}`).join('; ')}.`);
  const notes = impact.notes.filter((n) => !/deadline/i.test(n)).slice(0, MAX_NOTES);
  if (notes.length) lines.push('Engine notes:', ...notes.map((n) => `- ${n}`));
  return lines.join('\n');
}

function renderStudentBuckets(state: StudentState, shown: Set<CourseCode>): string {
  const all = bucketProgress(state);
  const open = all.filter((b) => b.remaining > 0);
  const done = all.filter((b) => b.remaining === 0).map((b) => b.label);
  const lines = open.map((b) => {
    const inTable = b.candidates.filter((c) => shown.has(c));
    const unit = b.kind === 'units' ? 'units' : b.remaining === 1 ? 'course' : 'courses';
    const wip = b.wipCodes.length ? ` (in progress: ${b.wipCodes.join(', ')})` : '';
    return `[${b.band}] ${b.label} — ${b.remaining} ${unit} still needed${wip}; in the table: ${inTable.join(', ') || 'none (use eligible_courses)'}`;
  });
  if (done.length) lines.push(`Complete: ${done.join('; ')}.`);
  return lines.join('\n');
}

function renderEligibility(rows: EligibilityRow[], terms: TermCode[]): string {
  const lines: string[] = [];
  for (const [i, t] of terms.entries()) {
    const ready = rows.filter((r) => r.earliestTerm === t);
    // From the second quarter on, a course is only eligible if the prerequisite it still lacks is planned in an
    // EARLIER quarter of the same plan; naming that prerequisite is what lets a no-thinking model place both.
    const codes = ready.map((r) => {
      const avoid = terms.filter((x) => compare(x, t) > 0 && r.evidence[x].status === 'not_offered');
      return `${r.code} (${r.units ?? '?'}u${i === 0 || !r.missing.length ? '' : `, needs ${renderPrereqs(r.missing)} planned earlier`}${avoid.length ? `; not in ${avoid.join('/')}` : ''})`;
    });
    const how = i === 0 ? 'prerequisites met by the record' : `only with the named prerequisite planned in an earlier quarter`;
    lines.push(`Eligible from ${t} (${how}): ${codes.join(', ') || 'none'}.`);
  }
  const blocked = rows.filter((r) => !r.onRecord && r.earliestTerm === null);
  if (blocked.length) {
    lines.push(`Not reachable in the horizon (never plan): ${blocked.map((r) => `${r.code} (needs ${renderPrereqs(r.missing) || 'an offered quarter'})`).join('; ')}.`);
  }
  const onRecord = rows.filter((r) => r.onRecord).map((r) => r.code);
  if (onRecord.length) lines.push(`Already on the record (do not plan): ${onRecord.join(', ')}.`);
  return lines.join('\n');
}

function renderConstraints(terms: TermCode[]): string {
  return [
    `- Plan exactly these quarters, in order: ${terms.join(', ')}. Every plan lists every quarter.`,
    '- 12 units minimum per quarter (or mark the quarter partTime:true and say why) and at most 19.5 (16 is typical); above 19.5 is flagged, above 22 is rejected. Units are catalog units: add the (Nu) values. In practice: three courses for 12–13 units, four for 16, five for 19.5–20; NEVER more than five courses in a quarter.',
    '- Never plan a course that is earned or in progress; never plan a course twice.',
    '- A prerequisite must be complete in an EARLIER quarter: earned, in progress now, or planned in an earlier quarter of the same plan. Same-quarter does not count: CSE 15L in WI27 does not satisfy CSE 30 in WI27; CSE 30 must wait for SP27. Place a course no earlier than its "Eligible from" quarter above, and only if you also plan the prerequisite it names in an earlier quarter.',
    '- Never place a course in a quarter whose status is not_offered, and avoid "unknown (not on dept page)" unless nothing else fills the requirement. Plain "unknown" is allowed but name it in the rationale.',
    '- Use only codes from the table or from eligible_courses. Fill open requirements first; a course that fills two buckets is counted once.',
    '- Submit one plan for the requested strategy with every quarter listed, a two-sentence rationale for the student and your estimated graduationTerm (quarter code or null).',
  ].join('\n');
}

export const STRATEGIES = ['fastest', 'balanced', 'lightest'] as const;
export type Strategy = (typeof STRATEGIES)[number];

const STRATEGY_BRIEF: Record<Strategy, string> = {
  fastest: 'FASTEST plan: reach graduation earliest — exactly five courses in every quarter (about 19.5 units), major-chain courses first so that later quarters unlock; college requirements only fill the remaining seats.',
  balanced: 'BALANCED plan: exactly four courses in every quarter (about 16 units), mixing major-chain courses with college requirements.',
  lightest: 'LIGHTEST plan: three 4-unit courses in every quarter (12 units, the minimum full-time load; add a fourth only if one of them is worth fewer than 4 units), major chain first.',
};

/** The per-draft closing section of the user message; everything before it is shared by the three drafts. */
export function strategyBrief(label: Strategy): string {
  return (
    `## Your draft\nDraft the ${STRATEGY_BRIEF[label]} ` +
    'Pick every course from the "Eligible from" lists above, in a quarter at or after the one it is listed under, with the prerequisite it names planned in an earlier quarter; never a course marked already on the record. ' +
    'Reply with tool calls only. The table and the lists above are complete for the courses they show, so call submit_plan now; make one round of lookups first (several in one reply) only when a requirement has no eligible course listed.'
  );
}

const MENU_CAP = 8;

/**
 * What a rejected slot in `term` can become: courses that fill a requirement still open once the rest of the plan
 * counts (minus `exclude`, the courses being replaced), with prerequisites met by the record plus the plan's EARLIER
 * quarters, not on the record, not already in the plan, and not not_offered (or absent from a covering department
 * page) in `term`. Offered evidence first, then fewer prerequisite groups, then code. The same rules the verifier
 * applies, so a pick from the menu cannot fail on them.
 */
export function replacementMenu(state: StudentState, plan: Plan, term: TermCode, exclude: CourseCode[] = []): { code: CourseCode; units: number | null }[] {
  const t = String(term).toUpperCase();
  const out = new Set(exclude.map(normalizeCode));
  const inPlan = new Set(plan.terms.flatMap((x) => x.courses.map(normalizeCode)));
  const onRecord = new Set(state.courses.map((c) => normalizeCode(c.code)));
  const kept = plan.terms.flatMap((x) => x.courses.map(normalizeCode)).filter((c) => !out.has(c) && !onRecord.has(c));
  const scored: StudentState = { ...state, courses: [...state.courses, ...kept.map((code) => ({ code, term: t, units: catalogUnits(code) ?? 4, grade: null, status: 'earned' as const }))] };
  const earlier = plan.terms.filter((x) => compare(x.term, t) < 0).flatMap((x) => x.courses.map(normalizeCode));
  const done = new Set([...earnedCodes(state), ...inProgress(state).map((c) => c.code), ...earlier]);
  const seen = new Set<CourseCode>();
  for (const b of remainingCourses(scored)) {
    for (const c of b.candidates) {
      if (seen.has(c) || inPlan.has(c) || onRecord.has(c) || !satisfied(c, done)) continue;
      const ev = offeringStatus(c, t);
      if (ev.status === 'not_offered' || statusText(ev) === 'unknown (not on dept page)') continue;
      seen.add(c);
    }
  }
  // Full-unit courses first: a 1- or 2-unit pick to replace a 4-unit course drops the quarter under the floor.
  const ranked = shortlist([...seen], [t], MENU_CAP * 2).map((code) => ({ code, units: catalogUnits(code) }));
  return [...ranked.filter((m) => (m.units ?? 4) >= 4), ...ranked.filter((m) => (m.units ?? 4) < 4)].slice(0, MENU_CAP);
}

const menuText = (menu: { code: CourseCode; units: number | null }[]) => (menu.length ? menu.map((m) => `${m.code} (${m.units ?? '?'}u)`).join(', ') : 'nothing else fits this quarter');

/**
 * The repair prompt's closing section: the rejected attempt, then every error with the concrete move that fixes it —
 * a replacement menu computed by code for the slot, a quarter to move to, or what to remove. Nothing else changes.
 */
export function repairBrief(label: Strategy, plan: Plan, report: VerifierReport, state: StudentState, round = 1): string {
  const attempt = plan.terms.map((t) => `${t.term} (${t.units}u): ${t.courses.join(', ') || '(empty)'}`).join('\n');
  const terms = plan.terms.map((t) => String(t.term).toUpperCase());
  const errors = report.violations.filter((v) => v.severity === 'error');
  const badIn = (term: string) => errors.filter((v) => v.term === term && v.course).map((v) => v.course as CourseCode);
  const lines = errors.map((v) => {
    const where = v.term ? String(v.term).toUpperCase() : '';
    const head = `- [${v.rule}]${v.course ? ` ${v.course}` : ''}${where ? ` in ${where}` : ''}: ${v.message}`;
    if (v.rule === 'unit-cap') return `${head} → remove courses from ${where} until it has five or fewer.`;
    if (v.rule === 'unit-floor') return `${head} → add to ${where} one of: ${menuText(replacementMenu(state, plan, where))}.`;
    if (v.rule === 'graduation-infeasible') return `${head} → set graduationTerm later, or null.`;
    if (!v.course || !where) return head;
    const menu = menuText(replacementMenu(state, plan, where, badIn(where)));
    const elsewhere = v.rule === 'not-offered' ? terms.filter((x) => x !== where && compare(x, where) > 0 && offeringStatus(v.course as string, x).status !== 'not_offered') : [];
    return `${head} → replace ${v.course} in ${where} with one of: ${menu}${elsewhere.length ? `; or move it to ${elsewhere.join(' or ')}` : ''}; or drop it if ${where} keeps 12+ units.`;
  });
  return [
    // The round number keeps a second repair of an unchanged plan from being the byte-identical request (fixture key).
    `## Previous ${label} attempt${round > 1 ? ` (repair ${round - 1} of ${round - 1})` : ''} — REJECTED by the verifier`,
    attempt,
    'Violations, each with the fix that code has already checked:',
    ...lines,
    `Apply exactly those fixes, keep every other course where it is, keep every quarter at 12+ units, and call submit_plan now with the corrected ${label} plan and a rationale written for the student (why this plan, what it assumes), not a description of the fix.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------

export function buildPlannerContext(
  state: StudentState,
  action: Action,
  impact: Impact,
  opts: { horizonTerms?: number } = {},
): { prefix: string; suffix: string; eligibility: EligibilityRow[] } {
  const terms = horizonTerms(state, opts.horizonTerms ?? DEFAULT_HORIZON);

  // Prefix: everything below is a function of the two requirement files, the data snapshot and the horizon.
  const buckets = blankBuckets(state);
  const picks = new Map<string, CourseCode[]>();
  const codes = new Set<CourseCode>();
  for (const b of buckets) {
    const pick = shortlist(b.candidates, terms, SHORTLIST_CAP[b.band]);
    picks.set(`${b.band}:${b.label}`, pick);
    for (const c of pick) codes.add(c);
  }
  const shown = [...codes].sort(byCode);
  const major = state.majorFile ? loadMajor(state.majorFile).program : null;
  const college = state.collegeFile ? loadCollege(state.collegeFile).college : null;
  const prefix = [
    SYSTEM,
    `## Requirements — ${major ? `${major.major} (${major.degree}, ${major.department})` : 'major unknown'}; college GE: ${college ?? 'unknown'}`,
    renderBuckets(buckets, picks),
    `## Course table — ${terms.join(', ')} (${shown.length} courses; "|" separates alternatives, "&" joins required groups)`,
    renderTable(shown, terms),
  ].join('\n\n');

  // Suffix: the student, as the record stands once the action is taken (a dropped course is gone).
  const after = applyAction(state, action);
  const eligibility = eligibilityRows(after, shown, terms);
  const suffix = [
    '## Student (record after the action below)', renderRecord(after),
    '## Situation', renderImpact(impact, state),
    '## Open requirements for this student', renderStudentBuckets(after, codes),
    '## Eligibility for this student (table courses)', renderEligibility(eligibility, terms),
    '## Constraints', renderConstraints(terms),
  ].join('\n\n');

  return { prefix, suffix, eligibility };
}

/** Evidence for every planned course in every horizon term (plus its planned term when outside the horizon). */
export function buildEvidenceIndex(plans: Plan[], terms: TermCode[]): Record<string, OfferingEvidence> {
  const index: Record<string, OfferingEvidence> = {};
  for (const p of plans) {
    for (const t of p.terms) {
      for (const raw of t.courses) {
        const code = normalizeCode(raw);
        for (const term of new Set([...terms, String(t.term).toUpperCase()])) {
          const id = evidenceId(code, term);
          index[id] ??= offeringStatus(code, term);
        }
      }
    }
  }
  return index;
}

export { label as termLabel };
