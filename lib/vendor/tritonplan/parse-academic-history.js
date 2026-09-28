// Parser for a UCSD "Academic History" page/PDF, pasted as text.
// Turns the copied text into the same record schema the tools consume, so a
// signed-in student can import their own history and immediately get a working
// Degree Audit, Planner, and GPA Calculator. Order-tolerant: it anchors on
// "Term:" headers and self-contained course rows, so it handles both a
// select-all copy of the web page and text extracted from the PDF.

// Every Major:/Minor: line, not just the first. Lives in program-match.js so
// the matcher's tests can exercise it without this file.
import { readMajors, readMinors } from './program-match.js';

const TERM_CODE = (name) => {
  const m = /(Fall|Winter|Spring|Sum(?:mer)? Ses(?:sion)?)\s*(I{1,2})?\s*(?:Qtr\s*)?(\d{4})/i.exec(name);
  if (!m) return name.replace(/\s+/g, '').slice(0, 6);
  const yy = m[3].slice(2);
  const s = m[1].toLowerCase();
  if (s.startsWith('fall')) return 'FA' + yy;
  if (s.startsWith('winter')) return 'WI' + yy;
  if (s.startsWith('spring')) return 'SP' + yy;
  // summer session I / II
  return (m[2] === 'II' ? 'S2' : 'S1') + yy;
};

// A course row: SUBJ NUM  Title...  Units  [Grade]  Points
// Units/points allow one OR two decimals: a 7.5-unit course prints as "7.5" on
// some records, and demanding "\d\.\d\d" silently dropped the whole row.
const ROW = /^([A-Z]{2,4})\s+(\d{1,3}[A-Z]{0,2})\s+(.+?)\s+(\d+\.\d{1,2})(?:\s+([A-Z][+-]?|P|NP|IP|W|S|U))?\s+(\d+\.\d{1,2})\s*$/;
const GRADED = /^[A-F][+-]?$/;

/*
 * Transfer Credit table. One LOGICAL row is spread over up to three PHYSICAL
 * lines, because "Course Title / Transferred From" is a two-line cell and the
 * "UCSD Approx" column is a list:
 *
 *   PSYC 1A General Psychology                 <- head:  subject, number, title
 *   Grossmont College 6.00 P SP24 LD PSYC 1    <- spine: from, units, grade, term, level, first equivalent
 *   PSYC 2                                     <- continuation: further equivalents
 *
 * A row is recognised on the SPINE — the "<units> [grade] <term> <LD|UD>"
 * run — never on the subject token. Anchoring on a literal "AP"/"IB" subject
 * (as this did until 2026-07-25) meant a community-college row could not start
 * a row at all: it was swallowed into the previous AP/IB segment, so the
 * student lost the transfer units AND gained UCSD courses they never took,
 * harvested out of the swallowed rows' text and written to completedCourses as
 * "earned". The spine carries no subject, so every source institution works.
 */
const XFER_SPINE = /^(.*?)\s*\b(\d{1,3}(?:\.\d{1,2})?)(?:\s+([A-Z]{1,2}[+-]?))?\s+((?:FA|WI|SP|SU|SS|S1|S2|S3)\d{2})\s+(LD|UD)\b\s*(.*)$/;
// "SUBJ NUM Title" — number is alphanumeric because exam rows use codes like
// CA4, MAA5, DIPL alongside ordinary course numbers like 1A, 180.
const XFER_HEAD = /^([A-Z]{2,6})\s+([A-Z0-9]{1,6})\s+(\S.*)$/;
// A continuation line is ONLY a list of course codes. Requiring the whole line
// to be codes is what stops prose — a wrapped title, a footer, the disclaimer —
// from ever reaching the equivalency harvester.
const XFER_CONT = /^[A-Z]{2,4}\s+\d{1,3}[A-Z]{0,2}(?:\s+[A-Z]{2,4}\s+\d{1,3}[A-Z]{0,2})*$/;

// Roman numerals are the reason "Calculus II 6.00" used to yield the course
// "II 6": they are the one token shape that is indistinguishable from a subject
// code. No UCSD subject is a bare Roman numeral, so excluding them is loss-free.
const ROMAN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

// The two source institutions whose names are fixed strings. When the PDF puts
// a whole row on one line these are the only "Transferred From" values that can
// be split back out of the title with certainty — and they have to be, because
// degree-audit.html identifies a student's AP/IB exam by that exact title.
const INSTITUTION = /\s*(Advanced Placement Credit|International Baccalaureate Examination)\s*$/i;
// The same names at the START of a line, with whatever follows them (an
// equivalent course code glued on by pdf.js, or nothing).
const INSTITUTION_LEAD = /^(Advanced Placement Credit|International Baccalaureate Examination)\b\s*(.*)$/i;

// Collect UCSD-equivalent course codes out of one chunk of "UCSD Approx" text.
// Never called with anything but text from AFTER the spine or a continuation
// line, so a row's own title and source institution can't leak in here.
function addApprox(row, text) {
  // One exam can grant a whole sequence — AP Calculus BC is MATH 20A *and*
  // MATH 20B — and the "UCSD Approx" cell writes the second course without
  // repeating the subject: "MATH 20A 20B", "MATH 20A/20B", "MATH 20A, 20B".
  // Only the first was ever read, so the student silently lost half an exam's
  // credit.
  //
  // A bare follow-on number is only taken when it ENDS IN A LETTER (20B, 2C).
  // A plain integer is the shape of page furniture — "page 1 of 2" — and
  // crediting a course off a page number is worse than missing one.
  // The trailing run is captured WHOLE — a repeated capture group keeps only
  // its last repetition, which quietly lost the middle of "PHYS 2A 2B 2C".
  const code = /\b([A-Z]{2,4})\s+(\d{1,3}[A-Z]{0,2})((?:(?:\s*[,/]\s*|\s+)\d{1,3}[A-Z]{1,2}\b)*)/g;
  const own = row.subject + ' ' + row.number;
  const add = (k) => {
    if (k !== own && !row.approx.includes(k)) row.approx.push(k);
  };
  let m;
  while ((m = code.exec(text))) {
    if (m[1] === 'AP' || m[1] === 'IB' || ROMAN.test(m[1])) continue;
    add(m[1] + ' ' + m[2]);
    for (const n of (m[3] || '').match(/\d{1,3}[A-Z]{1,2}\b/g) || []) add(m[1] + ' ' + n);
  }
}

// Strip characters that could enable HTML injection when a parsed free-text
// field (course title, student name, college, etc.) is later rendered into
// innerHTML. A legitimate UCSD Academic History never contains angle brackets
// in these fields, so removing them is loss-free and neutralizes stored-XSS at
// the source — every downstream renderer inherits the protection. Each DOM sink
// still escapes on output as defense-in-depth.
const clean = (s) => String(s == null ? '' : s).replace(/[<>]/g, '').trim();

// Labels a UCSD Academic History uses. A continuation line is only joined onto
// a field when it is NOT itself one of these — see fld().
const FIELD_LABELS = /^\s*(Student(?:\s+Level)?|PID|College|Major|Minor|Intended Degree|Degree|Level|Class Level|Admission Term|Term|Academic (?:Events|Status)|Transfer Courses|Cumulative|Total|Prepared)\b/i;

/**
 * Read a "Label: value" field.
 *
 * PDFs wrap. "Major: Bioengineering: Biotechnology" comes out of pdf.js as
 * "Major: Bioengineering:" / newline / "Biotechnology", and a single-line
 * regex silently kept only "Bioengineering:" — which then exact-matched the
 * PARENT major and produced a confident, wrong Degree Audit (docs/ATLAS.md,
 * 2026-07-24). So: when the captured value is obviously incomplete — it ends
 * on a separator, or the next line is plainly a continuation rather than the
 * next labelled field — the following line is joined on.
 */
function fld(text, label) {
  const m = new RegExp(label + '\\s*:?\\s*(.+(?:\\n.+)?)', 'i').exec(text);
  if (!m) return '';
  const [first, next] = String(m[1]).split('\n');
  const head = clean(first);
  if (next == null) return head;
  const tail = clean(next);
  // A value cut off mid-name: "Bioengineering:", "Mechanical Engineering (",
  // "Political Science /", or a trailing hyphen.
  const dangling = /[:\-–—/(&]$/.test(head) || /\($/.test(head);
  // A continuation closes a bracket the first line opened.
  const closes = /^[^()]*\)/.test(tail) && /\([^)]*$/.test(head);
  if (!tail || FIELD_LABELS.test(next) || /^[A-Z][A-Za-z ]{0,24}:/.test(tail)) return head;
  if (!dangling && !closes) return head;
  return clean(head + (/[-–—/(]$/.test(head) ? '' : ' ') + tail);
}

export function parseAcademicHistory(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => l.trim());

  // ---- student / general info ----
  const student = {
    name: fld(raw, 'Student'),
    pid: (/(A\d{7,9})/.exec(raw) || [])[1] || fld(raw, 'PID'),
    level: fld(raw, 'Student Level'),
    college: fld(raw, 'College'),
    major: fld(raw, 'Major'),
    degree: fld(raw, 'Intended Degree'),
    // EVERY major and minor the record names. `major` above stays the first
    // major — the one the Degree Audit checks.
    majors: readMajors(raw),
    minors: readMinors(raw),
  };

  // ---- cumulative summary ----
  const cumRows = [];
  for (const l of lines) {
    const m = /^(Letter|P\/NP|TOTAL)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(l);
    if (m) cumRows.push({ option: m[1], attm: m[2], pssd: m[3], gpaCrd: m[4], points: m[5], gpa: m[6] });
  }
  const totalRow = cumRows.find((r) => r.option === 'TOTAL') || cumRows.find((r) => r.option === 'Letter');
  student.uc_gpa = totalRow ? parseFloat(totalRow.gpa) : null;
  // fallback: if the cumulative block didn't parse cleanly (e.g. PDF column
  // split), compute UC GPA from the graded course rows we did capture.
  const GP = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
  const upperDiv = (/Upper Division Units Passed:\s*([\d.]+)/i.exec(raw) || [])[1] || '';

  // ---- terms + courses ----
  const terms = [];
  let cur = null;
  const inTransfer = () => transferStarted;
  let transferStarted = false;
  for (const l of lines) {
    if (/^Transfer Courses/i.test(l) || /UCSD\s*Approx/i.test(l)) transferStarted = true;
    if (/^Academic Events/i.test(l)) transferStarted = false;
    const th = /^Term:\s*(.+)/i.exec(l);
    if (th) {
      const tname = th[1].replace(/\s*(Not an Official Transcript|page\s*\d+\s*of\s*\d+).*$/i, '').trim();
      cur = { term: tname, code: TERM_CODE(tname), courses: [] }; terms.push(cur); continue;
    }
    if (transferStarted) continue; // transfer rows handled below
    if (cur) {
      const m = ROW.exec(l);
      if (m) {
        const grade = (m[5] || '').trim();
        cur.courses.push({ subject: m[1], number: m[2], title: clean(m[3]), units: m[4], grade, points: m[6] });
      }
      const cp = /Term Credits Passed:\s*([\d.]+)/i.exec(l); if (cp) cur.creditsPassed = cp[1];
      const gp = /Term Grade Points:\s*([\d.]+)/i.exec(l); if (gp) cur.gradePoints = gp[1];
      const gc = /Term GPA Credits:\s*([\d.]+)/i.exec(l); if (gc) cur.gpaCredits = gc[1];
      const tg = /Term GPA:\s*([\d.]+)/i.exec(l); if (tg) cur.termGpa = tg[1];
      const as = /Academic Status:\s*(.+)/i.exec(l); if (as) cur.status = clean(as[1]);
      const hn = /Term Honors:\s*(.+)/i.exec(l); if (hn) cur.honors = clean(hn[1]);
    }
  }
  // a term with no graded course is in progress
  for (const t of terms) t.inProgress = t.courses.length > 0 && t.courses.every((c) => !c.grade);

  // ---- transfer credit: any source institution, plus its UCSD equivalents ----
  // Row shape mirrors buildCredit() in app/tools/import.html, which is the
  // reference for what the tools consume — including units as a Number.
  const transfer = [];
  const tIdx = lines.findIndex((l) => /^Transfer Courses/i.test(l) || /UCSD\s*Approx/i.test(l));
  const eIdx = lines.findIndex((l) => /^Academic Events/i.test(l));
  if (tIdx >= 0) {
    // A PDF text layer is not always in visual order, so the "Academic Events"
    // heading can be emitted before the transfer rows. Ending the block at the
    // first such heading regardless would cut every row off. Take the first one
    // that actually leaves rows behind.
    let xEnd = lines.length;
    for (let i = tIdx + 1; i < lines.length; i++) {
      if (!/^Academic Events/i.test(lines[i])) continue;
      if (lines.slice(tIdx, i).some((l) => XFER_SPINE.test(l))) { xEnd = i; break; }
    }
    const blk = lines.slice(tIdx, xEnd);
    let head = null; // most recent head line not yet attached to a row
    let row = null;  // row currently accepting continuation lines

    // A line that is nothing but "SUBJ NUM" is ambiguous: the open row's UCSD
    // equivalent, or the NEXT row's head with its title clustered onto a line
    // of its own. Reading it as an equivalent when it was a head costs the
    // student twice over — the eaten head becomes a UCSD course they never
    // took, and its own spine is then dropped by the `if (!subject)` guard
    // below, so the transfer course vanishes. A student reported exactly that
    // pair of symptoms: "for 1 of my courses, I have 5 UCSD approx courses, and
    // the other transfer courses do not show".
    //
    // The block itself settles it. Look forward to whichever comes first:
    //   • a head line that carries its own title — the next row is provided
    //     for, so this line is an equivalent;
    //   • a spine whose own text already contains a course code — likewise;
    //   • a spine with NO code and no head pending — nothing else in the block
    //     can name that row, so this line is its head.
    // Only a line holding exactly ONE code can be re-read this way: two codes
    // cannot be one head, and "BILD 2 BILD 3" is an equivalence list.
    const isBareHead = (i) => {
      if (head) return false;                       // a head is already waiting
      if (!/^[A-Z]{2,4}\s+\d{1,3}[A-Z]{0,2}$/.test(blk[i])) return false;
      for (let j = i + 1; j < blk.length; j++) {
        const sp = XFER_SPINE.exec(blk[j]);
        if (sp) return !XFER_HEAD.test(sp[1]);
        if (XFER_HEAD.test(blk[j]) && !XFER_CONT.test(blk[j])) return false;
      }
      return false;                                 // no spine follows: an equivalent
    };

    for (let i = 0; i < blk.length; i++) {
      const l = blk[i];
      const sp = XFER_SPINE.exec(l);
      if (sp) {
        const [, pre, units, grade, term, level, tail] = sp;
        let subject = '', number = '', title = '', from = clean(pre);
        if (head) {
          [subject, number, title] = head;
          head = null;
        } else {
          // Head and spine landed on one physical line. Take the course code
          // off the front; title and institution are not separable without the
          // column geometry, so keep them together rather than guess.
          const hm = XFER_HEAD.exec(pre);
          if (hm) {
            subject = hm[1]; number = hm[2]; title = clean(hm[3]); from = '';
            const im = INSTITUTION.exec(title);
            if (im) { from = clean(im[1]); title = clean(title.slice(0, im.index)); }
          }
        }
        // No identifiable course code: emit nothing. A missing transfer row is
        // recoverable by hand on the import review screen; an invented one is
        // a wrong degree audit the student has no reason to distrust.
        if (!subject) { row = null; continue; }
        row = { subject, number, title, from, units: parseFloat(units) || 0, grade: grade || 'P', term, level, approx: [] };
        addApprox(row, tail);
        transfer.push(row);
        continue;
      }
      // Checked before XFER_HEAD: two codes on one line ("PHYS 1A PHYS 1B")
      // also satisfy the head shape, and inside an open row they are equivalents
      // — unless the block says this one is a head with its title on the next
      // line (see isBareHead above).
      if (row && XFER_CONT.test(l) && !isBareHead(i)) { addApprox(row, l); continue; }
      const hm = XFER_HEAD.exec(l);
      if (hm) { head = [hm[1], hm[2], clean(hm[3])]; row = null; continue; }
      if (isBareHead(i)) {
        const [subject, number] = l.split(/\s+/);
        head = [subject, number, ''];   // title arrives on a following line
        row = null;
        continue;
      }
      // An institution line under an open row. In a PDF whose head and spine
      // share a physical line, the institution is printed on the NEXT line —
      // and pdf.js clusters by y, so the row's second UCSD equivalent, which
      // sits in the Approx column on that same next line, is glued onto it:
      //   "IB MAA5 Math Analysis & Approaches 8.00 P SP25 LD MATH 10B"
      //   "International Baccalaureate Examination MATH 20A"
      // Before this branch that line was prose, MATH 20A was dropped, and the
      // student's own Calculus I requirement read ✗ on the audit. The
      // institution name is the whole guard: a
      // wrapped title never starts with an exam board's name.
      if (row) {
        const inst = INSTITUTION_LEAD.exec(l);
        if (inst) {
          if (!row.from) row.from = clean(inst[1]);
          if (inst[2] && XFER_CONT.test(inst[2])) addApprox(row, inst[2]);
          continue;
        }
      }
      // Anything else is a wrapped title or a wrapped institution name. If a
      // head is waiting without one, this is its title — that is the whole
      // reason the head was on a line by itself. Otherwise the line belongs to
      // the current row, which stays open for its remaining equivalents; only
      // the next head or spine ends it.
      if (head && !head[2]) head[2] = clean(l);
    }
  }

  // ---- academic events ----
  const events = [];
  if (eIdx >= 0) {
    for (const l of lines.slice(eIdx + 1)) {
      const m = /^(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s*$/.exec(l);
      if (m) events.push({ event: clean(m[1]), date: m[2] });
    }
  }

  // ---- flat course list for the tools ----
  const courses = [];
  for (const t of terms) {
    for (const c of t.courses) {
      const status = c.grade ? 'earned' : 'wip';
      courses.push({ subject: c.subject, number: c.number, title: c.title, term: t.code, grade: c.grade || null, units: parseFloat(c.units) || 0, status });
    }
  }
  // UCSD-equivalent courses from transfer credit satisfy prereqs/requirements
  for (const tr of transfer) {
    for (const k of (tr.approx || [])) {
      const [subject, number] = k.split(' ');
      if (subject && number && !courses.some((c) => c.subject === subject && c.number === number)) {
        courses.push({ subject, number, title: k + ' (transfer credit)', term: 'XFER', grade: 'P', units: 0, status: 'earned' });
      }
    }
  }

  if (student.uc_gpa == null) {
    let gp = 0, gu = 0;
    for (const c of courses) if (c.grade && GP[c.grade.toUpperCase()] != null) { gp += GP[c.grade.toUpperCase()] * c.units; gu += c.units; }
    student.uc_gpa = gu ? Math.round((gp / gu) * 1000) / 1000 : null;
  }

  return {
    student,
    cumulative: { rows: cumRows, upperDivUnits: upperDiv },
    terms, transfer, events, courses,
    _parsedAt: null, // stamped by caller
  };
}
