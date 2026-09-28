'use client';

import type { ApproveResponse, SaveResponse } from '@/app/lib/contracts';
import { btn, Card, Notice } from './ui';

export function ActionsPanel({ approval, saved, busy, deleted, onSave, onDelete }: {
  approval: ApproveResponse;
  saved: SaveResponse | null;
  busy: boolean;
  deleted: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  if (deleted) {
    return <Notice tone="neutral">Your data has been deleted. Nothing about this session is kept.</Notice>;
  }
  const shareUrl = saved ? `${typeof window !== 'undefined' ? window.location.origin : ''}${saved.url}` : null;
  return (
    <Card tone="accent">
      <h3 className="text-base font-semibold text-ink">Approved. Where should it go?</h3>
      <p className="mt-1 text-sm text-ink-2">Approval <span className="font-mono text-xs">{approval.approvalId}</span>. Each action uses this approval; nothing was sent yet.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={approval.importUrl} target="_blank" rel="noopener noreferrer" className={btn.primary}>Send to TritonPlan</a>
        <a href={approval.icsUrl} download className={btn.secondary}>Download .ics</a>
        <a href={approval.mailto} className={btn.secondary}>Draft advisor email</a>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button type="button" onClick={onSave} disabled={busy || !!saved} className={btn.secondary}>{saved ? 'Saved' : 'Save'}</button>
        <button type="button" onClick={onDelete} disabled={busy} className={btn.danger}>Delete my data</button>
        {shareUrl && (
          <p className="text-sm text-ink-2">
            Shareable link: <a href={saved!.url} className="font-mono text-xs text-accent underline-offset-2 hover:underline">{shareUrl}</a>
          </p>
        )}
        {!saved && <p className="text-xs text-ink-3">Nothing is stored until you save.</p>}
      </div>
    </Card>
  );
}
