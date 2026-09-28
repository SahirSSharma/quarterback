import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat } from './client';
import { MissingFixtureError, requestKey, stableStringify } from './replay';

afterEach(() => vi.unstubAllEnvs());

const base = {
  model: 'nvidia/Nemotron-3_5-Lightning',
  messages: [{ role: 'user', content: 'hello  world\n' }],
  max_tokens: 50,
  chat_template_kwargs: { enable_thinking: false },
  reasoning_effort: 'none',
};

describe('stableStringify', () => {
  it('sorts keys recursively, drops undefined and emits no whitespace', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify('x  y')).toBe('"x  y"');
    expect(stableStringify(null)).toBe('null');
  });
});

describe('requestKey', () => {
  it('is a sha256 hex digest', () => {
    expect(requestKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores key order and undefined fields', () => {
    const reordered = {
      reasoning_effort: 'none',
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 50,
      messages: [{ content: 'hello  world\n', role: 'user' }],
      model: base.model,
      temperature: undefined,
    };
    expect(requestKey(reordered)).toBe(requestKey(base));
  });

  it('ignores fields outside the canonical set (stream, stream_options)', () => {
    expect(requestKey({ ...base, stream: true, stream_options: { include_usage: true } })).toBe(requestKey(base));
  });

  it('changes when any canonical field changes, including message whitespace', () => {
    const k = requestKey(base);
    expect(requestKey({ ...base, max_tokens: 51 })).not.toBe(k);
    expect(requestKey({ ...base, messages: [{ role: 'user', content: 'hello world' }] })).not.toBe(k);
    expect(requestKey({ ...base, chat_template_kwargs: { enable_thinking: true } })).not.toBe(k);
    expect(requestKey({ ...base, model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B' })).not.toBe(k);
  });
});

describe('mock mode miss', () => {
  it('throws MissingFixtureError naming the key, the model and the last user message', async () => {
    vi.stubEnv('QB_MODE', 'mock');
    const user = `never recorded ${'x'.repeat(300)} tail`;
    const p = chat({ role: 'extract', messages: [{ role: 'system', content: 's' }, { role: 'user', content: user }] }, { step: 't' });
    await expect(p).rejects.toBeInstanceOf(MissingFixtureError);
    const err = (await p.catch((e) => e)) as MissingFixtureError;
    expect(err.key).toMatch(/^[0-9a-f]{64}$/);
    expect(err.message).toContain(err.key);
    expect(err.message).toContain('nvidia/Nemotron-3_5-Lightning');
    expect(err.message).toContain('QB_RECORD=1');
    expect(err.message).toContain(user.slice(0, 200));
    expect(err.message).not.toContain('tail');
  });
});
