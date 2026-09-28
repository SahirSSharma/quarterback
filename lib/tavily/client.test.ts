import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, createTavilyClient, fixtureKey, MissingFixtureError } from './client';
import type { TavilyCreditEntry } from './client';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'tavily-'));
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fixture keys', () => {
  it('are independent of key order and include include_usage', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
    expect(fixtureKey('search', { query: 'x', max_results: 5 })).toBe(fixtureKey('search', { max_results: 5, query: 'x' }));
    expect(fixtureKey('search', { query: 'x', include_usage: true })).not.toBe(fixtureKey('search', { query: 'x' }));
    expect(fixtureKey('search', { query: 'x' })).not.toBe(fixtureKey('extract', { query: 'x' }));
  });
});

describe('mock mode', () => {
  it('throws MissingFixtureError on an unknown request and never touches the network', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network call in mock mode')));
    const client = createTavilyClient({ mode: 'mock', fixturesDir: tmp(), fetch: fetchSpy as unknown as typeof fetch });
    await expect(client.search({ query: 'nothing recorded' }, 'test')).rejects.toBeInstanceOf(MissingFixtureError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.ledger).toEqual([]);
  });

  it('does not record even when asked to', async () => {
    const dir = tmp();
    const client = createTavilyClient({ mode: 'mock', record: true, fixturesDir: dir });
    await expect(client.extract({ urls: ['https://example.com'] }, 'test')).rejects.toThrow(/No Tavily fixture/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('live mode', () => {
  it('posts with the bearer key and include_usage, records credits from usage, and replays what it recorded', async () => {
    const dir = tmp();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse({ results: [{ title: 't', url: 'https://cse.ucsd.edu/x', content: 'c', score: 0.9 }], usage: { credits: 1 } });
    }) as typeof fetch;
    const sink: TavilyCreditEntry[] = [];
    const live = createTavilyClient({ mode: 'live', record: true, fixturesDir: dir, fetch: fetchStub, apiKey: 'test-key', sink: (e) => sink.push(e) });

    const res = await live.search({ query: 'CSE offerings', max_results: 5, search_depth: 'basic' }, 'offerings:CSE:search');
    expect(res.results[0].url).toBe('https://cse.ucsd.edu/x');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ query: 'CSE offerings', max_results: 5, search_depth: 'basic', include_usage: true });
    expect(live.ledger).toHaveLength(1);
    expect(live.ledger[0]).toMatchObject({ step: 'offerings:CSE:search', endpoint: 'search', credits: 1, replayed: false });
    expect(sink).toEqual(live.ledger);

    const key = fixtureKey('search', { query: 'CSE offerings', max_results: 5, search_depth: 'basic', include_usage: true });
    const fixture = path.join(dir, `${key}.json`);
    expect(existsSync(fixture)).toBe(true);
    expect(JSON.parse(readFileSync(fixture, 'utf8')).request.include_usage).toBe(true);

    const mock = createTavilyClient({ mode: 'mock', fixturesDir: dir, fetch: fetchStub });
    const replayed = await mock.search({ query: 'CSE offerings', max_results: 5, search_depth: 'basic' }, 'offerings:CSE:search');
    expect(replayed).toEqual(res);
    expect(calls).toHaveLength(1);
    expect(mock.ledger[0]).toMatchObject({ credits: 1, replayed: true });
  });

  it('fails loudly on an HTTP error without leaking the key', async () => {
    const fetchStub = (async () => jsonResponse({ detail: 'Unauthorized' }, 401)) as typeof fetch;
    const client = createTavilyClient({ mode: 'live', fixturesDir: tmp(), fetch: fetchStub, apiKey: 'secret-key' });
    const err = await client.extract({ urls: ['https://example.com'] }, 'test').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/HTTP 401/);
    expect((err as Error).message).not.toContain('secret-key');
    expect(client.ledger).toEqual([]);
  });

  it('refuses to run without a key', async () => {
    // An empty value survives loadEnv() (it only fills variables that are undefined), so .env.local cannot rescue this.
    const saved = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = '';
    const client = createTavilyClient({ mode: 'live', fixturesDir: tmp(), fetch: (async () => jsonResponse({})) as typeof fetch });
    try {
      await expect(client.map({ url: 'https://example.com' }, 'test')).rejects.toThrow(/TAVILY_API_KEY/);
    } finally {
      if (saved === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = saved;
    }
  });
});
