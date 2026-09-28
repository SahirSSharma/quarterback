import { describe, it, expect } from 'vitest';
import { initial, reduce, type Flow, type Msg } from './flow';
import type { RunRecord } from './contracts';
import { demo } from '@/app/api/_lib/mock';

const f = demo('a');
if (!f.verdict.recommend) throw new Error('the recorded demo (a) verdict recommends no plan; the reducer tests below need one');
const impact = { ...f.impact, deadlines: [] };
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
    expect(deep).toMatchObject({ runId: 'run_1', traceDone: true, selectedPlanId: f.verdict.recommend, overrides: [{ refusalPlanId: 'p-fastest' }] });
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
    expect(withVerdict).toMatchObject({ readOnly: true, traceDone: true, course: 'CSE 29', kind: 'drop', selectedPlanId: f.verdict.recommend, saved: { id: 'qb_1', url: '/plan/qb_1' } });
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

  it('drops the run and everything below it on delete, keeps the impact, and clears the flag on the next re-plan', () => {
    const deep = play([
      { type: 'student', state: f.state, course: 'CSE 29', kind: 'drop' },
      { type: 'impact', impact },
      { type: 'plan-start', runId: 'run_1' },
      { type: 'trace', event: { type: 'done', step: 'plan', at: 'now' } },
      { type: 'run', run: { ...run, verdict: f.verdict } },
      { type: 'approval', approval: { approvalId: 'apr_1', importUrl: 'u', icsUrl: 'i', mailto: 'm' }, run: null },
      { type: 'busy' },
    ]);
    const gone = reduce(deep, { type: 'deleted' });
    expect(gone).toMatchObject({ deleted: true, busy: false, runId: null, run: null, trace: [], traceDone: false, verdict: null, approval: null, saved: null, selectedPlanId: null });
    expect(gone.impact).toBe(deep.impact);
    expect(gone.student).toBe(deep.student);
    expect(reduce(gone, { type: 'plan-start', runId: 'run_2' })).toMatchObject({ deleted: false, runId: 'run_2' });
    expect(reduce(gone, { type: 'select', kind: 'pnp' }).deleted).toBe(false);
  });

  it('clears every busy flag on error', () => {
    const s = play([{ type: 'stress-start' }, { type: 'approve-start' }, { type: 'busy' }, { type: 'error', message: 'nope' }]);
    expect(s).toMatchObject({ stressing: false, approving: false, busy: false, error: 'nope' });
  });
});

describe('trace stream housekeeping', () => {
  const started = play([{ type: 'student', state: f.state, course: 'CSE 29', kind: 'drop' }, { type: 'plan-start', runId: 'run_1' }]);

  it('drops the events on a reconnect (the server replays from the start) without ending the trace', () => {
    let s = reduce(started, { type: 'trace', event: { type: 'step', step: 'plan', at: 'now', message: 'first' } });
    s = reduce(s, { type: 'trace-connection', reconnecting: true });
    expect(s.traceReconnecting).toBe(true);
    s = reduce(s, { type: 'trace-reset' });
    s = reduce(s, { type: 'trace-connection', reconnecting: false });
    expect(s).toMatchObject({ trace: [], traceDone: false, traceReconnecting: false, runId: 'run_1' });
  });

  it('adds a later model call to both the trace and the run ledger', () => {
    const entry = { ...f.ledger[0], step: 'explain', at: 'later' };
    let s = reduce(started, { type: 'trace', event: { type: 'done', step: 'plan', at: 'now' } });
    s = reduce(s, { type: 'run', run });
    s = reduce(s, { type: 'ledger', entry });
    expect(s.trace.at(-1)).toEqual({ type: 'model', step: 'explain', at: 'later', entry });
    expect(s.run?.ledger).toEqual([entry]);
    expect(s.traceDone).toBe(true);
  });
});
