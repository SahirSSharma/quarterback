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
        Processed in memory. Stored only if you choose Save, and you can delete it any time.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="submit" disabled={busy || text.trim().length === 0} className={`${btn.primary} self-start`}>
        {busy ? 'Reading…' : 'See what a drop costs'}
      </button>
    </form>
  );
}
