// Spend caps for live Token Factory calls.
//
//   assertBudget(sink?)   → resolves when under QB_DAILY_CAP_USD / QB_TOTAL_CAP_USD (unset = no cap),
//                           throws BudgetExceededError otherwise; the app catches it and flips to replay
//   BudgetExceededError   → { cap: 'daily' | 'total', spent, limit }
//
// Spend comes from the active ledger sink's non-replayed entries. "Daily" is the current UTC calendar day.
import { ledgerSink, type LedgerSink } from './ledger';

export class BudgetExceededError extends Error {
  cap: 'daily' | 'total';
  spent: number;
  limit: number;
  constructor(cap: 'daily' | 'total', spent: number, limit: number) {
    super(`Token Factory ${cap} spend cap reached: $${spent.toFixed(4)} of $${limit.toFixed(2)}`);
    this.name = 'BudgetExceededError';
    this.cap = cap;
    this.spent = spent;
    this.limit = limit;
  }
}

export async function assertBudget(sink: LedgerSink = ledgerSink()): Promise<void> {
  const daily = capFromEnv('QB_DAILY_CAP_USD');
  const total = capFromEnv('QB_TOTAL_CAP_USD');
  if (total !== null) {
    const spent = await sink.spent();
    if (spent >= total) throw new BudgetExceededError('total', spent, total);
  }
  if (daily !== null) {
    const startOfDay = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const spent = await sink.spent(startOfDay);
    if (spent >= daily) throw new BudgetExceededError('daily', spent, daily);
  }
}

function capFromEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got '${raw}'`);
  return n;
}
