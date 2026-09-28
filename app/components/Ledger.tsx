import type { LedgerEntry } from '@/lib/types';
import { formatCents, formatMs, formatTokens } from '@/app/lib/format';
import { ModelBadge } from './ModelBadge';

export function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const total = entries.reduce(
    (s, e) => ({ ms: s.ms + e.ms, tokens: s.tokens + e.promptTokens + e.completionTokens + e.reasoningTokens, usd: s.usd + e.usd, cache: s.cache + e.cacheHitTokens }),
    { ms: 0, tokens: 0, usd: 0, cache: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="px-4 py-2 text-left text-xs text-ink-3">Model calls on Nebius Token Factory for this run.</caption>
        <thead className="bg-bg text-left text-xs uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Step</th>
            <th scope="col" className="px-4 py-2 font-medium">Model</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Time</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Tokens</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Cost</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Cache</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-3 text-ink-3">No model calls yet.</td></tr>
          )}
          {entries.map((e, i) => (
            <tr key={`${e.at}-${i}`}>
              <td className="px-4 py-2.5 text-ink">
                {e.step}
                {e.replayed && <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">replay</span>}
              </td>
              <td className="px-4 py-2.5"><ModelBadge model={e.model} showId /></td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{formatMs(e.ms)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-2" title={`${e.promptTokens} in · ${e.completionTokens} out · ${e.reasoningTokens} reasoning`}>
                {formatTokens(e.promptTokens + e.completionTokens + e.reasoningTokens)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{formatCents(e.usd)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{e.cacheHitTokens > 0 ? `${formatTokens(e.cacheHitTokens)} hit` : '—'}</td>
            </tr>
          ))}
        </tbody>
        {entries.length > 0 && (
          <tfoot className="border-t border-line-2 bg-bg text-xs font-medium text-ink">
            <tr>
              <td className="px-4 py-2" colSpan={2}>Total · {entries.length} call{entries.length === 1 ? '' : 's'}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMs(total.ms)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatTokens(total.tokens)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatCents(total.usd)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{total.cache > 0 ? `${formatTokens(total.cache)} hit` : '—'}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
