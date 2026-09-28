import type { Deadline, Impact } from '@/lib/types';
import { deadlineHeadline } from '@/app/lib/deadlines';
import { formatUnits, termName } from '@/app/lib/format';
import { EvidencePopover } from './EvidencePopover';
import { Card, Notice, Tag } from './ui';

/** Rows shown before a list folds; demo (a) has ~45 downstream courses and 20+ engine notes. */
const BLOCKS_SHOWN = 8;
const NOTES_SHOWN = 6;

function BlockedRow({ b }: { b: Impact['blocks'][number] }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {b.code}
          {b.title && <span className="font-normal text-ink-2"> · {b.title}</span>}
        </p>
        {b.buckets.length > 0 && <p className="mt-0.5 truncate text-xs text-ink-3">Fills: {b.buckets.join(' · ')}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2 sm:justify-end sm:text-right">
        <span>
          {b.nextOffered ? `Next listed ${termName(b.nextOffered)}` : 'No later listing this year'}
          {b.delayQuarters > 0 && <span className="text-danger"> · {b.delayQuarters} quarter{b.delayQuarters === 1 ? '' : 's'} later</span>}
        </span>
        {b.evidence && <EvidencePopover evidence={b.evidence} />}
      </div>
    </li>
  );
}

const verb: Record<Impact['action']['kind'], string> = { drop: 'Dropping', pnp: 'Switching to P/NP', keep: 'Keeping' };

const risk: Record<Impact['graduationRisk'], { label: string; tone: 'accent' | 'warn' | 'danger' }> = {
  none: { label: 'No graduation risk found', tone: 'accent' },
  possible: { label: 'Graduation risk: possible', tone: 'warn' },
  likely: { label: 'Graduation risk: likely', tone: 'danger' },
};

const pnpTone: Record<Impact['pnpAllowed'], 'accent' | 'danger' | 'warn'> = { yes: 'accent', no: 'danger', unknown: 'warn' };
const pnpLabel: Record<Impact['pnpAllowed'], string> = { yes: 'P/NP counts', no: 'P/NP would not count', unknown: 'P/NP: check with your department' };

/** `deadlines` are judged on today's LA calendar day by the caller (a saved run's stored flags may be stale). */
export function ImpactCard({ impact, deadlines = impact.deadlines }: { impact: Impact; deadlines?: Deadline[] }) {
  const r = risk[impact.graduationRisk];
  const unitPct = Math.min(100, Math.round((impact.unitsAfter / Math.max(impact.fullTimeFloor, impact.unitsAfter, 1)) * 100));
  const headline = deadlineHeadline(impact.action.kind, deadlines);
  const notes = impact.notes.slice(0, NOTES_SHOWN);
  const moreNotes = impact.notes.slice(NOTES_SHOWN);
  // Delayed courses first, then the rest of the dependents; the long tail folds.
  const blocks = [...impact.blocks].sort((a, b) => b.delayQuarters - a.delayQuarters);
  const shownBlocks = blocks.slice(0, BLOCKS_SHOWN);
  const moreBlocks = blocks.slice(BLOCKS_SHOWN);
  return (
    <Card>
      {headline && <div className="mb-4"><Notice tone="warn">{headline}</Notice></div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-tight text-ink">
            {verb[impact.action.kind]} {impact.course.code}
          </h3>
          <p className="mt-0.5 text-sm text-ink-2">{impact.course.title ? `${impact.course.title} · ` : ''}{formatUnits(impact.course.units)}</p>
        </div>
        <Tag tone={r.tone}>{r.label}</Tag>
      </div>

      <section className="mt-6" aria-labelledby="blocked">
        <h4 id="blocked" className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {impact.action.kind === 'drop' ? 'Courses this blocks' : 'Courses affected'}
        </h4>
        {impact.blocks.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">Nothing downstream depends on {impact.course.code}.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-2">
              {impact.blocks.length} course{impact.blocks.length === 1 ? '' : 's'} on your requirement path depend on it
              {blocks[0]?.delayQuarters > 0 ? `; ${blocks.filter((b) => b.delayQuarters > 0).length} ${blocks.filter((b) => b.delayQuarters > 0).length === 1 ? 'is' : 'are'} delayed by this alone.` : '; none is delayed by this alone.'}
            </p>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {shownBlocks.map((b) => <BlockedRow key={b.code} b={b} />)}
            </ul>
            {moreBlocks.length > 0 && (
              <details className="mt-2">
                <summary className="qb-summary cursor-pointer text-sm font-medium text-accent underline-offset-2 hover:underline">{moreBlocks.length} more course{moreBlocks.length === 1 ? '' : 's'} that depend on {impact.course.code}</summary>
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                  {moreBlocks.map((b) => <BlockedRow key={b.code} b={b} />)}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="units" className="rounded-lg border border-line p-3">
          <h4 id="units" className="text-xs font-medium uppercase tracking-wide text-ink-3">Units this quarter</h4>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {impact.unitsAfter}
            <span className="text-sm font-normal text-ink-2"> after · floor {impact.fullTimeFloor}</span>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className={`h-full rounded-full ${impact.belowFullTime ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${unitPct}%` }} />
          </div>
          <p className={`mt-1.5 text-xs ${impact.belowFullTime ? 'text-danger' : 'text-ink-2'}`}>
            {impact.belowFullTime ? 'Below full-time. Aid, housing and visa status can depend on 12 units.' : impact.unitsAfter === impact.fullTimeFloor ? 'Exactly at the full-time floor.' : 'Still full-time.'}
          </p>
        </section>
        <section aria-labelledby="pnp" className="rounded-lg border border-line p-3">
          <h4 id="pnp" className="text-xs font-medium uppercase tracking-wide text-ink-3">Grading option</h4>
          <div className="mt-1.5"><Tag tone={pnpTone[impact.pnpAllowed]}>{pnpLabel[impact.pnpAllowed]}</Tag></div>
          <p className="mt-2 text-xs leading-5 text-ink-2">{impact.pnpNote}</p>
        </section>
      </div>

      <section className="mt-6" aria-labelledby="progress">
        <h4 id="progress" className="text-xs font-medium uppercase tracking-wide text-ink-3">Requirement progress</h4>
        {impact.progressDelta.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">No requirement loses progress.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {impact.progressDelta.map((p) => (
              <li key={`${p.band}-${p.bucket}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">{p.bucket} <span className="text-xs text-ink-3">· {p.band}</span></span>
                  <span className="shrink-0 text-xs text-ink-2">{p.before} → <span className={p.after < p.before ? 'font-medium text-danger' : ''}>{p.after}</span> of {p.needed}</span>
                </div>
                <div className="mt-1 flex h-2 w-full gap-px overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <div className="h-full bg-accent" style={{ width: `${(Math.min(p.after, p.needed) / p.needed) * 100}%` }} />
                  <div className="h-full bg-danger/60" style={{ width: `${(Math.max(0, Math.min(p.before, p.needed) - Math.min(p.after, p.needed)) / p.needed) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm" aria-labelledby="chain">
        <h4 id="chain" className="text-xs font-medium uppercase tracking-wide text-ink-3">Longest chain left</h4>
        <p className="text-ink">
          {impact.chainQuartersBefore} → <span className={impact.chainQuartersAfter > impact.chainQuartersBefore ? 'font-medium text-danger' : ''}>{impact.chainQuartersAfter}</span> quarters
        </p>
      </section>

      {impact.notes.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <ul className="space-y-1.5 text-sm leading-6 text-ink-2">
            {notes.map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-ink-3">—</span><span>{n}</span></li>)}
          </ul>
          {moreNotes.length > 0 && (
            <details className="mt-1.5">
              <summary className="qb-summary cursor-pointer text-sm font-medium text-accent underline-offset-2 hover:underline">{moreNotes.length} more note{moreNotes.length === 1 ? '' : 's'}</summary>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-6 text-ink-2">
                {moreNotes.map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-ink-3">—</span><span>{n}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
