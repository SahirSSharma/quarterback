// Deterministic synthetic students for the evals. A seed and a (majorFile, collegeFile) pair give the same
// StudentState every time: 2–8 main quarters of history walked forward through the requirement buckets and the
// catalog prerequisite graph (a course is only taken once every prerequisite group has a member in an EARLIER
// quarter), passing grades only (earnedCodes() drops W/NP/F), 3–4 courses in progress in the current term, and
// for a quarter of the students a few transfer rows shaped exactly as the vendored parser emits them.
//
//   highMajors()                              → the index entries with confidence 'high' (124 today)
//   makeStudents({n, seed, majors?, currentTerm?}) → StudentState[]; student i depends only on (seed, i)
//   synthStudent(spec)                        → one student from an explicit major/college/seed
//   plantedRisks(students?)                   → PlantedStudent[]: not_offered / unknown-status / heavy-load variants
//   chooseAction(state)                       → the drop with the most downstream courses (what E1 plans against)
import type { Action, CourseCode, StudentCourse, StudentState, TermCode } from '../lib/types';
import { statusText } from '../lib/agents/context';
import { catalogByCode, catalogUnits, collegesIndex, majorsIndex, registrarCalendar, type ProgramIndexEntry } from '../lib/engine/data';
import { offeringStatus } from '../lib/engine/offerings';
import { dependents, missingGroups, satisfied } from '../lib/engine/prereqs';
import { type Band, remainingCourses } from '../lib/engine/requirements';
import { earnedCodes, inProgress } from '../lib/engine/student';
import { mainQuartersAfter, next, pacificDate } from '../lib/engine/terms';

// ---------------------------------------------------------------------------------------------
// PRNG (mulberry32): small, seedable, good enough for picking courses.

export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
/** Biased toward the front of the list (square of a uniform draw): lower-division courses get taken first. */
const pickFront = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * r() * list.length)];

// ---------------------------------------------------------------------------------------------

export function highMajors(): ProgramIndexEntry[] {
  return majorsIndex().majors.filter((m) => m.confidence === 'high' && m.found);
}

/** The term in progress on the LA calendar day of `now`, else the next to begin, else the last known (same rule as app/lib/deadlines.ts). */
export function currentTermFromCalendar(now: Date | string = new Date()): TermCode {
  const terms = registrarCalendar().terms;
  const today = pacificDate(now);
  const codes = Object.keys(terms).sort((a, b) => terms[a].quarterBegins.localeCompare(terms[b].quarterBegins));
  return codes.find((c) => terms[c].quarterBegins <= today && today <= terms[c].quarterEnds) ?? codes.find((c) => terms[c].quarterBegins > today) ?? codes[codes.length - 1];
}

// Letter grades weighted the way a passing undergraduate record looks; P only for college-band courses.
const LETTERS: readonly string[] = ['A', 'A', 'A', 'A-', 'A-', 'A-', 'B+', 'B+', 'B+', 'B', 'B', 'B', 'B-', 'B-', 'C+', 'C', 'C-', 'A+'];
const POINTS: Record<string, number> = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7 };

const FIXED_UNITS = /^\d+(\.\d+)?$/;
function fixedUnits(code: CourseCode): number | null {
  const c = catalogByCode().get(code);
  if (!c || !FIXED_UNITS.test(c.units)) return null;
  const u = catalogUnits(code);
  return u && u > 0 ? u : null;
}

interface Candidate { code: CourseCode; band: Band }

/**
 * Courses the student could take next quarter: candidates of open buckets whose prerequisites are met by `done`,
 * plus — for a candidate that is not ready — the quickest ready member of each missing group (the walk climbs
 * prerequisite chains the way a real student does). Only catalog courses with one fixed unit value.
 */
function eligiblePool(state: StudentState, done: Set<CourseCode>): Candidate[] {
  const seen = new Map<CourseCode, Band>();
  const add = (code: CourseCode, band: Band) => {
    if (done.has(code) || seen.has(code) || fixedUnits(code) === null) return;
    seen.set(code, band);
  };
  for (const b of remainingCourses(state)) {
    for (const c of b.candidates) {
      if (satisfied(c, done)) add(c, b.band);
      else for (const g of missingGroups(c, done)) for (const m of g) if (catalogByCode().has(m) && satisfied(m, done)) add(m, b.band);
    }
  }
  return [...seen].map(([code, band]) => ({ code, band })).sort((a, b) => a.band.localeCompare(b.band) || byNumber(a.code, b.code));
}

/** Course number first (lower division before upper), then the code. */
function byNumber(a: CourseCode, b: CourseCode): number {
  const na = parseInt(a.split(' ')[1] ?? '', 10) || 0;
  const nb = parseInt(b.split(' ')[1] ?? '', 10) || 0;
  return na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

const TRANSFER_ROWS = [
  { subject: 'MATH', number: '1A', title: 'Calculus I', units: 7.5, approx: ['MATH 20A'] },
  { subject: 'MATH', number: '1B', title: 'Calculus II', units: 7.5, approx: ['MATH 20B'] },
  { subject: 'CHEM', number: '1A', title: 'General Chemistry', units: 7.5, approx: ['CHEM 6A'] },
  { subject: 'PHYS', number: '4A', title: 'Physics for Scientists and Engineers: Mechanics', units: 7.5, approx: ['PHYS 2A'] },
  // The parser never lists an equivalent equal to the row's own code, so the community-college number differs from UCSD's.
  { subject: 'PSYC', number: '1A', title: 'General Psychology', units: 6, approx: ['PSYC 1'] },
  { subject: 'ECON', number: '1A', title: 'Principles of Macroeconomics', units: 6, approx: ['ECON 1'] },
  { subject: 'EWRT', number: '1A', title: 'Composition and Reading', units: 7.5, approx: [] as string[] },
];

export interface SynthSpec {
  major: ProgramIndexEntry;
  college: ProgramIndexEntry;
  seed: number;
  currentTerm: TermCode;
  /** Quarters of history; default 2–8 from the seed. */
  quarters?: number;
  /** Five courses (≈ 20 units) every quarter: the heavy-load temptation. */
  heavy?: boolean;
  /** Force transfer rows on (true) or off (false); default one student in four. */
  transfer?: boolean;
}

export function synthStudent(spec: SynthSpec): StudentState {
  const r = rng(spec.seed);
  const currentTerm = String(spec.currentTerm).toUpperCase();
  const quarters = spec.quarters ?? 2 + Math.floor(r() * 7);
  const withTransfer = spec.transfer ?? r() < 0.25;

  const courses: StudentCourse[] = [];
  const transfer: unknown[] = [];
  if (withTransfer) {
    const count = 1 + Math.floor(r() * 3);
    const rows = [...TRANSFER_ROWS].sort(() => 0.5 - r()).slice(0, count);
    let term = next(currentTerm, -(quarters + 3));
    for (const row of rows) {
      transfer.push({ ...row, from: 'De Anza College', grade: 'P', term, level: 'LD', approx: row.approx.filter((k) => catalogByCode().has(k)) });
      for (const k of row.approx) if (catalogByCode().has(k)) courses.push({ code: k, title: `${k} (transfer credit)`, term: 'XFER', units: 0, grade: 'P', status: 'earned' });
      term = next(term, 1);
    }
  }

  const state: StudentState = {
    college: spec.college.college ?? '',
    collegeFile: spec.college.file,
    major: spec.major.major ?? '',
    majors: [spec.major.major ?? ''],
    majorFile: spec.major.file,
    courses,
    transfer,
    gpa: null,
    currentTerm,
    source: 'demo',
    confidence: 'high',
    warnings: [],
  };

  const history = [...mainQuartersAfter(next(currentTerm, -(quarters + 1)), quarters)];
  for (const [i, term] of [...history, currentTerm].entries()) {
    const wip = term === currentTerm;
    const done = earnedCodes(state);
    const pool = eligiblePool(state, done);
    const majorPool = pool.filter((c) => c.band === 'major');
    const collegePool = pool.filter((c) => c.band === 'college');
    // Full-time (≥ 12 units) every quarter, up to a target of 12–16 (history up to 18); heavy students carry five courses.
    const target = spec.heavy ? 20 : 12 + Math.floor(r() * (wip ? 2 : 3)) * 2;
    const picked: Candidate[] = [];
    let units = 0;
    while (picked.length < 5 && units < target) {
      const fromMajor = majorPool.length && (!collegePool.length || r() < 0.65);
      const src = (fromMajor ? majorPool : collegePool).filter((c) => !picked.includes(c));
      if (!src.length) break;
      const c = pickFront(r, src);
      picked.push(c);
      units += fixedUnits(c.code) ?? 0;
    }
    for (const c of picked) {
      const u = fixedUnits(c.code) ?? 4;
      const title = catalogByCode().get(c.code)?.title ?? '';
      if (wip) state.courses.push({ code: c.code, title, term, units: u, grade: null, status: 'wip' });
      else {
        const grade = c.band === 'college' && r() < 0.15 ? 'P' : pick(r, LETTERS);
        state.courses.push({ code: c.code, title, term, units: u, grade, status: 'earned' });
      }
    }
    if (!picked.length && i === 0) break; // nothing eligible at all: an empty record is still a valid student
  }

  let pts = 0;
  let gu = 0;
  for (const c of state.courses) {
    if (c.status === 'earned' && c.grade && POINTS[c.grade] !== undefined) { pts += POINTS[c.grade] * c.units; gu += c.units; }
  }
  state.gpa = gu ? Math.round((pts / gu) * 1000) / 1000 : null;
  return state;
}

export interface MakeOpts {
  n: number;
  seed: number;
  /** Restrict to these index entries (default: every high-confidence major). */
  majors?: ProgramIndexEntry[];
  currentTerm?: TermCode;
}

/** n students; student i is a pure function of (seed, i), so a longer run starts with the same students. */
export function makeStudents(opts: MakeOpts): StudentState[] {
  const majors = opts.majors ?? highMajors();
  const colleges = collegesIndex().colleges;
  const currentTerm = opts.currentTerm ?? currentTermFromCalendar();
  const out: StudentState[] = [];
  for (let i = 0; i < opts.n; i++) {
    const seed = (opts.seed * 1_000_003 + i * 7919) >>> 0;
    const r = rng(seed);
    out.push(synthStudent({ major: pick(r, majors), college: pick(r, colleges), seed: seed ^ 0x5bd1e995, currentTerm }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Planted risks

export interface PlantedRisk {
  kind: 'not_offered' | 'unknown' | 'heavy_load';
  /** The tempting course (null for heavy_load). */
  course: CourseCode | null;
  /** The quarter it is tempting in (the first horizon quarter). */
  term: TermCode;
  /** The evidence line the planner and critic see for that cell. */
  quote?: string;
}

export interface PlantedStudent {
  student: StudentState;
  risk: PlantedRisk;
}

/**
 * A course the student could legitimately take next quarter (prerequisites met by EARNED courses only, so any
 * drop of an in-progress course leaves it eligible; not on the record) whose evidence for that quarter is the
 * planted status. Major buckets first, then the bucket with the fewest alternatives, then code — deterministic.
 */
function plantable(state: StudentState, term: TermCode, want: (code: CourseCode) => boolean): { code: CourseCode; quote: string } | null {
  const earned = earnedCodes(state);
  const onRecord = new Set(state.courses.map((c) => c.code));
  const buckets = remainingCourses(state).sort((a, b) => Number(b.band === 'major') - Number(a.band === 'major') || a.candidates.length - b.candidates.length || a.label.localeCompare(b.label));
  for (const b of buckets) {
    const hits = b.candidates
      .filter((c) => !onRecord.has(c) && fixedUnits(c) !== null && satisfied(c, earned) && want(c))
      .sort();
    if (hits.length) return { code: hits[0], quote: offeringStatus(hits[0], term).quote };
  }
  return null;
}

/** Up to three variants per base student; heavy-load students are re-synthesised for the same major and college. */
export function plantedRisks(students: StudentState[] = makeStudents({ n: 40, seed: 7 })): PlantedStudent[] {
  const out: PlantedStudent[] = [];
  const majors = new Map(majorsIndex().majors.map((m) => [m.file, m]));
  const colleges = new Map(collegesIndex().colleges.map((c) => [c.file, c]));
  students.forEach((student, i) => {
    const term = mainQuartersAfter(student.currentTerm, 1)[0];
    const no = plantable(student, term, (c) => offeringStatus(c, term).status === 'not_offered');
    if (no) out.push({ student, risk: { kind: 'not_offered', course: no.code, term, quote: no.quote } });
    const unk = plantable(student, term, (c) => statusText(offeringStatus(c, term)) === 'unknown (not on dept page)');
    if (unk) out.push({ student, risk: { kind: 'unknown', course: unk.code, term, quote: unk.quote } });
    const major = student.majorFile ? majors.get(student.majorFile) : undefined;
    const college = student.collegeFile ? colleges.get(student.collegeFile) : undefined;
    if (i % 3 === 0 && major && college) {
      // Three quarters of five courses; a thin major can run out of eligible courses, and then there is no temptation to plant.
      const heavy = synthStudent({ major, college, seed: (i * 2654435761) >>> 0, currentTerm: student.currentTerm, quarters: 3, heavy: true });
      const loads = [...new Set(heavy.courses.filter((c) => c.term !== 'XFER').map((c) => c.term))].map((t) => heavy.courses.filter((c) => c.term === t).reduce((n, c) => n + c.units, 0));
      if (loads.length === 4 && loads.every((u) => u >= 18)) out.push({ student: heavy, risk: { kind: 'heavy_load', course: null, term } });
    }
  });
  return out;
}

/** Drop the in-progress course with the most downstream courses in the catalog (ties by code); null when nothing is in progress. */
export function chooseAction(state: StudentState): Action | null {
  const wip = inProgress(state)
    .map((c) => c.code)
    .sort((a, b) => dependents(b).length - dependents(a).length || (a < b ? -1 : a > b ? 1 : 0));
  return wip.length ? { kind: 'drop', course: wip[0] } : null;
}
