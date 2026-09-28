// requirements-progress.js — everything that has to happen to a student's
// record and a set of requirement buckets BEFORE allocate() can score them,
// plus the one number the dashboard shows: courses taken vs. left.
//
// Why this file exists: expandBuckets() and applyExamCredits() used to live
// inline in app/tools/degree-audit.html, alongside the record map they read.
// The dashboard now shows "14 of 31 courses" for the major and the college,
// and that number is only honest if it comes from the SAME preprocessing the
// audit page uses — a second copy would drift the first time one of them was
// fixed. So the audit imports these too; there is one implementation.
//
// Unlike requirements-engine.js this module has imports (the AP/IB chart),
// but every import is pure, so `node --test` still runs it without a browser.
import { norm, allocate } from './requirements-engine.js';
import { AP_EXAMS, IB_EXAMS, getExam, resolveExemption } from './ap-ib-credit.js';

// ---- repair transfer rows that lost an equivalent on import ----
// The parser previously dropped a row's second UCSD equivalent when the
// PDF's text layer glued it to the institution line. Records imported before
// the fix still carry [MATH 10B] where UCSD posted [MATH 10B, MATH 20A], and
// nobody should have to re-import. The chart is the authority on what an exam
// grants, so an AP/IB row is completed from it — but only when
// the answer is unambiguous:
//   • the row already lists at least one equivalent (a row with none is a
//     no-credit exam like the IB Diploma, or a parse we cannot vouch for);
//   • exactly one chart tier, across exams of the row's board, is a STRICT
//     superset of what the row lists AND carries the row's posted units
//     (Calculus AB posts 4, BC posts 8 — the units are what tell them apart).
// Anything else is left exactly as imported. Returns new rows; the record is
// never mutated.
export function repairTransferEquivalents(transfer) {
  return (transfer || []).map((t) => {
    const board = t.subject === 'AP' || t.subject === 'IB' ? t.subject
      : /advanced placement/i.test(t.from || '') ? 'AP'
      : /international baccalaureate/i.test(t.from || '') ? 'IB' : '';
    const have = (t.approx || []).map(norm).filter(Boolean);
    if (!board || !have.length) return t;
    const units = +t.units || 0;
    const exams = board === 'AP' ? AP_EXAMS : IB_EXAMS;
    const candidates = new Set();
    for (const e of exams) {
      if ((e.units || 0) !== units) continue;
      for (const list of Object.values(e.exemptions || {})) {
        const tier = list.map(norm);
        if (tier.length > have.length && have.every((c) => tier.includes(c))) candidates.add(tier.join('|'));
      }
    }
    if (candidates.size !== 1) return t;
    const full = [...candidates][0].split('|');
    const approx = (t.approx || []).slice();
    for (const c of full) if (!have.includes(c)) approx.push(c);
    return { ...t, approx, repaired: true };
  });
}

/**
 * Build the course record map the audit works from: every completed course,
 * plus a UCSD-equivalent entry for each transfer row's approx[] codes (an
 * equivalent never overwrites a course actually taken here).
 *
 * @returns {{ rec: Object, takenEarned: Set, earnedUnits: Object }}
 *   rec         { "CSE 12": {status, units, grade, term, title, code, transfer?, src?} }
 *   takenEarned normalized codes with status !== 'wip'
 *   earnedUnits { "CSE 12": 4 } for takenEarned only — the shape allocate() takes
 */
export function buildRecordMap(courses, transfer) {
  const rec = {};
  const put = (code, o) => { const k = norm(code); if (k) rec[k] = o; };
  for (const c of (courses || []))
    put(c.subject + ' ' + c.number,
        { status: c.status, units: +c.units || 0, grade: c.grade,
          term: c.term, title: c.title, code: (c.subject + ' ' + c.number) });
  for (const t of (transfer || []))
    for (const eq of (t.approx || []))
      if (!rec[norm(eq)])
        put(eq, { status: 'earned', units: +t.units || 0, grade: t.grade,
                  term: t.term, title: t.title, code: eq, transfer: true,
                  src: (t.subject + ' ' + t.number) });
  const takenEarned = new Set(Object.keys(rec).filter(k => rec[k].status !== 'wip'));
  const earnedUnits = {};
  for (const k of takenEarned) earnedUnits[k] = rec[k].units || 0;
  return { rec, takenEarned, earnedUnits };
}

// ---- recover the student's AP/IB exams from their transfer rows ----
// College charts award GE credit for exams even when the exam carries no
// UCSD course exemption (e.g. AP US History = 2 humanities courses + AHI
// at Sixth), so buckets carry score-gated rules in b.examCredits and we
// need the exams themselves, not just their exemption courses. Declared
// exams (freshman flow) store examId/examScore and a "<name> — score <n>"
// title; PDF-imported rows have neither, but UC posts AP units only for
// scores of 3+ (IB HL 5+), so a unit-bearing row safely fires
// minimum-score rules.
const EXAM_ID = {};
for (const e of AP_EXAMS) EXAM_ID['AP ' + e.name.toUpperCase()] = e.id;
for (const e of IB_EXAMS) EXAM_ID['IB ' + e.name.toUpperCase()] = e.id;
export function declaredExamsFrom(transfer) {
  const declared = [];
  for (const t of (transfer || [])) {
    if (t.subject !== 'AP' && t.subject !== 'IB') continue;
    const m = /^(.+?)\s+—\s+score\s+(\d)$/.exec(t.title || '');
    const id = t.examId || EXAM_ID[t.subject + ' ' + String(m ? m[1] : t.title || '').trim().toUpperCase()];
    if (!id) continue;
    const score = t.examScore != null ? +t.examScore
      : (m ? +m[2] : ((+t.units || 0) > 0 ? (t.subject === 'AP' ? 3 : 5) : 0));
    if (score) declared.push({ id, kind: t.subject, score });
  }
  return declared;
}

// ---- expand "SUBJ 100-199"-style range tokens in requirement buckets ----
// Harvested files use ranges for "any upper-division X" buckets (CSE open
// electives, ASTR/PHYS electives, ...). A range can't match a course code
// literally — before this expansion such buckets never credited anything.
// Each range is replaced by the student's own courses that fall inside it;
// the range text is kept on the bucket for the SELECT FROM line. Optional
// b.exclude lists codes that may not double-count (e.g. core courses that
// sit inside the elective range but satisfy their own bucket).
const RANGE_RE = /^([A-Z]{2,6})\s+(\d+)\s*[-–]\s*(\d+)$/;
export function expandBuckets(buckets, rec) {
  for (const b of (buckets || [])) {
    const ranges = [], fixed = [];
    for (const c of (b.courses || [])) {
      const m = RANGE_RE.exec(norm(c));
      if (m) ranges.push({ subj: m[1], lo: +m[2], hi: +m[3], text: c });
      else fixed.push(c);
    }
    if (!ranges.length) continue;
    const excl = new Set((b.exclude || []).map(norm));
    const seen = new Set(fixed.map(norm));
    for (const k of Object.keys(rec)) {
      if (excl.has(k) || seen.has(k)) continue;
      const km = /^([A-Z]{2,6}) (\d+)[A-Z]*$/.exec(k);
      if (!km) continue;
      const n = +km[2];
      if (ranges.some(r => r.subj === km[1] && n >= r.lo && n <= r.hi)) {
        fixed.push(rec[k].code); seen.add(k);
      }
    }
    b.courses = fixed;
    b.rangeText = ranges.map(r => r.text).join(', ');
  }
}

// ---- score AP/IB exams against a bucket's examCredits rules (run after
// expandBuckets, before allocate). Each rule {exam, minScore, courses|units}
// credits the bucket when a matching exam was declared at/above minScore.
// Credit already earned through that exam's own course exemption inside
// this bucket is deducted (e.g. AP Psych 5 → PSYC 1 already counts in
// Social Analysis), so one exam never counts twice in a bucket — but an
// exam MAY credit several buckets, exactly as the college charts allow
// (AP US History = humanities GE and AHI).
export function applyExamCredits(buckets, declaredExams, takenEarned) {
  for (const b of (buckets || [])) {
    if (!b.examCredits) continue;
    b.examEarned = 0; b.examRows = [];
    const inBucket = new Set((b.courses || []).map(norm));
    for (const rule of b.examCredits) {
      if (b.examEarned >= b.needed) break;
      const d = declaredExams.find(x => x.id === rule.exam && x.score >= rule.minScore);
      if (!d) continue;
      const overlap = resolveExemption(d.id, d.score).courses
        .filter(c => inBucket.has(norm(c)) && takenEarned.has(norm(c))).length;
      const amt = b.kind === 'units'
        ? Math.max(0, (rule.units || 0) - overlap * 4)
        : Math.max(0, (rule.courses || 0) - overlap);
      if (!amt) continue;
      b.examEarned += amt;
      const exam = getExam(d.id);
      b.examRows.push({ kind: d.kind, name: exam ? exam.name : d.id, score: d.score,
        label: amt + (b.kind === 'units' ? ' units' : (amt === 1 ? ' course' : ' courses')) });
    }
  }
}

// ---- Academic Events that satisfy a requirement outright ----
// The transcript's "Academic Events" list records campus-wide requirements
// cleared without a course on this record: "AMER HIST& INST REQT SATISFIED
// 12/05/2025" (by exam or transfer before enrolment). The AHI bucket in every
// college file is a course list, so without this the audit shows ✗ under a
// line the registrar has already closed.
const EVENT_RULES = [
  { event: /AMER(?:ICAN)?\s*HIST/i, bucket: /american history and institutions|\bAH&?I\b/i, name: 'American History & Institutions' },
];
export function applyEventCredits(buckets, events) {
  for (const ev of (events || [])) {
    if (!/SATISF|COMPLET|MET\b/i.test(ev.event || '')) continue;
    for (const rule of EVENT_RULES) {
      if (!rule.event.test(ev.event || '')) continue;
      for (const b of (buckets || [])) {
        if (!rule.bucket.test(b.label || '')) continue;
        if ((b.examEarned || 0) >= b.needed) continue;
        b.examEarned = b.needed;
        b.examRows = (b.examRows || []).concat([{ kind: 'Event', name: rule.name, score: '',
          label: b.needed + (b.kind === 'units' ? ' units' : (b.needed === 1 ? ' course' : ' courses')),
          note: 'Recorded as satisfied in Academic Events' + (ev.date ? ' on ' + ev.date : '') }]);
      }
    }
  }
}

/**
 * The whole sequence, in the order the audit runs it. Mutates both bucket
 * arrays (expand, exam credit, allocate) and returns the record context the
 * caller needs to read them. This is the ONE entry point both the audit page
 * and the dashboard call, so they cannot disagree.
 */
export function prepareBands(courses, transfer, majorBuckets, collegeBuckets, events) {
  transfer = repairTransferEquivalents(transfer);
  const ctx = buildRecordMap(courses, transfer);
  ctx.declaredExams = declaredExamsFrom(transfer);
  expandBuckets(majorBuckets, ctx.rec);
  allocate(majorBuckets, ctx.earnedUnits);
  expandBuckets(collegeBuckets, ctx.rec);
  applyExamCredits(collegeBuckets, ctx.declaredExams, ctx.takenEarned);
  applyEventCredits(collegeBuckets, events);
  allocate(collegeBuckets, ctx.earnedUnits, { campuswide: true });
  return ctx;
}

// Requirement lines that are not "take N of these courses". They can never
// be satisfied by a course, so counting them would leave a permanent
// shortfall on a bar that claims to count courses.
const NOT_COURSE_BUCKET = new Set(['unitTotal', 'seeCollegeGE', 'proficiency', 'manual']);
export function isCourseBucket(b) {
  return !!b && b.kind !== 'units' && !NOT_COURSE_BUCKET.has(b.type) && (+b.needed || 0) > 0;
}

/**
 * Courses taken vs. left across a band, AFTER prepareBands().
 *
 * taken   = per bucket, the earned courses allocate() let it claim plus any
 *           exam/event credit, capped at `needed` — a bucket cannot be more
 *           than done
 * wip     = in-progress courses sitting in the bucket's list, capped at what
 *           is still missing. In-progress courses are not claimed by
 *           allocate(), so a small claim set here stops one WIP course filling
 *           two buckets.
 * planned = courses on the student's saved WebReg schedule (`planned`, a Set
 *           of normalized codes) that would fill what is still missing after
 *           earned and in-progress. Same claim rule. A planned course that is
 *           already on the record counts as whatever the record says, not as
 *           planned.
 * total   = sum of `needed`
 */
export function courseProgress(buckets, rec, takenEarned, planned) {
  let taken = 0, wip = 0, plan = 0, total = 0;
  const claimed = new Set();
  const plannedSet = planned || new Set();
  for (const b of (buckets || [])) {
    if (!isCourseBucket(b)) continue;
    const need = +b.needed;
    const earned = (b.courses || []).filter(c => takenEarned.has(norm(c))).length + (b.examEarned || 0);
    const got = Math.min(need, earned);
    let inProg = 0, ahead = 0;
    for (const c of (b.courses || [])) {
      const k = norm(c);
      if (got + inProg + ahead >= need) break;
      if (claimed.has(k)) continue;
      if (rec[k] && rec[k].status === 'wip') { claimed.add(k); inProg++; }
      else if (!rec[k] && plannedSet.has(k)) { claimed.add(k); ahead++; }
    }
    taken += got; wip += inProg; plan += ahead; total += need;
  }
  return { taken, wip, planned: plan, total };
}
