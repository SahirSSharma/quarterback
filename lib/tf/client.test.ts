import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExceededError } from './budget';
import { BASE_URL, TFHttpError, buildBody, chat, chatStream, deps, type ChatRequest, type StreamChunk } from './client';
import { MemoryLedger, setLedgerSink } from './ledger';
import { LIGHTNING, NANO, SUPER, ULTRA } from './models';
import { completion, json, scriptedFetch, toolCall } from './test-util';

const originalDeps = { ...deps };
let ledger: MemoryLedger;
let sleeps: number[];

beforeEach(() => {
  vi.stubEnv('QB_MODE', 'live');
  vi.stubEnv('QB_RECORD', '');
  vi.stubEnv('NEBIUS_API_KEY', 'test-key-not-real');
  ledger = new MemoryLedger();
  setLedgerSink(ledger);
  sleeps = [];
  deps.sleep = async (ms) => {
    sleeps.push(ms);
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(deps, originalDeps);
});

const ask = (content: string, role: ChatRequest['role'] = 'extract'): ChatRequest => ({ role, messages: [{ role: 'user', content }] });

describe('request body', () => {
  it("an 'extract' request always carries enable_thinking:false and reasoning_effort:'none'", async () => {
    const { fn, calls } = scriptedFetch([json(completion({ content: 'ok' }))]);
    deps.fetch = fn;
    await chat(
      { ...ask('x'), chat_template_kwargs: { enable_thinking: true, reasoning_budget: 512 }, reasoning_effort: 'high' },
      { step: 'extract' },
    );
    expect(calls[0].body.model).toBe(LIGHTNING);
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(calls[0].body.reasoning_effort).toBe('none');
    expect(calls[0].body).not.toHaveProperty('role');
    expect(calls[0].body).not.toHaveProperty('extra_body');
  });

  it('passes thinking settings through for judgment roles and sends the bearer token', async () => {
    const { fn, calls } = scriptedFetch([json(completion({ content: 'ok' }))]);
    deps.fetch = fn;
    await chat({ ...ask('x', 'plan'), chat_template_kwargs: { enable_thinking: true, reasoning_budget: 4096 }, temperature: 0.2 }, { step: 'plan' });
    expect(calls[0].url).toBe(`${BASE_URL}/chat/completions`);
    expect(calls[0].headers.authorization).toBe('Bearer test-key-not-real');
    expect(calls[0].body.model).toBe(SUPER);
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_budget: 4096 });
    expect(calls[0].body.temperature).toBe(0.2);
    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
  });

  it('buildBody honours an explicit model override', () => {
    expect(buildBody({ ...ask('x', 'plan'), model: LIGHTNING }).model).toBe(LIGHTNING);
  });

  it('refuses to call without NEBIUS_API_KEY', async () => {
    vi.stubEnv('NEBIUS_API_KEY', '');
    await expect(chat(ask('x'), { step: 's' })).rejects.toThrow(/NEBIUS_API_KEY/);
  });
});

describe('retries', () => {
  it('retries 429 and 5xx, honouring Retry-After with jitter, then succeeds', async () => {
    const { fn, calls } = scriptedFetch([
      json({ error: 'slow down' }, 429, { 'retry-after': '2' }),
      json({ error: 'upstream' }, 503),
      json(completion({ content: 'third time' })),
    ]);
    deps.fetch = fn;
    const res = await chat(ask('x'), { step: 's' });
    expect(res.message.content).toBe('third time');
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[0]).toBeLessThan(2250);
    // no header on the second failure → exponential base 1000 * 2^attempt
    expect(sleeps[1]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[1]).toBeLessThan(2250);
    expect(res.entry.fallback).toBeUndefined();
  });

  it('caps a long Retry-After at 20 s', async () => {
    deps.fetch = scriptedFetch([json({}, 429, { 'retry-after': '60' }), json(completion({ content: 'ok' }))]).fn;
    await chat(ask('x'), { step: 's' });
    expect(sleeps[0]).toBeGreaterThanOrEqual(20_000);
    expect(sleeps[0]).toBeLessThan(20_250);
  });

  it('does not retry other 4xx and throws a TFHttpError with status and body snippet', async () => {
    const { fn, calls } = scriptedFetch([json({ error: { message: 'invalid json_schema: bad property' } }, 400)]);
    deps.fetch = fn;
    const err = await chat(ask('x'), { step: 's' }).catch((e) => e);
    expect(err).toBeInstanceOf(TFHttpError);
    expect(err.status).toBe(400);
    expect(err.body).toContain('invalid json_schema');
    expect(err.message).toMatch(/400/);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('retries network errors too', async () => {
    let n = 0;
    deps.fetch = vi.fn(async () => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return json(completion({ content: 'ok' }));
    });
    const res = await chat(ask('x'), { step: 's' });
    expect(res.message.content).toBe('ok');
    expect(sleeps).toHaveLength(1);
  });
});

describe('fallback model', () => {
  it('a 404 (model removed) retries once on the fallback and marks the ledger entry', async () => {
    const { fn, calls } = scriptedFetch([json({ error: 'not found' }, 404), json(completion({ content: 'from nano' }))]);
    deps.fetch = fn;
    const res = await chat(ask('x'), { step: 'extract' });
    expect(res.model).toBe(NANO);
    expect(calls.map((c) => c.body.model)).toEqual([LIGHTNING, NANO]);
    expect(res.entry.model).toBe(NANO);
    expect(res.entry.fallback).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("a 400 saying the model does not exist falls back; other 400s do not", async () => {
    deps.fetch = scriptedFetch([
      json({ error: { message: `The model 'nvidia/nemotron-3-super-120b-a12b' does not exist` } }, 400),
      json(completion({ content: 'from ultra' })),
    ]).fn;
    const res = await chat(ask('x', 'plan'), { step: 'plan' });
    expect(res.model).toBe(ULTRA);
    expect(res.entry.fallback).toBe(true);

    const { fn, calls } = scriptedFetch([json({ error: { message: 'messages[0].content must be a string' } }, 400)]);
    deps.fetch = fn;
    await expect(chat(ask('x', 'plan'), { step: 'plan' })).rejects.toBeInstanceOf(TFHttpError);
    expect(calls).toHaveLength(1);
  });

  it('repeated 429s exhaust the retries and then fall back once', async () => {
    const limited = () => json({ error: 'rate limited' }, 429, { 'retry-after': '1' });
    const { fn, calls } = scriptedFetch([limited, limited, limited, limited, json(completion({ content: 'from nano' }))]);
    deps.fetch = fn;
    const res = await chat(ask('x'), { step: 'extract' });
    expect(calls.map((c) => c.body.model)).toEqual([LIGHTNING, LIGHTNING, LIGHTNING, LIGHTNING, NANO]);
    expect(sleeps).toHaveLength(3);
    expect(res.entry.fallback).toBe(true);
  });

  it('gives up when the fallback fails too', async () => {
    deps.fetch = scriptedFetch([json({}, 404), json({}, 404)]).fn;
    const err = await chat(ask('x'), { step: 'extract' }).catch((e) => e);
    expect(err).toBeInstanceOf(TFHttpError);
    expect(err.model).toBe(NANO);
  });
});

describe('ledger', () => {
  it('maps usage to ledger fields including reasoning and cache-hit tokens, priced from the registry', async () => {
    deps.fetch = scriptedFetch([
      json(
        completion({ content: 'ok' }, {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
          completion_tokens_details: { reasoning_tokens: 200 },
          prompt_cache_hit_tokens: 300,
        }),
      ),
    ]).fn;
    const res = await chat(ask('x', 'plan'), { step: 'planner' });
    const e = res.entry;
    expect(ledger.entries).toEqual([e]);
    expect(e).toMatchObject({
      step: 'planner',
      model: SUPER,
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cacheHitTokens: 300,
      replayed: false,
    });
    expect(e.usd).toBeCloseTo((1000 * 0.3 + 500 * 0.9) / 1e6, 12);
    expect(e.ms).toBeGreaterThanOrEqual(0);
    expect(Date.parse(e.at)).not.toBeNaN();
    expect(ledger.spent()).toBeCloseTo(e.usd, 12);
  });

  it('reads cached tokens from prompt_tokens_details when that is the field present', async () => {
    deps.fetch = scriptedFetch([
      json(completion({ content: 'ok' }, { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 7 } })),
    ]).fn;
    const res = await chat(ask('x'), { step: 's' });
    expect(res.entry.cacheHitTokens).toBe(7);
    expect(res.entry.reasoningTokens).toBe(0);
  });
});

describe('budget', () => {
  it('throws BudgetExceededError before calling when the daily cap is spent', async () => {
    vi.stubEnv('QB_DAILY_CAP_USD', '0.01');
    ledger.record({ at: new Date().toISOString(), step: 's', model: SUPER, ms: 1, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, usd: 0.02, replayed: false });
    const { fn } = scriptedFetch([]);
    deps.fetch = fn;
    const err = await chat(ask('x'), { step: 's' }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.cap).toBe('daily');
    expect(err.spent).toBeCloseTo(0.02, 12);
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores replayed entries and old spend for the daily cap, but counts old spend for the total cap', async () => {
    vi.stubEnv('QB_DAILY_CAP_USD', '0.01');
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    ledger.record({ at: yesterday, step: 's', model: SUPER, ms: 1, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, usd: 0.5, replayed: false });
    ledger.record({ at: new Date().toISOString(), step: 's', model: SUPER, ms: 1, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, usd: 5, replayed: true });
    deps.fetch = scriptedFetch([json(completion({ content: 'ok' }))]).fn;
    await expect(chat(ask('x'), { step: 's' })).resolves.toBeDefined();

    vi.stubEnv('QB_TOTAL_CAP_USD', '0.25');
    const err = await chat(ask('x'), { step: 's' }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.cap).toBe('total');
  });
});

describe('streaming', () => {
  const sse = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: 'Hello' } }] },
    { choices: [{ index: 0, delta: { content: ' world' } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'offering_status', arguments: '' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"course":' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"CSE 100"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 0 } } },
  ];
  const sseBody = sse.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

  it('yields content and tool-call deltas, assembles the message and takes usage from the final chunk', async () => {
    const { fn, calls } = scriptedFetch([new Response(sseBody, { status: 200 })]);
    deps.fetch = fn;
    const chunks: StreamChunk[] = [];
    for await (const c of chatStream(ask('stream me'), { step: 'stream' })) chunks.push(c);
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.stream_options).toEqual({ include_usage: true });
    const deltas = chunks.filter((c) => !c.done);
    expect(deltas.map((c) => c.delta)).toEqual(['Hello', ' world', '', '', '']);
    expect(deltas[2].toolCallDeltas).toEqual([{ index: 0, id: 'call_9', name: 'offering_status', arguments: '' }]);
    expect(deltas[4].toolCallDeltas[0].arguments).toBe('"CSE 100"}');
    const end = chunks.at(-1)!;
    if (!end.done) throw new Error('last chunk must be the final one');
    expect(end.result.message.content).toBe('Hello world');
    expect(end.result.message.tool_calls).toEqual([toolCall('offering_status', { course: 'CSE 100' }, 'call_9')]);
    expect(end.result.finish_reason).toBe('tool_calls');
    expect(end.result.entry).toMatchObject({ promptTokens: 12, completionTokens: 7, model: LIGHTNING, replayed: false });
    expect(ledger.entries).toHaveLength(1);
  });

  it('retries a 429 before the stream starts', async () => {
    deps.fetch = scriptedFetch([json({}, 429, { 'retry-after': '1' }), new Response(sseBody, { status: 200 })]).fn;
    const chunks: StreamChunk[] = [];
    for await (const c of chatStream(ask('stream me'), { step: 'stream' })) chunks.push(c);
    expect(sleeps).toHaveLength(1);
    expect(chunks.at(-1)!.done).toBe(true);
  });
});

describe('record and replay', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'qb-tf-'));
    vi.stubEnv('QB_FIXTURES_DIR', dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('QB_RECORD=1 writes a fixture that mock mode then serves through chat and chatStream without fetch', async () => {
    vi.stubEnv('QB_RECORD', '1');
    const { fn, calls } = scriptedFetch([json(completion({ content: 'recorded answer' }, { prompt_tokens: 21, completion_tokens: 4 }))]);
    deps.fetch = fn;
    const req = { ...ask('record me'), max_tokens: 30 };
    const live = await chat(req, { step: 'rec' });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    const fixture = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8'));
    expect(fixture.request).toEqual(calls[0].body);
    expect(fixture.usage).toEqual({ prompt_tokens: 21, completion_tokens: 4 });
    expect(typeof fixture.recordedAt).toBe('string');
    expect(fixture.ms).toBe(live.entry.ms);

    vi.stubEnv('QB_MODE', 'mock');
    vi.stubEnv('QB_RECORD', '');
    const replayed = await chat(req, { step: 'rec' });
    expect(replayed.message.content).toBe('recorded answer');
    expect(replayed.entry).toMatchObject({ replayed: true, promptTokens: 21, completionTokens: 4, ms: live.entry.ms });
    expect(replayed.entry.usd).toBeCloseTo(live.entry.usd, 12);
    expect(ledger.spent()).toBeCloseTo(live.entry.usd, 12); // replayed entries cost nothing

    const chunks: StreamChunk[] = [];
    for await (const c of chatStream(req, { step: 'rec' })) chunks.push(c);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ delta: 'recorded answer', toolCallDeltas: [], done: false });
    expect(chunks[1].done).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a streamed live call records a completion-shaped fixture the non-streamed twin replays', async () => {
    vi.stubEnv('QB_RECORD', '1');
    const body = 'data: {"choices":[{"index":0,"delta":{"content":"streamed"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
    deps.fetch = scriptedFetch([new Response(body, { status: 200 })]).fn;
    for await (const _ of chatStream(ask('twin'), { step: 's' })) void _;
    vi.stubEnv('QB_MODE', 'mock');
    const res = await chat(ask('twin'), { step: 's' });
    expect(res.message.content).toBe('streamed');
    expect(res.entry.replayed).toBe(true);
  });
});
