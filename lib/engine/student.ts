// StudentState from a pasted Academic History (vendored parser + program matcher) or from data/demo.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAcademicHistory } from '../vendor/tritonplan/parse-academic-history.js';
import { MATCH, indexPrograms, isConfident, matchCollege, matchProgram, splitPrograms } from '../vendor/tritonplan/program-match.js';
import type { CourseCode, StudentCourse, StudentState, TermCode } from '../types';
import { collegesIndex, majorsIndex, normalizeCode, type ProgramIndexEntry } from './data';
import { joinWrappedRows } from './paste';

export { normalizeCode };

// The vendored modules are plain JS; these are the parts of their results this module reads.
interface ParsedCourse {
  subject: string; number: string; title: string; term: string; grade: string | null; units: number; status: 'earned' | 'wip';
}
interface Parsed {
  student: { college: string; major: string; degree: string; majors: string[]; uc_gpa: number | null };
  transfer: unknown[];
  courses: ParsedCourse[];
}
interface Match {
  status: string; entry: ProgramIndexEntry | null; candidates: ProgramIndexEntry[]; reason: string; matchedName: string;
}

export function fromAcademicHistory(text: string, opts: { currentTerm: TermCode }): StudentState {
  // The vendored parser reads one course per line; a browser copy or PDF text wraps long rows over two or three.
  const p = parseAcademicHistory(joinWrappedRows(text)) as unknown as Parsed;
  const currentTerm = String(opts.currentTerm).toUpperCase();
  const warnings: string[] = [];

  const courses: StudentCourse[] = p.courses.map((c) => ({
    code: normalizeCode(`${c.subject} ${c.number}`),
    ...(c.title ? { title: c.title } : {}),
    term: String(c.term).toUpperCase(),
    units: Number(c.units) || 0,
    grade: c.grade ?? null,
    status: c.status,
  }));
  if (!courses.length) warnings.push('No course rows were recognised in the paste.');
  const staleWip = [...new Set(courses.filter((c) => c.status === 'wip').map((c) => c.term))].filter((t) => t !== currentTerm);
  if (staleWip.length) warnings.push(`In-progress courses are recorded under ${staleWip.join(', ')}, not the current term ${currentTerm}.`);

  // Major: every program the record names; a single field can hold two ("X / Y"), so let the index split it.
  const shaped = indexPrograms(majorsIndex().majors, 'major');
  const listed = p.student.majors.length ? p.student.majors : p.student.major ? [p.student.major] : [];
  const named: string[] = listed.flatMap((n) => splitPrograms(n, shaped) as string[]);
  let majorFile: string | null = null;
  let confidence: StudentState['confidence'] = 'high';
  if (!named.length) {
    confidence = 'low';
    warnings.push('No major found on the record.');
  } else {
    const hit = matchProgram(named[0], shaped, { degree: p.student.degree }) as unknown as Match;
    if (isConfident(hit.status) && hit.entry) {
      majorFile = hit.entry.file;
    } else if (hit.status === MATCH.PARENT && hit.entry) {
      majorFile = hit.entry.file;
      confidence = 'medium';
      warnings.push(`Using the "${hit.matchedName}" requirement set for "${named[0]}": ${hit.reason}.`);
    } else if (hit.status === MATCH.AMBIGUOUS) {
      confidence = 'low';
      const options = hit.candidates.map((c) => `${c.major} (${c.degree})`).join('; ');
      warnings.push(`"${named[0]}" matches ${hit.candidates.length} requirement sets: ${options}. Pick one.`);
    } else {
      confidence = 'low';
      warnings.push(`No requirement set matches the major "${named[0]}".`);
    }
  }
  if (named.length > 1) warnings.push(`Second major "${named.slice(1).join('", "')}" is on the record and is not checked.`);

  const col = matchCollege(p.student.college, collegesIndex().colleges) as unknown as Match;
  const collegeFile = col.status === MATCH.EXACT && col.entry ? col.entry.file : null;
  if (!collegeFile) {
    warnings.push(p.student.college ? `College "${p.student.college}" did not match a GE file.` : 'No college found on the record.');
    if (confidence === 'high') confidence = 'medium';
  }

  return {
    college: p.student.college,
    collegeFile,
    major: named[0] ?? p.student.major ?? '',
    majors: named,
    majorFile,
    courses,
    transfer: p.transfer,
    gpa: p.student.uc_gpa ?? null,
    currentTerm,
    source: 'paste',
    confidence,
    warnings,
  };
}

/** The synthetic demo students in data/demo, in file-name order. */
export function demoStudents(): StudentState[] {
  const dir = path.join(process.cwd(), 'data', 'demo');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as StudentState);
}

// The parser marks every graded row 'earned', including W/NP/F. Those rows stay on the record (TritonPlan
// parity) but do not satisfy a prerequisite, so the prereq/verifier side of the engine uses this set.
const NOT_PASSING = new Set(['W', 'NP', 'F', 'I', 'U']);

export function earnedCodes(state: StudentState): Set<CourseCode> {
  const out = new Set<CourseCode>();
  for (const c of state.courses) {
    if (c.status === 'earned' && !NOT_PASSING.has(String(c.grade ?? '').toUpperCase())) out.add(normalizeCode(c.code));
  }
  return out;
}

/** Courses in progress in the student's current term. */
export function inProgress(state: StudentState): StudentCourse[] {
  return state.courses.filter((c) => c.status === 'wip' && c.term === state.currentTerm);
}
