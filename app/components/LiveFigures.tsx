'use client';

import { useEffect, useState } from 'react';
import { api } from '@/app/lib/api';
import type { LedgerSummary } from '@/app/lib/contracts';
import { formatCents } from '@/app/lib/format';
import { modelTier } from '@/app/lib/models';
import { Line } from './Skeletons';

function Figure({ label, value, note }: { label: string; value: string | null; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-1 h-8">
        {value === null ? <Line w="w-24" h="h-7" className="mt-0.5" /> : <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>}
      </div>
      <p className="mt-1 text-xs text-ink-2">{note}</p>
    </div>
  );
}

const capText = (cap: number | null) => (cap === null ? 'no cap set' : `cap $${cap.toFixed(2)}`);

/** Today's and total live spend against the caps, and live stress-tests today, from GET /api/ledger/summary. */
export function LiveFigures() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.ledgerSummary().then(setSummary).catch((e) => setError(e instanceof Error ? e.message : 'The ledger is not reachable.'));
  }, []);

  const byModel = summary
    ? Object.entries(summary.byModel).sort((a, b) => b[1].calls - a[1].calls).map(([id, m]) => `${modelTier(id)} ${m.calls}`)
    : [];
  return (
    <div aria-busy={!summary && !error}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Spent today" value={summary ? formatCents(summary.today.usd) : null} note={summary ? capText(summary.today.capUsd) : 'Daily cap'} />
        <Figure label="Spent in total" value={summary ? formatCents(summary.total.usd) : null} note={summary ? capText(summary.total.capUsd) : 'Total cap'} />
        <Figure label="Stress-tests today" value={summary ? `${summary.stressTests.today} of ${summary.stressTests.cap}` : null} note="Live calls to the largest model" />
      </div>
      <p className="mt-2 min-h-5 text-xs text-ink-3" aria-live="polite">
        {error
          ? `Live figures unavailable: ${error}`
          : summary
            ? `Live figures from this deployment's ledger; replayed calls are excluded. Live calls by model: ${byModel.length ? byModel.join(' · ') : 'none yet'}${summary.credits > 0 ? ` · ${summary.credits} Tavily credits` : ''}.`
            : 'Loading live figures…'}
      </p>
    </div>
  );
}
