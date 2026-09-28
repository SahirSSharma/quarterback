import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TavilyCreditEntry } from '../tavily/client';
import { MemoryLedger, ledgerSink, setLedgerSink, type TFLedgerEntry } from '../tf/ledger';
import { setStore, store } from './blob';
import { BlobLedgerSink, installLedgerSink, ulid } from './ledger-sink';
import { tempStore } from './test-fixture';

function entry(at: string, usd: number, replayed: boolean, model = 'nvidia/Nemotron-3_5-Lightning', step = 'intake'): TFLedgerEntry {
  return { at, step, model, ms: 400, promptTokens: 1000, completionTokens: 100, reasoningTokens: 0, cacheHitTokens: 0, usd, replayed };
}
function credits(at: string, credits: number, replayed: boolean): TavilyCreditEntry {
  return { at, step: 'discover', endpoint: 'search', ms: 900, credits, replayed };
}

describe('BlobLedgerSink', () => {
  let cleanup: () => void;
  beforeAll(() => { ({ cleanup } = tempStore()); });
  afterAll(() => { cleanup(); setLedgerSink(new MemoryLedger()); });

  it('appends one dated object per entry and sums live spend since a UTC instant', async () => {
    const sink = new BlobLedgerSink();
    await sink.record(entry('2026-09-26T23:30:00.000Z', 0.1, false));
    await sink.record(entry('2026-09-27T01:00:00.000Z', 0.05, false, 'nvidia/nemotron-3-super-120b-a12b', 'plan'));
    await sink.record(entry('2026-09-27T02:00:00.000Z', 0.2, true)); // fixture-served: never spend
    await sink.record(entry('2026-09-27T03:00:00.000Z', 0.01, false));

    const keys = await store().list('ledger/');
    expect(keys).toHaveLength(4);
    expect(keys.filter((k) => k.startsWith('ledger/2026-09-27/'))).toHaveLength(3);
    expect(keys.filter((k) => k.startsWith('ledger/2026-09-26/'))).toHaveLength(1);
    expect(keys.every((k) => /^ledger\/\d{4}-\d{2}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}$/.test(k))).toBe(true);

    expect(await sink.spent()).toBeCloseTo(0.16, 10);
    expect(await sink.spent('2026-09-27T00:00:00.000Z')).toBeCloseTo(0.06, 10); // the daily cap's question
    expect(await sink.spent('2026-09-27T02:30:00.000Z')).toBeCloseTo(0.01, 10); // instant, not just day
    expect(await sink.spent('2026-09-28T00:00:00.000Z')).toBe(0);
  });

  it('totals live spend by model and step, and Tavily credits separately', async () => {
    const sink = new BlobLedgerSink();
    sink.recordCredits(credits('2026-09-27T04:00:00.000Z', 2, false));
    sink.recordCredits(credits('2026-09-27T04:01:00.000Z', 5, true));
    await vi.waitFor(async () => expect(await store().list('ledger/2026-09-27/')).toHaveLength(5));

    const t = await sink.totals();
    expect(t.usd).toBeCloseTo(0.16, 10);
    expect(t.credits).toBe(2);
    expect(Object.keys(t.byModel).sort()).toEqual(['nvidia/Nemotron-3_5-Lightning', 'nvidia/nemotron-3-super-120b-a12b']);
    expect(t.byModel['nvidia/Nemotron-3_5-Lightning'].calls).toBe(2); // the replayed Lightning call is excluded
    expect(t.byStep.plan.usd).toBeCloseTo(0.05, 10);
  });

  it('never throws into the request path when the write fails', async () => {
    const broken = { put: vi.fn().mockRejectedValue(new Error('blob down')), get: vi.fn(), list: vi.fn(), del: vi.fn() };
    const prev = store();
    setStore(broken);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const sink = new BlobLedgerSink();
      await expect(sink.record(entry('2026-09-27T05:00:00.000Z', 0.01, false))).resolves.toBeUndefined();
      expect(() => sink.recordCredits(credits('2026-09-27T05:00:00.000Z', 1, false))).not.toThrow();
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
      expect(error.mock.calls[0][0]).toContain('blob down');
      expect(error.mock.calls[0][0]).not.toContain('0.01'); // the entry itself is not logged
    } finally {
      error.mockRestore();
      setStore(prev);
    }
  });

  it('installs itself as the Token Factory ledger sink', () => {
    const sink = installLedgerSink();
    expect(ledgerSink()).toBe(sink);
  });

  it('ulid sorts by time and is unique', () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a.length).toBe(26);
    expect(a < b).toBe(true);
    expect(ulid(1_000_000)).not.toBe(a);
    expect(ulid(1_000_000).slice(0, 10)).toBe(a.slice(0, 10));
  });
});
