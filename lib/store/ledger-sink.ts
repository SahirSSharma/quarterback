// Persistent spend ledger: the LedgerSink lib/tf/ledger.ts expects, plus the Tavily credit sink.
//
//   BlobLedgerSink                  → { record(entry), recordCredits(entry), spent(sinceIso?), totals() } over
//                                     the process-wide store() from ./blob
//   installLedgerSink()             → setLedgerSink(new BlobLedgerSink()) and returns the sink; the app layer
//                                     calls it once at startup (route module scope)
//
// Append-only: every entry is its own object at ledger/<UTC day of entry.at>/<ulid>, tagged
// `kind: 'tf' | 'tavily'`. Writes are fire-and-forget from the caller's point of view: record() resolves
// even when the backend fails (it logs the error message, never the entry) so a storage outage cannot break
// a model call. spent() and totals() read and may throw — they sit behind the live-mode budget check only.
// spent(sinceIso) sums usd of non-replayed Token Factory entries with `at >= sinceIso`, reading only the day
// folders at or after sinceIso's UTC date; past days are memoized per process so a budget check costs one
// list plus today's entries. totals() is live spend too: replayed (fixture-served) entries are excluded
// everywhere.
import type { TavilyCreditEntry } from '../tavily/client';
import { type LedgerSink, type TFLedgerEntry, type Total, setLedgerSink, totals as groupTotals } from '../tf/ledger';
import { store } from './blob';

export type StoredLedgerEntry = ({ kind: 'tf' } & TFLedgerEntry) | ({ kind: 'tavily' } & TavilyCreditEntry);

export interface LedgerTotals {
  byModel: Record<string, Total>;
  byStep: Record<string, Total>;
  usd: number;
  credits: number;
}

const PREFIX = 'ledger/';

export class BlobLedgerSink implements LedgerSink {
  private readonly pastDays = new Map<string, StoredLedgerEntry[]>();

  async record(entry: TFLedgerEntry): Promise<void> {
    await this.append({ kind: 'tf', ...entry });
  }

  /** Tavily's sink is synchronous `(entry) => void`; the write runs in the background. */
  recordCredits(entry: TavilyCreditEntry): void {
    void this.append({ kind: 'tavily', ...entry });
  }

  async spent(sinceIso?: string): Promise<number> {
    let usd = 0;
    for (const e of await this.entries(sinceIso)) {
      if (e.kind === 'tf' && !e.replayed && (!sinceIso || e.at >= sinceIso)) usd += e.usd;
    }
    return usd;
  }

  async totals(): Promise<LedgerTotals> {
    const all = await this.entries();
    const tf = all.filter((e): e is { kind: 'tf' } & TFLedgerEntry => e.kind === 'tf' && !e.replayed);
    let credits = 0;
    for (const e of all) if (e.kind === 'tavily' && !e.replayed) credits += e.credits;
    return { ...groupTotals(tf), usd: tf.reduce((sum, e) => sum + e.usd, 0), credits };
  }

  private async append(entry: StoredLedgerEntry): Promise<void> {
    try {
      await store().put(`${PREFIX}${entry.at.slice(0, 10)}/${ulid(new Date(entry.at).getTime())}`, entry);
    } catch (err) {
      console.error(`ledger write failed (${entry.kind} ${entry.step}): ${(err as Error).message}`);
    }
  }

  /** Entries of every UTC day at or after sinceIso's date. Past days never change (append-only, keys are dated
   *  by `at`), so they are read once per process; only today's keys are fetched again on each call. */
  private async entries(sinceIso?: string): Promise<StoredLedgerEntry[]> {
    const sinceDay = sinceIso?.slice(0, 10) ?? '';
    const today = new Date().toISOString().slice(0, 10);
    const byDay = new Map<string, string[]>();
    for (const key of await store().list(PREFIX)) {
      const day = key.slice(PREFIX.length, PREFIX.length + 10);
      if (day >= sinceDay) byDay.set(day, [...(byDay.get(day) ?? []), key]);
    }
    const out: StoredLedgerEntry[] = [];
    for (const [day, keys] of byDay) {
      let entries = this.pastDays.get(day);
      if (!entries) {
        entries = [];
        for (const key of keys) {
          const e = await store().get<StoredLedgerEntry>(key);
          if (e) entries.push(e);
        }
        if (day < today) this.pastDays.set(day, entries);
      }
      out.push(...entries);
    }
    return out;
  }
}

export function installLedgerSink(): BlobLedgerSink {
  const sink = new BlobLedgerSink();
  setLedgerSink(sink);
  return sink;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-char ULID: 48-bit millisecond time then 80 random bits, so keys sort by time and never collide. */
export function ulid(timeMs = Date.now()): string {
  let out = '';
  let t = Number.isFinite(timeMs) ? timeMs : Date.now();
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) out += CROCKFORD[rand[i] & 31];
  return out;
}
