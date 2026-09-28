import type { VerifierReport } from '@/lib/types';
import { formatDate, termName } from '@/app/lib/format';
import { planLabel } from './PlanColumns';
import { Tag } from './ui';

/** 'p-fastest' → 'Fastest', 'p-fastest-2' → 'Fastest'. Reports carry the draft's id, not its label. */
export function draftLabel(planId: string): string {
  return planLabel(planId.replace(/^p-/, '').replace(/-\d+$/, '').replace(/-/g, ' ')) || planId;
}

/**
 * The deterministic veto, made legible: every draft the verifier rejected, with the error-severity rule that
 * rejected it. A violation with evidence shows the department page's row, source and fetch date; one without
 * falls back to the verifier's message. Closed by default; the summary line carries the count.
 */
export function RejectedDrafts({ reports }: { reports: VerifierReport[] }) {
  const rejected = reports.filter((r) => !r.ok);
  if (rejected.length === 0) return null;
  return (
    <details className="rounded-xl border border-line bg-surface">
      <summary className="qb-summary flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
        <span className="font-medium text-ink">What the code rejected</span>
        <span className="text-ink-2">{rejected.length} draft{rejected.length === 1 ? '' : 's'} failed a check before you saw {rejected.length === 1 ? 'it' : 'them'}. Open to see which rule.</span>
      </summary>
      <div className="divide-y divide-line border-t border-line">
        {rejected.map((r) => {
          const errors = r.violations.filter((v) => v.severity === 'error');
          return (
            <section key={r.planId} aria-label={`${draftLabel(r.planId)} draft`} className="px-5 py-4">
              <h4 className="text-sm font-semibold text-ink">{draftLabel(r.planId)} draft <span className="font-mono text-xs font-normal text-ink-3">{r.planId}</span></h4>
              <ul className="mt-2 space-y-2">
                {errors.map((v, i) => {
                  const ev = v.evidence;
                  const host = ev ? (() => { try { return new URL(ev.url).host; } catch { return ev.url; } })() : null;
                  return (
                    <li key={i} className="text-sm leading-6 text-ink-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Tag tone="danger" className="font-mono">{v.rule}</Tag>
                        {(v.course || v.term) && (
                          <span className="font-medium text-ink">{v.course ?? ''}{v.course && v.term ? ' · ' : ''}{v.term ? termName(v.term) : ''}</span>
                        )}
                      </div>
                      {ev ? (
                        <figure className="mt-1.5">
                          <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-bg px-3 py-2 font-mono text-[12px] leading-5 text-ink">{ev.quote}</blockquote>
                          <figcaption className="mt-1 text-xs text-ink-3">
                            {ev.course} · {termName(ev.term)} ·{' '}
                            <a href={ev.url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{host}</a>
                            {' · fetched '}{formatDate(ev.fetchedAt)}
                          </figcaption>
                        </figure>
                      ) : (
                        <p className="mt-0.5">{v.message}</p>
                      )}
                    </li>
                  );
                })}
                {errors.length === 0 && <li className="text-sm text-ink-3">Rejected without an error-severity violation on record.</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
