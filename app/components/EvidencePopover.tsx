import type { OfferingEvidence } from '@/lib/types';
import { formatDate, termName } from '@/app/lib/format';

const statusLabel: Record<OfferingEvidence['status'], string> = {
  offered: 'Listed',
  tentative: 'Tentative',
  not_offered: 'Not listed',
  unknown: 'Unknown',
};

/** The verbatim source line, its URL and fetch date, behind a native <details> so it needs no script. */
export function EvidencePopover({ evidence, label = 'Evidence' }: { evidence: OfferingEvidence; label?: string }) {
  const host = (() => { try { return new URL(evidence.url).host; } catch { return evidence.url; } })();
  return (
    <details className="relative inline-block">
      <summary className="qb-summary cursor-pointer select-none rounded-md text-xs font-medium text-accent underline-offset-2 hover:underline">
        {label}
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-80 sm:left-auto sm:right-0 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 text-left shadow-lg">
        <p className="text-xs text-ink-2">
          <span className="font-medium text-ink">{evidence.course}</span> · {termName(evidence.term)} · {statusLabel[evidence.status]}
          {evidence.instructor ? ` · ${evidence.instructor}` : ''}
        </p>
        <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-md bg-bg px-2.5 py-2 font-mono text-[11px] leading-5 text-ink">
          {evidence.quote}
        </blockquote>
        <p className="mt-2 text-xs text-ink-3">
          <a href={evidence.url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{host}</a>
          {' · fetched '}
          {formatDate(evidence.fetchedAt)}
        </p>
      </div>
    </details>
  );
}
