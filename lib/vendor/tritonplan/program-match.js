// program-match.js — the ONE place a student's program name becomes a
// requirement set.
//
// Why this file exists: the old matcher (tools.js `normMajor` + an
// exact → prefix → substring ladder) answered CONFIDENTLY and WRONGLY whenever
// two program names overlapped. A "Mathematics-Computer Science" student was
// shown the Computer Science audit; every parenthesized specialization
// ("Mechanical Engineering (Controls and Robotics)") silently collapsed into
// its parent. Both rendered `matched: true` with no caveat — the worst failure
// mode this project has, because a confidently-wrong audit is more damaging
// than an honest "we don't know".
//
// The rules that make that class of bug impossible:
//   1. ONE normalization function, used on both sides of every comparison.
//   2. A program name is never matched INSIDE a different program's name.
//      No substring tier, no prefix-of-a-longer-name tier.
//   3. A match must be UNAMBIGUOUS to be used. Two candidates that survive a
//      tier means AMBIGUOUS — never "take the first" or "take the longest".
//   4. Specializations are addressable: "Base (Spec)", "Base: Spec",
//      "Base with Specialization in Spec", "Base - Spec", "Base / Spec" all
//      parse into the same (base, spec) pair, so the specialization entry wins
//      on its own merits. Falling back to the general/parent set is allowed but
//      is reported as MATCH.PARENT so the UI must caveat it.
//   5. "no match", "ambiguous" and "the data failed to load" are three
//      different statuses, in the code and on screen.
//
// Pure: no DOM, no fetch, no imports. Runs identically in the browser and in
// `node --test`, which is what lets tests/rules/program-match.test.mjs sweep
// all 127 majors on every run.

/* ────────────────────────────── statuses ────────────────────────────── */

export const MATCH = Object.freeze({
  EXACT: 'exact',        // one unambiguous requirement set — use it, no caveat
  PINNED: 'pinned',      // the student picked this set themselves
  PARENT: 'parent',      // general set stood in for an unlisted specialization
  AMBIGUOUS: 'ambiguous',// 2+ sets tie — refuse to guess, ask the student
  NONE: 'none',          // nothing plausible in the index
  UNAVAILABLE: 'unavailable', // index/file did not load — a network problem
});

/** True when the status means "these buckets are the student's own set". */
export function isConfident(status) {
  return status === MATCH.EXACT || status === MATCH.PINNED;
}

/* ─────────────────────── canonical normalization ────────────────────── */

// Non-prefix abbreviations UCSD's own screens and PDFs emit. A token here is
// rewritten before comparison. Prefix truncations ("Interdisc" for
// "Interdisciplinary", "Elec" for "Electrical") do NOT belong here — they are
// handled generically by the alignment tier below, which needs no table.
const ABBREV = Object.freeze({
  '&': 'and',
  'w': 'with',
  'w/': 'with',
  'wi': 'with',
  'engr': 'engineering',
  'engrg': 'engineering',
  'sci': 'science',
  'scis': 'sciences',
  'mgmt': 'management',
  'mgt': 'management',
  'intl': 'international',
  'intnl': 'international',
  'natl': 'national',
  'amer': 'american',
  'ameri': 'american',
  'spec': 'specialization',
  'specl': 'specialization',
  'conc': 'concentration',
  'dept': 'department',
  'stds': 'studies',
  'stdies': 'studies',
  'prog': 'program',
  'lang': 'language',
  'ling': 'linguistics',
  'psy': 'psychology',
  'psych': 'psychology',
  'soc': 'sociology',
  'econ': 'economics',
  'poli': 'political',
  'polsci': 'political science',
  'cog': 'cognitive', // too short for the generic truncation tier below
  'sys': 'systems',
  'syst': 'systems',
  'env': 'environmental',
  'envir': 'environmental',
  'ee': 'electrical engineering',
  'me': 'mechanical engineering',
  'cs': 'computer science',
  'cse': 'computer science',
});

// Words that carry no identity — dropped from a SPECIALIZATION only, so
// "(Specialization in Cognition and Language)", "Cultures Emphasis" and
// "Concentration in Biostatistics" all reduce to the thing that distinguishes
// them. Never dropped from a base name (there is no major called "Studies").
const SPEC_NOISE = new Set([
  'specialization', 'specializations', 'concentration', 'concentrations',
  'emphasis', 'track', 'option', 'in', 'a', 'the', 'with',
]);

// A parenthesized qualifier that means "this entry IS the general program",
// not a sub-program of it: `Public Health (General)`, `Economics and
// Mathematics (Joint Major)`.
const GENERAL_SPEC = new Set(['general', 'joint major', 'general track', 'general program']);

const DEGREE_PAREN = /\((?:\s*(?:b|m)\.?\s*(?:s|a|as|fa|arch)\.?\s*|\s*bachelor[^)]*|\s*master[^)]*)\)/gi;
const DEGREE_TAIL = /[,\s]+(?:b\.?\s?[sa]\.?|m\.?\s?[sa]\.?|bachelor of (?:science|arts)|major|degree)\s*$/i;

/* ──────────────────── UCSD's compressed field form ──────────────────── */

// UCSD's own screens carry the major in a ~30-character field, produced by
// deleting the spaces and squeezing the words. "Mechanical Engineering with
// Specialization in Renewable Energy and Environmental Flows" reaches a
// student as `MechEngW/SpecRnEnergy&EnvFlows`. Nothing downstream — not the
// separators, not tokenization, not alignment — can read that until the word
// boundaries are back, so restoring them runs FIRST, on both sides of every
// comparison.
//
// The boundaries are recoverable because the squeeze is CamelCase: a new word
// always starts with a capital. On a normally spaced name the transform is a
// no-op (asserted over every index entry in the test), which is what makes it
// safe to run unconditionally rather than behind a heuristic.
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
const ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;

/** Restore the word boundaries a compressed major field deleted. Idempotent. */
export function decompressName(s) {
  return String(s == null ? '' : s)
    .replace(CAMEL_BOUNDARY, '$1 $2')
    .replace(ACRONYM_BOUNDARY, '$1 $2')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the raw name was written in the squashed, no-spaces form. */
function isCompressed(s) {
  return /[a-z0-9][A-Z]/.test(String(s == null ? '' : s));
}

/** Lowercase, de-Unicode, expand `&`, join wrapped lines. Shared entry point. */
function flatten(s) {
  return decompressName(s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Tokenize + expand abbreviations. The single comparison currency. */
function tokens(s, { noise = null } = {}) {
  const out = [];
  for (const raw of flatten(s).split(/[^a-z0-9&']+/)) {
    if (!raw) continue;
    const t = raw.replace(/'/g, '');
    if (!t) continue;
    const expanded = Object.prototype.hasOwnProperty.call(ABBREV, t) ? ABBREV[t] : t;
    for (const piece of expanded.split(' ')) {
      if (!piece) continue;
      if (noise && noise.has(piece)) continue;
      out.push(piece);
    }
  }
  return out;
}

/**
 * Normalize a program name to its canonical comparison key.
 * The ONE function every tier and both sides of every comparison go through.
 */
export function normProgram(s) {
  return tokens(String(s == null ? '' : s).replace(DEGREE_PAREN, ' ').replace(DEGREE_TAIL, '')).join(' ');
}

// Specialization separators, in the order they are tried. Each returns
// [base, spec] or null. Order matters: the wordy forms are checked before the
// punctuation forms so "Psychology with a Specialization in Clinical
// Psychology" is not first split on a stray hyphen inside the spec.
// The word that announces a sub-program, in every form UCSD writes it —
// including the truncations its compressed field uses ("Spec", "Conc"). The
// compressed field also drops the "in" ("...W/SpecRnEnergy..."), so after
// "with" that word is optional; on its own it is not, because "Cultures
// Emphasis" is a name, not a separator.
const SPEC_LABEL =
  '(?:specializations?|specl?|concentrations?|conc|emphasis|track|option)\\.?';
const SEPARATORS = [
  (s) => split(s, new RegExp('\\s+with\\s+(?:an?\\s+)?' + SPEC_LABEL + '(?:\\s+in)?\\s+', 'i')),
  (s) => split(s, new RegExp('\\s+' + SPEC_LABEL + '\\s+in\\s+', 'i')),
  (s) => {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s);
    return m && m[1].trim() ? [m[1], m[2]] : null;
  },
  (s) => split(s, /:\s*/),
  (s) => split(s, /\s+[-–—]\s+/),
  (s) => split(s, /\s*\/\s*/),
];

function split(s, re) {
  const m = re.exec(s);
  if (!m || !m.index) return null;
  return [s.slice(0, m.index), s.slice(m.index + m[0].length)];
}

/**
 * Split a raw program name into canonical `{ full, base, spec }`.
 *
 * `full` is the whole name; `base`/`spec` are the program and its
 * sub-program. A parenthesized ACRONYM ("(ICAM)") and a "general" qualifier
 * ("(General)", "(Joint Major)") are NOT specializations — they name the same
 * program, so they collapse into the base. That is what makes
 * `Interdisciplinary Computing and the Arts` and
 * `Interdisciplinary Computing and the Arts (ICAM)` collide honestly (two real
 * programs, two departments) instead of one silently winning.
 */
export function splitProgram(raw) {
  const squeezed = isCompressed(raw);
  const cleaned = decompressName(raw)
    .replace(DEGREE_PAREN, ' ')
    .replace(DEGREE_TAIL, '')
    // The separator patterns below read the name BEFORE tokenization, so the
    // abbreviations UCSD screens use for exactly these words have to be spelled
    // out first ("Cog Sci w/Spec in Neuroscience").
    .replace(/\bw\/\s*/gi, 'with ')
    .replace(/\bspecl?\.?\s+in\b/gi, 'specialization in')
    .replace(/\bconc\.?\s+in\b/gi, 'concentration in')
    .replace(/\s+/g, ' ')
    .trim();
  for (const sep of SEPARATORS) {
    const hit = sep(cleaned);
    if (!hit) continue;
    const [rawBase, rawSpec] = hit;
    const specText = rawSpec.trim();
    const base = normProgram(rawBase);
    if (!base) break;
    // "(ICAM)" — an all-caps acronym is another name for the same program,
    // never a sub-program of it. It collapses into the base (and is kept as an
    // alias) so two departments' ICAM programs collide honestly instead of one
    // silently winning.
    if (/^[A-Z][A-Z0-9]{1,7}$/.test(specText)) {
      return { full: base, base, spec: '', acronym: flatten(specText), compressed: squeezed };
    }
    const spec = tokens(specText, { noise: SPEC_NOISE }).join(' ');
    // "Bioengineering:" — a separator with nothing after it. The record's major
    // line was cut off (a PDF line wrap); the specialization is UNKNOWN, not
    // absent, so the caller must not present the base program as certain.
    if (!spec) return { full: base, base, spec: '', specRaw: '', truncated: true, compressed: squeezed };
    if (GENERAL_SPEC.has(spec) || GENERAL_SPEC.has(tokens(specText).join(' '))) {
      return { full: base, base, spec: '', specRaw: '', compressed: squeezed };
    }
    // specRaw keeps the student's own capitalization for display — the audit
    // quotes their specialization back at them, and "deep sea robotics" reads
    // like a typo where "Deep Sea Robotics" reads like their program.
    return { full: base + ' ' + spec, base, spec, specRaw: specText, compressed: squeezed };
  }
  const full = normProgram(cleaned);
  return { full, base: full, spec: '', compressed: squeezed };
}

/**
 * Normalize a degree label: "B.S." / "BS" / "Bachelor of Science" → "BS".
 * Anything it does not RECOGNISE returns "" rather than a guess — an unknown
 * degree must never fire the degree-mismatch caveat.
 */
export function normDegree(s) {
  const f = flatten(s);
  if (!f) return '';
  if (/\bb\.?\s?s\.?\b|bachelor of science|\bbsc\b/.test(f)) return 'BS';
  if (/\bb\.?\s?a\.?\b|bachelor of arts/.test(f)) return 'BA';
  return '';
}

/* ─────────────────────────── token alignment ────────────────────────── */

// UCSD's own systems truncate long major names to fit a field, so a real
// student record says "Interdisc Computing & the Arts" for
// "Interdisciplinary Computing and the Arts". Alignment accepts a token that
// is a PREFIX of the catalog token — but only under conditions that keep it
// from turning into the substring tier we just deleted:
//   • the two names must have the SAME number of tokens (no absorbing a
//     shorter program name into a longer one),
//   • at least one token must match exactly (an all-abbreviation "match" is a
//     guess, not a match),
//   • an abbreviated token must be ≥4 characters,
//   • and — enforced by the caller — the aligned candidate must be UNIQUE.
const MIN_ABBREV = 4;

// The compressed field squeezes harder than it truncates: it drops interior
// letters too, so "Renewable" arrives as "Rn" and "Engineering" as "Eng". Both
// are the same shape — the first letter is kept and the remaining letters
// appear, in order, inside the full word. Accepting that is only safe because
// the caller still requires the SAME token count, at least one EXACT token,
// and a UNIQUE surviving candidate; two squeezed candidates are AMBIGUOUS, not
// a coin flip. It is gated on the name actually having arrived squashed, so a
// hand-typed "Comp Eng" is still judged by the strict rule above.
const MIN_SQUEEZE = 2;

function squeezes(a, b) {
  if (a.length < MIN_SQUEEZE || b.length <= a.length || a[0] !== b[0]) return false;
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i++;
  return i === a.length;
}

function aligns(inputTokens, entryTokens, squeezed) {
  if (inputTokens.length !== entryTokens.length || !inputTokens.length) return false;
  let exact = 0;
  for (let i = 0; i < inputTokens.length; i++) {
    const a = inputTokens[i];
    const b = entryTokens[i];
    if (a === b) { exact++; continue; }
    if (a.length >= MIN_ABBREV && b.length > a.length && b.startsWith(a)) continue;
    if (squeezed && squeezes(a, b)) continue;
    return false;
  }
  return squeezed || exact > 0;
}

/* ──────────────────────────── index shaping ─────────────────────────── */

/**
 * Decorate raw index entries with their canonical keys once, so no tier ever
 * re-derives them (and no tier can derive them differently).
 */
export function indexPrograms(entries, nameKey) {
  return (entries || []).map((e) => {
    const parts = splitProgram(e[nameKey]);
    return {
      entry: e,
      name: e[nameKey] || '',
      full: parts.full,
      base: parts.base,
      spec: parts.spec,
      fullT: parts.full.split(' ').filter(Boolean),
      baseT: parts.base.split(' ').filter(Boolean),
      specT: parts.spec.split(' ').filter(Boolean),
      degree: normDegree(e.degree),
      department: e.department || '',
      aliases: (e.aliases || []).map(normProgram).concat(parts.acronym ? [parts.acronym] : []),
    };
  });
}

/* ────────────────────────────── the matcher ─────────────────────────── */

function result(status, hit, extra) {
  return Object.assign(
    { status, entry: hit ? hit.entry : null, candidate: hit || null, candidates: [], reason: '' },
    extra || {}
  );
}

/**
 * Resolve one program name against an index.
 *
 * @param {string} rawName   the student's own program string (from their PDF)
 * @param {Array}  shaped    output of indexPrograms()
 * @param {object} opts      { degree, pinned }  — `pinned` is the `file` the
 *                           student explicitly chose; it always wins.
 * @returns {{status, entry, candidates, reason, requested, matchedName}}
 */
export function matchProgram(rawName, shaped, opts) {
  const o = opts || {};
  const list = shaped || [];
  const requested = String(rawName || '').trim();
  const want = splitProgram(requested);
  want.fullT = want.full.split(' ').filter(Boolean);
  want.baseT = want.base.split(' ').filter(Boolean);
  want.specT = want.spec.split(' ').filter(Boolean);
  const wantDegree = normDegree(o.degree);

  const base = (status, hit, cands, reason, caveat) =>
    Object.assign(result(status, hit, {
      candidates: (cands || []).map((c) => c.entry),
      reason: reason || '',
    }), {
      requested,
      requestedSpec: want.specRaw || want.spec,
      matchedName: hit ? hit.name : '',
      matchedSpec: hit ? hit.spec : '',
      caveat: caveat || '',
    });

  if (!list.length) return base(MATCH.NONE, null, [], 'no requirement index available');
  if (!want.full) return base(MATCH.NONE, null, [], 'no program name on the record');

  // 0. A choice the student made themselves outranks every heuristic.
  if (o.pinned) {
    const pin = list.find((c) => c.entry && c.entry.file === o.pinned);
    // Candidates = the rest of the family, so the UI can always offer a way
    // back out of a pin the student now regrets.
    if (pin) {
      return base(MATCH.PINNED, pin, list.filter((c) => c.base === pin.base), 'student-selected program');
    }
  }

  // Tiers, strongest first. Each returns a candidate SET; a set of exactly one
  // is the answer, a set of two or more is ambiguity — never a coin flip.
  const tiers = [
    ['exact name', () => list.filter((c) => c.full === want.full)],
    ['exact base + specialization', () =>
      want.spec ? list.filter((c) => c.base === want.base && c.spec === want.spec) : []],
    ['alias', () => list.filter((c) => c.aliases.includes(want.full))],
    ['abbreviated name', () =>
      list.filter((c) => aligns(want.full.split(' '), c.fullT, want.compressed))],
    ['abbreviated base + specialization', () =>
      want.spec
        ? list.filter((c) => c.spec && aligns(want.baseT, c.baseT, want.compressed) &&
                             aligns(want.specT, c.specT, want.compressed))
        : []],
  ];

  // A record whose major line was cut off ("Bioengineering:") names the base
  // program but hides the specialization. If the index carries specializations
  // under that base, the base is a FALLBACK, never a certain answer.
  const settle = (hit, why) => {
    if (want.truncated) {
      const family = list.filter((c) => c.base === hit.base);
      if (family.some((c) => c.spec)) {
        return base(MATCH.PARENT, hit, family, 'the major line on your record is cut off', 'truncated');
      }
    }
    // The requirement sets are per-degree (the B.A. and B.S. of the same major
    // are different programs). Showing one under the other's name is the same
    // silent substitution this module exists to prevent.
    if (wantDegree && hit.degree && wantDegree !== hit.degree) {
      return base(MATCH.PARENT, hit, [], why + ' (degree differs)', 'degree');
    }
    return base(MATCH.EXACT, hit, [], why);
  };

  for (const [why, run] of tiers) {
    let hits = run();
    if (!hits.length) continue;
    if (hits.length > 1 && wantDegree) {
      const byDegree = hits.filter((c) => c.degree === wantDegree);
      if (byDegree.length === 1) return settle(byDegree[0], why + ' + degree');
      if (byDegree.length) hits = byDegree;
    }
    if (hits.length === 1) return settle(hits[0], why);
    return base(MATCH.AMBIGUOUS, null, hits, why + ' matched ' + hits.length + ' programs');
  }

  // Nothing named this program. If the student has a SPECIALIZATION we do not
  // carry, the general program is a legitimate stand-in — but only when it is
  // itself unambiguous, and the caller must show it as a fallback.
  if (want.spec) {
    const family = list.filter((c) => c.base === want.base || aligns(want.baseT, c.baseT, want.compressed));
    if (family.length) {
      const parents = family.filter((c) => !c.spec);
      let pick = parents;
      if (pick.length > 1 && wantDegree) {
        const byDegree = pick.filter((c) => c.degree === wantDegree);
        if (byDegree.length) pick = byDegree;
      }
      if (pick.length === 1) {
        return base(MATCH.PARENT, pick[0], family, 'no set for this specialization', 'specialization');
      }
      return base(MATCH.AMBIGUOUS, null, family,
        'no set for this specialization and ' + family.length + ' related programs');
    }
  }

  // A bare base name that only exists as specializations (Environmental
  // Systems has four, and no general set) — listing them is the honest answer.
  // With exactly ONE such entry there is nothing to choose between, but it is
  // still a narrower program than the student named, so it is a fallback.
  const family = list.filter((c) => c.base === want.base || aligns(want.baseT, c.baseT, want.compressed));
  if (family.length === 1) {
    return base(MATCH.PARENT, family[0], family,
      'only the ' + family[0].name + ' set is covered', 'narrower');
  }
  if (family.length) {
    return base(MATCH.AMBIGUOUS, null, family, 'this program has ' + family.length + ' specializations');
  }

  return base(MATCH.NONE, null, [], 'no requirement set carries this name');
}

/* ────────────────── two programs in ONE "Major:" field ──────────────── */

// A double major does not always arrive as two `Major:` lines. Plenty of
// records print both inside ONE field — "Astronomy & Astrophysics/Computer
// Science", "…, Computer Science", "… and Computer Science" — and every one of
// those forms failed: the joined name matched nothing, so the audit
// said "your imported major did not match a harvested requirement set" and
// showed no major requirements at all. The slash form failed WORSE, because
// `/` is also a specialization separator: "Computer Science" was read as a
// SPECIALIZATION of Astronomy and Astrophysics and the general A&A set was
// presented as theirs — the confidently-wrong answer this module exists to
// prevent.
//
// Splitting on punctuation alone is not available to us: real UCSD programs
// carry every one of these characters — "Political Science / Public Law",
// "Art History/Theory/Criticism", "Ecology, Behavior and Evolution",
// "Economics and Mathematics (Joint Major)", "Molecular and Cell Biology". So
// the INDEX is the judge, under two rules that make a wrong split impossible:
//   1. a field that names one real program is never split, and
//   2. a split is accepted only when EVERY piece is itself an unambiguous
//      program and no two pieces are the same one.
// Anything else stays a single name and takes the ordinary path — an honest
// "no set carries this name" beats an invented pair of majors.
const COMBINED_SEPARATORS = [
  /\s*;\s*/g,
  /\s*\+\s*/g,
  /\s*\/\s*/g,
  /\s*,\s*/g,
  /\s+and\s+/gi,
  /\s*&\s*/g,
];

// Two majors, each of which may itself be a spec'd name, is the realistic
// ceiling; the cap only stops a pathological field from fanning out.
const MAX_COMBINED = 4;

/**
 * Split a Major field that names more than one program.
 *
 * @param {string} rawName  the field exactly as the record prints it
 * @param {Array}  shaped   output of indexPrograms()
 * @returns {string[]} the student's own text for each program, in document
 *   order. ONE element — the input unchanged — whenever the field is one
 *   program, or when the pieces do not all resolve.
 */
export function splitPrograms(rawName, shaped) {
  const raw = String(rawName == null ? '' : rawName).trim();
  const list = shaped || [];
  if (!raw) return [];
  if (!list.length) return [raw];

  // The degree is deliberately NOT passed: a B.A./B.S. mismatch is a caveat
  // about the requirement set, never evidence that the name is not a program.
  // Memoized because the search below asks about the same substring from many
  // directions, and matchProgram() re-tokenizes the whole index every call.
  const known = new Map();
  const resolved = (name) => {
    if (!known.has(name)) {
      const hit = matchProgram(name, list, {});
      known.set(name, isConfident(hit.status) && hit.entry ? hit : null);
    }
    return known.get(name);
  };

  // One name, or a name that splits into names — recursive, so a separator
  // that appears both INSIDE a program name and BETWEEN two ("Molecular and
  // Cell Biology and Computer Science") is split at the occurrence that leaves
  // two real programs rather than at all of them. Every recursive call is on a
  // strictly shorter slice, and each distinct slice is answered once, so the
  // search is bounded by the number of separators in the field.
  const memo = new Map();
  const pieces = (text) => {
    const t = text.trim();
    if (!t) return null;
    if (memo.has(t)) return memo.get(t);
    memo.set(t, null); // a slice never splits into itself
    let found = resolved(t) ? [t] : null;
    for (const sep of COMBINED_SEPARATORS) {
      if (found) break;
      sep.lastIndex = 0;
      let m;
      while ((m = sep.exec(t))) {
        if (!m.index || m.index + m[0].length >= t.length) continue;
        const left = pieces(t.slice(0, m.index));
        if (!left) continue;
        const right = pieces(t.slice(m.index + m[0].length));
        if (right) { found = left.concat(right); break; }
      }
    }
    memo.set(t, found);
    return found;
  };

  const out = pieces(raw);
  if (!out || out.length < 2 || out.length > MAX_COMBINED) return [raw];
  // The same program written twice is a formatting artefact, not two majors.
  const seen = new Set(out.map((p) => normProgram(p)));
  return seen.size === out.length ? out : [raw];
}

/* ───────────────────────────── colleges ─────────────────────────────── */

// The eight names are unique with or without the word "college", and students'
// records shorten them freely ("Marshall", "ERC", "Sixth"). Canonicalizing to
// the distinctive part is exact matching, not substring matching.
const COLLEGE_ALIAS = Object.freeze({
  erc: 'eleanor roosevelt',
  tmc: 'thurgood marshall',
  marshall: 'thurgood marshall',
  roosevelt: 'eleanor roosevelt',
  warren: 'earl warren',
  muir: 'john muir',
  revelle: 'revelle',
  sixth: 'sixth',
  seventh: 'seventh',
  eighth: 'eighth',
  '6th': 'sixth',
  '7th': 'seventh',
  '8th': 'eighth',
});

/** Canonical college key: drop the word "college", expand known shorthands. */
export function normCollege(s) {
  const key = normProgram(s).replace(/\bcolleges?\b/g, '').replace(/\s+/g, ' ').trim();
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(COLLEGE_ALIAS, key) ? COLLEGE_ALIAS[key] : key;
}

/** Same contract as matchProgram(), for the 8 college GE files. */
export function matchCollege(rawName, entries) {
  const requested = String(rawName || '').trim();
  const want = normCollege(requested);
  const shaped = (entries || []).map((e) => ({ entry: e, name: e.college || '', key: normCollege(e.college) }));
  const out = (status, hit, cands, reason) => ({
    status, entry: hit ? hit.entry : null, candidates: (cands || []).map((c) => c.entry),
    reason, requested, matchedName: hit ? hit.name : '',
  });
  if (!shaped.length) return out(MATCH.NONE, null, [], 'no college index available');
  if (!want) return out(MATCH.NONE, null, [], 'no college on the record');
  let hits = shaped.filter((c) => c.key === want);
  if (!hits.length) {
    const wt = want.split(' ');
    hits = shaped.filter((c) => aligns(wt, c.key.split(' ')));
  }
  if (hits.length === 1) return out(MATCH.EXACT, hits[0], [], 'college name');
  if (hits.length > 1) return out(MATCH.AMBIGUOUS, null, hits, 'college name matched ' + hits.length);
  return out(MATCH.NONE, null, [], 'no college GE set carries this name');
}

/* ─────────────────────── how many majors on record ──────────────────── */

// Labels an Academic History uses. A wrapped value is joined onto the field
// only when the next line is NOT itself a label — same rule as `fld()` in
// parse-academic-history.js.
const AH_FIELD_LABELS =
  /^\s*(Student(?:\s+Level)?|PID|College|Majors?|Minor|Intended Degree|Degree|Level|Class Level|Admission Term|Term|Academic (?:Events|Status)|Transfer Courses|Cumulative|Total|Prepared)\b/i;

/**
 * EVERY major named on an Academic History, in document order.
 *
 * `parseAcademicHistory()` reads `Major:` with a single-match regex, so a
 * double major's SECOND program was dropped on the floor and the audit showed
 * one major with no hint that another existed — a silently incomplete audit,
 * which is the failure mode this pipeline exists to prevent. TritonPlan does
 * not model double majors; this function exists so the tools can at least SAY
 * that a second one is on the record and is not being checked.
 *
 * Returns [] when the text names no major, and a de-duplicated list otherwise
 * (UCSD PDFs repeat the header block on every page).
 *
 * NOTE for whoever owns parse-academic-history.js: this belongs inside
 * `parseAcademicHistory()` as `student.majors`. It lives here only because
 * that file was under concurrent edit on 2026-07-25, and here because this
 * module is the pure, node-testable home of "what program is this student in".
 */
export function readMajors(text) {
  return readProgramLines(text, /^\s*Majors?\s*:?\s*(.+)$/i);
}

/**
 * Every "Minor:" line, the same way. A UCSD Academic History prints one line
 * per declared minor (most students have none). The parser recognised the
 * label from the start — FIELD_LABELS carries "Minor" — but never read the
 * value, so a declared minor vanished on import exactly as the second major
 * used to. The Major & Minor screen shows it as the student's CURRENT
 * program, next to whatever they are exploring.
 */
export function readMinors(text) {
  return readProgramLines(text, /^\s*Minors?\s*:?\s*(.+)$/i);
}

function readProgramLines(text, lineRe) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lineRe.exec(lines[i]);
    if (!m) continue;
    let val = String(m[1]).replace(/[<>]/g, '').trim();
    const next = lines[i + 1] == null ? null : String(lines[i + 1]).replace(/[<>]/g, '').trim();
    // Same continuation rule as fld(): a value cut off on a separator, or one
    // that opened a bracket the next line closes, absorbs that next line.
    const dangling = /[:\-–—/(&]$/.test(val);
    const closes = /\([^)]*$/.test(val) && next != null && /^[^()]*\)/.test(next);
    if (next && !AH_FIELD_LABELS.test(lines[i + 1]) && !/^[A-Z][A-Za-z ]{0,24}:/.test(next) &&
        (dangling || closes)) {
      val = (val + (/[-–—/(]$/.test(val) ? '' : ' ') + next).trim();
      i++;
    }
    if (!val) continue;
    const key = normProgram(val);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(val);
  }
  return out;
}
