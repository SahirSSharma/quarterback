import { describe, expect, it } from 'vitest';
import type { LedgerEntry, TraceEvent } from '@/lib/types';
import { collapseTools, elapsedMs, formatElapsed, inFlight, stepTier } from './trace';

const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
const entry = (model: string): LedgerEntry => ({
  at: at(1), step: 'plan', model, ms: 900, promptTokens: 10, completionTokens: 5, reasoningTokens: 0, cacheHitTokens: 0, usd: 0, replayed: true,
});
const call = (name: string, s: number): TraceEvent => ({ type: 'tool_call', step: 'plan', at: at(s), name, args: { code: 'CSE 29' } });
const result = (name: string, s: number): TraceEvent => ({ type: 'tool_result', step: 'plan', at: at(s), name, ms: 2, summary: 'ok' });

describe('collapseTools', () => {
  it('folds each tool call with the next result of the same name and passes everything else through', () => {
    const events: TraceEvent[] = [
      { type: 'step', step: 'plan', at: at(0), message: 'Context pack built' },
      call('unit_check', 1), call('offering_status', 1), result('unit_check', 2), result('offering_status', 2),
      { type: 'verifier', step: 'plan', at: at(3), report: { planId: 'p', ok: true, violations: [] } },
    ];
    const rows = collapseTools(events);
    expect(rows.map((r) => r.kind)).toEqual(['event', 'tool', 'tool', 'event']);
    const tools = rows.filter((r) => r.kind === 'tool');
    expect(tools[0]).toMatchObject({ call: { name: 'unit_check' }, result: { name: 'unit_check' } });
    expect(tools[1]).toMatchObject({ call: { name: 'offering_status' }, result: { name: 'offering_status' } });
  });

  it('leaves a call without a result open, and a result without a call as its own row', () => {
    const rows = collapseTools([call('unit_check', 1), result('grade_history', 2)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'tool', result: null });
    expect(rows[1]).toMatchObject({ kind: 'event', event: { type: 'tool_result', name: 'grade_history' } });
  });
});

describe('elapsed time', () => {
  it('measures from the first timestamp and never goes negative or NaN', () => {
    expect(elapsedMs(at(0), at(83.4))).toBe(83_400);
    expect(elapsedMs(at(5), at(0))).toBe(0);
    expect(elapsedMs(undefined, at(0))).toBe(0);
    expect(elapsedMs('nope', at(0))).toBe(0);
  });
  it('formats as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(83_400)).toBe('1:23');
    expect(formatElapsed(144_311)).toBe('2:24');
  });
});

describe('the call in flight', () => {
  it('reads the tier from the step name, so renamed planner steps still get a badge', () => {
    expect(stepTier('plan')).toBe('Super');
    expect(stepTier('drafting')).toBe('Super');
    expect(stepTier('verifying')).toBe('Super');
    expect(stepTier('repairing')).toBe('Super');
    expect(stepTier('stress-test')).toBe('Ultra');
    expect(stepTier('explain')).toBe('Lightning');
    expect(stepTier('intake')).toBe('Lightning');
    expect(stepTier('something-new')).toBeNull();
  });

  it('is null once the trace is done or errored, or when not live', () => {
    const done: TraceEvent[] = [{ type: 'done', step: 'plan', at: at(1) }];
    expect(inFlight(done, true)).toBeNull();
    expect(inFlight([{ type: 'error', step: 'plan', at: at(1), message: 'x' }], true)).toBeNull();
    expect(inFlight([{ type: 'step', step: 'plan', at: at(0), message: 'm' }], false)).toBeNull();
  });

  it('names the last step and falls back to the last model seen for an unknown step', () => {
    expect(inFlight([], true)).toEqual({ step: 'plan', tier: 'Super' });
    const events: TraceEvent[] = [
      { type: 'model', step: 'plan', at: at(1), entry: entry('nvidia/nemotron-3-super-120b-a12b') },
      { type: 'step', step: 'mystery', at: at(2), message: 'Doing something new · 1,200 ms' },
    ];
    expect(inFlight(events, true)).toEqual({ step: 'mystery', tier: 'Super' });
    expect(inFlight([{ type: 'step', step: 'mystery', at: at(2), message: 'm' }], true)).toEqual({ step: 'mystery', tier: null });
  });
});
