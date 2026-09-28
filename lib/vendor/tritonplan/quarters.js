// Quarter codes, in order — the arithmetic the Degree Planner's board needs.
//
// The board used to be a hard-coded six columns starting at Fall 2026, so a
// student already enrolled at UCSD could not put the quarters they had ALREADY
// taken on it: "can you set it up so that I can add in previous quarters
// (before Fall 26)? That way students who are already enrolled at UCSD can have
// their whole degree planner setup within TritonPlan".
//
// Codes are the ones the Academic History parser emits: FA26, WI27, SP27, and
// the summer sessions S1/S2/S3. Ordering is CHRONOLOGICAL, not alphabetical,
// and a UCSD academic year runs Fall → Winter → Spring, so Fall 2026 comes
// BEFORE Winter 2027.

// Position of each season inside a calendar year, so codes sort by real time.
const SEASON = { WI: 0, SP: 1, S1: 2, S2: 3, S3: 4, SU: 2, FA: 5 };
const LABEL = { WI: 'Winter', SP: 'Spring', FA: 'Fall', S1: 'Summer I', S2: 'Summer II', S3: 'Summer III', SU: 'Summer' };
// Only the three main quarters are ever GENERATED. Summer sessions appear on
// the board when a student's own record has one, but nobody wants an empty
// summer column manufactured between every school year.
const CYCLE = ['WI', 'SP', 'FA'];

const parse = (code) => {
  // The season token is two characters and the SECOND one may be a digit —
  // the parser writes summer sessions as S1/S2/S3, so "S126" is Summer I 2026.
  const m = /^([A-Z][A-Z0-9])(\d{2})$/.exec(String(code || '').toUpperCase());
  if (!m || SEASON[m[1]] == null) return null;
  return { season: m[1], year: 2000 + Number(m[2]) };
};

/** Chronological sort key. Returns null for anything that is not a quarter —
 *  "XFER" most importantly, which is credit with no term at all. */
export function qIndex(code) {
  const p = parse(code);
  return p ? p.year * 10 + SEASON[p.season] : null;
}

export const isQuarter = (code) => qIndex(code) != null;

/** "FA26" -> "Fall 2026". Unknown codes print themselves rather than a guess. */
export function qLabel(code) {
  const p = parse(code);
  return p ? `${LABEL[p.season]} ${p.year}` : String(code || '');
}

/** The next/previous MAIN quarter (summers are skipped — see CYCLE). */
export function qStep(code, delta) {
  const p = parse(code);
  if (!p) return null;
  // Summer sits between Spring and Fall of the same calendar year, so it steps
  // FORWARD from Spring (landing on that Fall) and BACKWARD from Fall (landing
  // on that Spring). Stepping it like an ordinary quarter would skip a term.
  let year = p.year;
  let i = CYCLE.indexOf(p.season);
  if (i === -1) i = CYCLE.indexOf(delta >= 0 ? 'SP' : 'FA');
  let n = i + delta;
  year += Math.floor(n / CYCLE.length);
  n = ((n % CYCLE.length) + CYCLE.length) % CYCLE.length;
  return `${CYCLE[n]}${String(year % 100).padStart(2, '0')}`;
}

// The month a quarter ENDS in — how a student says when they graduate. Nobody
// says "I finish in SP29"; they say "I graduate in June 2029". Offering the
// term by its ending month is what makes the picker answerable without
// translation.
const ENDS = { WI: 'March', SP: 'June', FA: 'December', S1: 'August', S2: 'September', S3: 'September', SU: 'September' };

/** "SP29" -> "June 2029" — the month the quarter finishes. */
export function qEnds(code) {
  const p = parse(code);
  return p ? `${ENDS[p.season]} ${p.year}` : '';
}

/**
 * Quarters a student could pick as their last, starting at `from`.
 * Main quarters only — nobody graduates out of a summer session.
 */
export function gradOptions(from = 'FA26', count = 21) {
  const out = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    out.push({ id: cursor, label: qLabel(cursor), ends: qEnds(cursor) });
    cursor = qStep(cursor, 1);
  }
  return out;
}

/**
 * The columns the planner should show.
 *
 *   anchor    first plannable quarter (the term the catalog is for, FA26)
 *   recorded  quarter codes the student's imported record already contains
 *   planned   quarter codes the saved plan already uses
 *   through   the student's LAST quarter — their graduating term. When set, the
 *             board runs to it exactly, however far away it is.
 *   back      extra earlier quarters the student asked for
 *   forward   extra later quarters the student asked for (beyond `ahead`)
 *   ahead     how many quarters from the anchor to show when `through` is unset
 *
 * Returns [{ id, label, past }] in chronological order. `past` marks a quarter
 * that has already happened — it is history to be recorded, not a plan to be
 * checked, and the planner treats it differently.
 */
export function quarterSpan({ anchor = 'FA26', recorded = [], planned = [], through = '', back = 0, forward = 0, ahead = 5 } = {}) {
  const anchorIdx = qIndex(anchor);
  if (anchorIdx == null) return [];

  const ids = new Set();
  // Forward from the anchor. A student who has told us when they graduate gets
  // every quarter up to that term — six columns ending at Spring 2028 is not a
  // degree plan for somebody finishing in 2029. Without that answer, the
  // default run plus anything they extended it by or already planned beyond.
  const throughIdx = qIndex(through);
  let cursor = anchor;
  if (throughIdx != null && throughIdx >= anchorIdx) {
    // Bounded by the quarter itself, not by a count, so it cannot run away.
    while (qIndex(cursor) <= throughIdx) {
      ids.add(cursor);
      cursor = qStep(cursor, 1);
    }
  } else {
    for (let i = 0; i <= ahead + Math.max(0, forward); i++) {
      ids.add(cursor);
      cursor = qStep(cursor, 1);
    }
  }
  // Backward from the anchor, for a student whose record we do not have.
  cursor = anchor;
  for (let i = 0; i < Math.max(0, back); i++) {
    cursor = qStep(cursor, -1);
    ids.add(cursor);
  }
  // Every quarter the student actually has coursework or plans in, whenever it
  // is. A term on the record is never dropped off the board for being old.
  for (const c of [...recorded, ...planned]) {
    if (isQuarter(c)) ids.add(String(c).toUpperCase());
  }

  return [...ids]
    .sort((a, b) => qIndex(a) - qIndex(b))
    .map((id) => ({ id, label: qLabel(id), past: qIndex(id) < anchorIdx }));
}
