'use client';

import { useState } from 'react';
import type { ApprovalRecord, Plan, Refusal } from '@/lib/types';
import { formatDate, termName } from '@/app/lib/format';
import { planLabel } from './PlanColumns';
import { btn, Card, Tag } from './ui';

type Override = ApprovalRecord['overrides'][number];
const PHRASE = 'I understand';

export function RefusalCard({ refusal, plan, override, onOverride, disabled = false }: {
  refusal: Refusal; plan: Plan | undefined; override: Override | undefined; onOverride: (o: Override) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const ready = phrase === PHRASE && reason.trim().length > 0;

  return (
    <Card tone="danger">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">
          Refused: {plan ? planLabel(plan.label) : refusal.planId} plan
        </h3>
        <Tag tone="danger">Not recommended</Tag>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-2">{refusal.reason}</p>

      {refusal.evidence.map((e, i) => {
        const host = (() => { try { return new URL(e.url).host; } catch { return e.url; } })();
        return (
          <figure key={i} className="mt-4">
            <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-bg px-3 py-2 font-mono text-[12px] leading-5 text-ink">{e.quote}</blockquote>
            <figcaption className="mt-1.5 text-xs text-ink-3">
              {e.course} · {termName(e.term)} ·{' '}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{host}</a>
              {' · fetched '}{formatDate(e.fetchedAt)}
            </figcaption>
          </figure>
        );
      })}

      <div className="mt-4 border-t border-danger/20 pt-4">
        {override ? (
          <p className="text-sm text-ink-2">
            <span className="font-medium text-warn">Override recorded.</span> Reason: “{override.reason}”. This plan can now be selected and approved; the override stays on the approval record.
          </p>
        ) : !open ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={btn.secondary}>Override this refusal</button>
            <span className="text-xs text-ink-3">Requires typing “{PHRASE}” and a reason. It is logged.</span>
          </div>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready) return;
              onOverride({ refusalPlanId: refusal.planId, reason: reason.trim(), phrase: PHRASE });
              setOpen(false);
            }}
          >
            <label className="block text-sm">
              <span className="font-medium text-ink">Type “{PHRASE}”</span>
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false}
                aria-invalid={phrase.length > 0 && phrase !== PHRASE}
                className="mt-1 w-full rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm text-ink focus:border-accent" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink">Why you are overriding</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. My advisor confirmed the Winter section by email"
                className="mt-1 w-full rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent" />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={!ready} className={btn.danger}>Record override</button>
              <button type="button" onClick={() => setOpen(false)} className={btn.quiet}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
