'use client';

import { useEffect, useRef, useState } from 'react';
import type { TraceEvent } from '@/lib/types';
import { formatCents, formatMs, formatTokens } from '@/app/lib/format';
import { collapseTools, elapsedMs, formatElapsed, inFlight, type TraceRow } from '@/app/lib/trace';
import { ModelBadge } from './ModelBadge';

function Row({ row }: { row: TraceRow }) {
  if (row.kind === 'tool') {
    const { call, result } = row;
    const args = JSON.stringify(call.args);
    return (
      <span className="block truncate font-mono text-[12px] text-ink" title={`${call.name}(${args})${result ? `\n→ ${result.summary}` : ''}`}>
        <span className="text-ink-3">→ </span>{call.name}<span className="text-ink-2">({args})</span>
        {result
          ? <span className="text-ink-2"> · {formatMs(result.ms)} · {result.summary}</span>
          : <span className="text-ink-3"> · running…</span>}
      </span>
    );
  }
  const e = row.event;
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
            {formatMs(t.ms)} · {formatTokens(t.promptTokens)} in · {formatTokens(t.completionTokens)} out
            {t.reasoningTokens > 0 ? ` · ${formatTokens(t.reasoningTokens)} reasoning` : ''} · {formatCents(t.usd)}
            {t.cacheHitTokens > 0 ? ` · ${formatTokens(t.cacheHitTokens)} cached` : ' · no cache hits'}
            {t.replayed ? ' · replayed' : ''}{t.fallback ? ' · fallback model' : ''}
          </span>
        </span>
      );
    }
    case 'tool_result':
      return <span className="font-mono text-[12px] text-ink-2"><span className="text-ink-3">← </span>{e.name} · {formatMs(e.ms)} · {e.summary}</span>;
    case 'verifier': {
      const errors = e.report.violations.filter((v) => v.severity === 'error');
      const warnings = e.report.violations.length - errors.length;
      return (
        <span className={e.report.ok ? 'text-accent' : 'text-danger'}>
          Verifier · {e.report.planId} · {e.report.ok ? 'passed' : 'rejected'}
          {errors.length > 0 && ` · ${errors.length} error${errors.length === 1 ? '' : 's'}`}
          {warnings > 0 && <span className="text-warn"> · {warnings} warning{warnings === 1 ? '' : 's'}</span>}
          {!e.report.ok && <span className="text-ink-3"> · {[...new Set(errors.map((v) => v.rule))].join(', ')}</span>}
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

/** Ticks once a second while the trace is live so the in-flight row shows how long the current call has run. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Streamed agent steps. Time is elapsed since the first event; a tool call and its result share a row; while a
 * call is in flight the last row spins with the model badge. Capped height with its own scroll, so arriving
 * events never move the page.
 */
export function TracePanel({ events, live, reconnecting = false }: { events: TraceEvent[]; live: boolean; reconnecting?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  const rows = collapseTools(events);
  const start = events[0]?.at;
  const pending = inFlight(events, live);
  const now = useTick(!!pending);
  const last = events[events.length - 1];

  // Follow new rows only; the once-a-second tick must not pull a reader who scrolled up back to the bottom.
  const pendingNow = pending !== null;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, pendingNow]);

  return (
    <details open className="rounded-xl border border-line bg-surface">
      <summary className="qb-summary flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-accent motion-reduce:animate-none' : 'bg-ink-3'}`} />
          Trace
          <span className="font-normal text-ink-3">
            · {events.length} event{events.length === 1 ? '' : 's'}{live ? (reconnecting ? ' · reconnecting' : ' · live') : ''}
            {start && last && !live ? ` · ${formatElapsed(elapsedMs(start, last.at))}` : ''}
          </span>
        </span>
        <span className="text-xs text-ink-3">Nebius Token Factory</span>
      </summary>
      <ol ref={ref} aria-live="polite" aria-relevant="additions" className="max-h-56 min-h-[8rem] overflow-y-auto border-t border-line px-4 py-2 text-[13px] leading-6 lg:max-h-[26rem] lg:min-h-[12rem]">
        {events.length === 0 && !pending && <li className="py-2 text-ink-3">Waiting for the first step…</li>}
        {rows.map((row, i) => (
          <li key={i} className="flex gap-3 border-b border-line/70 py-1.5 last:border-0">
            <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-3" title={new Date(row.at).toLocaleTimeString()}>{formatElapsed(elapsedMs(start, row.at))}</span>
            <span className="min-w-0 flex-1 break-words"><Row row={row} /></span>
          </li>
        ))}
        {pending && (
          <li className="flex gap-3 py-1.5" role="status" aria-label={reconnecting ? 'Reconnecting to the trace' : `${pending.step} in progress`}>
            <span aria-hidden="true" className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
              {last ? `+${formatElapsed(Math.max(0, now - Date.parse(last.at)))}` : ''}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
              <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-2 border-t-accent motion-reduce:animate-none" />
              {pending.tier && <ModelBadge tier={pending.tier} />}
              <span>{reconnecting ? 'Connection lost; the browser is retrying and the server keeps working.' : `${pending.step} · call in flight`}</span>
            </span>
          </li>
        )}
      </ol>
    </details>
  );
}
