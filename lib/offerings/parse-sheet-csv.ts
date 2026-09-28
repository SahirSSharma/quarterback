// Department pages that embed a published Google Sheet (CSE, COGS), exported as CSV. The first column is the
// course code; every column whose header names a quarter ('Fall 2026', 'Winter 2027', …) holds zero or more
// instructor names (newline-separated inside quotes). A name means offered; an empty cell means not offered
// (CSE: "If no instructor is listed, the course will not be offered"). Columns that are not quarters (Title,
// Summer 1/2 without a session) are ignored.
import type { OfferingEvidence } from '../types';
import { normalizeCourseCode, termCode } from './normalize';

export const QUOTE_MAX = 300;

interface CsvRecord {
  fields: string[];
  /** The record exactly as it appears in the file (embedded newlines kept, trailing CR dropped). */
  raw: string;
}

/** RFC 4180 records: quoted fields may contain commas, doubled quotes and newlines; CRLF or LF line ends. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let start = 0;
  const endRecord = (end: number) => {
    fields.push(field);
    const raw = text.slice(start, end).replace(/\r$/, '');
    if (raw.trim() !== '') records.push({ fields, raw });
    fields = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
      endRecord(i);
      if (c === '\r') i++;
      start = i + 1;
    } else field += c;
  }
  if (start < text.length) endRecord(text.length);
  return records;
}

export function parseSheetCsv(csv: string, meta: { url: string; fetchedAt: string }): OfferingEvidence[] {
  const [header, ...records] = parseCsvRecords(csv);
  if (!header || !/course/i.test(header.fields[0])) throw new Error(`offerings CSV: unexpected header ${JSON.stringify(header?.raw)}`);
  const termColumns = header.fields
    .map((label, index) => ({ index, term: termCode(label) }))
    .filter((c): c is { index: number; term: string } => c.term !== null);
  if (termColumns.length === 0) throw new Error(`offerings CSV: no term columns in header ${JSON.stringify(header.raw)}`);

  // A course listed on several rows (COGS repeats a few codes) is offered in a term when any of its rows names
  // an instructor there; the quote is the first row that does.
  const byCourse = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const course = normalizeCourseCode(record.fields[0] ?? '');
    if (!course) throw new Error(`offerings CSV: row without a course code: ${JSON.stringify(record.raw)}`);
    if (record.fields.length !== header.fields.length) throw new Error(`offerings CSV: expected ${header.fields.length} cells: ${JSON.stringify(record.raw)}`);
    byCourse.set(course, [...(byCourse.get(course) ?? []), record]);
  }

  const rows: OfferingEvidence[] = [];
  for (const [course, courseRecords] of byCourse) {
    for (const { index, term } of termColumns) {
      const namesOf = (r: CsvRecord) => r.fields[index].split('\n').map((s) => s.trim()).filter(Boolean);
      const named = courseRecords.filter((r) => namesOf(r).length);
      const names = [...new Set(named.flatMap(namesOf))];
      rows.push({
        course,
        term,
        status: names.length ? 'offered' : 'not_offered',
        quote: (named[0] ?? courseRecords[0]).raw.trim().slice(0, QUOTE_MAX),
        url: meta.url,
        fetchedAt: meta.fetchedAt,
        ...(names.length ? { instructor: names.join('; ') } : {}),
        source: 'department-page',
      });
    }
  }
  return rows;
}
