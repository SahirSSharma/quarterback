// Audit the catalog snapshot's machine-derived prerequisite groups against the prose they were read from.
// Two defect classes, both from the upstream TritonPlan catalog parser (details in notes/engine-fixes.md):
//   (a) a group taken from a clause that is not a prerequisite — "two units of credit offered … if CSE 15L
//       taken previously", "students may not receive credit for …", "renumbered from …", "(formerly …)";
//   (b) a course mention written in non-standard case or spacing ("Math 20C", "JWSP103", "MATH 31 AH") that
//       the groups omit, which silently narrows an OR-group or drops the prerequisite altogether.
// Reads the raw entries (before data/catalog-overrides.json is applied) and says which flagged courses the
// overrides file already covers. Every hit is a heuristic that needs a human read of the full prereqText.
//
//   node --import ./scripts/node-ts.ts scripts/audit-prereqs.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { catalogEntries, catalogOverrides, normalizeCode } from '../lib/engine/data';
import type { CatalogCourse } from '../lib/engine/data';

/** Clauses that mention courses without making them prerequisites. */
const NON_PREREQ_CLAUSE = /credit (?:offered|given)|no credit|taken previously|previously or concurrently|may not receive credit|students who have (?:taken|completed)|renumbered from|formerly/i;
/** Any subject-plus-number token, whatever its case or spacing: 'CSE 100', 'Math 20C', 'JWSP103'. */
const MENTION = /\b([A-Za-z]{2,5})\s*(\d{1,3}[A-Za-z]{0,3})\b/g;
/** 'MATH 31 AH': a letter suffix split from its number. */
const SPLIT_SUFFIX = /\b([A-Z]{2,5}) (\d{1,3}) ([A-Z]{1,2})\b/g;

interface Hit { code: string; page: string; detail: string; text: string }

const asCode = (subject: string, num: string) => normalizeCode(`${subject} ${num}`);

/** (a) Groups whose members are only mentioned after the first non-prerequisite clause. */
function groupsFromNonPrereqClause(c: CatalogCourse): Hit[] {
  const text = c.prereqText ?? '';
  const m = NON_PREREQ_CLAUSE.exec(text);
  if (!m || !c.prereqs.length) return [];
  const head = new Set([...text.slice(0, m.index).matchAll(MENTION)].map((x) => asCode(x[1], x[2])));
  const hits: Hit[] = [];
  for (const g of c.prereqs) {
    const tailOnly = g.filter((member) => !head.has(member));
    if (!tailOnly.length) continue;
    const how = tailOnly.length === g.length ? 'whole group' : `member ${tailOnly.join(', ')}`;
    hits.push({ code: c.code, page: c.page, detail: `${JSON.stringify(g)}: ${how} only after "${m[0]}"`, text });
  }
  return hits;
}

/** (b) Non-standard course mentions (case, missing space, split suffix) that no group contains. */
function omittedMentions(c: CatalogCourse, subjects: Set<string>): Hit[] {
  const listed = new Set(c.prereqs.flat());
  const hits: Hit[] = [];
  const hit = (raw: string, wanted: string) =>
    hits.push({ code: c.code, page: c.page, detail: `"${raw}" → ${wanted}, missing from ${JSON.stringify(c.prereqs)}`, text: c.prereqText ?? '' });
  for (const sentence of (c.prereqText ?? '').split(/(?<=[.;])\s+/)) {
    if (/major/i.test(sentence)) continue; // "restricted to SE27, SE28 … majors" lists major codes, not courses
    for (const m of sentence.matchAll(MENTION)) {
      const [raw, subject, num] = m;
      const standard = subject === subject.toUpperCase() && raw === `${subject} ${num}`;
      if (standard || !subjects.has(subject.toUpperCase())) continue;
      const wanted = asCode(subject, num);
      if (!listed.has(wanted)) hit(raw, wanted);
    }
    for (const m of sentence.matchAll(SPLIT_SUFFIX)) {
      const wanted = asCode(m[1], `${m[2]}${m[3]}`);
      if (subjects.has(m[1]) && !listed.has(wanted)) hit(m[0], wanted);
    }
  }
  return hits;
}

function report(title: string, hits: Hit[], overridden: Set<string>): void {
  const seen = new Set<string>();
  const unique = hits.filter((h) => !seen.has(`${h.code}|${h.detail}`) && seen.add(`${h.code}|${h.detail}`));
  console.log(`\n${title}: ${unique.length} hit${unique.length === 1 ? '' : 's'} across ${new Set(unique.map((h) => h.code)).size} courses`);
  for (const h of unique) {
    console.log(`  ${h.code} (${h.page || 'index'}) — override: ${overridden.has(h.code) ? 'yes' : 'NO'}\n    ${h.detail}\n    "${h.text}"`);
  }
}

const all = catalogEntries();
const withText = all.filter((c) => c.prereqText);
const subjects = new Set<string>([
  ...all.map((c) => c.subject),
  ...(JSON.parse(readFileSync(path.join(process.cwd(), 'data/subjects.json'), 'utf8')) as { code: string }[]).map((s) => s.code),
]);
const overridden = new Set(catalogOverrides().keys());

console.log(`Catalog: ${all.length} records, ${withText.length} with prereqText, ${withText.filter((c) => c.prereqs.length).length} with structured groups; ${overridden.size} overrides in data/catalog-overrides.json.`);
report('(a) groups from a non-prerequisite clause', withText.flatMap(groupsFromNonPrereqClause), overridden);
report('(b) non-standard course mentions the groups omit', withText.flatMap((c) => omittedMentions(c, subjects)), overridden);
