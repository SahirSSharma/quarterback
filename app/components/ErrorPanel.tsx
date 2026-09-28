'use client';

import Link from 'next/link';
import { btn } from './ui';

export function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Something went wrong on this page.</h1>
      <p className="mt-3 text-sm text-ink-2">{error.message || 'An unexpected error occurred.'}</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-ink-3">ref {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className={btn.primary}>Try again</button>
        <Link href="/" className={btn.secondary}>Back to start</Link>
      </div>
    </div>
  );
}
