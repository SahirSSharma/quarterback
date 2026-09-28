// Nightly discovery for one department source: Tavily /search re-finds the page (they move yearly), the raw
// source text is fetched (Tavily /extract for markdown tables; a direct fetch for the Google-Sheet CSVs
// behind the CSE and COGS pages and for the MATH HTML, whose empty cells Tavily's markdown drops), and a
// sha256 gate lets the caller skip re-parsing unchanged content.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OfferingEvidence } from '../types';
import type { TavilyClient, TavilySearchResult } from '../tavily/client';
import { contentHash } from './build';
import { parseSheetCsv } from './parse-sheet-csv';
import { parseEceTable } from './parse-ece-table';
import { htmlText, parseMathHtml } from './parse-math-table';

export type SourceKind = 'page-with-google-sheet' | 'html-table' | 'markdown-table';

export interface Source {
  dept: string;
  url: string;
  kind: SourceKind;
}

export interface Sources {
  academicYear: string;
  sources: Source[];
}

export function loadSources(dir = 'data/offerings'): Sources {
  const json = JSON.parse(readFileSync(path.resolve(process.cwd(), dir, 'sources.json'), 'utf8'));
  return { academicYear: json.academicYear, sources: json.sources };
}

export function searchQuery(dept: string, academicYear: string): string {
  return `${dept} tentative course offerings ${academicYear} site:ucsd.edu`;
}

/** The known url when the search still returns it (query string ignored), else the first result on its host, else the known url. */
export function pickUrl(known: string, results: TavilySearchResult[]): { url: string; note?: string } {
  const strip = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  if (results.some((r) => strip(r.url) === strip(known))) return { url: known };
  const host = new URL(known).host;
  const sameHost = results.find((r) => URL.canParse(r.url) && new URL(r.url).host === host);
  if (sameHost) return { url: sameHost.url, note: `known url not in search results; using ${sameHost.url}` };
  return { url: known, note: 'known url not in search results and no result on its host; keeping the known url' };
}

/** The published-CSV url of the first Google Sheet a page embeds as an iframe. */
export function sheetCsvUrl(html: string): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/e\/([^/"'\s]+)\/pubhtml\?[^"'\s]*?gid=(\d+)/.exec(html);
  return m ? `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?gid=${m[2]}&single=true&output=csv` : null;
}

/** The sentences of `text` matching each pattern, verbatim, joined with a space. Lines bound sentences too. */
function sentences(text: string, patterns: RegExp[]): string | undefined {
  const found = patterns
    .map((p) => new RegExp(`[^.!?\n]*${p.source}[^.!?\n]*[.!?]`, 'i').exec(text)?.[0].replace(/^[\s*]+/, '').trim())
    .filter((s): s is string => !!s);
  return found.length ? found.join(' ') : undefined;
}

/** The caveat a Google-Sheet page states about itself (CSE and COGS word theirs differently). */
export function sheetPageDisclaimer(pageHtml: string): string | undefined {
  // One line per block element, so navigation text without periods cannot run into the first real sentence.
  const blocks = pageHtml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .split(/<\/?(?:p|div|li|h[1-6]|td|th|tr|br|section|article|nav|header|footer)\b[^>]*>/i)
    .map(htmlText)
    .filter(Boolean);
  return sentences(blocks.join('\n'), [
    /tentative and subject to change/,
    /no instructor is listed/,
    /these are tentative schedules/,
    /may change or be canceled/,
  ]);
}

export function eceDisclaimer(markdown: string): string | undefined {
  return sentences(markdown, [/professor.s name in a box/, /blank box/]);
}

export interface Discovered {
  dept: string;
  url: string;
  /** The source text the parser consumes: CSV, HTML or markdown. */
  raw: string;
  contentHash: string;
  fetchedAt: string;
  /** The hash differs from `previousHash`. */
  changed: boolean;
  /** Tavily credits this discovery cost, from the responses' usage. */
  credits: number;
  disclaimer?: string;
  /** For Google-Sheet sources, the page HTML the CSV url and disclaimer came from. */
  page?: string;
  notes: string[];
}

export interface DiscoverDeps {
  tavily: TavilyClient;
  fetch?: typeof fetch;
  previousHash?: string | null;
  academicYear: string;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; Quarterback offerings refresh; +https://github.com/SahirSSharma/quarterback)';

export async function discoverSource(source: Source, deps: DiscoverDeps): Promise<Discovered> {
  const { tavily } = deps;
  const doFetch = deps.fetch ?? fetch;
  const ledgerStart = tavily.ledger.length;
  const notes: string[] = [];
  const fetchedAt = new Date().toISOString();

  const found = await tavily.search(
    { query: searchQuery(source.dept, deps.academicYear), max_results: 5, search_depth: 'basic' },
    `offerings:${source.dept}:search`,
  );
  const picked = pickUrl(source.url, found.results);
  if (picked.note) notes.push(picked.note);
  const url = picked.url;

  // One retry: a connect timeout to docs.google.com was seen once on 2026-09-27 and succeeded on the next attempt.
  const text = async (u: string, attempt = 1): Promise<string> => {
    try {
      const res = await doFetch(u, { headers: { 'user-agent': USER_AGENT } });
      if (!res.ok) throw new Error(`GET ${u} failed: HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 2) throw err;
      return text(u, attempt + 1);
    }
  };

  let raw: string;
  let disclaimer: string | undefined;
  let page: string | undefined;
  switch (source.kind) {
    case 'page-with-google-sheet': {
      page = await text(url);
      const csvUrl = sheetCsvUrl(page);
      if (!csvUrl) throw new Error(`${source.dept}: no Google Sheet iframe found at ${url}`);
      raw = await text(csvUrl);
      disclaimer = sheetPageDisclaimer(page);
      break;
    }
    case 'html-table':
      raw = await text(url);
      break;
    case 'markdown-table': {
      const ex = await tavily.extract({ urls: [url], extract_depth: 'advanced' }, `offerings:${source.dept}:extract`);
      const hit = ex.results.find((r) => r.url === url) ?? ex.results[0];
      if (!hit) throw new Error(`Tavily /extract returned nothing for ${url}: ${ex.failed_results.map((f) => f.error).join('; ')}`);
      raw = hit.raw_content;
      disclaimer = eceDisclaimer(raw);
      break;
    }
  }

  const hash = contentHash(raw);
  return {
    dept: source.dept,
    url,
    raw,
    contentHash: hash,
    fetchedAt,
    changed: hash !== (deps.previousHash ?? null),
    credits: tavily.ledger.slice(ledgerStart).reduce((sum, e) => sum + e.credits, 0),
    ...(disclaimer ? { disclaimer } : {}),
    ...(page ? { page } : {}),
    notes,
  };
}

export function parseSource(source: Source, raw: string, meta: { url: string; fetchedAt: string; academicYear: string }): OfferingEvidence[] {
  switch (source.kind) {
    case 'page-with-google-sheet':
      return parseSheetCsv(raw, meta);
    case 'html-table':
      return parseMathHtml(raw, meta);
    case 'markdown-table':
      return parseEceTable(raw, meta);
  }
}
