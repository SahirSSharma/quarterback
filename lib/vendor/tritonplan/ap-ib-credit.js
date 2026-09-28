// AP / IB → UC San Diego course-credit mapping.
//
// Source of truth: the official UC San Diego General Catalog credit charts —
// "Advanced Placement Credit: Application to College and Major Requirements"
// and "International Baccalaureate Credits" (catalog.ucsd.edu, 2023–24 tables).
// We encode the "UC SAN DIEGO COURSE EXEMPTIONS (FOR USE ON MAJOR)" column,
// which is the score-dependent, specific-course credit that drives prereqs,
// the Degree Audit, and the Planner. (The college-by-college GE columns vary by
// college and are intentionally NOT modeled here — those are handled by each
// college's GE requirement buckets downstream.)
//
// An incoming freshman has no Academic History PDF to import, so they instead
// declare their AP/IB exams here; each granted exemption becomes an XFER course
// in the exact schema parse-academic-history.js produces for transfer credit,
// so every tool treats it identically to a real imported record.
//
// Where the catalog grants a choice ("MATH 20A or 10A"), we award the
// major-track course (the 20-series), which is the option UCSD honors and the
// one that satisfies the widest set of major prerequisites.

// ------------------------------ AP EXAMS ------------------------------
// exemptions: score → list of UCSD "SUBJ NUM" courses that exam earns at that
// score. Scores below the lowest listed key earn units but no course exemption.
// `note` is a plain-English extra (e.g. writing / American History & Institutions).
//
// `chart` names the row of the official credit chart this entry encodes — one
// string, or an array where one option covers several rows the chart prints
// together. tests/data/ap-chart.test.mjs asserts the two lists are the same
// set, so an exam cannot go missing again the way AP European History was
// reported missing twice: the check is over the whole chart, never one exam.
// It also asserts the option's NAME contains the exam's own name, because an
// exam hidden inside a group label ("World Language (French / German /
// Chinese / etc.)") reads as missing to the student looking for theirs.
export const AP_EXAMS = [
  { id: 'ap-calc-ab', name: 'Calculus AB', group: 'Math & Computer Science', units: 4, capGroup: 'calculus',
    chart: 'Mathematics: Calculus AB',
    exemptions: { 3: ['MATH 10A'], 4: ['MATH 20A'], 5: ['MATH 20A'] } },
  { id: 'ap-calc-bc', name: 'Calculus BC', group: 'Math & Computer Science', units: 8, capGroup: 'calculus',
    chart: 'Mathematics: Calculus BC',
    exemptions: { 3: ['MATH 20A'], 4: ['MATH 20A', 'MATH 20B'], 5: ['MATH 20A', 'MATH 20B'] } },
  { id: 'ap-statistics', name: 'Statistics', group: 'Math & Computer Science', units: 4,
    chart: 'Statistics', exemptions: {}, note: 'Counts toward the math/quantitative requirement at some colleges.' },
  { id: 'ap-cs-a', name: 'Computer Science A', group: 'Math & Computer Science', units: 8,
    chart: 'Computer Science A', exemptions: { 4: ['CSE 8A'], 5: ['CSE 8A'] }, note: 'UCSD recommends you still take CSE 11.' },
  { id: 'ap-cs-principles', name: 'Computer Science Principles', group: 'Math & Computer Science', units: 8,
    chart: 'Computer Science Principles', exemptions: { 4: ['CSE 3'], 5: ['CSE 3'] } },

  { id: 'ap-chemistry', name: 'Chemistry', group: 'Science', units: 8, chart: 'Chemistry',
    exemptions: { 3: ['CHEM 4'], 4: ['CHEM 6A'], 5: ['CHEM 6A', 'CHEM 6B', 'CHEM 6C'] } },
  { id: 'ap-biology', name: 'Biology', group: 'Science', units: 8, chart: 'Biology',
    exemptions: { 3: ['BILD 10'], 4: ['BILD 1', 'BILD 2', 'BILD 3'], 5: ['BILD 1', 'BILD 2', 'BILD 3'] } },
  { id: 'ap-physics-1', name: 'Physics 1: Algebra-Based', group: 'Science', units: 8, capGroup: 'physics',
    chart: 'Physics 1', exemptions: { 3: ['PHYS 10'], 4: ['PHYS 10'], 5: ['PHYS 10'] }, note: '8-unit maximum across all Physics exams.' },
  { id: 'ap-physics-2', name: 'Physics 2: Algebra-Based', group: 'Science', units: 8, capGroup: 'physics',
    chart: 'Physics 2', exemptions: { 3: ['PHYS 10'], 4: ['PHYS 10'], 5: ['PHYS 10'] }, note: '8-unit maximum across all Physics exams.' },
  { id: 'ap-physics-c-mech', name: 'Physics C: Mechanics', group: 'Science', units: 4, capGroup: 'physics',
    chart: 'Physics C: Mechanics', exemptions: { 3: ['PHYS 1A'], 4: ['PHYS 2A'], 5: ['PHYS 2A'] } },
  { id: 'ap-physics-c-em', name: 'Physics C: Electricity & Magnetism', group: 'Science', units: 4, capGroup: 'physics',
    chart: 'Physics C: Electricity and Magnetism', exemptions: { 3: ['PHYS 1B'], 4: ['PHYS 2B'], 5: ['PHYS 2B'] } },
  { id: 'ap-env-science', name: 'Environmental Science', group: 'Science', units: 4,
    chart: 'Environmental Science', exemptions: { 4: ['ESYS 10'], 5: ['ESYS 10'] } },

  { id: 'ap-econ-micro', name: 'Economics: Microeconomics', group: 'Social Sciences', units: 4,
    chart: 'Economics: Microeconomics', exemptions: { 5: ['ECON 1'] } },
  { id: 'ap-econ-macro', name: 'Economics: Macroeconomics', group: 'Social Sciences', units: 4,
    chart: 'Economics: Macroeconomics', exemptions: { 5: ['ECON 3'] } },
  { id: 'ap-psychology', name: 'Psychology', group: 'Social Sciences', units: 4, chart: 'Psychology',
    exemptions: { 4: ['PSYC 1'], 5: ['PSYC 1'] } },
  { id: 'ap-gov-us', name: 'Government & Politics: United States', group: 'Social Sciences', units: 4,
    chart: 'Government and Politics: United States', exemptions: { 5: ['POLI 10'] }, note: 'Satisfies the American History & Institutions requirement.' },
  { id: 'ap-gov-comp', name: 'Government & Politics: Comparative', group: 'Social Sciences', units: 4,
    chart: 'Government and Politics: Comparative', exemptions: { 5: ['POLI 11'] } },
  { id: 'ap-hist-us', name: 'United States History', group: 'Social Sciences', units: 8,
    chart: 'History: United States', exemptions: {},
    note: 'Satisfies the American History & Institutions requirement, and exempts two quarters '
      + 'of US history — you may still take HILD 2A, 2B or 2C for credit.' },
  { id: 'ap-human-geo', name: 'Human Geography', group: 'Social Sciences', units: 4,
    chart: 'Human Geography', exemptions: {} },

  { id: 'ap-english-lang', name: 'English Language & Composition', group: 'Humanities & Arts', units: 8, capGroup: 'english',
    chart: 'English: Language and Composition', exemptions: {}, note: 'Meets the UC Entry Level Writing requirement. 8-unit maximum across both English exams.' },
  { id: 'ap-english-lit', name: 'English Literature & Composition', group: 'Humanities & Arts', units: 8, capGroup: 'english',
    chart: 'English: Composition and Literature', exemptions: {}, note: 'Meets the UC Entry Level Writing requirement. 8-unit maximum across both English exams.' },
  { id: 'ap-latin-vergil', name: 'Latin: Vergil', group: 'Humanities & Arts', units: 4, chart: 'Latin: Vergil',
    exemptions: { 3: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 4: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 5: ['LTLA 1', 'LTLA 2', 'LTLA 3'] } },
  { id: 'ap-latin-literature', name: 'Latin: Literature', group: 'Humanities & Arts', units: 4, chart: 'Latin: Literature',
    exemptions: { 3: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 4: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 5: ['LTLA 1', 'LTLA 2', 'LTLA 3'] } },
  { id: 'ap-spanish-lit', name: 'Spanish Literature & Culture', group: 'Humanities & Arts', units: 8,
    chart: 'Literature: Spanish', exemptions: { 3: ['LTSP 2A'], 4: ['LTSP 2B'], 5: ['LTSP 2C'] } },
  { id: 'ap-art-history', name: 'Art History', group: 'Humanities & Arts', units: 8,
    chart: 'Art History', exemptions: {} },
  { id: 'ap-studio-drawing', name: 'Studio Art: Drawing', group: 'Humanities & Arts', units: 8,
    capGroup: 'studio-art', chart: 'Studio Art: Drawing', exemptions: {},
    note: '8-unit maximum across all Studio Art exams.' },
  { id: 'ap-studio-2d', name: 'Studio Art: 2D Art and Design', group: 'Humanities & Arts', units: 8,
    capGroup: 'studio-art', chart: 'Studio Art: 2D Art and Design', exemptions: {},
    note: '8-unit maximum across all Studio Art exams.' },
  { id: 'ap-studio-3d', name: 'Studio Art: 3D Art and Design', group: 'Humanities & Arts', units: 8,
    capGroup: 'studio-art', chart: 'Studio Art: 3D Art and Design', exemptions: {},
    note: '8-unit maximum across all Studio Art exams.' },
  { id: 'ap-music-theory', name: 'Music Theory', group: 'Humanities & Arts', units: 8,
    chart: 'Music Theory', exemptions: {} },
  { id: 'ap-hist-euro', name: 'European History', group: 'Humanities & Arts', units: 8,
    chart: 'History: European', exemptions: {}, note: 'May count toward humanities/history GE depending on your college.' },
  { id: 'ap-hist-world', name: 'World History', group: 'Humanities & Arts', units: 8,
    chart: 'History: World', exemptions: {}, note: 'May count toward humanities/history GE depending on your college.' },
  // "Language other than English" is ONE row on the chart naming six exams, and
  // it was shipped here as one option called "World Language (French / German /
  // Chinese / etc.)" that granted no exemption at all. A student who took AP
  // Spanish Language did not see the word Spanish and got nothing for a 5 that
  // the chart says exempts LTSP 2B. Six exams, six options.
  //
  // The chart's score-3 exemptions (LIFR/LIGM/LIIT/LISP 1C) name courses the
  // General Catalog no longer publishes, so a 3 earns units and the placement
  // note rather than a course that does not exist — an exemption for a course
  // nobody can find is worse than none.
  ...['French', 'German', 'Italian', 'Spanish'].map((lang) => {
    const code = { French: 'FR', German: 'GM', Italian: 'IT', Spanish: 'SP' }[lang];
    return {
      id: 'ap-lang-' + lang.toLowerCase(),
      name: lang + ' Language & Culture',
      group: 'Humanities & Arts',
      units: 8,
      chart: 'Language other than English: ' + lang,
      exemptions: { 4: ['LT' + code + ' 2A'], 5: ['LT' + code + ' 2B'] },
      note: 'Also counts toward your college language-proficiency requirement.',
    };
  }),
  // The chart carries these two under the same row but exempts nothing:
  // "Chinese and Japanese: Placement exam/interview required."
  { id: 'ap-lang-chinese', name: 'Chinese Language & Culture', group: 'Humanities & Arts', units: 8,
    chart: 'Language other than English: Chinese', exemptions: {},
    note: 'A placement exam or interview is required — contact the department for your course credit.' },
  { id: 'ap-lang-japanese', name: 'Japanese Language & Culture', group: 'Humanities & Arts', units: 8,
    chart: 'Language other than English: Japanese', exemptions: {},
    note: 'A placement exam or interview is required — contact the department for your course credit.' },

  // AP Capstone. No university credit, but the chart records that either exam
  // meets Entry Level Writing — which is why leaving them off the list was not
  // harmless: a student who took one saw no way to say so.
  { id: 'ap-seminar', name: 'Seminar', group: 'Humanities & Arts', units: 0,
    chart: 'Seminar', exemptions: {},
    note: 'Not eligible for university credit. A score of 3, 4 or 5 meets the UC Entry Level Writing requirement.' },
  { id: 'ap-research', name: 'Research', group: 'Humanities & Arts', units: 0,
    chart: 'Research', exemptions: {},
    note: 'Not eligible for university credit. A score of 3, 4 or 5 meets the UC Entry Level Writing requirement.' },
];

// ------------------------------ IB EXAMS ------------------------------
// Only Higher Level (HL) exams earn UC credit (scores 5–7). Standard Level
// exams are not credit-bearing at UC, so we list HL only.
export const IB_EXAMS = [
  { id: 'ib-math-aa', name: 'Mathematics: Analysis & Approaches (HL)', group: 'Math & Computer Science', units: 8,
    exemptions: { 5: ['MATH 20A', 'MATH 10B'], 6: ['MATH 20A', 'MATH 10B'], 7: ['MATH 20A', 'MATH 10B'] } },
  { id: 'ib-math-ai', name: 'Mathematics: Applications & Interpretation (HL)', group: 'Math & Computer Science', units: 0,
    exemptions: {}, note: 'Not eligible for UC San Diego credit.' },
  { id: 'ib-cs', name: 'Computer Science (HL)', group: 'Math & Computer Science', units: 8,
    exemptions: { 6: ['CSE 3'], 7: ['CSE 3'] } },

  { id: 'ib-chemistry', name: 'Chemistry (HL)', group: 'Science', units: 8,
    exemptions: { 5: ['CHEM 6A'], 6: ['CHEM 6A', 'CHEM 6C'], 7: ['CHEM 6A', 'CHEM 6B', 'CHEM 6C'] } },
  { id: 'ib-biology', name: 'Biology (HL)', group: 'Science', units: 8,
    exemptions: { 5: ['BILD 10'], 6: ['BILD 1', 'BILD 2', 'BILD 3'], 7: ['BILD 1', 'BILD 2', 'BILD 3'] } },
  { id: 'ib-physics', name: 'Physics (HL)', group: 'Science', units: 8,
    exemptions: { 5: ['PHYS 10'], 6: ['PHYS 1A', 'PHYS 1B'], 7: ['PHYS 2A', 'PHYS 2B'] } },

  { id: 'ib-economics', name: 'Economics (HL)', group: 'Social Sciences', units: 8,
    exemptions: { 7: ['ECON 1', 'ECON 3'] } },
  { id: 'ib-psychology', name: 'Psychology (HL)', group: 'Social Sciences', units: 8,
    exemptions: { 5: ['PSYC 1'], 6: ['PSYC 1'], 7: ['PSYC 1'] } },
  { id: 'ib-anthropology', name: 'Social & Cultural Anthropology (HL)', group: 'Social Sciences', units: 8,
    exemptions: { 5: ['ANTH 1'], 6: ['ANTH 1'], 7: ['ANTH 1'] } },
  { id: 'ib-hist-americas', name: 'History of the Americas (HL)', group: 'Social Sciences', units: 8,
    exemptions: {}, note: 'Satisfies the American History & Institutions requirement.' },
  { id: 'ib-global-politics', name: 'Global Politics (HL)', group: 'Social Sciences', units: 8, exemptions: {} },
  { id: 'ib-geography', name: 'Geography (HL)', group: 'Social Sciences', units: 8, exemptions: {} },
  { id: 'ib-business', name: 'Business & Management (HL)', group: 'Social Sciences', units: 8, exemptions: {} },

  { id: 'ib-english', name: 'English A: Literature / Lang & Lit (HL)', group: 'Humanities & Arts', units: 8,
    exemptions: {}, note: 'Meets the UC Entry Level Writing requirement.' },
  { id: 'ib-latin', name: 'Latin / Classical Greek (HL)', group: 'Humanities & Arts', units: 8,
    exemptions: { 5: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 6: ['LTLA 1', 'LTLA 2', 'LTLA 3'], 7: ['LTLA 1', 'LTLA 2', 'LTLA 3'] } },
  { id: 'ib-linguistics', name: 'Language A (Linguistics) (HL)', group: 'Humanities & Arts', units: 8,
    exemptions: { 5: ['LING 1C'], 6: ['LING 1D'], 7: ['LING 1D'] } },
  { id: 'ib-language-b', name: 'Language B — world language (HL)', group: 'Humanities & Arts', units: 8,
    exemptions: {}, note: 'Elective credit; may help a language-proficiency requirement — see your college adviser.' },
  { id: 'ib-philosophy', name: 'Philosophy (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-music', name: 'Music (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-visual-arts', name: 'Visual Arts (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-theatre', name: 'Theatre (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-film', name: 'Film (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-dance', name: 'Dance (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
  { id: 'ib-hist-world', name: 'History (non-Americas) (HL)', group: 'Humanities & Arts', units: 8, exemptions: {} },
];

// Per-subject-area unit caps from the official chart ("8-unit maximum for
// both/all tests"). Exams sharing a capGroup draw from one pool: the first
// declared exam takes its full units, later ones only what remains.
export const UNIT_CAPS = { english: 8, physics: 8, calculus: 8, 'studio-art': 8 };

export const AP_SCORES = [3, 4, 5];
export const IB_SCORES = [5, 6, 7]; // HL only

const byId = {};
for (const e of AP_EXAMS) byId[e.id] = { ...e, kind: 'AP' };
for (const e of IB_EXAMS) byId[e.id] = { ...e, kind: 'IB' };

export function getExam(id) { return byId[id] || null; }

// Resolve one declared exam+score into the UCSD courses it exempts.
// Returns the highest-scoring tier at or below the student's score (so a 5 also
// gets everything a 4 would). Returns { courses: string[], note, units }.
export function resolveExemption(id, score) {
  const exam = byId[id];
  if (!exam) return { courses: [], note: '', units: 0 };
  const s = Number(score);
  const tiers = Object.keys(exam.exemptions || {}).map(Number).filter((k) => k <= s).sort((a, b) => b - a);
  const courses = tiers.length ? exam.exemptions[tiers[0]] : [];
  return { courses: courses.slice(), note: exam.note || '', units: exam.units || 0 };
}
