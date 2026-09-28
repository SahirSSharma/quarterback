// Shared helpers for lib/tf tests: a scripted fetch that records request bodies, and completion builders.
import { vi } from 'vitest';
import type { AssistantMessage, Completion } from './client';
import type { Usage } from './ledger';

export interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Serves the given responses in order; a function entry is called lazily (Response bodies are single-use). */
export function scriptedFetch(responses: (Response | (() => Response))[]) {
  const calls: CapturedCall[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const next = responses.shift();
    if (!next) throw new Error(`scriptedFetch: no response left for call ${calls.length}`);
    return typeof next === 'function' ? next() : next;
  });
  return { fn, calls };
}

export function completion(message: Partial<AssistantMessage>, usage?: Usage, finish_reason = 'stop'): Completion {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason }],
    usage: usage ?? { prompt_tokens: 10, completion_tokens: 5 },
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function toolCall(name: string, args: unknown, id = 'call_1') {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
}
