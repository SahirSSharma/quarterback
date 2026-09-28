// ECE "Tentative Course List": Tavily markdown of an HTML table
// (| COURSE | FALL 26 | WINTER 27 | SPRING 27 | SU27 (TBD) |). The course cell holds two markdown links
// (code, title). A name in a cell means offered; a blank cell means not offered (the page: "If there is a
// blank box, then the course is not being offered that quarter"). The summer column has no session, so it
// is skipped.
import type { OfferingEvidence } from '../types';
import { normalizeCourseCode, stripMarkdownLinks, termCode } from './normalize';
import { QUOTE_MAX } from './parse-sheet-csv';

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function rendered(cell: string): string {
  return stripMarkdownLinks(cell).replace(/\s+/g, ' ').trim();
}

export function parseEceTable(markdown: string, meta: { url: string; fetchedAt: string }): OfferingEvidence[] {
  const rows: OfferingEvidence[] = [];
  let columns: { index: number; term: string }[] | null = null;
  let width = 0;

  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const c = splitRow(line);
    if (c[0].toUpperCase() === 'COURSE') {
      columns = c.map((label, index) => ({ index, term: termCode(label) })).filter((x): x is { index: number; term: string } => x.term !== null);
      width = c.length;
      continue;
    }
    if (!columns || /^-+$/.test(c[0])) continue;
    if (c.length !== width) throw new Error(`ECE table: expected ${width} cells: ${line.trim()}`);
    // The code link text is occasionally missing (only the title link survives); the catalog anchor still names it.
    const course = normalizeCourseCode(c[0]) ?? normalizeCourseCode(/#(ece\d+[a-z]*)/i.exec(c[0])?.[1] ?? '');
    if (!course) throw new Error(`ECE table: row without a course code: ${line.trim()}`);
    const quote = c.map(rendered).join(' | ').slice(0, QUOTE_MAX);
    for (const { index, term } of columns) {
      const instructor = rendered(c[index]);
      rows.push({
        course,
        term,
        status: instructor ? 'offered' : 'not_offered',
        quote,
        url: meta.url,
        fetchedAt: meta.fetchedAt,
        ...(instructor ? { instructor } : {}),
        source: 'department-page',
      });
    }
  }
  if (!rows.length) throw new Error('ECE table: no offering table found');
  return rows;
}
