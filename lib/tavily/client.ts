// Tavily client: /search, /extract and /map with include_usage on every call and a credit ledger.
// Mode semantics mirror the Token Factory client: mock/replay serve fixtures/tavily/<sha256(canonical
// request)>.json and fail loudly on a miss; live calls the API; QB_RECORD=1 (live only) writes fixtures.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, mode as envMode } from '../env';
import type { Mode } from '../types';

const BASE_URL = 'https://api.tavily.com';

export type TavilyEndpoint = 'search' | 'extract' | 'map';

export interface TavilySearchRequest {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
  include_domains?: string[];
  include_raw_content?: boolean;
  time_range?: 'day' | 'week' | 'month' | 'year';
}
export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string | null;
}
export interface TavilySearchResponse {
  results: TavilySearchResult[];
  answer?: string;
  usage?: { credits: number };
}

export interface TavilyExtractRequest {
  urls: string[];
  extract_depth?: 'basic' | 'advanced';
}
export interface TavilyExtractResponse {
  results: { url: string; raw_content: string }[];
  failed_results: { url: string; error: string }[];
  usage?: { credits: number };
}

export interface TavilyMapRequest {
  url: string;
  max_depth?: number;
  limit?: number;
  instructions?: string;
}
export interface TavilyMapResponse {
  base_url?: string;
  results: string[];
  usage?: { credits: number };
}

/** Mirrors LedgerEntry, with Tavily credits in place of tokens and dollars. */
export interface TavilyCreditEntry {
  at: string;
  step: string;
  endpoint: TavilyEndpoint;
  ms: number;
  credits: number;
  /** Served from fixtures (mock/replay) rather than a live call. */
  replayed: boolean;
}

export class MissingFixtureError extends Error {
  constructor(endpoint: TavilyEndpoint, key: string, mode: Mode) {
    super(`No Tavily fixture for /${endpoint} (${key}) in QB_MODE=${mode}; record it with QB_MODE=live QB_RECORD=1`);
    this.name = 'MissingFixtureError';
  }
}

export interface TavilyClientOptions {
  mode?: Mode;
  /** Write fixtures from live responses (QB_RECORD=1). Ignored outside live mode. */
  record?: boolean;
  fixturesDir?: string;
  fetch?: typeof fetch;
  apiKey?: string;
  /** Receives every credit entry as it is made, in addition to `ledger`. */
  sink?: (entry: TavilyCreditEntry) => void;
}

export interface TavilyClient {
  search(req: TavilySearchRequest, step: string): Promise<TavilySearchResponse>;
  extract(req: TavilyExtractRequest, step: string): Promise<TavilyExtractResponse>;
  map(req: TavilyMapRequest, step: string): Promise<TavilyMapResponse>;
  readonly ledger: TavilyCreditEntry[];
}

/** JSON with object keys sorted at every level, so the same request always hashes to the same fixture. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

export function fixtureKey(endpoint: TavilyEndpoint, body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson({ endpoint, body })).digest('hex');
}

export function createTavilyClient(opts: TavilyClientOptions = {}): TavilyClient {
  const mode = opts.mode ?? envMode();
  const record = opts.record ?? process.env.QB_RECORD === '1';
  const fixturesDir = opts.fixturesDir ?? path.resolve(process.cwd(), 'fixtures/tavily');
  const doFetch = opts.fetch ?? fetch;
  const ledger: TavilyCreditEntry[] = [];

  function apiKey(): string {
    if (opts.apiKey) return opts.apiKey;
    loadEnv();
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new Error('TAVILY_API_KEY is not set (expected in .env.local)');
    return key;
  }

  async function call<T>(endpoint: TavilyEndpoint, req: object, step: string): Promise<T> {
    const body = { ...req, include_usage: true } as Record<string, unknown>;
    const key = fixtureKey(endpoint, body);
    const file = path.join(fixturesDir, `${key}.json`);
    const started = Date.now();
    let response: T & { usage?: { credits: number } };
    let replayed = false;

    if (mode === 'live') {
      const res = await doFetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Tavily /${endpoint} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      response = (await res.json()) as typeof response;
      if (record) {
        mkdirSync(fixturesDir, { recursive: true });
        writeFileSync(file, JSON.stringify({ endpoint, request: body, response, recordedAt: new Date().toISOString() }, null, 2) + '\n');
      }
    } else {
      if (!existsSync(file)) throw new MissingFixtureError(endpoint, key, mode);
      response = JSON.parse(readFileSync(file, 'utf8')).response;
      replayed = true;
    }

    const entry: TavilyCreditEntry = {
      at: new Date().toISOString(),
      step,
      endpoint,
      ms: Date.now() - started,
      credits: response.usage?.credits ?? 0,
      replayed,
    };
    ledger.push(entry);
    opts.sink?.(entry);
    return response;
  }

  return {
    search: (req, step) => call<TavilySearchResponse>('search', req, step),
    extract: (req, step) => call<TavilyExtractResponse>('extract', req, step),
    map: (req, step) => call<TavilyMapResponse>('map', req, step),
    ledger,
  };
}
