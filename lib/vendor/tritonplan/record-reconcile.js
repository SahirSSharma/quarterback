// Keep an imported record's three views of the same coursework in agreement.
//
// A parsed Academic History carries the SAME courses three times:
//   • `terms[].courses` — what the Academic History page prints, by quarter
//   • `transfer[]`      — the Transfer Credit table, with its UCSD equivalents
//   • `courses[]`       — the flat list every tool (Audit, Planner, GPA) reads
//
// The import review table only ever edited the third one. So a student who
// added a course the PDF had missed saw it appear in the Degree Audit and
// nowhere on their Academic History — and a student who DELETED a stray row saw
// it vanish from the tools while the Academic History kept printing it. Both
// halves of that were reported on 2026-08-03: a missing AP-credit MATH 20B that
// "is still not showing up on my academic history" even after adding it by hand.
//
// The review table is the ONLY place a student can correct their record, so its
// output is the authority here: this walks the edited flat list and rewrites
// terms[] and transfer[] to match it. Nothing is invented — a row is only ever
// kept, updated, moved, or dropped.

const codeOf = (c) => `${String(c.subject || '').trim()} ${String(c.number || '').trim()}`
  .toUpperCase().trim();
const termOf = (c) => String(c.term || '').trim().toUpperCase();

// Transfer credit is the one "term" that is not a quarter. The parser stamps it
// XFER; a student typing it by hand may well write the same thing.
const XFER = 'XFER';

const QUARTER = { FA: 'Fall', WI: 'Winter', SP: 'Spring', S1: 'Summer Session I', S2: 'Summer Session II', S3: 'Summer Session III', SU: 'Summer' };

// "FA26" -> "Fall Quarter 2026", so a term the student invents prints like the
// ones the PDF supplied. Anything unrecognised is shown verbatim rather than
// mangled into a wrong quarter.
function termName(code) {
  const m = /^([A-Z]{2})(\d{2})$/.exec(String(code || '').toUpperCase());
  if (!m || !QUARTER[m[1]]) return String(code || '');
  const year = Number(m[2]) >= 70 ? `19${m[2]}` : `20${m[2]}`;
  const q = QUARTER[m[1]];
  return q.startsWith('Summer') ? `${q} ${year}` : `${q} Quarter ${year}`;
}

/**
 * Rewrite `record.terms` and `record.transfer` so they agree with `edited`,
 * the flat course list collected from the import review table.
 *
 * Returns a NEW record; the input is not mutated.
 */
export function reconcileRecord(record, edited) {
  const rec = record || {};
  const rows = Array.isArray(edited) ? edited.filter((c) => c && c.subject && c.number) : [];

  // Every edited row, by term + course code. A student can legitimately hold
  // the same course code in two terms (a repeat), so the term is part of the
  // key and each occurrence is consumed at most once.
  const pending = new Map();
  for (const c of rows) {
    const k = `${termOf(c)}|${codeOf(c)}`;
    if (!pending.has(k)) pending.set(k, []);
    pending.get(k).push(c);
  }
  const take = (term, code) => {
    const k = `${String(term || '').toUpperCase()}|${code}`;
    const list = pending.get(k);
    if (!list || !list.length) return null;
    const hit = list.shift();
    if (!list.length) pending.delete(k);
    return hit;
  };

  // ---- terms: keep what survived the edit, with the edited values ----------
  const terms = (rec.terms || []).map((t) => {
    const kept = [];
    for (const cr of (t.courses || [])) {
      const hit = take(t.code, codeOf(cr));
      if (!hit) continue; // the student removed this row
      kept.push({
        ...cr,
        title: hit.title != null && hit.title !== '' ? hit.title : cr.title,
        units: hit.units != null ? String(hit.units) : cr.units,
        grade: hit.grade || '',
      });
    }
    const next = { ...t, courses: kept };
    // "In progress" is derived from the grades, so an edit that fills one in
    // has to be able to close the term out (and clearing one, re-open it).
    next.inProgress = kept.length > 0 && kept.every((c) => !c.grade);
    return next;
  });

  // ---- transfer: keep the equivalents the student still claims -------------
  const transfer = (rec.transfer || []).map((tr) => {
    const approx = (tr.approx || []).filter((k) => take(XFER, k.toUpperCase()));
    return { ...tr, approx };
  });

  // ---- whatever is left is new: place it where the student put it ----------
  const leftovers = [];
  for (const list of pending.values()) leftovers.push(...list);

  for (const c of leftovers) {
    const term = termOf(c);
    // Transfer credit — including a row with no term at all, which is what an
    // "+ Add a course" row looks like until it is given one. Guessing a quarter
    // for it would print a course in a term the student never attended;
    // transfer credit is the honest place for coursework with no UCSD term.
    if (!term || term === XFER) {
      transfer.push({
        subject: String(c.subject || '').toUpperCase(),
        number: String(c.number || '').toUpperCase(),
        title: c.title || '',
        from: 'Added by you',
        units: Number(c.units) || 0,
        grade: c.grade || 'P',
        term: XFER,
        level: /^[12]\d{2}$/.test(String(c.number)) ? 'UD' : 'LD',
        approx: [codeOf(c)],
        manual: true,
      });
      continue;
    }
    const row = {
      subject: String(c.subject || '').toUpperCase(),
      number: String(c.number || '').toUpperCase(),
      title: c.title || '',
      units: c.units != null ? String(c.units) : '',
      grade: c.grade || '',
      points: '',
    };
    const existing = terms.find((t) => String(t.code || '').toUpperCase() === term);
    if (existing) {
      existing.courses.push(row);
      existing.inProgress = existing.courses.every((x) => !x.grade);
    } else {
      terms.push({ term: termName(term), code: term, courses: [row], inProgress: !row.grade, manual: true });
    }
  }

  return { ...rec, terms, transfer, courses: rows };
}

export const __test = { termName };
