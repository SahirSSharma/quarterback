import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTavilyClient, MissingFixtureError } from '../tavily/client';
import type { TavilyClient, TavilyCreditEntry } from '../tavily/client';
import { contentHash } from './build';
import { discoverSource, eceDisclaimer, loadSources, parseSource, pickUrl, searchQuery, sheetCsvUrl, sheetPageDisclaimer } from './discover';
import type { Source } from './discover';

const root = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(root, 'data/offerings', f), 'utf8');
const { academicYear, sources } = loadSources(path.join(root, 'data/offerings'));
const source = (dept: string) => sources.find((s) => s.dept === dept)!;
const sheetCsv = (dept: string) => (source(dept) as Source & { sheetCsv: string }).sheetCsv;

/** Serves the saved raw fixtures for the urls discovery fetches directly; anything else is a test failure. */
const localFiles: Record<string, string> = {
  [source('CSE').url]: 'raw-cse-page-2026-27.html',
  [sheetCsv('CSE')]: 'raw-cse-2026-27.csv',
  [source('MATH').url]: 'raw-math-2026-27.html',
  [source('COGS').url]: 'raw-cogs-page-2026-27.html',
  [sheetCsv('COGS')]: 'raw-cogs-2026-27.csv',
};
function localFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const file = localFiles[String(url)];
    if (!file) throw new Error(`unexpected fetch ${String(url)}`);
    return new Response(read(file), { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
/** Mock-mode client over the recorded fixtures in fixtures/tavily; a network call would throw. */
const mockTavily = () => createTavilyClient({ mode: 'mock', fixturesDir: path.join(root, 'fixtures/tavily'), fetch: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch });

describe('searchQuery / pickUrl / sheetCsvUrl', () => {
  it('builds the re-discovery query from dept and academic year', () => {
    expect(searchQuery('CSE', '2026-2027')).toBe('CSE tentative course offerings 2026-2027 site:ucsd.edu');
  });

  it('prefers the known url, ignoring its query string, then the same host, then falls back', () => {
    const r = (url: string) => ({ title: '', url, content: '', score: 1 });
    const known = 'https://math.ucsd.edu/students/planned-course-offerings?year=2026-2027';
    expect(pickUrl(known, [r('https://x.ucsd.edu/'), r('https://math.ucsd.edu/students/planned-course-offerings')])).toEqual({ url: known });
    expect(pickUrl(known, [r('https://x.ucsd.edu/'), r('https://math.ucsd.edu/students/undergraduate')])).toMatchObject({ url: 'https://math.ucsd.edu/students/undergraduate' });
    expect(pickUrl(known, [r('https://x.ucsd.edu/')])).toMatchObject({ url: known, note: expect.stringContaining('keeping the known url') });
  });

  it('finds the published-CSV url of the sheet each page embeds', () => {
    expect(sheetCsvUrl(read('raw-cse-page-2026-27.html'))).toBe(sheetCsv('CSE'));
    expect(sheetCsvUrl(read('raw-cogs-page-2026-27.html'))).toBe(sheetCsv('COGS'));
    expect(sheetCsvUrl('<html><iframe src="https://example.com"></iframe></html>')).toBeNull();
  });

  it('quotes each page caveat verbatim', () => {
    expect(sheetPageDisclaimer(read('raw-cse-page-2026-27.html'))).toBe('This page is tentative and subject to change. If no instructor is listed, the course will not be offered.');
    expect(sheetPageDisclaimer(read('raw-cogs-page-2026-27.html'))).toBe('These are tentative schedules. Classes and/or instructors may change or be canceled.');
    const ece = eceDisclaimer(read('raw-ece-2026-27.md'))!;
    expect(ece).toMatch(/^Please note if you see a professor's name in a box below, .*If there is a blank box, then the course is not being offered that quarter\.$/);
    expect(read('raw-ece-2026-27.md').includes(ece)).toBe(true);
    expect(sheetPageDisclaimer(read('raw-math-2026-27.html'))).toBeUndefined();
  });
});

describe('discoverSource against the recorded Tavily fixtures (mock mode)', () => {
  it('CSE: re-finds the page, follows the sheet iframe to the CSV, hashes it and quotes the disclaimer', async () => {
    const tavily = mockTavily();
    const fetch = localFetch();
    const d = await discoverSource(source('CSE'), { tavily, fetch, academicYear });
    expect(d.url).toBe(source('CSE').url);
    expect(d.raw).toBe(read('raw-cse-2026-27.csv'));
    expect(d.contentHash).toBe(contentHash(read('raw-cse-2026-27.csv')));
    expect(d.disclaimer).toBe('This page is tentative and subject to change. If no instructor is listed, the course will not be offered.');
    expect(d.page).toBe(read('raw-cse-page-2026-27.html'));
    expect(d.changed).toBe(true);
    expect(d.notes).toEqual([]);
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([source('CSE').url, sheetCsv('CSE')]);
    expect(d.credits).toBe(1);
    expect(tavily.ledger).toHaveLength(1);
    expect(tavily.ledger[0]).toMatchObject({ endpoint: 'search', step: 'offerings:CSE:search', credits: 1, replayed: true });
  });

  it('hash gate: unchanged content is reported as not changed', async () => {
    const d = await discoverSource(source('CSE'), { tavily: mockTavily(), fetch: localFetch(), academicYear, previousHash: contentHash(read('raw-cse-2026-27.csv')) });
    expect(d.changed).toBe(false);
    const d2 = await discoverSource(source('CSE'), { tavily: mockTavily(), fetch: localFetch(), academicYear, previousHash: 'stale' });
    expect(d2.changed).toBe(true);
  });

  it('MATH: fetches the HTML directly and keeps the year-specific url', async () => {
    const d = await discoverSource(source('MATH'), { tavily: mockTavily(), fetch: localFetch(), academicYear });
    expect(d.url).toBe(source('MATH').url);
    expect(d.raw).toBe(read('raw-math-2026-27.html'));
    expect(d.disclaimer).toBeUndefined();
    expect(d.credits).toBe(1);
  });

  it('COGS: the index page embeds the sheet too', async () => {
    const d = await discoverSource(source('COGS'), { tavily: mockTavily(), fetch: localFetch(), academicYear });
    expect(d.url).toBe(source('COGS').url);
    expect(d.raw).toBe(read('raw-cogs-2026-27.csv'));
    expect(d.disclaimer).toBe('These are tentative schedules. Classes and/or instructors may change or be canceled.');
    expect(d.credits).toBe(1);
  });

  it('retries a direct fetch once', async () => {
    let failed = false;
    const flaky = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === sheetCsv('CSE') && !failed) {
        failed = true;
        throw new TypeError('fetch failed');
      }
      return new Response(read(localFiles[String(url)]), { status: 200 });
    }) as unknown as typeof fetch;
    const d = await discoverSource(source('CSE'), { tavily: mockTavily(), fetch: flaky, academicYear });
    expect(d.raw).toBe(read('raw-cse-2026-27.csv'));
  });

  it('ECE: extracts the markdown table with Tavily (advanced) and quotes the blank-box rule', async () => {
    const md = read('raw-ece-2026-27.md');
    const ledger: TavilyCreditEntry[] = [];
    const extract = vi.fn(async () => {
      ledger.push({ at: '', step: 'offerings:ECE:extract', endpoint: 'extract', ms: 1, credits: 2, replayed: false });
      return { results: [{ url: source('ECE').url, raw_content: md }], failed_results: [], usage: { credits: 2 } };
    });
    const stub: TavilyClient = {
      search: async () => {
        ledger.push({ at: '', step: 'offerings:ECE:search', endpoint: 'search', ms: 1, credits: 1, replayed: false });
        return { results: [{ title: 'ECE Tentative Course List', url: source('ECE').url, content: '', score: 0.9 }], usage: { credits: 1 } };
      },
      extract,
      map: async () => ({ results: [] }),
      ledger,
    };
    const d = await discoverSource(source('ECE'), { tavily: stub, fetch: localFetch(), academicYear });
    expect(extract).toHaveBeenCalledWith({ urls: [source('ECE').url], extract_depth: 'advanced' }, 'offerings:ECE:extract');
    expect(d.raw).toBe(md);
    expect(d.disclaimer).toMatch(/blank box/);
    expect(d.credits).toBe(3);
  });

  it('never reaches the network for an unrecorded request', async () => {
    const unrecorded: Source = { dept: 'DSGN', url: 'https://cogsci.ucsd.edu/undergraduates/courses/index.html', kind: 'page-with-google-sheet' };
    await expect(discoverSource(unrecorded, { tavily: mockTavily(), fetch: localFetch(), academicYear })).rejects.toBeInstanceOf(MissingFixtureError);
  });
});

describe('parseSource', () => {
  it('dispatches each source kind to its parser', () => {
    const meta = { url: 'u', fetchedAt: 't', academicYear };
    expect(parseSource(source('CSE'), read('raw-cse-2026-27.csv'), meta)).toHaveLength(92 * 3);
    expect(parseSource(source('MATH'), read('raw-math-2026-27.html'), meta)).toHaveLength(175 * 3);
    expect(parseSource(source('ECE'), read('raw-ece-2026-27.md'), meta)).toHaveLength(185 * 3);
    expect(parseSource(source('COGS'), read('raw-cogs-2026-27.csv'), meta)).toHaveLength(92 * 3);
  });
});
