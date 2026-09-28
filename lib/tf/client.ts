// Thin fetch client for Nebius Token Factory chat completions.
//
//   chat(request, {step})        → ChatResult { model, message, finish_reason, usage, entry }
//   chatStream(request, {step})  → async generator of { delta, toolCallDeltas, done:false } chunks, then one
//                                  { done:true, result } with the assembled message and the ledger entry
//   TFHttpError                  → { status, body (≤300 chars), model, retryAfterMs }; status 0 = network / timeout
//   deps                         → { fetch, sleep } — swap in tests; never in app code
//
// Behaviour: Authorization from NEBIUS_API_KEY; `chat_template_kwargs` travels at the top level of the body;
// role 'extract' is always forced to thinking OFF + reasoning_effort 'none' (Lightning leaks reasoning into
// content otherwise); 429/5xx/network errors retry up to 3 times honouring Retry-After (capped at 20 s, with
// jitter); 120 s timeout per attempt; a model that is gone (404, or 400 naming the model) or that keeps
// rate-limiting is retried once on the role's fallback model and the ledger entry is marked `fallback`.
// QB_MODE=mock|replay serves fixtures/tf and throws MissingFixtureError on a miss; QB_MODE=live calls the API
// after the budget check and, with QB_RECORD=1, writes the fixture. Every call records a ledger entry.
import { mode } from '../env';
import type { ModelRole } from '../types';
import { assertBudget } from './budget';
import { ledgerSink, makeEntry, type TFLedgerEntry, type Usage } from './ledger';
import { fallbackOf, resolveModel } from './models';
import { MissingFixtureError, readFixture, requestKey, writeFixture } from './replay';

export const BASE_URL = 'https://api.tokenfactory.nebius.com/v1';
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_AFTER_CAP_MS = 20_000;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning?: string;
  reasoning_content?: string;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatRequest {
  role: ModelRole;
  /** Explicit model id (eval ablations); defaults to resolveModel(role). */
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
  };
  chat_template_kwargs?: { enable_thinking: boolean; reasoning_budget?: number };
  reasoning_effort?: ReasoningEffort;
  temperature?: number;
  max_tokens?: number;
}

/** The body actually sent (and keyed): the request minus `role`, with the model resolved. */
export type ChatBody = Omit<ChatRequest, 'role' | 'model'> & { model: string };

export interface Completion {
  id?: string;
  object?: string;
  model?: string;
  choices: { index?: number; message: AssistantMessage; finish_reason: string | null }[];
  usage?: Usage;
}

export interface ChatResult {
  model: string;
  message: AssistantMessage;
  finish_reason: string | null;
  usage: Usage;
  entry: TFLedgerEntry;
}

export interface CallOpts {
  step: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export type StreamChunk =
  | { delta: string; toolCallDeltas: ToolCallDelta[]; done: false }
  | { delta: ''; toolCallDeltas: []; done: true; result: ChatResult };

export class TFHttpError extends Error {
  status: number;
  body: string;
  model: string;
  retryAfterMs: number | null;
  constructor(status: number, body: string, model: string, retryAfterMs: number | null = null) {
    const snippet = body.replace(/\s+/g, ' ').slice(0, 300);
    super(`Token Factory ${status || 'network error'} from ${model}: ${snippet}`);
    this.name = 'TFHttpError';
    this.status = status;
    this.body = snippet;
    this.model = model;
    this.retryAfterMs = retryAfterMs;
  }
}

export const deps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => globalThis.fetch(url, init),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

export function buildBody(req: ChatRequest): ChatBody {
  const { role, model, ...rest } = req;
  const body: ChatBody = { ...rest, model: model ?? resolveModel(role).id };
  if (role === 'extract') {
    body.chat_template_kwargs = { enable_thinking: false };
    body.reasoning_effort = 'none';
  }
  return body;
}

export async function chat(req: ChatRequest, opts: CallOpts): Promise<ChatResult> {
  const body = buildBody(req);
  if (mode() !== 'live') return replay(body, opts.step);
  await assertBudget();
  const { value: attempt, body: used, fallback } = await withFallback(body, (b) => fetchWithRetries(b, false));
  let json: Completion;
  try {
    json = (await attempt.res.json()) as Completion;
  } finally {
    attempt.done();
  }
  return settle(used, json, Date.now() - attempt.started, fallback, opts.step);
}

export async function* chatStream(req: ChatRequest, opts: CallOpts): AsyncGenerator<StreamChunk, void> {
  const body = buildBody(req);
  if (mode() !== 'live') {
    // Fixtures hold the assembled final message; replay it as a single delta.
    const result = await replay(body, opts.step);
    const calls = result.message.tool_calls ?? [];
    yield {
      delta: result.message.content ?? '',
      toolCallDeltas: calls.map((tc, index) => ({ index, id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
      done: false,
    };
    yield { delta: '', toolCallDeltas: [], done: true, result };
    return;
  }
  await assertBudget();
  const { value: attempt, body: used, fallback } = await withFallback(body, (b) => fetchWithRetries(b, true));
  let content = '';
  let reasoning = '';
  let finish: string | null = null;
  let usage: Usage | undefined;
  const toolCalls: ToolCall[] = [];
  try {
    for await (const data of sseData(attempt.res)) {
      const chunk = JSON.parse(data) as {
        usage?: Usage;
        choices?: {
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            reasoning?: string;
            reasoning_content?: string;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta ?? {};
      const text = delta.content ?? '';
      const r = delta.reasoning ?? delta.reasoning_content;
      if (r) reasoning += r;
      const toolCallDeltas: ToolCallDelta[] = [];
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? 0;
        const cur = (toolCalls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        toolCallDeltas.push({ index, id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments });
      }
      content += text;
      if (text || toolCallDeltas.length) yield { delta: text, toolCallDeltas, done: false };
    }
  } finally {
    attempt.done();
  }
  const message: AssistantMessage = { role: 'assistant', content: content || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (reasoning) message.reasoning = reasoning;
  const json: Completion = {
    object: 'chat.completion',
    model: used.model,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage,
  };
  const result = await settle(used, json, Date.now() - attempt.started, fallback, opts.step);
  yield { delta: '', toolCallDeltas: [], done: true, result };
}

// ---------------------------------------------------------------------------------------------

async function replay(body: ChatBody, step: string): Promise<ChatResult> {
  const key = requestKey(body);
  const fixture = readFixture(key);
  if (!fixture) throw new MissingFixtureError(key, body.model, lastUserContent(body.messages));
  const entry = makeEntry({ step, model: body.model, ms: fixture.ms, usage: fixture.usage, replayed: true });
  await ledgerSink().record(entry);
  return toResult(body.model, fixture.response as Completion, fixture.usage, entry);
}

async function settle(body: ChatBody, json: Completion, ms: number, fallback: boolean, step: string): Promise<ChatResult> {
  const usage = json.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const entry = makeEntry({ step, model: body.model, ms, usage, replayed: false, fallback });
  await ledgerSink().record(entry);
  if (process.env.QB_RECORD === '1') {
    writeFixture(requestKey(body), { request: body, response: json, recordedAt: entry.at, usage, ms });
  }
  return toResult(body.model, json, usage, entry);
}

function toResult(model: string, json: Completion, usage: Usage, entry: TFLedgerEntry): ChatResult {
  const choice = json.choices?.[0];
  if (!choice?.message) throw new TFHttpError(200, `response had no choices: ${JSON.stringify(json)}`, model);
  return { model, message: choice.message, finish_reason: choice.finish_reason ?? null, usage, entry };
}

function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.content;
  }
  return '';
}

function fallbackWorthy(err: TFHttpError): boolean {
  if (err.status === 404 || err.status === 429) return true;
  return err.status === 400 && /model.*(not found|does not exist|not available)|no such model|unknown model/i.test(err.body);
}

async function withFallback<T>(
  body: ChatBody,
  run: (b: ChatBody) => Promise<T>,
): Promise<{ value: T; body: ChatBody; fallback: boolean }> {
  try {
    return { value: await run(body), body, fallback: false };
  } catch (err) {
    const next = err instanceof TFHttpError && fallbackWorthy(err) ? fallbackOf(body.model) : null;
    if (!next) throw err;
    const fb = { ...body, model: next.id };
    return { value: await run(fb), body: fb, fallback: true };
  }
}

interface Attempt {
  res: Response;
  started: number;
  /** Clears the timeout once the body has been consumed. */
  done: () => void;
}

async function fetchWithRetries(body: ChatBody, stream: boolean): Promise<Attempt> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error('NEBIUS_API_KEY is not set; load .env.local with loadEnv() first');
  const payload = JSON.stringify(stream ? { ...body, stream: true, stream_options: { include_usage: true } } : body);
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();
    let err: TFHttpError;
    try {
      const res = await deps.fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (res.ok) return { res, started, done: () => clearTimeout(timer) };
      const text = await res.text().catch(() => '');
      err = new TFHttpError(res.status, text, body.model, retryAfterMs(res.headers.get('retry-after')));
    } catch (e) {
      if (controller.signal.aborted) {
        clearTimeout(timer);
        throw new TFHttpError(0, `request timed out after ${TIMEOUT_MS / 1000} s`, body.model);
      }
      err = new TFHttpError(0, e instanceof Error ? e.message : String(e), body.model);
    }
    clearTimeout(timer);
    const retryable = err.status === 0 || err.status === 429 || err.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) throw err;
    const base = err.retryAfterMs ?? 1000 * 2 ** attempt;
    await deps.sleep(Math.min(base, RETRY_AFTER_CAP_MS) + Math.random() * 250);
  }
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Yields the payload of each SSE `data:` line, skipping `[DONE]`. */
async function* sseData(res: Response): AsyncGenerator<string, void> {
  if (!res.body) throw new TFHttpError(res.status, 'streaming response had no body', '');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') yield data;
    }
    if (done) return;
  }
}
