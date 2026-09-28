'use client';

import { useEffect, useRef } from 'react';
import type { TraceEvent } from '@/lib/types';
import { formatCents, formatMs, formatTokens } from '@/app/lib/format';
import { ModelBadge } from './ModelBadge';

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Los_Angeles' });
}

function Row({ e }: { e: TraceEvent }) {
  switch (e.type) {
    case 'step':
      return <span className="text-ink-2">{e.message}</span>;
    case 'model': {
      const t = e.entry;
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ModelBadge model={t.model} />
          <span className="text-ink">{t.step}</span>
          <span className="tabular-nums text-ink-2">
            {formatMs(t.ms)} · {formatTokens(t.promptTokens + t.completionTokens + t.reasoningTokens)} tokens · {formatCents(t.usd)}
            {t.cacheHitTokens > 0 ? ` · ${formatTokens(t.cacheHitTokens)} cache hits` : ' · no cache hits'}
          </span>
        </span>
      );
    }
    case 'tool_call':
      return <span className="font-mono text-[12px] text-ink"><span className="text-ink-3">→ </span>{e.name}({JSON.stringify(e.args)})</span>;
    case 'tool_result':
      return <span className="font-mono text-[12px] text-ink-2"><span className="text-ink-3">← </span>{e.name} · {formatMs(e.ms)} · {e.summary}</span>;
    case 'verifier': {
      const errors = e.report.violations.filter((v) => v.severity === 'error').length;
      const warnings = e.report.violations.length - errors;
      return (
        <span className={e.report.ok ? 'text-accent' : 'text-danger'}>
          Verifier · {e.report.planId} · {e.report.ok ? 'passed' : 'rejected'}
          {errors > 0 && ` · ${errors} error${errors === 1 ? '' : 's'}`}
          {warnings > 0 && <span className="text-warn"> · {warnings} warning{warnings === 1 ? '' : 's'}</span>}
          {!e.report.ok && <span className="text-ink-3"> · {e.report.violations.filter((v) => v.severity === 'error').map((v) => v.rule).join(', ')}</span>}
        </span>
      );
    }
    case 'waiting':
      return <span className="text-warn">Waiting {e.seconds}s · {e.reason === 'rate-limit' ? 'rate limit' : 'queue'}</span>;
    case 'done':
      return <span className="font-medium text-ink">Done</span>;
    case 'error':
      return <span className="text-danger">Error · {e.message}</span>;
  }
}

/** Streamed agent steps. Collapsible; fixed height so arriving events never move the page. */
export function TracePanel({ events, live }: { events: TraceEvent[]; live: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <details open className="rounded-xl border border-line bg-surface">
      <summary className="qb-summary flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-accent motion-reduce:animate-none' : 'bg-ink-3'}`} />
          Trace
          <span className="font-normal text-ink-3">· {events.length} event{events.length === 1 ? '' : 's'}{live ? ' · live' : ''}</span>
        </span>
        <span className="text-xs text-ink-3">Nebius Token Factory</span>
      </summary>
      <ol ref={ref} aria-live="polite" aria-relevant="additions" className="max-h-[26rem] min-h-[12rem] overflow-y-auto border-t border-line px-4 py-2 text-[13px] leading-6">
        {events.length === 0 && <li className="py-2 text-ink-3">Waiting for the first step…</li>}
        {events.map((e, i) => (
          <li key={i} className="flex gap-3 border-b border-line/70 py-1.5 last:border-0">
            <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{clock(e.at)}</span>
            <span className="min-w-0 flex-1 break-words"><Row e={e} /></span>
          </li>
        ))}
      </ol>
    </details>
  );
}
