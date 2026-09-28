// aiIntake: the fallback when lib/engine's deterministic Academic History parser reports low confidence.
// Lightning (thinking off, json_schema) reads the paste into a StudentState candidate; the vendored program
// matcher resolves the major and college files. Always source 'ai-intake'; confidence 'low' unless a major file
// matched ('medium' then — never 'high' from a model read); warnings say what the student must confirm.
//
//   aiIntake(text, {currentTerm}) → StudentState
import { z } from 'zod';
import type { StudentCourse, StudentState, TermCode } from '../types';
import { collegesIndex, majorsIndex, normalizeCode, type ProgramIndexEntry } from '../engine/data';
import { MATCH, indexPrograms, isConfident, matchCollege, matchProgram } from '../vendor/tritonplan/program-match.js';
import { structured } from '../tf/helpers';

export const INTAKE_STEP = 'intake';

export const intakeSchema = z.object({
  college: z.string().nullable().describe('UC San Diego college as written, e.g. "Revelle College"; null if absent'),
  major: z.string().nullable().describe('Major as written; null if absent'),
  degree: z.string().nullable().describe('e.g. "Bachelor of Science"; null if absent'),
  gpa: z.number().nullable().describe('Cumulative UC GPA; null if absent'),
  courses: z.array(
    z.object({
      code: z.string().describe('Subject and number with one space, e.g. "CSE 100"'),
      title: z.string().nullable(),
      term: z.string().describe('Quarter code: FA25, WI26, SP26, S126 (Summer Session I 2026); XFER for transfer credit'),
      units: z.number(),
      grade: z.string().nullable().describe('Letter grade, P, NP, W, or null while in progress'),
      inProgress: z.boolean().describe('True for the current quarter\'s rows (no grade yet)'),
    }),
  ),
});
export type IntakeRecord = z.output<typeof intakeSchema>;

const SYSTEM = `You read a UC San Diego student's pasted Academic History (TritonLink) and return it as JSON. List every course row exactly once with its quarter code, units and grade; transfer credit rows use term XFER. Copy names as written. Never invent a row, a grade or a program.`;

interface Match {
  status: string;
  entry: ProgramIndexEntry | null;
  candidates: ProgramIndexEntry[];
  reason: string;
  matchedName: string;
}

const SEASON: Record<string, string> = { fall: 'FA', winter: 'WI', spring: 'SP', summer: 'S1' };

/** 'FA25' as is; 'Fall 2025' / 'Fall Qtr 2025' → 'FA25'; anything transfer-like → 'XFER'; else upper-cased. */
export function toTermCode(raw: string): TermCode {
  const s = String(raw ?? '').trim();
  if (/^[A-Z][A-Z0-9]\d{2}$/i.test(s)) return s.toUpperCase();
  if (/xfer|transfer/i.test(s)) return 'XFER';
  const m = /(fall|winter|spring|summer)\D*(\d{4}|\d{2})\b/i.exec(s);
  return m ? `${SEASON[m[1].toLowerCase()]}${m[2].slice(-2)}` : s.toUpperCase();
}

// Letter grades and the notations TritonLink prints in the grade column. An in-progress row has none: the
// recorded Lightning read of the demo paste copied the "0.00" grade-points cell into `grade` and left
// inProgress false, so anything that is not a grade means "no grade yet".
const GRADE = /^(?:[A-D][+-]?|F|P|NP|S|U|W|I|IP|H|NR|IN)$/i;

export function toStudentState(record: IntakeRecord, currentTerm: TermCode): StudentState {
  const term = String(currentTerm).toUpperCase();
  const warnings: string[] = [];
  const courses: StudentCourse[] = record.courses.map((c) => {
    const grade = c.grade?.trim() ?? '';
    const wip = c.inProgress || !GRADE.test(grade) || grade.toUpperCase() === 'IP';
    return {
      code: normalizeCode(c.code),
      ...(c.title ? { title: c.title } : {}),
      term: toTermCode(c.term),
      units: Number(c.units) || 0,
      grade: wip ? null : grade.toUpperCase(),
      status: wip ? 'wip' : 'earned',
    };
  });

  let majorFile: string | null = null;
  let confidence: StudentState['confidence'] = 'low';
  if (record.major) {
    const shaped = indexPrograms(majorsIndex().majors, 'major');
    const hit = matchProgram(record.major, shaped, { degree: record.degree ?? undefined }) as unknown as Match;
    if ((isConfident(hit.status) || hit.status === MATCH.PARENT) && hit.entry) {
      majorFile = hit.entry.file;
      confidence = 'medium';
      warnings.push(`Confirm the major: the record reads "${record.major}", matched to the "${hit.matchedName}" requirement set.`);
    } else if (hit.status === MATCH.AMBIGUOUS) {
      warnings.push(`"${record.major}" matches ${hit.candidates.length} requirement sets: ${hit.candidates.map((c) => `${c.major} (${c.degree})`).join('; ')}. Pick one.`);
    } else {
      warnings.push(`No requirement set matches the major "${record.major}".`);
    }
  } else {
    warnings.push('No major found on the record.');
  }

  const col = record.college ? (matchCollege(record.college, collegesIndex().colleges) as unknown as Match) : null;
  const collegeFile = col?.status === MATCH.EXACT && col.entry ? col.entry.file : null;
  if (!collegeFile) warnings.push(record.college ? `College "${record.college}" did not match a GE file.` : 'No college found on the record.');

  warnings.push(`A model read this paste, not the parser: confirm the ${courses.length} course rows (codes, quarters, units, grades) before planning.`);
  if (!courses.some((c) => c.status === 'wip' && c.term === term)) warnings.push(`No in-progress courses were found for ${term}.`);

  return {
    college: record.college ?? '',
    collegeFile,
    major: record.major ?? '',
    majors: record.major ? [record.major] : [],
    majorFile,
    courses,
    transfer: [],
    gpa: record.gpa,
    currentTerm: term,
    source: 'ai-intake',
    confidence,
    warnings,
  };
}

export async function aiIntake(text: string, opts: { currentTerm: TermCode }): Promise<StudentState> {
  const record = await structured('extract', {
    system: SYSTEM,
    user: text,
    schema: intakeSchema,
    name: 'academic_record',
    maxTokens: 6000,
    step: INTAKE_STEP,
  });
  return toStudentState(record, opts.currentTerm);
}
