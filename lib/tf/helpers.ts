// Higher-level Token Factory calls the agents build on. Every call goes through chat(), so every call lands
// in the ledger and replays from fixtures in mock mode.
//
//   structured(role, {system, user, schema, name, maxTokens})
//       → zod-validated object via response_format json_schema with thinking OFF; on invalid JSON it retries
//         once with the validation error appended, then throws.
//   forcedTool(role, {messages, tool:{name, description, schema}, thinking, maxTokens})
//       → { args, result } where args are the zod-validated arguments of the forced tool call; retries once
//         when the reply has no call or the arguments fail validation, then throws with finish_reason.
//   toolLoop(role, {messages, tools:[{def, run}], maxRounds, thinking, onEvent})
//       → runs assistant ↔ tool rounds until a reply without tool calls or maxRounds; emits TraceEvents
//         ('model', 'tool_call', 'tool_result'); returns the final message and the full message history so
//         a caller can finish with forcedTool on it.
//   jsonSchemaOf(zodSchema) → JSON schema for tools / response_format (zod 4, `$schema` stripped)
//
// Thinking: { enable:false } sends enable_thinking:false + reasoning_effort:'none'; { enable:true, budget,
// effort } sends enable_thinking:true with reasoning_budget and, when given, reasoning_effort.
import { z, type ZodType } from 'zod';
import type { ModelRole, TraceEvent } from '../types';
import {
  chat,
  type AssistantMessage,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ReasoningEffort,
  type ToolCall,
  type ToolDef,
} from './client';

export interface Thinking {
  enable: boolean;
  budget?: number;
  effort?: ReasoningEffort;
}

export function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function thinkingFields(t?: Thinking): Pick<ChatRequest, 'chat_template_kwargs' | 'reasoning_effort'> {
  if (!t?.enable) return { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none' };
  const kwargs: ChatRequest['chat_template_kwargs'] = { enable_thinking: true };
  if (t.budget !== undefined) kwargs.reasoning_budget = t.budget;
  return t.effort ? { chat_template_kwargs: kwargs, reasoning_effort: t.effort } : { chat_template_kwargs: kwargs };
}

/** Reasoning is dropped from history: it can run to thousands of tokens and the template does not need it back. */
function forHistory(m: AssistantMessage): AssistantMessage {
  const { reasoning: _r, reasoning_content: _rc, ...rest } = m;
  return rest;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function validate<S extends ZodType>(schema: S, raw: string | null | undefined): Parsed<z.output<S>> {
  if (raw === null || raw === undefined || raw.trim() === '') return { ok: false, error: 'empty reply' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

// ---------------------------------------------------------------------------------------------

export async function structured<S extends ZodType>(
  role: ModelRole,
  opts: { system: string; user: string; schema: S; name: string; maxTokens?: number; step?: string; model?: string },
): Promise<z.output<S>> {
  const step = opts.step ?? opts.name;
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  const req: ChatRequest = {
    role,
    model: opts.model,
    messages,
    response_format: { type: 'json_schema', json_schema: { name: opts.name, schema: jsonSchemaOf(opts.schema), strict: true } },
    ...thinkingFields({ enable: false }),
    max_tokens: opts.maxTokens,
  };
  let res = await chat(req, { step });
  let parsed = validate(opts.schema, res.message.content);
  if (parsed.ok) return parsed.value;
  res = await chat(
    {
      ...req,
      messages: [
        ...messages,
        { role: 'assistant', content: res.message.content ?? '' },
        { role: 'user', content: `That reply was not valid: ${parsed.error}\nReply with only the corrected JSON object.` },
      ],
    },
    { step },
  );
  parsed = validate(opts.schema, res.message.content);
  if (parsed.ok) return parsed.value;
  throw new Error(`structured(${opts.name}) on ${res.model} was still invalid after one retry: ${parsed.error}`);
}

// ---------------------------------------------------------------------------------------------

export interface ForcedToolSpec<S extends ZodType> {
  name: string;
  description?: string;
  schema: S;
}

export async function forcedTool<S extends ZodType>(
  role: ModelRole,
  opts: { messages: ChatMessage[]; tool: ForcedToolSpec<S>; thinking?: Thinking; maxTokens?: number; step?: string; model?: string },
): Promise<{ args: z.output<S>; result: ChatResult }> {
  const { name } = opts.tool;
  const step = opts.step ?? name;
  const def: ToolDef = {
    type: 'function',
    function: { name, description: opts.tool.description, parameters: jsonSchemaOf(opts.tool.schema) },
  };
  const req: ChatRequest = {
    role,
    model: opts.model,
    messages: opts.messages,
    tools: [def],
    tool_choice: { type: 'function', function: { name } },
    ...thinkingFields(opts.thinking),
    max_tokens: opts.maxTokens,
  };
  let res = await chat(req, { step });
  let parsed = parseCall(res, name, opts.tool.schema);
  if (parsed.ok) return { args: parsed.value, result: res };

  // One correction round. A reply that carried a (bad) call is answered on that call's id; a reply with no
  // call at all (e.g. finish_reason 'length' inside reasoning) has no id to answer, so nudge as the user.
  const call = res.message.tool_calls?.find((tc) => tc.function.name === name);
  const feedback = call
    ? [
        forHistory(res.message),
        { role: 'tool' as const, tool_call_id: call.id, content: `Arguments rejected: ${parsed.error}\nCall ${name} again with corrected arguments.` },
      ]
    : [{ role: 'user' as const, content: `You must answer by calling the ${name} tool. ${parsed.error}` }];
  res = await chat({ ...req, messages: [...opts.messages, ...feedback] }, { step });
  parsed = parseCall(res, name, opts.tool.schema);
  if (parsed.ok) return { args: parsed.value, result: res };
  throw new Error(
    `forcedTool(${name}) on ${res.model} failed after one retry: ${parsed.error} ` +
      `(finish_reason=${res.finish_reason}, content=${JSON.stringify((res.message.content ?? '').slice(0, 200))})`,
  );
}

function parseCall<S extends ZodType>(res: ChatResult, name: string, schema: S): Parsed<z.output<S>> {
  const call = res.message.tool_calls?.find((tc) => tc.function.name === name);
  if (!call) {
    return {
      ok: false,
      error: `no ${name} call in the reply (finish_reason=${res.finish_reason}, content=${JSON.stringify((res.message.content ?? '').slice(0, 200))})`,
    };
  }
  return validate(schema, call.function.arguments);
}

// ---------------------------------------------------------------------------------------------

export interface LoopTool {
  def: ToolDef;
  run: (args: unknown) => unknown | Promise<unknown>;
}

export interface ToolLoopResult {
  /** Last assistant message (final answer, or the last tool-calling turn when rounds ran out). */
  message: AssistantMessage;
  /** Full history including tool results, ready for a follow-up forcedTool call. */
  messages: ChatMessage[];
  rounds: number;
  /** True when maxRounds ended the loop before the model produced a final message. */
  exhausted: boolean;
}

export async function toolLoop(
  role: ModelRole,
  opts: {
    messages: ChatMessage[];
    tools: LoopTool[];
    maxRounds?: number;
    thinking?: Thinking;
    maxTokens?: number;
    onEvent?: (event: TraceEvent) => void;
    step?: string;
    model?: string;
  },
): Promise<ToolLoopResult> {
  const step = opts.step ?? 'tool-loop';
  const maxRounds = opts.maxRounds ?? 3;
  const emit = opts.onEvent ?? (() => {});
  const byName = new Map(opts.tools.map((t) => [t.def.function.name, t]));
  const messages = [...opts.messages];
  let last: AssistantMessage = { role: 'assistant', content: null };
  for (let round = 1; round <= maxRounds; round++) {
    const res = await chat(
      { role, model: opts.model, messages, tools: opts.tools.map((t) => t.def), ...thinkingFields(opts.thinking), max_tokens: opts.maxTokens },
      { step },
    );
    emit({ type: 'model', step, at: res.entry.at, entry: res.entry });
    last = res.message;
    messages.push(forHistory(res.message));
    const calls = res.message.tool_calls ?? [];
    if (!calls.length) return { message: res.message, messages, rounds: round, exhausted: false };
    for (const call of calls) messages.push(await runTool(call, byName, step, emit));
  }
  return { message: last, messages, rounds: maxRounds, exhausted: true };
}

async function runTool(
  call: ToolCall,
  byName: Map<string, LoopTool>,
  step: string,
  emit: (e: TraceEvent) => void,
): Promise<ChatMessage> {
  const name = call.function.name;
  let args: unknown;
  let argsError: string | null = null;
  try {
    args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
  } catch {
    argsError = 'arguments are not valid JSON';
  }
  emit({ type: 'tool_call', step, at: new Date().toISOString(), name, args: args ?? call.function.arguments });
  const started = Date.now();
  let content: string;
  try {
    const tool = byName.get(name);
    if (!tool) throw new Error(`unknown tool ${name}`);
    if (argsError) throw new Error(argsError);
    const out = await tool.run(args);
    content = typeof out === 'string' ? out : JSON.stringify(out);
  } catch (e) {
    content = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
  emit({ type: 'tool_result', step, at: new Date().toISOString(), name, ms: Date.now() - started, summary: content.slice(0, 200) });
  return { role: 'tool', tool_call_id: call.id, content };
}
