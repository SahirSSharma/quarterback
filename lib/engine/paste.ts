// Pre-normalizer for a pasted Academic History: re-joins course rows that a browser copy or PDF text extraction
// broke across physical lines, so the vendored parser (one course per line) sees whole rows.
//
// Two wrap shapes arrive from the TSS page: the title continues on the next line and the units / grade / points
// tail follows it ("CSE 29 Systems Programming" / "and Software Tools 4.00 A 16.00"), and the tail alone drops
// to the next line ("CSE 29 Systems Programming and Software Tools" / "4.00 A 16.00"). A row may also take
// three lines (title, rest of the title, tail). A join is committed only when the joined text is a complete
// row, and a continuation is never a line that could start a row itself, so two complete rows are never merged
// and a transfer block (head / spine / equivalents) is left alone: a transfer spine ends in LD/UD or a course
// code, never in a points cell. The opposite wrap — tail on the first line, the rest of the title orphaned on
// the next — already parses as a row (with a shortened title) and is not touched.

// Mirrors ROW in lib/vendor/tritonplan/parse-academic-history.js, which does not export it; keep byte-identical.
const ROW = /^([A-Z]{2,4})\s+(\d{1,3}[A-Z]{0,2})\s+(.+?)\s+(\d+\.\d{1,2})(?:\s+([A-Z][+-]?|P|NP|IP|W|S|U))?\s+(\d+\.\d{1,2})\s*$/;
// The start of a course row: subject + number, optionally followed by title text. "II 4.00 B 12.00" (a Roman
// numeral ending a wrapped title) is not head-shaped because the number must be followed by whitespace or the end.
const HEAD = /^[A-Z]{2,4}\s+\d{1,3}[A-Z]{0,2}(?:\s+\S.*)?$/;
// Lines that begin a section, a header or a footer are never the rest of a course row.
const LABEL = /^(Term\b|Academic\b|Transfer Courses|Subject\s+Course|Not an Official|page\s+\d)/i;

const MAX_CONTINUATIONS = 2;

/** Re-joins course rows wrapped across up to three lines; every other line is returned byte-for-byte. */
export function joinWrappedRows(text: string): string {
  const lines = String(text ?? '').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trim();
    if (!HEAD.test(head) || ROW.test(head)) {
      out.push(lines[i]);
      continue;
    }
    let joined = head;
    let used = 0;
    for (let j = i + 1; j <= i + MAX_CONTINUATIONS && j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next || HEAD.test(next) || LABEL.test(next)) break;
      joined = `${joined} ${next}`;
      if (ROW.test(joined)) {
        used = j - i;
        break;
      }
    }
    if (used) {
      out.push(joined);
      i += used;
    } else {
      out.push(lines[i]);
    }
  }
  return out.join('\n');
}
