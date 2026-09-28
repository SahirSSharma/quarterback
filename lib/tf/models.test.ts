import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING, LIGHTNING, MODELS, NANO, ROLE_PRIMARY, SUPER, ULTRA, fallbackOf, modelEntry, price, resolveModel } from './models';

afterEach(() => vi.unstubAllEnvs());

describe('registry', () => {
  it('maps roles to the verified primaries', () => {
    expect(resolveModel('extract').id).toBe(LIGHTNING);
    expect(resolveModel('plan').id).toBe(SUPER);
    expect(resolveModel('critic').id).toBe(ULTRA);
  });

  it('every role primary has a fallback that is a registry model', () => {
    for (const role of Object.keys(ROLE_PRIMARY) as (keyof typeof ROLE_PRIMARY)[]) {
      const fb = fallbackOf(ROLE_PRIMARY[role]);
      expect(fb, role).not.toBeNull();
      expect(MODELS[fb!.id]).toBeDefined();
    }
    expect(fallbackOf(LIGHTNING)?.id).toBe(NANO);
    expect(fallbackOf(SUPER)?.id).toBe(ULTRA);
    expect(fallbackOf(ULTRA)?.id).toBe(SUPER);
    expect(fallbackOf(NANO)).toBeNull();
    expect(fallbackOf(EMBEDDING)).toBeNull();
  });

  it('QB_MODEL_<ROLE> overrides the primary but must be a registry id', () => {
    vi.stubEnv('QB_MODEL_PLAN', ULTRA);
    expect(resolveModel('plan').id).toBe(ULTRA);
    expect(fallbackOf(resolveModel('plan').id)?.id).toBe(SUPER);
    vi.stubEnv('QB_MODEL_PLAN', 'nvidia/does-not-exist');
    expect(() => resolveModel('plan')).toThrow(/does-not-exist.*lib\/tf\/models\.ts/);
    expect(() => modelEntry('gpt-4')).toThrow(/Unknown Token Factory model/);
  });
});

describe('price', () => {
  it('uses $/1M input and output from the registry', () => {
    expect(price(LIGHTNING, { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(0.3, 10);
    expect(price(SUPER, { prompt_tokens: 1000, completion_tokens: 500 })).toBeCloseTo(0.0003 + 0.00045, 12);
    expect(price(ULTRA, { prompt_tokens: 2000, completion_tokens: 100 })).toBeCloseTo(0.002 + 0.0003, 12);
    expect(price(EMBEDDING, { prompt_tokens: 100_000, completion_tokens: 0 })).toBeCloseTo(0.001, 12);
  });

  it('a two-round Super plan of ~30k prompt tokens stays around five cents', () => {
    const usd = 2 * price(SUPER, { prompt_tokens: 30_000, completion_tokens: 4_000 });
    expect(usd).toBeGreaterThan(0.02);
    expect(usd).toBeLessThan(0.06);
  });
});
