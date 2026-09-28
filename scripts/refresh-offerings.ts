// Refresh data/offerings/<DEPT>.json from the department pages in data/offerings/sources.json.
//
//   node --import ./scripts/node-ts.ts scripts/refresh-offerings.ts --offline
//       Parse the raw fixtures already saved in data/offerings (no network, $0).
//   QB_MODE=live [QB_RECORD=1] node --import ./scripts/node-ts.ts scripts/refresh-offerings.ts [--dept CSE,MATH]
//       Tavily /search re-discovers each page, the source is fetched, a hash gate skips unchanged content,
//       changed content is parsed and written together with its raw fixture. QB_RECORD=1 records the Tavily
//       responses under fixtures/tavily for mock mode. Credits are reported from the responses' usage.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mode } from '../lib/env';
import { createTavilyClient } from '../lib/tavily/client';
import { buildOfferingsFile, contentHash, readOfferingsFile, writeOfferingsFile } from '../lib/offerings/build';
import type { OfferingsFile } from '../lib/offerings/build';
import { discoverSource, eceDisclaimer, loadSources, parseSource, sheetPageDisclaimer } from '../lib/offerings/discover';
import type { Source } from '../lib/offerings/discover';

const DIR = 'data/offerings';
const EXT: Record<Source['kind'], string> = { 'page-with-google-sheet': 'csv', 'html-table': 'html', 'markdown-table': 'md' };

/** data/offerings/raw-cse-2026-27.csv; a Google-Sheet source's page HTML sits beside it as raw-cse-page-2026-27.html. */
function rawPath(source: Source, academicYear: string, page = false): string {
  const [y1, y2] = academicYear.split('-');
  return path.resolve(process.cwd(), DIR, `raw-${source.dept.toLowerCase()}${page ? '-page' : ''}-${y1}-${y2.slice(-2)}.${page ? 'html' : EXT[source.kind]}`);
}

function disclaimerFor(source: Source, raw: string, page: string | undefined): string | undefined {
  if (source.kind === 'page-with-google-sheet') return page ? sheetPageDisclaimer(page) : undefined;
  if (source.kind === 'markdown-table') return eceDisclaimer(raw);
  return undefined;
}

function report(file: OfferingsFile, p: string): void {
  const courses = new Set(file.rows.map((r) => r.course)).size;
  const perTerm = file.terms.map((t) => {
    const offered = file.rows.filter((r) => r.term === t && r.status === 'offered').length;
    return `${t} offered ${offered} / not offered ${file.rows.filter((r) => r.term === t && r.status === 'not_offered').length}`;
  });
  console.log(`${file.dept}: ${courses} courses, ${file.rows.length} rows → ${path.relative(process.cwd(), p)}\n  ${perTerm.join('\n  ')}`);
}

function offline(sources: Source[], academicYear: string): void {
  for (const source of sources) {
    const p = rawPath(source, academicYear);
    if (!existsSync(p)) {
      console.log(`${source.dept}: no raw fixture at ${path.relative(process.cwd(), p)}; skipped`);
      continue;
    }
    const raw = readFileSync(p, 'utf8');
    const pagePath = rawPath(source, academicYear, true);
    const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : undefined;
    const fetchedAt = statSync(p).mtime.toISOString();
    const rows = parseSource(source, raw, { url: source.url, fetchedAt, academicYear });
    const file = buildOfferingsFile(source.dept, rows, { sourceUrl: source.url, fetchedAt, contentHash: contentHash(raw), disclaimer: disclaimerFor(source, raw, page) });
    report(file, writeOfferingsFile(file, DIR));
  }
}

async function live(sources: Source[], academicYear: string): Promise<void> {
  if (mode() !== 'live') {
    console.error('Live refresh needs QB_MODE=live; use --offline to rebuild from the saved raw fixtures.');
    process.exit(1);
  }
  const tavily = createTavilyClient();
  for (const source of sources) {
    const previousHash = readOfferingsFile(source.dept, DIR)?.contentHash ?? null;
    const d = await discoverSource(source, { tavily, previousHash, academicYear });
    for (const note of d.notes) console.log(`${source.dept}: ${note}`);
    if (!d.changed) {
      console.log(`${source.dept}: unchanged (${d.contentHash.slice(0, 12)}), ${d.credits} credits`);
      continue;
    }
    writeFileSync(rawPath(source, academicYear), d.raw);
    if (d.page) writeFileSync(rawPath(source, academicYear, true), d.page);
    const rows = parseSource(source, d.raw, { url: d.url, fetchedAt: d.fetchedAt, academicYear });
    const file = buildOfferingsFile(source.dept, rows, { sourceUrl: d.url, fetchedAt: d.fetchedAt, contentHash: d.contentHash, disclaimer: d.disclaimer });
    report(file, writeOfferingsFile(file, DIR));
    console.log(`  ${d.credits} credits`);
  }
  const spent = tavily.ledger.filter((e) => !e.replayed).reduce((sum, e) => sum + e.credits, 0);
  console.log(`Tavily: ${tavily.ledger.length} calls, ${spent} credits (from usage)`);
}

const args = process.argv.slice(2);
const deptArg = args[args.indexOf('--dept') + 1];
const depts = args.includes('--dept') && deptArg ? deptArg.split(',').map((d) => d.trim().toUpperCase()) : null;
const { academicYear, sources } = loadSources(DIR);
const selected = depts ? sources.filter((s) => depts.includes(s.dept)) : sources;

if (args.includes('--offline')) offline(selected, academicYear);
else await live(selected, academicYear);
