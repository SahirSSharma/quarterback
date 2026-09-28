// Offering evidence for a course in a term, strongest source first: a department page row (written by the
// offerings module), the Schedule of Classes for a term we have sections for, then CAPE history — which
// only says when the course was LAST evaluated, so its status is 'unknown'. Nothing here invents 'offered'.
import type { CourseCode, OfferingEvidence, TermCode } from '../types';
import { grades, gradesMeta, normalizeCode, offeringsRows, sectionsByCode } from './data';
import { mainQuartersAfter } from './terms';

// Public entry point of the Schedule of Classes the FA26 sections snapshot mirrors. The snapshot file carries
// no fetch timestamp of its own; this is the date the data/ directory was compiled (NOTICE.md).
const SCHEDULE_URL = 'https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm';
const SECTIONS_SNAPSHOT_FETCHED_AT = '2026-09-27T00:00:00.000Z';
const CAPE_URL = 'https://classplanner.apps.ucsd.edu';

export function offeringStatus(code: CourseCode, term: TermCode): OfferingEvidence {
  const course = normalizeCode(code);
  const t = String(term).toUpperCase();

  const row = offeringsRows().get(course)?.get(t);
  if (row) return row;

  const section = sectionsByCode(t)?.get(course);
  if (section) {
    const lecture = section.sections.find((s) => s.meeting_type === 'LE') ?? section.sections[0];
    const quote = lecture
      ? `${course} ${lecture.section_code} ${lecture.meeting_type} ${lecture.days} ${lecture.time_start}-${lecture.time_end} ${lecture.instructor}`.replace(/\s+/g, ' ').trim()
      : `${course} ${section.title}`;
    return {
      course, term: t, status: 'offered', quote, url: SCHEDULE_URL, fetchedAt: SECTIONS_SNAPSHOT_FETCHED_AT,
      ...(lecture?.instructor ? { instructor: lecture.instructor } : {}),
      source: 'schedule-of-classes',
    };
  }

  const cape = grades()[course];
  const fetchedAt = new Date(gradesMeta().generated).toISOString();
  if (cape) {
    return {
      course, term: t, status: 'unknown',
      quote: `${course}: last CAPE-evaluated offering ${cape.lq}; ${cape.q} quarters on record`,
      url: CAPE_URL, fetchedAt, source: 'cape-history',
    };
  }
  // No evidence at all. OfferingEvidence.source has no value for that, so this keeps the last source consulted
  // ('cape-history', with its URL) and the quote is the discriminator: it starts with "no source found".
  return {
    course, term: t, status: 'unknown',
    quote: `${course}: no source found — no department page row, no ${t} section, no CAPE history`,
    url: CAPE_URL, fetchedAt, source: 'cape-history',
  };
}

/** First of the next `horizonTerms` main quarters after `fromTerm` with offered or tentative evidence, or null. */
export function nextOffered(code: CourseCode, fromTerm: TermCode, horizonTerms = 6): { term: TermCode; evidence: OfferingEvidence } | null {
  for (const term of mainQuartersAfter(fromTerm, horizonTerms)) {
    const evidence = offeringStatus(code, term);
    if (evidence.status === 'offered' || evidence.status === 'tentative') return { term, evidence };
  }
  return null;
}
