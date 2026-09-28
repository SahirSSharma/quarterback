import type { ApprovalRecord, Plan, Verdict, VerifierReport } from '@/lib/types';
import type { CatalogTitles } from '@/app/lib/contracts';
import { formatUnits, termName } from '@/app/lib/format';
import { VerifierChecklist } from './VerifierChecklist';
import { Tag } from './ui';

export const planLabel = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

export function PlanColumns({
  plans, reports, verdict, titles, selectedPlanId, onSelect, overrides,
}: {
  plans: Plan[];
  reports: VerifierReport[];
  verdict: Verdict | null;
  titles: CatalogTitles;
  selectedPlanId: string | null;
  onSelect: (planId: string) => void;
  overrides: ApprovalRecord['overrides'];
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{plans.length === 0 ? 'No plans to show.' : `${plans.length} plan${plans.length === 1 ? '' : 's'} passed every check.`}</p>
      {/* min-w-0: a fieldset defaults to min-inline-size: min-content, and a nowrap course title would widen it past a phone. */}
      <fieldset className="min-w-0 space-y-4">
        <legend className="sr-only">Choose a plan</legend>
        {plans.map((plan) => {
          const report = reports.find((r) => r.planId === plan.id);
          const recommended = verdict?.recommend === plan.id;
          const refused = verdict?.refused.some((r) => r.planId === plan.id) ?? false;
          const overridden = overrides.some((o) => o.refusalPlanId === plan.id);
          const selectable = !refused || overridden;
          const selected = selectedPlanId === plan.id;
          const inputId = `plan-${plan.id}`;
          return (
            <article
              key={plan.id}
              aria-labelledby={`${inputId}-title`}
              className={`rounded-xl border bg-surface p-5 shadow-[0_1px_2px_rgb(28_25_23/0.04)] transition-colors ${
                selected ? 'border-accent ring-1 ring-accent/30' : recommended ? 'border-accent/40' : refused && !overridden ? 'border-danger/30 opacity-90' : 'border-line'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <label htmlFor={inputId} className={`flex items-start gap-3 ${selectable ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                  <input
                    id={inputId}
                    type="radio"
                    name="plan"
                    value={plan.id}
                    checked={selected}
                    disabled={!selectable}
                    onChange={() => onSelect(plan.id)}
                    className="mt-1 h-4 w-4 accent-accent"
                  />
                  <span>
                    <span id={`${inputId}-title`} className="block text-lg font-semibold tracking-tight text-ink">{planLabel(plan.label)}</span>
                    <span className="block text-sm text-ink-2">
                      {plan.graduationTerm ? `Graduates ${termName(plan.graduationTerm)}` : 'Graduation term not estimated'}
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {recommended && <Tag tone="accent">Recommended</Tag>}
                  {refused && <Tag tone="danger">Refused</Tag>}
                  {overridden && <Tag tone="warn">Override recorded</Tag>}
                  {report && report.violations.length > 0 && <Tag tone="warn">{report.violations.length} note{report.violations.length === 1 ? '' : 's'}</Tag>}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {plan.terms.map((t) => (
                  <section key={t.term} aria-label={termName(t.term)} className="min-w-0 rounded-lg border border-line bg-bg/60 p-3">
                    <header className="flex items-baseline justify-between gap-2">
                      <h4 className="text-sm font-medium text-ink">{termName(t.term)}</h4>
                      <span className="text-xs tabular-nums text-ink-2">{formatUnits(t.units)}</span>
                    </header>
                    <ul className="mt-2 space-y-1.5">
                      {t.courses.map((code) => (
                        <li key={code} className="text-sm leading-5">
                          <span className="font-medium text-ink">{code}</span>
                          <span className="block min-h-4 truncate text-xs text-ink-2" title={titles[code]?.title}>{titles[code]?.title ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <p className="mt-4 text-sm leading-6 text-ink-2">{plan.rationale}</p>
              <div className="mt-4 border-t border-line pt-4">
                <VerifierChecklist report={report} />
              </div>
            </article>
          );
        })}
      </fieldset>
    </div>
  );
}
