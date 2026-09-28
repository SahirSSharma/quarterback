// Replays the fixtures scripts/tf-probe.ts recorded live (2026-09-27) through every public path, in mock
// mode with the network disabled. If a prompt in probe-cases.ts changes, these fail with MissingFixtureError
// until the probe is re-run with QB_MODE=live QB_RECORD=1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TraceEvent } from '../types';
import { chat, deps } from './client';
import { MemoryLedger, setLedgerSink, totals } from './ledger';
import { LIGHTNING, SUPER } from './models';
import { probeForcedTool, probeStream, probeStructured, probeToolLoop } from './probe-cases';

const originalFetch = deps.fetch;
let ledger: MemoryLedger;

beforeEach(() => {
  vi.stubEnv('QB_MODE', 'mock');
  vi.stubEnv('QB_FIXTURES_DIR', '');
  ledger = new MemoryLedger();
  setLedgerSink(ledger);
  deps.fetch = vi.fn(async () => {
    throw new Error('network call in mock mode');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  deps.fetch = originalFetch;
});

describe('recorded fixtures replay', () => {
  it('structured: Lightning extracts the three fake record lines with json_schema', async () => {
    const out = await probeStructured();
    expect(out).toEqual({
      courses: [
        { code: 'CSE 8A', grade: 'A-' },
        { code: 'MATH 20A', grade: 'B+' },
        { code: 'CSE 12', grade: 'IP' },
      ],
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ step: 'probe-extract', model: LIGHTNING, replayed: true, promptTokens: 116, completionTokens: 58, reasoningTokens: 0 });
    expect(ledger.spent()).toBe(0);
  });

  it('forcedTool: Super answers through the forced submit_plans call with thinking on', async () => {
    const { args, result } = await probeForcedTool();
    expect(args.plans).toHaveLength(1);
    expect(args.plans[0].label).toBe('balanced');
    expect(args.plans[0].courses).toHaveLength(3);
    for (const c of args.plans[0].courses) expect(['CSE 8B', 'MATH 20B', 'CSE 12', 'CSE 15L', 'COGS 1']).toContain(c);
    expect(result.finish_reason).toBe('tool_calls');
    expect(result.message.tool_calls?.[0].function.name).toBe('submit_plans');
    expect(result.message.reasoning_content ?? result.message.reasoning).toBeTruthy();
    expect(result.entry).toMatchObject({ step: 'probe-plan', model: SUPER, replayed: true, reasoningTokens: 58, cacheHitTokens: 0 });
    expect(result.entry.usd).toBeCloseTo((507 * 0.3 + 116 * 0.9) / 1e6, 12);
  });

  it('toolLoop: Lightning calls offering_status, reads the tentative quote and answers', async () => {
    const events: TraceEvent[] = [];
    const out = await probeToolLoop((e) => events.push(e));
    expect(out.rounds).toBe(2);
    expect(out.exhausted).toBe(false);
    expect(out.message.content).toMatch(/tentative/i);
    expect(events.map((e) => e.type)).toEqual(['model', 'tool_call', 'tool_result', 'model']);
    expect(events[1]).toMatchObject({ type: 'tool_call', name: 'offering_status', args: { course: 'CSE 100', term: 'WI27' } });
    expect(out.messages.filter((m) => m.role === 'tool')).toHaveLength(1);
    expect(ledger.entries.every((e) => e.replayed && e.step === 'probe-tools')).toBe(true);
    expect(totals(ledger.entries).byStep['probe-tools'].calls).toBe(2);
  });

  it('stream: mock mode replays the recorded answer as one delta, and chat() shares the fixture', async () => {
    const { text, deltas, result } = await probeStream();
    expect(deltas).toBe(1);
    expect(text).toMatch(/prerequisite/i);
    expect(result.entry).toMatchObject({ step: 'probe-stream', replayed: true, promptTokens: 30, completionTokens: 20 });

    const twin = await chat(
      { role: 'extract', messages: [{ role: 'user', content: 'In exactly 20 words, explain what a course prerequisite is.' }], max_tokens: 80 },
      { step: 'twin' },
    );
    expect(twin.message.content).toBe(text);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
