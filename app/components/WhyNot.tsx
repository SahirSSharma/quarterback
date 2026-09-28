'use client';

import { useState } from 'react';
import type { LedgerEntry } from '@/lib/types';
import { api } from '@/app/lib/api';
import type { ExplainResponse } from '@/app/lib/contracts';
import { formatCents, formatMs, formatTokens } from '@/app/lib/format';
import { ModelBadge } from './ModelBadge';
import { btn, Card, Notice } from './ui';

/**
 * "Why not CSE 105?" — a course the student expected in a plan, answered in a sentence or three from the same
 * eligibility table the planner saw. Each answer is one small model call; its ledger line is shown under it.
 */
export function WhyNot({ runId, suggestions, onEntry }: { runId: string; suggestions: string[]; onEntry: (entry: LedgerEntry) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ExplainResponse | null>(null);

  async function ask(raw: string) {
    const c = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!c || busy) return;
    setCode(c);
    setBusy(true);
    setError(null);
    try {
      const res = await api.explain(runId, c);
      setAnswer(res);
      if (res.entry) onEntry(res.entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-ink">Why not a course you expected?</h3>
      <p className="mt-1 text-sm text-ink-2">Name a course and get the reason it is or is not in reach in the next quarters: what is missing and the earliest quarter it fits.</p>
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void ask(code); }}>
        <label htmlFor="whynot-code" className="sr-only">Course code</label>
        <input
          id="whynot-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. CSE 105"
          autoComplete="off"
          spellCheck={false}
          className="w-40 rounded-lg border border-line-2 bg-surface px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-accent"
        />
        <button type="submit" disabled={busy || code.trim().length === 0} className={btn.secondary}>{busy ? 'Asking…' : 'Why not?'}</button>
        {suggestions.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <span>Try:</span>
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => void ask(s)} disabled={busy} className="rounded-full border border-line-2 bg-bg px-2.5 py-0.5 font-mono text-xs text-ink-2 hover:border-ink-3 disabled:opacity-50">
                {s}
              </button>
            ))}
          </span>
        )}
      </form>
      <div className="mt-3 min-h-6" aria-live="polite">
        {error && <Notice tone="warn">{error}</Notice>}
        {answer && !error && (
          <div>
            <p className="text-sm leading-6 text-ink"><span className="font-medium">{answer.code}:</span> {answer.text}</p>
            {answer.entry && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-ink-3">
                <ModelBadge model={answer.entry.model} />
                <span>
                  {formatMs(answer.entry.ms)} · {formatTokens(answer.entry.promptTokens)} in · {formatTokens(answer.entry.completionTokens)} out · {formatCents(answer.entry.usd)}
                  {answer.entry.replayed ? ' · replayed' : ''}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
