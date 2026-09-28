'use client';

import { useEffect } from 'react';
import type { TermCode } from '@/lib/types';
import type { ApproveResponse, SaveResponse } from '@/app/lib/contracts';
import { icsCoverage } from '@/app/lib/deadlines';
import { termName } from '@/app/lib/format';
import { btn, Card } from './ui';

const list = (terms: TermCode[]) => {
  const names = terms.map(termName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
};

export function ActionsPanel({ approval, planHash, planTerms, currentTerm, saved, busy, onSave, onDelete }: {
  approval: ApproveResponse;
  /** The approval record's fingerprint (sha256 of the plan), shown as its first eight characters. */
  planHash: string | null;
  planTerms: TermCode[];
  currentTerm: TermCode;
  saved: SaveResponse | null;
  busy: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  // Save disables itself once saved, which would drop keyboard focus; the link it produced takes it.
  useEffect(() => { if (saved) document.getElementById('share-link')?.focus({ preventScroll: true }); }, [saved]);
  const shareUrl = saved ? `${typeof window !== 'undefined' ? window.location.origin : ''}${saved.url}` : null;
  const importHost = (() => { try { return new URL(approval.importUrl).host; } catch { return approval.importUrl; } })();
  const { dated, undated } = icsCoverage(planTerms);
  return (
    <Card tone="accent">
      <h3 id="actions-heading" tabIndex={-1} className="rounded text-base font-semibold text-ink">Approved. Where should it go?</h3>
      <p className="mt-1 text-sm text-ink-2">
        Approval <span className="font-mono text-xs">{approval.approvalId}</span>
        {planHash ? <> · plan <span className="font-mono text-xs" title={planHash}>{planHash.slice(0, 8)}</span></> : null}. Each action uses this approval; nothing was sent yet.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        <li>
          <a href={approval.importUrl} target="_blank" rel="noopener noreferrer" className={`${btn.primary} w-full`}>Send to TritonPlan</a>
          <p className="mt-1.5 text-xs leading-5 text-ink-3">opens TritonPlan · <span className="font-mono">{importHost}</span>. You confirm there before anything is written.</p>
        </li>
        <li>
          <a href={approval.icsUrl} download className={`${btn.secondary} w-full`}>Download .ics</a>
          <p className="mt-1.5 text-xs leading-5 text-ink-3">
            {termName(currentTerm)} deadlines{dated.length > 0 ? ` and courses for ${list(dated)}` : ''}.
            {undated.length > 0 ? ` ${list(undated)} ${undated.length === 1 ? 'is' : 'are'} listed but not dated: the published calendar does not reach ${undated.length === 1 ? 'it' : 'them'} yet.` : ''}
          </p>
        </li>
        <li>
          <a href={approval.mailto} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} w-full`}>Draft advisor email</a>
          <p className="mt-1.5 text-xs leading-5 text-ink-3">Opens your mail app in a new tab with the plan and two questions. You choose the recipient and send it.</p>
        </li>
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button type="button" onClick={onSave} disabled={busy || !!saved} className={btn.secondary}>{saved ? 'Saved' : 'Save'}</button>
        <button type="button" onClick={onDelete} disabled={busy} className={btn.danger}>Delete my data</button>
        {shareUrl && (
          <p className="min-w-0 text-sm text-ink-2">
            Shareable link: <a id="share-link" href={saved!.url} className="break-all font-mono text-xs text-accent underline-offset-2 hover:underline">{shareUrl}</a>
          </p>
        )}
        <p className="text-xs text-ink-3">Your record is kept only as part of this plan and only until you delete it; Save adds a share link.</p>
      </div>
    </Card>
  );
}
