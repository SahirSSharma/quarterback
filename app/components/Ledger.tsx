import type { LedgerEntry } from '@/lib/types';
import { formatCents, formatMs, formatTokens } from '@/app/lib/format';
import { ModelBadge } from './ModelBadge';

const num = 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2';

export function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const total = entries.reduce(
    (s, e) => ({
      ms: s.ms + e.ms, in: s.in + e.promptTokens, out: s.out + e.completionTokens, reasoning: s.reasoning + e.reasoningTokens,
      cache: s.cache + e.cacheHitTokens, usd: s.usd + e.usd,
    }),
    { ms: 0, in: 0, out: 0, reasoning: 0, cache: 0, usd: 0 },
  );
  const replayed = entries.filter((e) => e.replayed).length;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="px-4 py-2 text-left text-xs text-ink-3">
          Model calls on Nebius Token Factory for this run. Tokens are prompt in, completion out and reasoning; cache is prompt tokens served from the prompt cache.
        </caption>
        <thead className="bg-bg text-left text-xs uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Step</th>
            <th scope="col" className="px-3 py-2 font-medium">Model</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Time</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">In</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Out</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Reasoning</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Cache</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.length === 0 && (
            <tr><td colSpan={8} className="px-3 py-3 text-ink-3">No model calls yet.</td></tr>
          )}
          {entries.map((e, i) => (
            <tr key={`${e.at}-${i}`}>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                {e.step}
                {e.replayed && <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">replayed</span>}
                {e.fallback && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warn">fallback</span>}
              </td>
              <td className="px-3 py-2.5"><ModelBadge model={e.model} showId /></td>
              <td className={num}>{formatMs(e.ms)}</td>
              <td className={num}>{formatTokens(e.promptTokens)}</td>
              <td className={num}>{formatTokens(e.completionTokens)}</td>
              <td className={num}>{e.reasoningTokens > 0 ? formatTokens(e.reasoningTokens) : '—'}</td>
              <td className={num}>{e.cacheHitTokens > 0 ? formatTokens(e.cacheHitTokens) : '—'}</td>
              <td className={num}>{formatCents(e.usd)}</td>
            </tr>
          ))}
        </tbody>
        {entries.length > 0 && (
          <tfoot className="border-t border-line-2 bg-bg text-xs font-medium text-ink">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                Total · {entries.length} call{entries.length === 1 ? '' : 's'}
                {replayed > 0 && <span className="font-normal text-ink-3"> · {replayed === entries.length ? 'all replayed, no live spend' : `${replayed} replayed`}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMs(total.ms)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(total.in)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(total.out)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{total.reasoning > 0 ? formatTokens(total.reasoning) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{total.cache > 0 ? formatTokens(total.cache) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCents(total.usd)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
