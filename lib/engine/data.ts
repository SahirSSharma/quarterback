// Lazy, memoized loaders for the public data snapshot under data/. Everything reads with node:fs relative to
// process.cwd() so the same code runs in Vitest and in Next.js route handlers; nothing here awaits.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CourseCode, OfferingEvidence, TermCode } from '../types';

const dataDir = () => path.join(process.cwd(), 'data');

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(dataDir(), rel), 'utf8')) as T;
}

function memo<T>(fn: () => T): () => T {
  let value: T;
  let done = false;
  return () => {
    if (!done) { value = fn(); done = true; }
    return value;
  };
}

function memoBy<K, T>(fn: (key: K) => T): (key: K) => T {
  const cache = new Map<K, T>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, fn(key));
    return cache.get(key) as T;
  };
}

/** 'cse100', 'CSE-003', 'Math 20c ' → 'CSE 100', 'CSE 3', 'MATH 20C'. Anything else is upper-cased and trimmed. */
export function normalizeCode(raw: string): CourseCode {
  const s = String(raw ?? '').toUpperCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^([A-Z]{2,6})\s*0*(\d{1,3}[A-Z]{0,3})$/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s;
}

// ---------------------------------------------------------------------------------------------
// Catalog

export interface CatalogCourse {
  code: CourseCode;
  subject: string;
  num: string;
  title: string;
  /** As printed: '4', '2, 4', '1-4'. Use catalogUnits() for a number. */
  units: string;
  level?: string;
  description?: string;
  prereqText?: string;
  /** AND of OR-groups, codes normalized. Empty when the catalog lists none. */
  prereqs: string[][];
  listedAs?: string;
  /** Catalog page (department) the entry came from. */
  page: string;
}

interface RawCourse {
  code: string; subject?: string; num?: string; title?: string; units?: string; level?: string;
  description?: string; prereqText?: string; prereqs?: string[][] | null; listedAs?: string; page?: string;
}

/**
 * Every course record across the department pages plus the bare search index. Cross-listed courses appear
 * once per page they are printed on, so this is longer than catalogByCode().
 */
export const catalogEntries = memo((): CatalogCourse[] => {
  const dir = path.join(dataDir(), 'catalog');
  const out: CatalogCourse[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const json = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as unknown;
    // Two shapes: a department page {page, name, courses:[…]} and one bare list of {code,title,units,page}.
    // Anything else in the directory (index, grading restrictions, structured prereqs) is not a course list.
    const list: RawCourse[] | null = Array.isArray(json)
      ? (json as RawCourse[])
      : Array.isArray((json as { courses?: unknown }).courses) ? (json as { courses: RawCourse[] }).courses : null;
    if (!list) continue;
    const page = Array.isArray(json) ? '' : String((json as { page?: string }).page ?? file.replace(/\.json$/, ''));
    for (const c of list) {
      const code = normalizeCode(c.code);
      const [subject, num] = code.split(' ');
      out.push({
        code,
        subject: c.subject ?? subject,
        num: c.num ?? num ?? '',
        title: c.title ?? '',
        units: String(c.units ?? ''),
        level: c.level,
        description: c.description,
        prereqText: c.prereqText,
        prereqs: (c.prereqs ?? []).map((g) => g.map(normalizeCode)),
        listedAs: c.listedAs,
        page: c.page ?? page,
      });
    }
  }
  return out;
});

/**
 * data/catalog-overrides.json: hand-checked AND-of-OR groups that replace a catalog row's machine-derived
 * `prereqs` where the upstream parser misread the prereqText (scripts/audit-prereqs.ts finds candidates;
 * notes/engine-fixes.md records each decision). Keys and members are normalized like the catalog.
 */
export const catalogOverrides = memo((): Map<CourseCode, string[][]> => {
  const json = readJson<{ prereqs: Record<string, string[][]> }>('catalog-overrides.json');
  const map = new Map<CourseCode, string[][]>();
  for (const [code, groups] of Object.entries(json.prereqs)) map.set(normalizeCode(code), groups.map((g) => g.map(normalizeCode)));
  return map;
});

/**
 * One entry per code. A cross-listed course prefers the page of its own subject (CSE 282 from CSE, not BENG);
 * an override from catalogOverrides() wins over the snapshot's prereqs.
 */
export const catalogByCode = memo((): Map<CourseCode, CatalogCourse> => {
  const map = new Map<CourseCode, CatalogCourse>();
  for (const c of catalogEntries()) {
    const cur = map.get(c.code);
    const bare = !c.prereqText && !c.description && c.prereqs.length === 0;
    if (!cur) { map.set(c.code, c); continue; }
    if (bare) continue;
    if (cur.page !== cur.subject && c.page === c.subject) map.set(c.code, c);
  }
  // A new object per overridden entry, so catalogEntries() still shows the snapshot as scraped (the audit reads it).
  for (const [code, prereqs] of catalogOverrides()) {
    const c = map.get(code);
    if (c) map.set(code, { ...c, prereqs });
  }
  return map;
});

/** First number in the catalog units string, or null when the course is unknown or the string has none. */
export function catalogUnits(code: CourseCode): number | null {
  const c = catalogByCode().get(normalizeCode(code));
  const m = c ? /\d+(?:\.\d+)?/.exec(c.units) : null;
  return m ? Number(m[0]) : null;
}

export type GradingRestriction = 'P' | 'S' | 'L';
/** data/catalog/grading-restrictions.json: P = P/NP grades only, S = S/U only, L = letter grades only. Derived from catalog prose. */
export const gradingRestrictions = memo((): Record<CourseCode, GradingRestriction> => {
  const p = path.join(dataDir(), 'catalog/grading-restrictions.json');
  if (!existsSync(p)) return {};
  const json = JSON.parse(readFileSync(p, 'utf8')) as { restrictions?: Record<string, GradingRestriction> };
  const out: Record<CourseCode, GradingRestriction> = {};
  for (const [code, r] of Object.entries(json.restrictions ?? {})) out[normalizeCode(code)] = r;
  return out;
});

// ---------------------------------------------------------------------------------------------
// Requirement files (majors, college GE)

export interface Bucket {
  label: string;
  division?: string;
  kind: 'courses' | 'units';
  needed: number;
  courses: string[];
  note?: string;
  /** 'university' marks a campuswide requirement (DEI, AHI, JTCCER) that may double-count. */
  scope?: string;
  /** Non-course lines: 'unitTotal' | 'seeCollegeGE' | 'proficiency' | 'manual'. */
  type?: string;
  exclude?: string[];
  examCredits?: unknown[];
  // Written by the vendored engine after prepareBands():
  examEarned?: number;
  rangeText?: string;
}

export interface ProgramIndexEntry {
  major?: string;
  college?: string;
  degree?: string;
  department?: string;
  matchKey: string;
  slug: string;
  file: string;
  confidence: string;
  found: boolean;
  bucketCount: number;
}

export interface MajorFile {
  program: { major: string; degree: string; department: string };
  catalogYear?: string;
  confidence?: string;
  notes?: string;
  sourceUrls?: string[];
  buckets: Bucket[];
}

export interface CollegeFile {
  college: string;
  catalogYear?: string;
  notes?: string;
  buckets: Bucket[];
}

export const majorsIndex = memo(() => readJson<{ meta: unknown; majors: ProgramIndexEntry[]; excluded?: unknown[] }>('majors/index.json'));
export const collegesIndex = memo(() => readJson<{ meta: unknown; colleges: ProgramIndexEntry[] }>('college-ge/index.json'));
/** The parsed file, shared: allocate() mutates buckets, so callers clone before handing them to the engine. */
export const loadMajor = memoBy((file: string) => readJson<MajorFile>(path.join('majors', path.basename(file))));
export const loadCollege = memoBy((file: string) => readJson<CollegeFile>(path.join('college-ge', path.basename(file))));

// ---------------------------------------------------------------------------------------------
// CAPE grade history, sections, calendar

export interface GradeRow {
  /** Average letter grade, its point value, students counted, quarters counted, last quarter evaluated. */
  l: string; p: number; n: number; q: number; lq: TermCode;
}
interface GradesFile { _meta: { source: string; generated: string }; grades: Record<string, GradeRow> }
const gradesFile = memo(() => readJson<GradesFile>('grades.json'));
export const grades = memo((): Record<CourseCode, GradeRow> => {
  const out: Record<CourseCode, GradeRow> = {};
  for (const [code, row] of Object.entries(gradesFile().grades)) out[normalizeCode(code)] = row;
  return out;
});
export const gradesMeta = () => gradesFile()._meta;

export interface Section {
  meeting_type: string; section_code: string; days: string; time_start: string; time_end: string;
  instructor: string; seats_avail: number | null; seats_limit: number | null; waitlist_ct: number;
}
export interface SectionCourse {
  subject_code: string; course_num: string; title: string; units: string; sections: Section[];
}
/** Schedule of Classes for one term, or null when no data/sections/<term>.json exists. */
export const sectionsByCode = memoBy((term: TermCode): Map<CourseCode, SectionCourse> | null => {
  const p = path.join(dataDir(), 'sections', `${String(term).toUpperCase()}.json`);
  if (!existsSync(p)) return null;
  const list = JSON.parse(readFileSync(p, 'utf8')) as SectionCourse[];
  const map = new Map<CourseCode, SectionCourse>();
  for (const c of list) map.set(normalizeCode(`${c.subject_code} ${c.course_num}`), c);
  return map;
});

export interface CalendarTerm {
  name: string;
  quarterBegins: string; instructionBegins: string;
  dropWithoutW: string; changeUnits: string; changeGradingOption: string; dropWithW: string;
  lastDayOfClasses: string; finals: string[]; quarterEnds: string; holidays: string[];
}
export interface RegistrarCalendar {
  _source: { url: string; title: string; fetched: string; note: string };
  terms: Record<TermCode, CalendarTerm>;
}
export const registrarCalendar = memo(() => readJson<RegistrarCalendar>('registrar-calendar.json'));

// ---------------------------------------------------------------------------------------------
// Offerings evidence (department pages, written by the offerings module)

interface OfferingsFile { dept: string; sourceUrl: string; fetchedAt: string; terms: TermCode[]; rows: OfferingEvidence[] }

/** course → term → evidence, from every data/offerings/*.json that has a rows[] array. Absence is fine. */
export const offeringsRows = memo((): Map<CourseCode, Map<TermCode, OfferingEvidence>> => {
  const map = new Map<CourseCode, Map<TermCode, OfferingEvidence>>();
  const dir = path.join(dataDir(), 'offerings');
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Partial<OfferingsFile>;
    if (!Array.isArray(json.rows)) continue; // sources.json and anything else that is not evidence
    for (const row of json.rows) {
      const code = normalizeCode(row.course);
      const term = String(row.term).toUpperCase();
      const byTerm = map.get(code) ?? new Map<TermCode, OfferingEvidence>();
      byTerm.set(term, { ...row, course: code, term });
      map.set(code, byTerm);
    }
  }
  return map;
});
