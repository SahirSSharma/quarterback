import type { VerifierReport, Violation } from '@/lib/types';

/** The rule set from DESIGN.md, in the order a student would ask about it. */
const CHECKS: { label: string; rules: string[] }[] = [
  { label: 'Prerequisites done by the quarter they are needed', rules: ['prereq-unsatisfied'] },
  { label: 'Every course sits in a quarter its department lists it', rules: ['not-offered', 'assumed-offered'] },
  { label: 'Between 12 and 19.5 units each quarter', rules: ['unit-floor', 'unit-cap'] },
  { label: 'No course repeated or already earned', rules: ['duplicate', 'already-earned'] },
  { label: 'No course counted twice across requirements', rules: ['double-count'] },
  { label: 'Graduation still reachable in the quarters left', rules: ['graduation-infeasible'] },
];

type State = 'pass' | 'warn' | 'fail';

function stateOf(violations: Violation[]): State {
  if (violations.some((v) => v.severity === 'error')) return 'fail';
  if (violations.length > 0) return 'warn';
  return 'pass';
}

const glyph: Record<State, { char: string; cls: string; label: string }> = {
  pass: { char: '✓', cls: 'bg-accent-soft text-accent', label: 'passed' },
  warn: { char: '!', cls: 'bg-warn-soft text-warn', label: 'warning' },
  fail: { char: '✕', cls: 'bg-danger-soft text-danger', label: 'failed' },
};

export function VerifierChecklist({ report, compact = false }: { report: VerifierReport | undefined; compact?: boolean }) {
  if (!report) return <p className="text-sm text-ink-3">No verifier report for this plan.</p>;
  return (
    <ul className={`grid gap-1.5 ${compact ? '' : 'sm:grid-cols-2'}`} aria-label="Verifier checks">
      {CHECKS.map((c) => {
        const hits = report.violations.filter((v) => c.rules.includes(v.rule));
        const s = stateOf(hits);
        const g = glyph[s];
        return (
          <li key={c.label} className="flex items-start gap-2 text-sm">
            <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${g.cls}`}>{g.char}</span>
            <span className="sr-only">{g.label}: </span>
            <span className="text-ink-2">
              {c.label}
              {hits.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {hits.map((v, i) => (
                    <li key={i} className={`text-xs leading-5 ${v.severity === 'error' ? 'text-danger' : 'text-warn'}`}>
                      {v.course ? <span className="font-medium">{v.course}{v.term ? ` · ${v.term}` : ''}: </span> : v.term ? <span className="font-medium">{v.term}: </span> : null}
                      {v.message}
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
