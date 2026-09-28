import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { TraceEvent } from '../types';
import { deps } from './client';
import { forcedTool, jsonSchemaOf, structured, toolLoop } from './helpers';
import { MemoryLedger, setLedgerSink } from './ledger';
import { LIGHTNING, SUPER } from './models';
import { completion, json, scriptedFetch, toolCall } from './test-util';

const originalDeps = { ...deps };
let ledger: MemoryLedger;

beforeEach(() => {
  vi.stubEnv('QB_MODE', 'live');
  vi.stubEnv('QB_RECORD', '');
  vi.stubEnv('NEBIUS_API_KEY', 'test-key-not-real');
  ledger = new MemoryLedger();
  setLedgerSink(ledger);
  deps.sleep = async () => {};
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(deps, originalDeps);
});

const record = z.object({ courses: z.array(z.object({ code: z.string(), grade: z.string() })) });

describe('jsonSchemaOf', () => {
  it('emits a strict object schema without the $schema marker', () => {
    const s = jsonSchemaOf(record);
    expect(s).not.toHaveProperty('$schema');
    expect(s).toMatchObject({ type: 'object', required: ['courses'], additionalProperties: false });
  });
});

describe('structured', () => {
  it('sends json_schema with thinking off and returns the validated object', async () => {
    const { fn, calls } = scriptedFetch([json(completion({ content: '{"courses":[{"code":"CSE 8A","grade":"A-"}]}' }))]);
    deps.fetch = fn;
    const out = await structured('extract', { system: 'sys', user: 'usr', schema: record, name: 'academic_record', maxTokens: 300 });
    expect(out).toEqual({ courses: [{ code: 'CSE 8A', grade: 'A-' }] });
    const body = calls[0].body;
    expect(body.model).toBe(LIGHTNING);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'academic_record', schema: jsonSchemaOf(record), strict: true } });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning_effort).toBe('none');
    expect(body.max_tokens).toBe(300);
    expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
    expect(ledger.entries.map((e) => e.step)).toEqual(['academic_record']);
  });

  it('retries once with the validation error appended, then throws if still invalid', async () => {
    const { fn, calls } = scriptedFetch([
      json(completion({ content: '{"courses":[{"code":8}]}' })),
      json(completion({ content: '{"courses":[]}' })),
    ]);
    deps.fetch = fn;
    const out = await structured('extract', { system: 'sys', user: 'usr', schema: record, name: 'r' });
    expect(out).toEqual({ courses: [] });
    expect(calls).toHaveLength(2);
    const retryMessages = calls[1].body.messages as { role: string; content: string }[];
    expect(retryMessages).toHaveLength(4);
    expect(retryMessages[2]).toEqual({ role: 'assistant', content: '{"courses":[{"code":8}]}' });
    expect(retryMessages[3].role).toBe('user');
    expect(retryMessages[3].content).toMatch(/not valid/);
    expect(retryMessages[3].content).toMatch(/courses\[0\]\.code/);

    deps.fetch = scriptedFetch([json(completion({ content: 'not json' })), json(completion({ content: '{"nope":1}' }))]).fn;
    await expect(structured('extract', { system: 'sys', user: 'usr', schema: record, name: 'r' })).rejects.toThrow(/still invalid after one retry/);
  });
});

describe('forcedTool', () => {
  const plans = z.object({ plans: z.array(z.object({ label: z.string(), courses: z.array(z.string()) })) });
  const messages = [{ role: 'user' as const, content: 'plan it' }];
  const good = { plans: [{ label: 'balanced', courses: ['CSE 8B', 'MATH 20B'] }] };

  it('forces the tool with thinking on and returns the validated arguments', async () => {
    const { fn, calls } = scriptedFetch([
      json(completion({ tool_calls: [toolCall('submit_plans', good)], reasoning: 'thinking…' }, undefined, 'tool_calls')),
    ]);
    deps.fetch = fn;
    const { args, result } = await forcedTool('plan', {
      messages,
      tool: { name: 'submit_plans', description: 'Submit plans.', schema: plans },
      thinking: { enable: true, budget: 256 },
      maxTokens: 400,
    });
    expect(args).toEqual(good);
    expect(result.message.reasoning).toBe('thinking…');
    const body = calls[0].body;
    expect(body.model).toBe(SUPER);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'submit_plans' } });
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'submit_plans', description: 'Submit plans.', parameters: jsonSchemaOf(plans) } }]);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_budget: 256 });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.max_tokens).toBe(400);
  });

  it('sends reasoning_effort when asked (critic) and thinking-off fields otherwise', async () => {
    const { fn, calls } = scriptedFetch([
      json(completion({ tool_calls: [toolCall('submit_plans', good)] })),
      json(completion({ tool_calls: [toolCall('submit_plans', good)] })),
    ]);
    deps.fetch = fn;
    await forcedTool('critic', { messages, tool: { name: 'submit_plans', schema: plans }, thinking: { enable: true, effort: 'high' } });
    expect(calls[0].body.reasoning_effort).toBe('high');
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: true });
    await forcedTool('plan', { messages, tool: { name: 'submit_plans', schema: plans }, thinking: { enable: false } });
    expect(calls[1].body.reasoning_effort).toBe('none');
    expect(calls[1].body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('answers a bad call on its tool_call_id and retries once', async () => {
    const bad = toolCall('submit_plans', { plans: [{ label: 'x' }] }, 'call_bad');
    const { fn, calls } = scriptedFetch([
      json(completion({ tool_calls: [bad], reasoning: 'long reasoning' })),
      json(completion({ tool_calls: [toolCall('submit_plans', good)] })),
    ]);
    deps.fetch = fn;
    const { args } = await forcedTool('plan', { messages, tool: { name: 'submit_plans', schema: plans } });
    expect(args).toEqual(good);
    const retry = calls[1].body.messages as Record<string, unknown>[];
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: 'assistant', content: null, tool_calls: [bad] }); // reasoning stripped
    expect(retry[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_bad' });
    expect(String(retry[2].content)).toMatch(/courses/);
  });

  it('nudges as the user when the reply had no tool call, and throws with finish_reason after the retry', async () => {
    deps.fetch = scriptedFetch([
      json(completion({ content: 'I ran out of' }, undefined, 'length')),
      json(completion({ tool_calls: [toolCall('submit_plans', good)] })),
    ]).fn;
    const { args } = await forcedTool('plan', { messages, tool: { name: 'submit_plans', schema: plans } });
    expect(args).toEqual(good);

    const { fn, calls } = scriptedFetch([
      json(completion({ content: 'I ran out of' }, undefined, 'length')),
      json(completion({ content: 'again' }, undefined, 'length')),
    ]);
    deps.fetch = fn;
    await expect(forcedTool('plan', { messages, tool: { name: 'submit_plans', schema: plans } })).rejects.toThrow(/finish_reason=length/);
    const retry = calls[1].body.messages as { role: string; content: string }[];
    expect(retry).toHaveLength(2);
    expect(retry[1].role).toBe('user');
    expect(retry[1].content).toMatch(/calling the submit_plans tool/);
  });
});

describe('toolLoop', () => {
  const offering = {
    def: {
      type: 'function' as const,
      function: { name: 'offering_status', parameters: { type: 'object', properties: { course: { type: 'string' } }, required: ['course'] } },
    },
    run: vi.fn((args: unknown) => ({ ...(args as object), status: 'tentative' })),
  };
  const messages = [{ role: 'user' as const, content: 'Is CSE 100 offered?' }];

  it('runs tool rounds until a final message, emitting trace events and building history', async () => {
    const call = toolCall('offering_status', { course: 'CSE 100' }, 'call_a');
    const { fn, calls } = scriptedFetch([
      json(completion({ tool_calls: [call], reasoning: 'hmm' }, undefined, 'tool_calls')),
      json(completion({ content: 'CSE 100 is tentative in WI27.' })),
    ]);
    deps.fetch = fn;
    const events: TraceEvent[] = [];
    const out = await toolLoop('extract', { messages, tools: [offering], maxRounds: 3, step: 'explain', onEvent: (e) => events.push(e) });
    expect(out.message.content).toBe('CSE 100 is tentative in WI27.');
    expect(out.rounds).toBe(2);
    expect(out.exhausted).toBe(false);
    expect(offering.run).toHaveBeenCalledWith({ course: 'CSE 100' });
    expect(events.map((e) => e.type)).toEqual(['model', 'tool_call', 'tool_result', 'model']);
    expect(events[1]).toMatchObject({ type: 'tool_call', step: 'explain', name: 'offering_status', args: { course: 'CSE 100' } });
    expect(events[2]).toMatchObject({ type: 'tool_result', name: 'offering_status', summary: '{"course":"CSE 100","status":"tentative"}' });
    expect(events[0]).toMatchObject({ type: 'model', entry: ledger.entries[0] });
    expect(calls[0].body.tools).toEqual([offering.def]);
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
    const round2 = calls[1].body.messages as Record<string, unknown>[];
    expect(round2).toEqual([
      messages[0],
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: 'call_a', content: '{"course":"CSE 100","status":"tentative"}' },
    ]);
    expect(out.messages).toHaveLength(4);
    expect(out.messages.at(-1)).toEqual({ role: 'assistant', content: 'CSE 100 is tentative in WI27.' });
  });

  it('feeds unknown tools and bad arguments back as tool errors, and reports exhaustion at maxRounds', async () => {
    const badArgs = { id: 'call_b', type: 'function' as const, function: { name: 'offering_status', arguments: '{not json' } };
    const unknown = toolCall('nope', {}, 'call_c');
    const { fn, calls } = scriptedFetch([json(completion({ tool_calls: [badArgs, unknown] })), json(completion({ tool_calls: [unknown] }))]);
    deps.fetch = fn;
    const out = await toolLoop('extract', { messages, tools: [offering], maxRounds: 2 });
    expect(out.exhausted).toBe(true);
    expect(out.rounds).toBe(2);
    const round2 = calls[1].body.messages as { role: string; content: string; tool_call_id?: string }[];
    expect(round2[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_b' });
    expect(round2[2].content).toMatch(/^Error: arguments are not valid JSON/);
    expect(round2[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_c', content: 'Error: unknown tool nope' });
    expect(out.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_c' });
  });
});
