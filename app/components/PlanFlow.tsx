'use client';

// The whole plan flow's state lives in this one reducer. Steps render top to bottom as data arrives:
// situation → impact → re-plan (trace + plans) → stress-test verdict → review & approve → actions.

import Link from 'next/link';
import { useEffect, useReducer, useState } from 'react';
import type { Plan, StudentState, TraceEvent } from '@/lib/types';
import type { DemoId } from '@/app/lib/contracts';
import { api } from '@/app/lib/api';
import { deadlinesFor } from '@/app/lib/deadlines';
import { currentCourses, initial, reduce, type Kind } from '@/app/lib/flow';
import { formatDate, formatUnits, termName } from '@/app/lib/format';
import { planHash } from '@/app/lib/planHash';
import { ActionsPanel } from './ActionsPanel';
import { ApproveDialog } from './ApproveDialog';
import { DeadlineChips } from './DeadlineChips';
import { ImpactCard } from './ImpactCard';
import { Ledger } from './Ledger';
import { PASTE_KEY } from './PasteForm';
import { PlanColumns, planLabel } from './PlanColumns';
import { RefusalCard } from './RefusalCard';
import { ImpactSkeleton, Line, PlansSkeleton } from './Skeletons';
import { TracePanel } from './TracePanel';
import { VerifierChecklist } from './VerifierChecklist';
import { btn, Card, Notice, StepHeading, Tag } from './ui';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'drop', label: 'Drop' },
  { kind: 'pnp', label: 'Switch to P/NP' },
  { kind: 'keep', label: 'Keep' },
];

export function PlanFlow({ demo, initialCourse = null, initialKind = 'drop', savedId }: {
  demo?: DemoId; initialCourse?: string | null; initialKind?: Kind; savedId?: string;
}) {
  const [s, dispatch] = useReducer(reduce, initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now] = useState(() => new Date());

  // 1. Who are we planning for?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (savedId) {
          const run = await api.run(savedId);
          if (!cancelled) dispatch({ type: 'hydrate', run });
        } else if (demo) {
          const state = await api.intake({ demo });
          if (!cancelled) dispatch({ type: 'student', state, course: initialCourse, kind: initialKind });
        } else {
          const raw = sessionStorage.getItem(PASTE_KEY);
          if (!raw) throw new Error('empty');
          dispatch({ type: 'student', state: JSON.parse(raw) as StudentState, course: initialCourse, kind: initialKind });
        }
      } catch (e) {
        if (!cancelled) dispatch({ type: 'load-error', message: e instanceof Error && e.message !== 'empty' ? e.message : '' });
      }
    })();
    return () => { cancelled = true; };
  }, [savedId, demo, initialCourse, initialKind]);

  // 2. Impact is instant and free: fetch it whenever the situation changes.
  const { student, course, kind, readOnly, runId, traceDone, run } = s;
  useEffect(() => {
    if (!student || !course || readOnly) return;
    const ctrl = new AbortController();
    dispatch({ type: 'impact-loading' });
    api.impact(student, { kind, course }, ctrl.signal)
      .then((impact) => dispatch({ type: 'impact', impact }))
      .catch((e) => { if (!(e instanceof DOMException && e.name === 'AbortError')) dispatch({ type: 'error', message: message(e) }); });
    return () => ctrl.abort();
  }, [student, course, kind, readOnly]);

  // 3. Stream the trace, then load the finished run.
  useEffect(() => {
    if (!runId || traceDone) return;
    const es = new EventSource(`/api/trace/${encodeURIComponent(runId)}`);
    const finish = () => {
      es.close();
      api.run(runId).then((r) => dispatch({ type: 'run', run: r })).catch((e) => dispatch({ type: 'error', message: message(e) }));
    };
    es.onmessage = (m) => {
      const event = JSON.parse(m.data) as TraceEvent;
      dispatch({ type: 'trace', event });
      if (event.type === 'done' || event.type === 'error') finish();
    };
    es.onerror = () => {
      // The stub's plans are complete as soon as the run exists, so a dropped stream is not fatal.
      dispatch({ type: 'trace', event: { type: 'done', step: 'plan', at: new Date().toISOString() } });
      finish();
    };
    return () => es.close();
  }, [runId, traceDone]);

  // 4. Titles for plan courses (plans carry codes only).
  useEffect(() => {
    if (!run) return;
    const codes = [...new Set(run.plans.flatMap((p) => p.terms.flatMap((t) => t.courses)))];
    if (codes.length === 0) return;
    api.titles(codes).then((titles) => dispatch({ type: 'titles', titles })).catch(() => { /* titles are decoration */ });
  }, [run]);

  async function replan() {
    if (!student || !course) return;
    try {
      const { runId: id } = await api.plan(student, { kind, course });
      dispatch({ type: 'plan-start', runId: id });
    } catch (e) { dispatch({ type: 'error', message: message(e) }); }
  }

  async function stress() {
    if (!runId) return;
    dispatch({ type: 'stress-start' });
    try {
      const verdict = await api.stress(runId);
      const fresh = await api.run(runId);
      const known = new Set((s.run?.ledger ?? []).map((e) => e.at));
      for (const entry of fresh.ledger) if (!known.has(entry.at)) dispatch({ type: 'trace', event: { type: 'model', step: entry.step, at: entry.at, entry } });
      dispatch({ type: 'verdict', verdict, run: fresh });
    } catch (e) { dispatch({ type: 'error', message: message(e) }); }
  }

  async function approve() {
    if (!runId || !s.selectedPlanId) return;
    dispatch({ type: 'approve-start' });
    try {
      const approval = await api.approve(runId, s.selectedPlanId, s.overrides);
      const fresh = await api.run(runId).catch(() => null);
      dispatch({ type: 'approval', approval, run: fresh });
      setDialogOpen(false);
    } catch (e) { dispatch({ type: 'error', message: message(e) }); }
  }

  async function save() {
    if (!runId) return;
    dispatch({ type: 'busy' });
    try { dispatch({ type: 'saved', saved: await api.save(runId) }); } catch (e) { dispatch({ type: 'error', message: message(e) }); }
  }

  async function remove() {
    if (!runId || !window.confirm('Delete this run and anything saved from it? This cannot be undone.')) return;
    dispatch({ type: 'busy' });
    try {
      await api.remove(runId);
      sessionStorage.removeItem(PASTE_KEY);
      dispatch({ type: 'deleted' });
    } catch (e) { dispatch({ type: 'error', message: message(e) }); }
  }

  if (s.loadError !== null) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{savedId ? 'This saved plan is not here.' : 'Nothing to plan yet.'}</h1>
        <p className="mt-3 text-sm text-ink-2">
          {s.loadError || (savedId ? 'It may have been deleted, or the link is wrong.' : 'Paste your Academic History or pick a demo student to begin.')}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className={btn.primary}>Back to start</Link>
          <Link href="/plan?demo=a&course=CSE%2029&action=drop" className={btn.secondary}>Try the demo</Link>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10" role="status" aria-label="Loading your record">
        <Line w="w-1/2" h="h-8" /><Line w="w-1/3" h="h-4" className="mt-3" />
        <div className="mt-10 space-y-3"><Line w="w-1/4" h="h-5" /><Line h="h-10" /><Line w="w-2/3" h="h-10" /></div>
      </div>
    );
  }

  const wip = currentCourses(student);
  const deadlines = deadlinesFor(student.currentTerm, now);
  const plans = run?.plans ?? [];
  const selected = plans.find((p) => p.id === s.selectedPlanId) ?? null;
  const selectedReport = run?.reports.find((r) => r.planId === selected?.id);
  const recommended = plans.find((p) => p.id === s.verdict?.recommend) ?? null;
  const refusedPlans = (s.verdict?.refused ?? []).map((r) => plans.find((p) => p.id === r.planId)).filter((p): p is Plan => !!p);
  const comparison = refusedPlans.length > 0 ? refusedPlans[0] : plans.find((p) => p.id !== recommended?.id) ?? null;
  const showTrace = s.trace.length > 0 || !s.traceDone;
  const sourceLabel = student.source === 'demo' ? 'Demo record' : student.source === 'paste' ? 'From your paste' : 'Read by the intake model';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <header>
        <p className="text-sm font-medium text-accent">{termName(student.currentTerm)} · {sourceLabel}{s.readOnly ? ' · saved plan' : ''}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{student.major}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {student.college}{student.catalogYear ? ` · catalog ${student.catalogYear}` : ''}{student.gpa !== null ? ` · GPA ${student.gpa.toFixed(2)}` : ''} · {student.courses.filter((c) => c.status === 'earned').reduce((u, c) => u + c.units, 0)} units earned
        </p>
        {student.warnings.length > 0 && (
          <div className="mt-3 space-y-2">{student.warnings.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}</div>
        )}
        {student.confidence !== 'high' && (
          <p className="mt-2 text-xs text-ink-3">Confidence in this record: {student.confidence}. Check the major and college above before you rely on the numbers.</p>
        )}
      </header>

      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0 space-y-12">
          {/* 1 Situation */}
          <section aria-labelledby="step-1">
            <StepHeading n={1} id="step-1" title="Situation" hint={s.readOnly ? 'The situation this plan was made for.' : 'Pick the class and what you are considering.'} />
            <Card className="space-y-5">
              <fieldset disabled={s.readOnly}>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Your {termName(student.currentTerm)} courses</legend>
                <div className="flex flex-wrap gap-2">
                  {wip.map((c) => (
                    <label key={c.code} className="relative">
                      <input type="radio" name="course" value={c.code} checked={s.course === c.code} onChange={() => dispatch({ type: 'select', course: c.code })} className="peer sr-only" />
                      <span className="inline-flex cursor-pointer items-baseline gap-1.5 rounded-full border border-line-2 bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:border-ink-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-2 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:cursor-default peer-disabled:hover:border-line-2">
                        <span className="font-medium">{c.code}</span>
                        <span className="text-xs text-ink-2">{formatUnits(c.units)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {s.course && (
                  <p className="mt-2 min-h-5 text-sm text-ink-2">{wip.find((c) => c.code === s.course)?.title ?? ''}</p>
                )}
              </fieldset>

              <fieldset disabled={s.readOnly}>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Action</legend>
                <div className="inline-flex w-full max-w-md rounded-lg border border-line-2 bg-bg p-1 sm:w-auto" role="radiogroup">
                  {KINDS.map((k) => (
                    <label key={k.kind} className="relative flex-1 sm:flex-none">
                      <input type="radio" name="action" value={k.kind} checked={s.kind === k.kind} onChange={() => dispatch({ type: 'select', kind: k.kind })} className="peer sr-only" />
                      <span className="block cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium text-ink-2 transition-colors hover:text-ink peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:cursor-default">
                        {k.label}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Deadlines this quarter</h3>
                <DeadlineChips deadlines={deadlines} now={now} />
              </div>
            </Card>
          </section>

          {/* 2 Impact */}
          {s.course && (
            <section aria-labelledby="step-2">
              <StepHeading n={2} id="step-2" title="Impact" hint="Computed from your record, the catalog and department pages. No model involved." />
              {s.impact && !s.impactLoading ? <ImpactCard impact={s.impact} /> : <ImpactSkeleton />}
              {!s.readOnly && s.impact && !s.impactLoading && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={replan} disabled={s.planning || !!runId} className={btn.primary}>
                    {runId ? 'Re-planned below' : 'Re-plan the next three quarters'}
                  </button>
                  {!runId && <span className="text-xs text-ink-3">Proposes up to three plans and checks each one. About ten seconds.</span>}
                </div>
              )}
            </section>
          )}

          {/* 3 Re-plan */}
          {runId && s.impact && (
            <section aria-labelledby="step-3">
              <StepHeading n={3} id="step-3" title="Re-plan" hint="Plans are proposed, then checked. Only plans that pass every check appear here." />
              {showTrace && <div className="mb-4 lg:hidden"><TracePanel events={s.trace} live={!s.traceDone} /></div>}
              {run ? (
                <PlanColumns
                  plans={plans}
                  reports={run.reports}
                  verdict={s.verdict}
                  titles={s.titles}
                  rejectedDrafts={run.rejectedDrafts}
                  selectedPlanId={s.selectedPlanId}
                  onSelect={(planId) => dispatch({ type: 'select-plan', planId })}
                  overrides={s.overrides}
                />
              ) : (
                <PlansSkeleton />
              )}
              {run && !s.verdict && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={stress} disabled={s.stressing} className={btn.primary}>{s.stressing ? 'Stress-testing…' : 'Stress-test these plans'}</button>
                  <span className="text-xs text-ink-3">Reads every plan against the offering evidence and recommends or refuses. One call.</span>
                </div>
              )}
            </section>
          )}

          {/* 4 Verdict */}
          {s.verdict && run && (
            <section aria-labelledby="step-4">
              <StepHeading n={4} id="step-4" title="Verdict" hint="A recommendation, and any plan refused with the department line that refused it." />
              <Card tone="accent">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="accent">Recommended</Tag>
                  <h3 className="text-base font-semibold text-ink">{recommended ? `${planLabel(recommended.label)} plan` : 'No plan recommended'}</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink-2">{s.verdict.summary}</p>
                {s.verdict.risks.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-ink-3">Risks to keep in view</h4>
                    <ul className="mt-1.5 space-y-1.5 text-sm leading-6 text-ink-2">
                      {s.verdict.risks.map((r, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-ink-3">—</span><span>{r}</span></li>)}
                    </ul>
                  </div>
                )}
              </Card>
              {s.verdict.refused.length > 0 && (
                <div className="mt-4 space-y-4">
                  {s.verdict.refused.map((r) => (
                    <RefusalCard
                      key={r.planId}
                      refusal={r}
                      plan={plans.find((p) => p.id === r.planId)}
                      override={s.overrides.find((o) => o.refusalPlanId === r.planId)}
                      onOverride={(o) => dispatch({ type: 'override', override: o })}
                      disabled={!!s.approval}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 5 Review & approve */}
          {s.verdict && run && s.impact && (
            <section aria-labelledby="step-5">
              <StepHeading n={5} id="step-5" title="Review & approve" hint="Nothing leaves this page until you approve." />
              <div className="grid gap-4 md:grid-cols-2">
                <PlanSummary plan={recommended} tag={<Tag tone="accent">Recommended</Tag>} empty="No recommendation." />
                <PlanSummary
                  plan={comparison}
                  tag={comparison && refusedPlans.includes(comparison) ? <Tag tone="danger">Refused</Tag> : <Tag>Alternative</Tag>}
                  empty="No other plan to compare."
                />
              </div>

              <Card className="mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-ink">{selected ? `Selected: ${planLabel(selected.label)} plan` : 'Select a plan above'}</h3>
                  {selected && <span className="font-mono text-xs text-ink-3">plan {planHash(selected.terms)}</span>}
                </div>
                {selected && (
                  <div className="mt-3 border-t border-line pt-3"><VerifierChecklist report={selectedReport} /></div>
                )}
                <div className="mt-4 border-t border-line pt-4 text-sm leading-6 text-ink-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-ink-3">What you would be approving</h4>
                  <p className="mt-1">
                    {s.impact.action.kind === 'drop' ? 'Drop' : s.impact.action.kind === 'pnp' ? 'Switch to P/NP' : 'Keep'} {s.impact.course.code} → {formatUnits(s.impact.unitsAfter)} this quarter{s.impact.belowFullTime ? ', below the full-time floor' : ''}.
                    {' '}{s.impact.blocks.length === 0 ? 'No downstream course moves.' : `${s.impact.blocks.length} downstream course${s.impact.blocks.length === 1 ? '' : 's'} move; longest chain ${s.impact.chainQuartersBefore} → ${s.impact.chainQuartersAfter} quarters.`}
                    {selected?.graduationTerm ? ` The selected plan graduates ${termName(selected.graduationTerm)}.` : ''}
                    {s.overrides.length > 0 ? ` ${s.overrides.length} override${s.overrides.length === 1 ? '' : 's'} will be recorded.` : ''}
                  </p>
                </div>
              </Card>

              <div className="mt-6">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Ledger</h3>
                <Ledger entries={run.ledger} />
              </div>

              {run.approval && !s.approval && (
                <div className="mt-6">
                  <Notice tone="accent">
                    Approved {formatDate(run.approval.at)} · plan <span className="font-mono text-xs">{run.approval.planHash}</span>
                    {run.approval.overrides.length > 0 ? ` · ${run.approval.overrides.length} override${run.approval.overrides.length === 1 ? '' : 's'}` : ''} ·{' '}
                    <a href={`/api/ics/${run.approval.id}`} className="underline underline-offset-2">Download .ics</a>
                  </Notice>
                </div>
              )}

              {s.error && <div className="mt-4"><Notice tone="danger">{s.error}</Notice></div>}

              {!s.approval ? (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => setDialogOpen(true)} disabled={!selected || s.approving} className={btn.primary}>
                    {run.approval ? 'Approve again' : 'Approve'}{selected ? ` the ${planLabel(selected.label)} plan` : ''}
                  </button>
                  <span className="text-xs text-ink-3">Opens a summary to confirm. Actions unlock after approval.</span>
                </div>
              ) : (
                <div className="mt-6">
                  <ActionsPanel approval={s.approval} saved={s.saved} busy={s.busy} deleted={s.deleted} onSave={save} onDelete={remove} />
                </div>
              )}

              <ApproveDialog
                open={dialogOpen}
                plan={selected}
                report={selectedReport}
                impact={s.impact}
                verdict={s.verdict}
                overrides={s.overrides}
                busy={s.approving}
                onClose={() => setDialogOpen(false)}
                onConfirm={approve}
              />
            </section>
          )}

          {s.error && !(s.verdict && run) && <Notice tone="danger">{s.error}</Notice>}
        </div>

        <aside className="hidden lg:block" aria-label="Trace">
          {runId && showTrace && <div className="sticky top-6"><TracePanel events={s.trace} live={!s.traceDone} /></div>}
        </aside>
      </div>
    </div>
  );
}

function PlanSummary({ plan, tag, empty }: { plan: Plan | null; tag: React.ReactNode; empty: string }) {
  if (!plan) return <Card><p className="text-sm text-ink-3">{empty}</p></Card>;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{planLabel(plan.label)} plan</h3>
        {tag}
      </div>
      <p className="mt-0.5 text-sm text-ink-2">{plan.graduationTerm ? `Graduates ${termName(plan.graduationTerm)}` : 'Graduation term not estimated'}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {plan.terms.map((t) => (
          <li key={t.term} className="flex items-baseline justify-between gap-3">
            <span><span className="font-medium text-ink">{termName(t.term)}</span> <span className="text-ink-2">· {t.courses.join(', ')}</span></span>
            <span className="shrink-0 text-xs tabular-nums text-ink-2">{formatUnits(t.units)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
