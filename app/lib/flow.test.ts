import { describe, it, expect } from 'vitest';
import { initial, reduce, type Flow, type Msg } from './flow';
import type { RunRecord } from './contracts';
import { demo } from '@/app/api/_lib/mock';

const f = demo('a');
const impact = { ...f.impacts['drop:CSE 29'], deadlines: [] };
const run: RunRecord = {
  runId: 'run_1', state: f.state, action: { kind: 'drop', course: 'CSE 29' }, impact, plans: f.plans, reports: f.reports,
  rejectedDrafts: f.rejectedDrafts, verdict: null, ledger: [], approval: null,
};
const play = (msgs: Msg[], from: Flow = initial) => msgs.reduce(reduce, from);

describe('plan flow reducer', () => {
  it('loads a student and only accepts a preselected course that is in progress this term', () => {
    expect(play([{ type: 'student', state: f.state, course: 'CSE 29', kind: 'pnp' }])).toMatchObject({ course: 'CSE 29', kind: 'pnp', impact: null });
    expect(play([{ type: 'student', state: f.state, course: 'CSE 12', kind: 'drop' }]).course).toBeNull(); // earned, not wip
  });

  it('wipes everything downstream when the course or action changes, and nothing when it does not', () => {
    const deep = play([
      { type: 'student', state: f.state, course: 'CSE 29', kind: 'drop' },
      { type: 'impact', impact },
      { type: 'plan-start', runId: 'run_1' },
      { type: 'trace', event: { type: 'done', step: 'plan', at: 'now' } },
      { type: 'run', run: { ...run, verdict: f.verdict } },
      { type: 'override', override: { refusalPlanId: 'p-fastest', reason: 'ok', phrase: 'I understand' } },
      { type: 'approval', approval: { approvalId: 'apr_1', importUrl: 'u', icsUrl: 'i', mailto: 'm' }, run: null },
    ]);
    expect(deep).toMatchObject({ runId: 'run_1', traceDone: true, selectedPlanId: 'p-balanced', overrides: [{ refusalPlanId: 'p-fastest' }] });
    expect(deep.approval?.approvalId).toBe('apr_1');

    const same = reduce(deep, { type: 'select', course: 'CSE 29' });
    expect(same).toBe(deep);

    const changed = reduce(deep, { type: 'select', kind: 'pnp' });
    expect(changed).toMatchObject({ course: 'CSE 29', kind: 'pnp', impact: null, runId: null, run: null, trace: [], traceDone: false, verdict: null, selectedPlanId: null, overrides: [], approval: null, saved: null });
    expect(changed.student).toBe(deep.student);
  });

  it('hydrates a saved run read-only, selecting the recommendation or else the approved plan', () => {
    const approval = { id: 'apr_9', at: 'now', planHash: 'deadbeef', planId: 'p-lightest', overrides: [], ledger: [] };
    const withVerdict = reduce(initial, { type: 'hydrate', run: { ...run, verdict: f.verdict, approval, state: { ...f.state, id: 'qb_1' } } });
    expect(withVerdict).toMatchObject({ readOnly: true, traceDone: true, course: 'CSE 29', kind: 'drop', selectedPlanId: 'p-balanced', saved: { id: 'qb_1', url: '/plan/qb_1' } });
    const noVerdict = reduce(initial, { type: 'hydrate', run: { ...run, approval } });
    expect(noVerdict.selectedPlanId).toBe('p-lightest');
    expect(noVerdict.saved).toBeNull();
  });

  it('marks the trace done on done or error and keeps the selection when a run refresh arrives', () => {
    let s = play([{ type: 'student', state: f.state, course: 'CSE 29', kind: 'drop' }, { type: 'plan-start', runId: 'run_1' }]);
    s = reduce(s, { type: 'trace', event: { type: 'step', step: 'plan', at: 'now', message: 'hi' } });
    expect(s.traceDone).toBe(false);
    s = reduce(s, { type: 'trace', event: { type: 'error', step: 'plan', at: 'now', message: 'boom' } });
    expect(s.traceDone).toBe(true);
    s = reduce(s, { type: 'run', run });
    expect(s.planning).toBe(false);
    s = reduce(s, { type: 'verdict', verdict: f.verdict, run: { ...run, verdict: f.verdict } });
    s = reduce(s, { type: 'select-plan', planId: 'p-lightest' });
    s = reduce(s, { type: 'run', run: { ...run, verdict: f.verdict } });
    expect(s.selectedPlanId).toBe('p-lightest');
  });

  it('clears every busy flag on error', () => {
    const s = play([{ type: 'stress-start' }, { type: 'approve-start' }, { type: 'busy' }, { type: 'error', message: 'nope' }]);
    expect(s).toMatchObject({ stressing: false, approving: false, busy: false, error: 'nope' });
  });
});
