// Tiny shared building blocks so every step, card and button looks the same.
import type { ReactNode } from 'react';

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50',
  quiet:
    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-danger/30 bg-surface px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50',
};

export function Card({ children, className = '', tone = 'default' }: { children: ReactNode; className?: string; tone?: 'default' | 'accent' | 'danger' | 'warn' }) {
  const tones = {
    default: 'border-line bg-surface',
    accent: 'border-accent/40 bg-surface ring-1 ring-accent/20',
    danger: 'border-danger/30 bg-surface',
    warn: 'border-warn/30 bg-surface',
  };
  return <div className={`rounded-xl border p-5 shadow-[0_1px_2px_rgb(28_25_23/0.04)] ${tones[tone]} ${className}`}>{children}</div>;
}

export function Tag({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'bg-bg text-ink-2 ring-line-2',
    accent: 'bg-accent-soft text-accent ring-accent/20',
    warn: 'bg-warn-soft text-warn ring-warn/20',
    danger: 'bg-danger-soft text-danger ring-danger/20',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]} ${className}`}>{children}</span>;
}

export function StepHeading({ n, title, hint, id }: { n: number; title: string; hint?: string; id: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      </div>
    </div>
  );
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'accent' }) {
  const tones = {
    neutral: 'border-line bg-bg text-ink-2',
    warn: 'border-warn/30 bg-warn-soft text-warn',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    accent: 'border-accent/30 bg-accent-soft text-accent-2',
  };
  return <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}
