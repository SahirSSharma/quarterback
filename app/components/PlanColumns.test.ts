// A 'code-built' plan (the engine's fallback when no proposed plan passes) is not in any recording yet, so its tag
// is pinned here with react-dom/server.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Plan, Verdict, VerifierReport } from '@/lib/types';
import { PlanColumns } from './PlanColumns';

const plan = (id: string, label: string): Plan => ({ id, label, terms: [{ term: 'WI27', courses: ['CSE 30', 'CSE 21'], units: 8 }], rationale: 'Because.', graduationTerm: 'SP28' });
const ok = (planId: string): VerifierReport => ({ planId, ok: true, violations: [] });
const render = (plans: Plan[], verdict: Verdict | null) =>
  renderToStaticMarkup(createElement(PlanColumns, { plans, reports: plans.map((p) => ok(p.id)), verdict, titles: {}, selectedPlanId: null, onSelect: () => {}, overrides: [] }));

describe('PlanColumns', () => {
  it('tags a code-built plan and explains it in one sentence, keeping the recommended styling', () => {
    const out = render([plan('p-code-built', 'code-built')], { recommend: 'p-code-built', refused: [], risks: [], summary: '' });
    expect(out).toContain('Built by the verifier’s rules');
    expect(out).toContain('None of the proposed plans passed every check');
    expect(out).toContain('Recommended');
    expect(out).toContain('Code-built');
  });

  it('leaves a drafted plan untagged', () => {
    const out = render([plan('p-fastest', 'fastest')], null);
    expect(out).not.toContain('Built by the verifier');
    expect(out).toContain('1 plan passed every check.');
  });
});
