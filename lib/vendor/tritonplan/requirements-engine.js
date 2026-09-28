// requirements-engine.js — the rule that decides which of a student's earned
// courses may fill which requirement bucket.
//
// Why this file exists: this rule used to live inline in
// app/tools/degree-audit.html, where the only way to check it was to open a
// browser. It is the single highest-stakes piece of logic in the project — a
// bucket wrongly marked ✗ (or ✓) is a wrong degree audit — and it has to hold
// across 8 college GE files and 127 major files. So it is pure: no DOM, no
// fetch, no imports, and `node --test tests/rules/requirements-engine.test.mjs`
// sweeps every college on every run.
//
// The two rules it encodes:
//
//   1. Within a band (major, or college GE), one earned course fills ONE
//      bucket. CSE 140 satisfies Systems or Theory, not both; that mirrors the
//      official audit and is why buckets are walked in file order with a
//      shared claim set.
//
//   2. EXCEPT the campuswide (university-wide) requirements — DEI, American
//      History & Institutions, and the Jane Teranes Climate Change Education
//      Requirement. UC San Diego sets these for the whole campus, not the
//      college, and every college file says in its own words that they overlap
//      everything else:
//        Sixth   DEI    "unrestricted double-counting with GE, major, and AHI"
//        Muir    JTCCER "May double-count with GE, DEI, major, or minor"
//        Marshall DEI   "may double-count with major, minor, college GE, ..."
//        Revelle JTCCER "may simultaneously count toward GE, DEI, and major"
//        Seventh JTCCER satisfied by SYN 1/1R, which "double-counts with the
//                       Synthesis bucket by design"
//      Rule 1 applied to them silently ate the qualifying course — MGT 18 was
//      consumed by Sixth's Social Analysis bucket and DEI rendered ✗ for a
//      student who had satisfied it; on Seventh, SYN 1/SYN 2 sit in both the
//      Synthesis bucket and the JTCCER bucket, so JTCCER could never be
//      satisfied there at all. They now get their own pass over the student's
//      whole earned record: they neither consume from nor are blocked by the
//      claim set, so they may share a course with a GE bucket, with the major,
//      and with each other.
//
// No college in app/data/college-ge/ states a restriction on these three; if
// one ever does, encode it on that bucket rather than reverting the rule.

/** Same normalizer as `norm` in tools.js. Kept local so this module has no
 *  imports and runs unchanged in node. */
export const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();

// The authority is the bucket's own `scope` flag, written into every
// app/data/college-ge/*.json campuswide bucket. The label test is the safety
// net: a re-harvest that drops the flag must not silently reintroduce the bug.
// Matches exactly 24 buckets (3 per college) and zero major-requirement files.
export const CAMPUSWIDE_LABEL =
  /diversity,\s*equity|american history and institutions|climate change education|\b(?:DEI|AHI|AH&I|JTCCER)\b/i;

/** True when a bucket is a UC San Diego campuswide requirement rather than a
 *  college GE or major requirement. */
export function isCampuswide(bucket) {
  if (!bucket) return false;
  return bucket.scope === 'university' || CAMPUSWIDE_LABEL.test(bucket.label || '');
}

/**
 * Allocate earned courses to buckets, in place.
 *
 * Mutates each bucket's `courses` to the list the audit should render: every
 * course the student has NOT earned (so the "select from" list stays complete),
 * plus the earned courses this bucket actually gets to claim.
 *
 * @param {Array}  buckets      requirement buckets, in file order
 * @param {Object} earnedUnits  { "MGT 18": 4, ... } — EARNED courses only
 *                              (in-progress courses are never claimed), keys
 *                              already normalized, value = units
 * @param {Object} [opts]       { campuswide: true } enables the second pass.
 *                              Pass it for the college band; the major band has
 *                              no campuswide buckets.
 */
export function allocate(buckets, earnedUnits, opts) {
  const list = buckets || [];
  const earned = earnedUnits || {};
  const twoPass = !!(opts && opts.campuswide);
  const claimed = new Set();

  // `exempt` buckets neither read nor write the claim set — that is the whole
  // campuswide exception, in one flag.
  const fill = (b, exempt) => {
    const keep = [];
    let got = b.examEarned || 0;
    for (const c of (b.courses || [])) {
      const k = norm(c);
      if (!Object.prototype.hasOwnProperty.call(earned, k)) { keep.push(c); continue; }
      if (!exempt && claimed.has(k)) continue;
      if (got >= b.needed) continue; // surplus — leave it for a later bucket
      if (!exempt) claimed.add(k);
      keep.push(c);
      got += b.kind === 'units' ? (earned[k] || 0) : 1;
    }
    b.courses = keep;
  };

  for (const b of list) if (!(twoPass && isCampuswide(b))) fill(b, false);
  for (const b of list) if (twoPass && isCampuswide(b)) fill(b, true);
  return list;
}

/**
 * Whether a bucket is satisfied, given the same earned map. Mirrors what
 * degree-audit.html renders as ✓ / ✗, so a test can assert the screen's verdict
 * without opening a browser.
 */
export function isSatisfied(bucket, earnedUnits) {
  const earned = earnedUnits || {};
  const mine = (bucket.courses || []).filter((c) =>
    Object.prototype.hasOwnProperty.call(earned, norm(c)));
  const got = (bucket.kind === 'units'
    ? mine.reduce((s, c) => s + (earned[norm(c)] || 0), 0)
    : mine.length) + (bucket.examEarned || 0);
  return got >= bucket.needed;
}
