// whyNot: "why not CSE 105?" — a short plain-language answer from Lightning (thinking off) over the course's
// eligibility row, the student's record and the alternatives for the same requirement. No retrieval: the facts
// are the engine's, rendered whole; the model only phrases them.
//
//   whyNot({state, code, eligibility, onEvent}) → string (≤ 3 sentences)
import type { CourseCode, StudentState, TraceEvent } from '../types';
import { normalizeCode } from '../engine/data';
import { earnedCodes, inProgress } from '../engine/student';
import { chat } from '../tf/client';
import { type EligibilityRow, eligibilityRows, horizonTerms } from './context';

export const EXPLAIN_STEP = 'explain';
const MAX_ALTERNATIVES = 10;

const SYSTEM = `You answer a UC San Diego student who asks why a course is or is not available to them in the next quarters. Answer in at most three plain sentences: whether they can take it, what is missing, and the earliest quarter it fits. Use only the facts given — never invent a prerequisite, an offering or a requirement; name courses by their codes; if the facts say the course does not fit within the quarters listed, say exactly that and do not name a later quarter. No preamble, no bullet points.`;

const groups = (g: string[][]) => (g.length ? g.map((x) => x.join(' or ')).join('; and ') : 'none');

export async function whyNot(input: { state: StudentState; code: CourseCode; eligibility: EligibilityRow[]; onEvent?: (event: TraceEvent) => void }): Promise<string> {
  const { state, eligibility } = input;
  const code = normalizeCode(input.code);
  const terms = eligibility.length ? Object.keys(eligibility[0].evidence) : horizonTerms(state);
  // A course outside the table gets its row computed against the whole table, so prerequisite chaining through
  // earlier quarters (CSE 21 in WI27 → CSE 105 later) is judged the same way as for the table's own rows.
  const row =
    eligibility.find((r) => r.code === code) ??
    eligibilityRows(state, [...eligibility.map((r) => r.code), code], terms).find((r) => r.code === code)!;
  const labels = new Set(row.buckets.map((b) => b.label));
  const alternatives = eligibility
    .filter((r) => r.code !== code && !r.onRecord && r.buckets.some((b) => labels.has(b.label)))
    .slice(0, MAX_ALTERNATIVES);
  const wip = inProgress(state).map((c) => c.code);
  const user = [
    `Course: ${code}${row.title ? ` — ${row.title}` : ''}${row.units != null ? ` (${row.units} units)` : ''}.`,
    `Fills: ${row.buckets.map((b) => `${b.label} (${b.band})`).join('; ') || 'no open requirement of this student'}.`,
    `Prerequisites: ${groups(row.prereqs)}.`,
    `Missing for this student: ${groups(row.missing)}.`,
    `Student has earned: ${[...earnedCodes(state)].sort().join(', ') || 'nothing yet'}; in progress in ${state.currentTerm}: ${wip.join(', ') || 'nothing'}.`,
    row.onRecord
      ? `${code} is already on the student's record.`
      : `Earliest quarter it fits: ${row.earliestTerm ?? `not within ${terms[0]}–${terms[terms.length - 1]}`}.`,
    `Offering evidence: ${terms.map((t) => `${t} ${row.evidence[t]?.status ?? 'unknown'}`).join(', ')}.`,
    alternatives.length
      ? `Alternatives for the same requirement: ${alternatives.map((a) => `${a.code}${a.earliestTerm ? ` (from ${a.earliestTerm})` : ' (not in horizon)'}`).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const res = await chat(
    { role: 'extract', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], max_tokens: 220 },
    { step: EXPLAIN_STEP },
  );
  input.onEvent?.({ type: 'model', step: EXPLAIN_STEP, at: res.entry.at, entry: res.entry });
  return (res.message.content ?? '').trim();
}
