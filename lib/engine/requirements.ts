// Requirement progress: a thin wrapper over the vendored prepareBands()/allocate()/courseProgress(), plus the
// per-bucket view the impact card and verifier need (what is still open, and which courses could fill it).
// allocate() mutates bucket lists, so every call works on a deep clone of the requirement files.
import { courseProgress, isCourseBucket, prepareBands } from '../vendor/tritonplan/requirements-progress.js';
import { norm } from '../vendor/tritonplan/requirements-engine.js';
import type { CourseCode, StudentState } from '../types';
import { type Bucket, catalogByCode, loadCollege, loadMajor } from './data';
import { chainQuarters } from './prereqs';

export type Band = 'major' | 'college';

export interface RecordEntry {
  status: 'earned' | 'wip'; units: number; grade: string | null; term: string; title?: string; code: string; transfer?: boolean;
}
export interface Progress { taken: number; wip: number; planned: number; total: number }
export interface Bands {
  major: { buckets: Bucket[]; progress: Progress } | null;
  college: { buckets: Bucket[]; progress: Progress } | null;
  /** Normalized code → record entry, earned and in progress (the shape allocate() reads). */
  rec: Record<string, RecordEntry>;
  takenEarned: Set<string>;
}

// The vendored engine reads parser-shaped rows. Planned courses are not on the record; the verifier adds
// them as earned when it wants a plan scored. Status is the parser's: W/NP/F rows count as earned here, for
// parity with TritonPlan's own audit (prereq checks use earnedCodes() from student.ts instead).
function parserCourses(state: StudentState) {
  return state.courses
    .filter((c) => c.status !== 'planned')
    .map((c) => {
      const [subject, ...rest] = c.code.split(' ');
      return { subject, number: rest.join(' '), title: c.title ?? '', term: c.term, grade: c.grade, units: c.units, status: c.status };
    });
}

export function bands(state: StudentState): Bands {
  const majorBuckets: Bucket[] = state.majorFile ? structuredClone(loadMajor(state.majorFile).buckets) : [];
  const collegeBuckets: Bucket[] = state.collegeFile ? structuredClone(loadCollege(state.collegeFile).buckets) : [];
  const ctx = prepareBands(parserCourses(state), state.transfer as never[], majorBuckets, collegeBuckets, []) as unknown as {
    rec: Record<string, RecordEntry>; takenEarned: Set<string>;
  };
  const progress = (b: Bucket[]) => courseProgress(b, ctx.rec, ctx.takenEarned) as Progress;
  return {
    major: state.majorFile ? { buckets: majorBuckets, progress: progress(majorBuckets) } : null,
    college: state.collegeFile ? { buckets: collegeBuckets, progress: progress(collegeBuckets) } : null,
    rec: ctx.rec,
    takenEarned: ctx.takenEarned,
  };
}

export interface BucketProgress {
  band: Band;
  label: string;
  kind: 'courses' | 'units';
  needed: number;
  /** Credited by allocate() plus exam credit, in courses or units, capped at needed. */
  earned: number;
  inProgress: number;
  remaining: number;
  earnedCodes: CourseCode[];
  wipCodes: CourseCode[];
  /** Catalog courses that could still fill the bucket; empty once nothing remains. */
  candidates: CourseCode[];
}

// Requirement lines that no course can satisfy (unit totals, "see college GE", proficiency, manual checks).
const NOT_COURSE = new Set(['unitTotal', 'seeCollegeGE', 'proficiency', 'manual']);
const RANGE = /^([A-Z]{2,6})\s+(\d+)\s*[-–]\s*(\d+)$/;

/** Catalog codes inside 'CSE 100-199'-style range text (several ranges may be comma-joined). */
function rangeCandidates(rangeText: string): CourseCode[] {
  const out: CourseCode[] = [];
  for (const part of rangeText.split(',')) {
    const m = RANGE.exec(norm(part));
    if (!m) continue;
    const [, subj, lo, hi] = m;
    for (const c of catalogByCode().values()) {
      const n = parseInt(c.num, 10);
      if (c.subject === subj && n >= +lo && n <= +hi) out.push(c.code);
    }
  }
  return out;
}

function bandProgress(band: Band, buckets: Bucket[], b: Bands): BucketProgress[] {
  const out: BucketProgress[] = [];
  const claimedWip = new Set<string>(); // one in-progress course fills one bucket, as courseProgress() does
  for (const bucket of buckets) {
    const needed = +bucket.needed || 0;
    if (needed <= 0 || NOT_COURSE.has(bucket.type ?? '')) continue;
    if (bucket.kind !== 'units' && !isCourseBucket(bucket)) continue;
    const units = bucket.kind === 'units';
    const amount = (k: string) => (units ? b.rec[k]?.units ?? 0 : 1);
    const earnedCodes = bucket.courses.map(norm).filter((k) => b.takenEarned.has(k));
    const earned = Math.min(needed, earnedCodes.reduce((n, k) => n + amount(k), 0) + (bucket.examEarned ?? 0));
    let inProgress = 0;
    const wipCodes: CourseCode[] = [];
    for (const k of bucket.courses.map(norm)) {
      if (earned + inProgress >= needed) break;
      if (b.rec[k]?.status !== 'wip' || claimedWip.has(k)) continue;
      claimedWip.add(k);
      wipCodes.push(k);
      inProgress += amount(k);
    }
    const remaining = Math.max(0, needed - earned - inProgress);
    let candidates: CourseCode[] = [];
    if (remaining > 0) {
      const excluded = new Set((bucket.exclude ?? []).map(norm));
      const pool = [...bucket.courses.map(norm), ...(bucket.rangeText ? rangeCandidates(bucket.rangeText) : [])];
      candidates = [...new Set(pool)].filter((k) => !b.rec[k] && !excluded.has(k) && catalogByCode().has(k));
    }
    out.push({ band, label: bucket.label, kind: units ? 'units' : 'courses', needed, earned, inProgress, remaining, earnedCodes, wipCodes, candidates });
  }
  return out;
}

/** Every countable bucket in both bands with what is credited, in progress and still open. */
export function bucketProgress(state: StudentState, b: Bands = bands(state)): BucketProgress[] {
  return [
    ...(b.major ? bandProgress('major', b.major.buckets, b) : []),
    ...(b.college ? bandProgress('college', b.college.buckets, b) : []),
  ];
}

/** The unfinished buckets, each with the courses that could still fill it. */
export function remainingCourses(state: StudentState, b?: Bands): BucketProgress[] {
  return bucketProgress(state, b).filter((p) => p.remaining > 0);
}

/** Buckets (from the original files, before allocation) that list `code`, by name or by range. */
export function bucketsFor(code: CourseCode, state: StudentState): { band: Band; label: string }[] {
  const k = norm(code);
  const [subj, numText] = k.split(' ');
  const n = parseInt(numText ?? '', 10);
  const out: { band: Band; label: string }[] = [];
  const scan = (band: Band, buckets: Bucket[]) => {
    for (const b of buckets) {
      const hit = b.courses.some((tok) => {
        const t = norm(tok);
        if (t === k) return true;
        const m = RANGE.exec(t);
        return !!m && m[1] === subj && n >= +m[2] && n <= +m[3];
      });
      if (hit) out.push({ band, label: b.label });
    }
  };
  if (state.majorFile) scan('major', loadMajor(state.majorFile).buckets);
  if (state.collegeFile) scan('college', loadCollege(state.collegeFile).buckets);
  return out;
}

/**
 * Longest prerequisite chain, in quarters, that finishing the open buckets still requires. Each bucket is
 * finished the quickest way: its candidates sorted by chain length, taking as many as it still needs
 * (units buckets count 4 units per course). The slowest bucket sets the number.
 */
export function remainingChainQuarters(earned: Set<CourseCode>, open: BucketProgress[]): number {
  let longest = 0;
  for (const p of open) {
    const want = p.kind === 'units' ? Math.ceil(p.remaining / 4) : p.remaining;
    const depths = p.candidates.map((c) => chainQuarters(c, earned)).sort((a, b) => a - b);
    if (!depths.length) continue;
    longest = Math.max(longest, depths[Math.min(want, depths.length) - 1]);
  }
  return longest;
}
