// Record / replay of Token Factory requests (QB_MODE=mock|replay serve fixtures; live + QB_RECORD=1 writes).
//
//   requestKey(body)            → sha256 of the stable-stringified canonical fields of a request body
//   stableStringify(value)      → JSON with sorted keys and no whitespace; undefined fields dropped
//   readFixture(key)            → Fixture | null from fixtures/tf/<key>.json (QB_FIXTURES_DIR overrides
//                                 the directory so tests can record into a temp dir)
//   writeFixture(key, fixture)
//   MissingFixtureError         → thrown by the client when mock/replay mode has no fixture for a request
//
// `stream` and `stream_options` are deliberately not part of the key, so a streamed call replays from the
// fixture its non-streamed twin recorded (the client stores the assembled final message either way).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Usage } from './ledger';

export const KEY_FIELDS = [
  'model',
  'messages',
  'tools',
  'tool_choice',
  'response_format',
  'chat_template_kwargs',
  'reasoning_effort',
  'temperature',
  'max_tokens',
] as const;

export interface Fixture {
  /** The ChatBody that was sent. */
  request: object;
  /** The chat-completion object as the API returned it (streams are assembled into this shape). */
  response: object;
  recordedAt: string;
  usage: Usage;
  /** Wall time of the recorded call, replayed into the ledger so traces look real. */
  ms: number;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function requestKey(body: object): string {
  const fields = body as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const f of KEY_FIELDS) if (fields[f] !== undefined) canonical[f] = fields[f];
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function fixturesDir(): string {
  return process.env.QB_FIXTURES_DIR || path.join(process.cwd(), 'fixtures', 'tf');
}

export function readFixture(key: string): Fixture | null {
  const p = path.join(fixturesDir(), `${key}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Fixture;
}

export function writeFixture(key: string, fixture: Fixture): void {
  const dir = fixturesDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(fixture, null, 2) + '\n');
}

export class MissingFixtureError extends Error {
  key: string;
  constructor(key: string, model: string, lastUserMessage: string) {
    super(
      `No Token Factory fixture ${key} for ${model} (QB_MODE=${process.env.QB_MODE ?? 'mock'}). ` +
        `Record it with QB_MODE=live QB_RECORD=1. Last user message: ${JSON.stringify(lastUserMessage.slice(0, 200))}`,
    );
    this.name = 'MissingFixtureError';
    this.key = key;
  }
}
