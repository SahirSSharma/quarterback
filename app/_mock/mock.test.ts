// The recorded demo runs (fixtures/runs/demo-*.json) are what replay mode shows judges; these checks keep them
// honest against the engine and the model registry, so a data or price change that invalidates them fails here.
import { describe, expect, it } from 'vitest';
import { demo, demoCards, demoIds, fixtureFor } from '@/app/api/_lib/mock';
import { applyAction } from '@/lib/agents/context';
import { catalogUnits } from '@/lib/engine/data';
import { offeringStatus } from '@/lib/engine/offerings';
import { demoStudents, earnedCodes } from '@/lib/engine/student';
import { deadlinesFor } from '@/lib/engine/terms';
import { verify } from '@/lib/engine/verifier';
import { MODELS, price } from '@/lib/tf/models';

describe.each(demoIds)('recorded demo %s', (id) => {
  const f = demo(id);

  it('is the demo student the Start page offers, in the situation its card names', () => {
    expect(f.demo).toBe(id);
    expect(demoStudents()).toContainEqual(f.state);
    const card = demoCards.find((c) => c.id === id)!;
    expect(card.headline).toEqual({ kind: f.action.kind, course: f.action.course });
    const wip = f.state.courses.filter((c) => c.term === f.state.currentTerm && c.status === 'wip');
    expect(wip.length).toBeGreaterThanOrEqual(3);
    expect(wip.map((c) => c.code)).toContain(f.action.course);
    for (const code of wip.map((c) => c.code)) expect(card.blurb).toContain(code);
    expect(fixtureFor(f.state, f.action)).toBe(f);
    expect(fixtureFor(f.state, { kind: 'pnp', course: f.action.course })).toBeNull();
    expect(fixtureFor({ ...f.state, source: 'paste' }, f.action)).toBeNull();
  });

  it('shows only plans the verifier still passes against the post-action record, and counts the rejected drafts', () => {
    const after = applyAction(f.state, f.action);
    expect(f.plans.length).toBeGreaterThanOrEqual(1);
    expect(new Set(f.plans.map((p) => p.id)).size).toBe(f.plans.length);
    for (const p of f.plans) {
      const stored = f.reports.find((r) => r.planId === p.id);
      expect(stored?.ok, `stored report for ${p.id}`).toBe(true);
      const fresh = verify(p, after);
      expect(fresh.violations.filter((v) => v.severity === 'error'), `${p.id} re-verified`).toEqual([]);
      expect(fresh.ok).toBe(true);
    }
    expect(f.rejectedDrafts).toBe(f.reports.filter((r) => !r.ok).length);
    for (const r of f.reports) if (!r.ok) expect(f.plans.map((p) => p.id)).not.toContain(r.planId);
  });

  it('sums term units from the catalog and never plans a course already earned', () => {
    const earned = earnedCodes(f.state);
    for (const p of f.plans) {
      for (const t of p.terms) {
        const units = t.courses.map((c) => catalogUnits(c));
        expect(units, `${p.id} ${t.term} ${t.courses.join(',')}`).not.toContain(null);
        expect(units.reduce((s, u) => s! + u!, 0)).toBe(t.units);
        for (const c of t.courses) expect(earned.has(c), `${c} already earned`).toBe(false);
      }
    }
  });

  it('recommends a shown plan and quotes only stored offering evidence in refusals', () => {
    const ids = f.plans.map((p) => p.id);
    expect(f.verdict.recommend === null || ids.includes(f.verdict.recommend)).toBe(true);
    expect(f.verdict.summary.length).toBeGreaterThan(20);
    for (const r of f.verdict.refused) {
      expect(ids).toContain(r.planId);
      expect(r.planId).not.toBe(f.verdict.recommend);
      expect(r.evidence.length).toBeGreaterThanOrEqual(1);
      // Vacuous today: no recorded verdict refuses a plan (notes/agents.md). Kept so a re-recording is checked.
      for (const e of r.evidence) expect(e.quote).toBe(offeringStatus(e.course, e.term).quote);
    }
  });

  it('prices every ledger entry from lib/tf/models.ts on a registry model', () => {
    expect(f.ledger.length).toBeGreaterThanOrEqual(2);
    for (const e of f.ledger) {
      expect(MODELS[e.model], e.model).toBeDefined();
      expect(e.usd).toBeCloseTo(price(e.model, { prompt_tokens: e.promptTokens, completion_tokens: e.completionTokens }), 9);
      expect(e.promptTokens).toBeGreaterThan(0);
      expect(e.ms).toBeGreaterThan(0);
    }
    // Lightning drafts, Super repairs only when a draft fails (lib/agents/planner.ts DEFAULT_OPTIONS).
    const plan = f.ledger.filter((e) => e.step === 'plan');
    expect(plan.every((e) => /lightning|super/i.test(e.model))).toBe(true);
    expect(plan.some((e) => /lightning/i.test(e.model))).toBe(true);
    expect(f.ledger.filter((e) => e.step === 'stress-test').map((e) => e.model)).toEqual([expect.stringMatching(/ultra/i)]);
  });

  it('recorded a planner trace that starts with a step, verifies every draft and ends with done', () => {
    const plan = f.events.filter((e) => e.event.step === 'plan');
    expect(plan[0].event.type).toBe('step');
    // A Lightning draft may submit without a lookup; any lookup it makes is one of the planner's tools and is answered.
    const calls = plan.filter((e) => e.event.type === 'tool_call');
    for (const c of calls) expect(['eligible_courses', 'check_prereqs', 'offering_status']).toContain((c.event as { name: string }).name);
    expect(plan.filter((e) => e.event.type === 'tool_result')).toHaveLength(calls.length);
    expect(plan.filter((e) => e.event.type === 'verifier')).toHaveLength(f.reports.length);
    expect(plan.filter((e) => e.event.type === 'done')).toHaveLength(1);
    expect(plan.at(-1)!.event.type).toBe('done');
    expect(plan.some((e) => e.event.type === 'error')).toBe(false);
    for (let i = 1; i < f.events.length; i++) expect(f.events[i].t).toBeGreaterThanOrEqual(f.events[i - 1].t);
    const modelEntries = f.events.flatMap((e) => (e.event.type === 'model' && e.event.step === 'plan' ? [e.event.entry] : []));
    expect(modelEntries).toEqual(f.ledger.filter((e) => e.step === 'plan'));
    expect(f.errors).toEqual([]);
  });

  it('carries an impact for the current term whose deadlines the calendar still reproduces', () => {
    expect(f.impact.action).toEqual(f.action);
    expect(f.impact.course.code).toBe(f.action.course);
    expect(f.impact.deadlines.map((d) => d.term)).toEqual(f.impact.deadlines.map(() => f.state.currentTerm));
    expect(deadlinesFor(f.state.currentTerm, f.now)).toEqual(f.impact.deadlines);
  });
});
