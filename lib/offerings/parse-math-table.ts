// MATH "Planned Course Offerings": an HTML table (COURSE | COURSE NAME | LECT | FALL | WINTER | SPRING).
// A course with several lecture sections spans rows (rowspan); continuation rows carry LECT + the three
// term cells. A course is offered in a term if ANY of its rows names an instructor in that column.
// Parsed from the HTML rather than Tavily's markdown because the markdown drops empty <td></td> cells,
// which makes a one-name row impossible to place in a quarter.
import type { OfferingEvidence } from '../types';
import { normalizeCourseCode, termCode } from './normalize';
import { QUOTE_MAX } from './parse-sheet-csv';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Visible text of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function htmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function cells(row: string): string[] {
  return [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => htmlText(m[1]));
}

interface Section {
  lect: string;
  names: string[];
  /** The rendered row, cells joined with ' | ', prefixed with the course code for continuation rows. */
  text: string;
}

export function parseMathHtml(html: string, meta: { url: string; fetchedAt: string; academicYear: string }): OfferingEvidence[] {
  const courses = new Map<string, { terms: string[]; sections: Section[] }>();
  let terms: string[] | null = null;
  let current: string | null = null;

  for (const [row] of html.matchAll(/<tr[\s\S]*?<\/tr>|<\/table>/gi)) {
    if (row.toLowerCase() === '</table>') {
      // A table boundary ends the current course, so a stray row elsewhere cannot be absorbed as a section.
      terms = null;
      current = null;
      continue;
    }
    const c = cells(row);
    if (c.length === 0) continue;
    if (c[0].toUpperCase() === 'COURSE') {
      // Only offering tables have LECT + term columns; anything else on the page is ignored.
      const termCells = c.slice(3).map((label) => termCode(label, meta.academicYear));
      terms = c[1].toUpperCase() === 'COURSE NAME' && c[2].toUpperCase() === 'LECT' && termCells.every((t): t is string => t !== null) ? termCells : null;
      current = null;
      continue;
    }
    if (!terms) continue;
    if (c.length === 3 + terms.length) {
      const course = normalizeCourseCode(c[0]);
      if (!course) throw new Error(`MATH table: row without a course code: ${c.join(' | ')}`);
      current = course;
      const entry = courses.get(course) ?? { terms, sections: [] };
      entry.sections.push({ lect: c[2], names: c.slice(3), text: c.join(' | ') });
      courses.set(course, entry);
    } else if (c.length === 1 + terms.length && current) {
      courses.get(current)!.sections.push({ lect: c[0], names: c.slice(1), text: [current, ...c].join(' | ') });
    } else {
      throw new Error(`MATH table: unexpected row shape (${c.length} cells): ${c.join(' | ')}`);
    }
  }
  if (!courses.size) throw new Error('MATH table: no offering table found');

  const rows: OfferingEvidence[] = [];
  for (const [course, { terms: courseTerms, sections }] of courses) {
    courseTerms.forEach((term, i) => {
      const named = sections.filter((s) => s.names[i]);
      rows.push({
        course,
        term,
        status: named.length ? 'offered' : 'not_offered',
        quote: (named[0] ?? sections[0]).text.slice(0, QUOTE_MAX),
        url: meta.url,
        fetchedAt: meta.fetchedAt,
        ...(named.length ? { instructor: [...new Set(named.map((s) => s.names[i]))].join('; ') } : {}),
        source: 'department-page',
      });
    });
  }
  return rows;
}
