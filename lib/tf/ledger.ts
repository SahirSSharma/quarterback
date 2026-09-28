// Per-call spend ledger for Token Factory.
//
//   makeEntry({step, model, ms, usage, replayed, fallback}) → LedgerEntry priced from the registry
//   LedgerSink                                              → { record(entry), spent(sinceIso?) }; the app
//                                                             layer plugs in a persistent one
//   MemoryLedger                                            → default in-memory sink (also used by tests)
//   setLedgerSink(sink) / ledgerSink()                      → swap / read the active sink
//   totals(entries)                                         → calls / tokens / usd grouped by step and model
//
// `fallback` marks an entry served by the role's fallback model; lib/types.ts has no field for it yet
// (requested in notes/tf.md), so it rides on TFLedgerEntry, which is structurally still a LedgerEntry.
import type { LedgerEntry } from '../types';
import { price } from './models';

/** OpenAI-compatible usage block as Token Factory returns it. */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface TFLedgerEntry extends LedgerEntry {
  fallback?: true;
}

export interface LedgerSink {
  record(entry: TFLedgerEntry): void | Promise<void>;
  /** USD of live (non-replayed) entries at or after `sinceIso`; all time when omitted. */
  spent(sinceIso?: string): number | Promise<number>;
}

export function makeEntry(args: {
  step: string;
  model: string;
  ms: number;
  usage: Usage;
  replayed: boolean;
  fallback?: boolean;
}): TFLedgerEntry {
  const { usage } = args;
  const entry: TFLedgerEntry = {
    at: new Date().toISOString(),
    step: args.step,
    model: args.model,
    ms: args.ms,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    cacheHitTokens: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    usd: price(args.model, usage),
    replayed: args.replayed,
  };
  if (args.fallback) entry.fallback = true;
  return entry;
}

export class MemoryLedger implements LedgerSink {
  entries: TFLedgerEntry[] = [];
  record(entry: TFLedgerEntry): void {
    this.entries.push(entry);
  }
  spent(sinceIso?: string): number {
    let usd = 0;
    for (const e of this.entries) {
      if (!e.replayed && (!sinceIso || e.at >= sinceIso)) usd += e.usd;
    }
    return usd;
  }
}

let sink: LedgerSink = new MemoryLedger();
export function setLedgerSink(next: LedgerSink): void {
  sink = next;
}
export function ledgerSink(): LedgerSink {
  return sink;
}

export interface Total {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  usd: number;
  ms: number;
}

export function totals(entries: LedgerEntry[]): { byStep: Record<string, Total>; byModel: Record<string, Total> } {
  const byStep: Record<string, Total> = {};
  const byModel: Record<string, Total> = {};
  for (const e of entries) {
    add(byStep, e.step, e);
    add(byModel, e.model, e);
  }
  return { byStep, byModel };
}

function add(group: Record<string, Total>, key: string, e: LedgerEntry): void {
  const t = (group[key] ??= { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, usd: 0, ms: 0 });
  t.calls += 1;
  t.promptTokens += e.promptTokens;
  t.completionTokens += e.completionTokens;
  t.reasoningTokens += e.reasoningTokens;
  t.cacheHitTokens += e.cacheHitTokens;
  t.usd += e.usd;
  t.ms += e.ms;
}
