'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/app/lib/api';
import { btn, Notice } from './ui';

export const PASTE_KEY = 'qb.state';

export function PasteForm() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const state = await api.intake({ text });
      sessionStorage.setItem(PASTE_KEY, JSON.stringify(state));
      router.push('/plan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-3">
      <label htmlFor="history" className="text-sm font-medium text-ink">
        Paste your Academic History from TritonLink
      </label>
      <details className="text-xs text-ink-2">
        <summary className="qb-summary cursor-pointer font-medium text-accent underline-offset-2 hover:underline">How to copy your Academic History from TSS</summary>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 leading-5">
          <li>In TritonLink, open the <span className="font-medium text-ink">Academic History</span> page.</li>
          <li>Select all on the page (⌘A on a Mac, Ctrl+A on Windows) and copy.</li>
          <li>Paste it into the box below and continue.</li>
        </ol>
      </details>
      <textarea
        id="history"
        name="history"
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        rows={7}
        spellCheck={false}
        placeholder={'Select everything on the Academic History page, copy, and paste here.\n\nFall 2026\nCSE 29  Systems Programming and Software Tools  4.00  IP\n…'}
        className="min-h-40 w-full flex-1 resize-y rounded-lg border border-line-2 bg-surface px-3 py-2 font-mono text-[13px] leading-5 text-ink placeholder:text-ink-3 focus:border-accent"
      />
      <p className="text-xs leading-5 text-ink-3">
        Your record is kept only as part of this plan and only until you delete it; Save adds a share link.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="submit" disabled={busy || text.trim().length === 0} className={`${btn.primary} self-start`}>
        {busy ? 'Reading…' : 'See what a drop costs'}
      </button>
    </form>
  );
}
