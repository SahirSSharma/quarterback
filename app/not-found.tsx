import Link from 'next/link';
import { btn } from './components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">That page is not here.</h1>
      <p className="mt-3 text-sm text-ink-2">Saved plans live at /plan/&lt;id&gt;; a deleted plan is gone for good.</p>
      <Link href="/" className={`${btn.primary} mt-6`}>Back to start</Link>
    </div>
  );
}
