'use client';

import { useEffect, useRef } from 'react';
import type { ApprovalRecord, Impact, Plan, Verdict, VerifierReport } from '@/lib/types';
import { formatUnits, termName } from '@/app/lib/format';
import { planLabel } from './PlanColumns';
import { VerifierChecklist } from './VerifierChecklist';
import { btn } from './ui';

export function ApproveDialog({ open, plan, report, impact, verdict, overrides, busy, onClose, onConfirm }: {
  open: boolean;
  plan: Plan | null;
  report: VerifierReport | undefined;
  impact: Impact;
  verdict: Verdict | null;
  overrides: ApprovalRecord['overrides'];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!plan) return null;
  const refused = verdict?.refused.some((r) => r.planId === plan.id) ?? false;
  const overridden = overrides.some((o) => o.refusalPlanId === plan.id);
  const blocked = refused && !overridden;

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="approve-title"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!blocked) onConfirm(); }} className="p-6">
        <h2 id="approve-title" className="text-xl font-semibold tracking-tight">Approve the {planLabel(plan.label)} plan</h2>
        <p className="mt-1 text-sm text-ink-2">
          {plan.graduationTerm ? `Graduates ${termName(plan.graduationTerm)}. ` : ''}The approval record carries the fingerprint of this plan.
        </p>

        <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
          {plan.terms.map((t) => (
            <li key={t.term} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span><span className="font-medium">{termName(t.term)}</span> <span className="text-ink-2">· {t.courses.join(', ')}</span></span>
              <span className="shrink-0 text-xs text-ink-2">{formatUnits(t.units)}</span>
            </li>
          ))}
        </ul>

        <section className="mt-4 text-sm text-ink-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">What this records</h3>
          <ul className="mt-1.5 space-y-1">
            <li>{impact.action.kind === 'drop' ? 'Drop' : impact.action.kind === 'pnp' ? 'Switch to P/NP' : 'Keep'} {impact.course.code}; {impact.unitsAfter} units this quarter{impact.belowFullTime ? ' (below the full-time floor)' : ''}.</li>
            <li>{impact.blocks.length === 0 ? 'No downstream courses affected.' : `${impact.blocks.length} downstream course${impact.blocks.length === 1 ? '' : 's'} moved; longest chain ${impact.chainQuartersBefore} → ${impact.chainQuartersAfter} quarters.`}</li>
            {overrides.length > 0 && <li className="text-warn">{overrides.length} override{overrides.length === 1 ? '' : 's'} recorded: {overrides.map((o) => `“${o.reason}”`).join('; ')}.</li>}
            {blocked && <li className="text-danger">This plan was refused. Record an override on its refusal card before approving.</li>}
          </ul>
        </section>

        <div className="mt-4 border-t border-line pt-4">
          <VerifierChecklist report={report} />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="submit" disabled={blocked || busy} className={btn.primary}>{busy ? 'Approving…' : 'Approve this plan'}</button>
        </div>
      </form>
    </dialog>
  );
}
