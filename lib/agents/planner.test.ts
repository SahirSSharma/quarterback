import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action, StudentState, TraceEvent } from '../types';
import { impact } from '../engine/impact';
import { demoStudents } from '../engine/student';
import { verify } from '../engine/verifier';
import { BudgetExceededError } from '../tf/budget';
import type { AssistantMessage, ChatMessage, ToolCall } from '../tf/client';
import type { Thinking } from '../tf/helpers';
import { makeEntry } from '../tf/ledger';
import { LIGHTNING, SUPER } from '../tf/models';
import { applyAction, type Strategy } from './context';
import { DEFAULT_OPTIONS, planRun, resolveOptions, toPlan, type PlannerTF } from './planner';
import type { DraftPlan, SubmitArgs } from './tools';

const NOW = '2026-10-01T12:00:00-07:00';
const demoA = demoStudents()[0];
const drop: Action = { kind: 'drop', course: 'CSE 29' };
const after = applyAction(demoA, drop);
const imp = impact(demoA, drop, NOW);

// CSE 100 and CSE 30 both need CSE 29, which was just dropped: two prereq-unsatisfied errors in WI27.
const BAD: SubmitArgs = {
  terms: [
    { term: 'wi27', courses: ['cse100', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
    { term: 'SP27', courses: ['CSE 101', 'CSE 151A', 'MATH 183'], units: 12 },
    { term: 'FA27', courses: ['CSE 150A', 'CSE 55', 'COGS 1'], units: 12 },
  ],
  rationale: 'too fast',
  graduationTerm: 'sp29',
};
const GOOD: SubmitArgs = {
  terms: [
    { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'], units: 16 },
    { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'MATH 183', 'HUM 5'], units: 16 },
    { term: 'FA27', courses: ['CSE 101', 'CSE 151A', 'CSE 55', 'COGS 1'], units: 16 },
  ],
  rationale: 'retake first',
  graduationTerm: null,
};
const ALL_GOOD = { fastest: [GOOD], balanced: [GOOD], lightest: [GOOD] };

type DraftMode = 'direct' | 'lookup' | 'prose' | 'invalid';
interface Script {
  /** How each draft's loop call ends: a direct submit_plan (default), one check_prereqs round, prose, or a submit_plan with bad arguments. */
  draft?: Partial<Record<Strategy, DraftMode>>;
  /** Per strategy, the submissions in order: the draft (direct or forced), then each repair. An Error is thrown instead. */
  submissions: Partial<Record<Strategy, (SubmitArgs | Error)[]>>;
}
interface Captured {
  fn: 'toolLoop' | 'forcedTool';
  role: string;
  label: Strategy;
  messages: ChatMessage[];
  thinking?: Thinking;
  tools?: string[];
  step: string;
}

const labelOf = (messages: ChatMessage[]): Strategy => {
  const user = messages.find((m) => m.role === 'user') as { content: string };
  return /Draft the (FASTEST|BALANCED|LIGHTEST) plan/.exec(user.content)![1].toLowerCase() as Strategy;
};

/** A scripted Token Factory behind the planner's `tf` seam; every draft loop waits until all three have started. */
function fakeTf(script: Script): { tf: PlannerTF; calls: Captured[] } {
  const calls: Captured[] = [];
  const queues = Object.fromEntries(Object.entries(script.submissions).map(([k, v]) => [k, [...(v ?? [])]])) as Record<string, (SubmitArgs | Error)[]>;
  const entry = (role: string, step: string) => makeEntry({ step, model: role === 'extract' ? LIGHTNING : SUPER, ms: 7, usage: { prompt_tokens: 1000, completion_tokens: 50 }, replayed: true });
  const next = (label: Strategy): SubmitArgs => {
    const s = queues[label]?.shift();
    if (!s) throw new Error(`fake tf: no submission left for ${label}`);
    if (s instanceof Error) throw s;
    return s;
  };
  let started = 0;
  let release: () => void = () => {};
  const allStarted = new Promise<void>((r) => (release = r));
  let n = 0;
  const submitCall = (label: Strategy, args: unknown): ToolCall => ({ id: `call_${label}_${++n}`, type: 'function', function: { name: 'submit_plan', arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

  const toolLoop: PlannerTF['toolLoop'] = async (role, opts) => {
    const label = labelOf(opts.messages);
    const step = opts.step ?? '';
    calls.push({ fn: 'toolLoop', role, label, messages: opts.messages, thinking: opts.thinking, tools: opts.tools.map((t) => t.def.function.name), step });
    const e = entry(role, step);
    opts.onEvent?.({ type: 'model', step, at: e.at, entry: e });
    if (++started === 3) release();
    await Promise.race([allStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('drafts did not run in parallel')), 1000))]);
    const mode = script.draft?.[label] ?? 'direct';
    if (mode === 'lookup') {
      const tool = opts.tools.find((t) => t.def.function.name === 'check_prereqs')!;
      const args = { code: 'CSE 100', term: 'WI27' };
      opts.onEvent?.({ type: 'tool_call', step, at: e.at, name: 'check_prereqs', args });
      const out = JSON.stringify(await tool.run(args));
      opts.onEvent?.({ type: 'tool_result', step, at: e.at, name: 'check_prereqs', ms: 1, summary: out.slice(0, 200) });
      const call: ToolCall = { id: `call_lookup_${label}`, type: 'function', function: { name: 'check_prereqs', arguments: JSON.stringify(args) } };
      const message: AssistantMessage = { role: 'assistant', content: null, tool_calls: [call] };
      return { message, messages: [...opts.messages, message, { role: 'tool', tool_call_id: call.id, content: out }], rounds: 1, exhausted: true };
    }
    if (mode === 'prose') {
      const message: AssistantMessage = { role: 'assistant', content: 'Ready.' };
      return { message, messages: [...opts.messages, message], rounds: 1, exhausted: false };
    }
    const call = mode === 'invalid' ? submitCall(label, '{"terms":"nope"}') : submitCall(label, next(label));
    const message: AssistantMessage = { role: 'assistant', content: null, tool_calls: [call] };
    return { message, messages: [...opts.messages, message], rounds: 1, exhausted: false, terminal: call };
  };

  const forcedTool: PlannerTF['forcedTool'] = async (role, opts) => {
    const label = labelOf(opts.messages);
    const step = opts.step ?? '';
    calls.push({ fn: 'forcedTool', role, label, messages: opts.messages, thinking: opts.thinking, step });
    const e = entry(role, step);
    opts.onEvent?.({ type: 'model', step, at: e.at, entry: e });
    const sub = next(label);
    const message: AssistantMessage = { role: 'assistant', content: null, reasoning: 'thinking…', tool_calls: [submitCall(label, sub)] };
    const args = opts.tool.schema.parse(sub);
    return { args, result: { model: e.model, message, finish_reason: 'tool_calls', usage: { prompt_tokens: 1000, completion_tokens: 50 }, entry: e } };
  };
  return { tf: { toolLoop, forcedTool }, calls };
}

const run = (tf: PlannerTF, extra: Partial<Parameters<typeof planRun>[0]> = {}) => {
  const events: TraceEvent[] = [];
  return planRun({ state: demoA, action: drop, impact: imp, onEvent: (e) => events.push(e), tf, ...extra }).then((out) => ({ out, events }));
};
const steps = (events: TraceEvent[]) => events.flatMap((e) => (e.type === 'step' ? [e.message] : []));

afterEach(() => vi.unstubAllEnvs());

describe('planRun: draft phase', () => {
  it('drafts the three strategies in parallel on the draft role, one call each, and returns them in strategy order', async () => {
    const { tf, calls } = fakeTf({ submissions: ALL_GOOD });
    const { out, events } = await run(tf);

    expect(calls.map((c) => [c.fn, c.role, c.label])).toEqual([
      ['toolLoop', 'extract', 'fastest'],
      ['toolLoop', 'extract', 'balanced'],
      ['toolLoop', 'extract', 'lightest'],
    ]);
    expect(out.plans.map((p) => p.id)).toEqual(['p-fastest', 'p-balanced', 'p-lightest']);
    expect(out.reports.map((r) => r.ok)).toEqual([true, true, true]);
    expect(out).toMatchObject({ rejectedDrafts: 0, rounds: 1 });
    expect(out.ledger).toHaveLength(3);
    expect(out.ledger.every((e) => e.model === LIGHTNING && e.replayed)).toBe(true);

    // The same system prefix and the same student suffix for all three; only the closing brief differs.
    const systems = calls.map((c) => (c.messages[0] as { content: string }).content);
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]).toMatch(/^You are Quarterback's degree planner/);
    const users = calls.map((c) => (c.messages[1] as { content: string }).content);
    expect(users[0]).toMatch(/Action: drop CSE 29/);
    expect(users[0]).toMatch(/## Your draft\nDraft the FASTEST plan/);
    expect(users[2]).toMatch(/## Your draft\nDraft the LIGHTEST plan/);
    expect(new Set(users.map((u) => u.split('## Your draft')[0])).size).toBe(1);
    for (const c of calls) {
      expect(c.tools).toEqual(['eligible_courses', 'check_prereqs', 'offering_status', 'submit_plan']);
      expect(c.thinking).toEqual({ enable: false });
      expect(c.step).toBe('plan');
    }
    expect(steps(events)[0]).toMatch(/^Context pack built: \d+ courses .* Drafting 3 plans in parallel on Nemotron 3\.5 Lightning \(thinking off\)/);
    expect(steps(events)[1]).toMatch(/^Drafted 3 plans in [\d,]+ ms: 3 passed the verifier, 0 rejected\.$/);
  });

  it('falls back to a forced submit_plan after a lookup round, after prose, and after bad arguments', async () => {
    const { tf, calls } = fakeTf({ draft: { fastest: 'lookup', balanced: 'prose', lightest: 'invalid' }, submissions: ALL_GOOD });
    const { out, events } = await run(tf);

    // Concurrent drafts finish in any order: look the forced calls up by strategy.
    const forced = (label: Strategy) => calls.find((c) => c.fn === 'forcedTool' && c.label === label)!;
    expect(calls.filter((c) => c.fn === 'forcedTool').map((c) => c.label).sort()).toEqual(['balanced', 'fastest', 'lightest']);
    expect(calls.filter((c) => c.fn === 'forcedTool').every((c) => c.role === 'extract' && c.thinking?.enable === false)).toBe(true);
    // The lookup ran against the record after the drop (CSE 29 is gone) and stays in the forced call's history.
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ name: 'check_prereqs', summary: expect.stringMatching(/"satisfied":false/) });
    expect(forced('fastest').messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_lookup_fastest' });
    expect(forced('balanced').messages.at(-1)).toEqual({ role: 'assistant', content: 'Ready.' });
    expect(forced('lightest').messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: expect.stringMatching(/^call_lightest_/), content: expect.stringMatching(/^Arguments rejected: [^]*Call submit_plan again/) });
    expect(out.plans.map((p) => p.id)).toEqual(['p-fastest', 'p-balanced', 'p-lightest']);
    expect(out.ledger).toHaveLength(6);
    expect(out.ledger.every((e) => e.model === LIGHTNING)).toBe(true);
  });

  it('sends the same byte-identical prefix for two students of the same major and college (what Lightning caches)', async () => {
    const sibling: StudentState = {
      ...demoA,
      gpa: 2.9,
      courses: [
        { code: 'CSE 8A', term: 'FA25', units: 4, grade: 'B', status: 'earned' },
        { code: 'MATH 20A', term: 'FA25', units: 4, grade: 'C+', status: 'earned' },
        { code: 'CSE 8B', term: 'WI26', units: 4, grade: 'B-', status: 'earned' },
        { code: 'CSE 12', term: 'FA26', units: 4, grade: null, status: 'wip' },
        { code: 'MATH 20B', term: 'FA26', units: 4, grade: null, status: 'wip' },
        { code: 'HUM 1', term: 'FA26', units: 6, grade: null, status: 'wip' },
      ],
    };
    const act: Action = { kind: 'drop', course: 'CSE 12' };
    const a = fakeTf({ submissions: ALL_GOOD });
    await run(a.tf);
    const b = fakeTf({ submissions: { fastest: [new Error('x')], balanced: [new Error('x')], lightest: [new Error('x')] } });
    await run(b.tf, { state: sibling, action: act, impact: impact(sibling, act, NOW) });
    const system = (c: Captured) => (c.messages[0] as { content: string }).content;
    expect(system(b.calls[0])).toBe(system(a.calls[0]));
    expect((b.calls[0].messages[1] as { content: string }).content).not.toBe((a.calls[0].messages[1] as { content: string }).content);
  });
});

describe('planRun: repair phase', () => {
  it('repairs only the failing draft on the repair role, as a fresh request carrying the violations and their fixes', async () => {
    const { tf, calls } = fakeTf({ submissions: { fastest: [BAD, GOOD], balanced: [GOOD], lightest: [GOOD] } });
    const { out, events } = await run(tf);

    expect(out.plans.map((p) => p.id)).toEqual(['p-fastest-2', 'p-balanced', 'p-lightest']);
    expect(out.reports.map((r) => [r.planId, r.ok])).toEqual([['p-fastest', false], ['p-balanced', true], ['p-lightest', true], ['p-fastest-2', true]]);
    expect(out).toMatchObject({ rejectedDrafts: 1, rounds: 2 });
    expect(out.reports[0].violations.filter((v) => v.severity === 'error').map((v) => `${v.rule}:${v.course}`)).toEqual(expect.arrayContaining(['prereq-unsatisfied:CSE 100', 'prereq-unsatisfied:CSE 30']));
    expect(out.ledger.map((e) => e.model)).toEqual([LIGHTNING, LIGHTNING, LIGHTNING, SUPER]);

    const forced = calls.filter((c) => c.fn === 'forcedTool');
    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ role: 'plan', label: 'fastest', thinking: { enable: false } }); // default: Super, thinking off
    // The repair is a fresh request: the same system prefix and student suffix, then the strategy brief and the
    // rejected attempt with its violations and code-computed fixes — never the draft's own submit_plan call.
    const draft = calls.find((c) => c.fn === 'toolLoop' && c.label === 'fastest')!;
    const retry = forced[0].messages;
    expect(retry).toHaveLength(2);
    expect(retry[0]).toEqual(draft.messages[0]);
    const text = (retry[1] as { content: string }).content;
    expect(text.startsWith((draft.messages[1] as { content: string }).content)).toBe(true);
    expect(text).toMatch(/## Previous fastest attempt — REJECTED by the verifier\nWI27 \(16u\): CSE 100, CSE 30, MATH 18, HUM 4/);
    expect(text).toMatch(/\[prereq-unsatisfied\] CSE 100 in WI27: .* → replace CSE 100 in WI27 with one of: /);
    expect(text).toMatch(/\[prereq-unsatisfied\] CSE 30 in WI27/);
    expect(text).toMatch(/call submit_plan now with the corrected fastest plan/);
    expect(text).not.toMatch(/assumed-offered/); // warnings are not asked to be fixed
    expect(retry.some((m) => m.role === 'assistant' || m.role === 'tool')).toBe(false);
    expect(steps(events)).toEqual([
      expect.stringMatching(/^Context pack built/),
      expect.stringMatching(/^Drafted 3 plans in [\d,]+ ms: 2 passed the verifier, 1 rejected\.$/),
      expect.stringMatching(/^Round 1: the verifier rejected 1 of 3 drafts; repairing fastest on Nemotron 3 Super \(thinking off\)\.$/),
      expect.stringMatching(/^Repair round 1 done in [\d,]+ ms: 1 passed, 0 still failing\.$/),
      expect.stringMatching(/^3 plans passed the verifier in [\d,]+ ms; 1 draft rejected\.$/),
    ]);
  });

  it('emits trace events in phase order: context step, 3 models, 3 verifiers, drafted, round, model, verifier, repaired, summary, done', async () => {
    const { tf } = fakeTf({ submissions: { fastest: [BAD, GOOD], balanced: [GOOD], lightest: [GOOD] } });
    const { out, events } = await run(tf);
    expect(events.map((e) => e.type)).toEqual(['step', 'model', 'model', 'model', 'verifier', 'verifier', 'verifier', 'step', 'step', 'model', 'verifier', 'step', 'step', 'done']);
    expect(events.every((e) => e.step === 'plan')).toBe(true);
    expect(events.filter((e) => e.type === 'verifier')).toHaveLength(out.reports.length);
    expect(events[4]).toMatchObject({ type: 'verifier', report: { planId: 'p-fastest', ok: false } });
    expect(events[10]).toMatchObject({ type: 'verifier', report: { planId: 'p-fastest-2', ok: true } });
  });

  it('gives up on a draft after two repair rounds, keeping every report and the other plans', async () => {
    const { tf, calls } = fakeTf({ submissions: { fastest: [BAD, BAD, BAD], balanced: [GOOD], lightest: [GOOD] } });
    const { out, events } = await run(tf);
    expect(out.plans.map((p) => p.id)).toEqual(['p-balanced', 'p-lightest']);
    expect(out.reports.map((r) => r.planId)).toEqual(['p-fastest', 'p-balanced', 'p-lightest', 'p-fastest-2', 'p-fastest-3']);
    expect(out).toMatchObject({ rejectedDrafts: 3, rounds: 3 });
    const repairs = calls.filter((c) => c.fn === 'forcedTool');
    expect(repairs).toHaveLength(2);
    // The second repair of an unchanged plan is not the byte-identical request (fixture keys stay distinct).
    expect(repairs[0].messages).not.toEqual(repairs[1].messages);
    expect((repairs[1].messages[1] as { content: string }).content).toMatch(/## Previous fastest attempt \(repair 1 of 1\) — REJECTED/);
    expect(steps(events)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Round 1: the verifier rejected 1 of 3 drafts/),
      expect.stringMatching(/^Round 2: the verifier rejected 1 of 1 repaired drafts/),
      expect.stringMatching(/^Repair round 2 done in [\d,]+ ms: 0 passed, 1 still failing\.$/),
      expect.stringMatching(/^2 plans passed the verifier in [\d,]+ ms; 3 drafts rejected\.$/),
    ]));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('never repairs when maxRepairRounds is 0, and never adds the code-built plan while a draft passed', async () => {
    const { tf, calls } = fakeTf({ submissions: { fastest: [BAD], balanced: [GOOD], lightest: [GOOD] } });
    const { out } = await run(tf, { options: { maxRepairRounds: 0 } });
    expect(calls.filter((c) => c.fn === 'forcedTool')).toHaveLength(0);
    expect(out).toMatchObject({ rejectedDrafts: 1, rounds: 1 });
    expect(out.plans.map((p) => p.id)).toEqual(['p-balanced', 'p-lightest']);
  });

  it('falls back to the engine’s code-built plan, verified like a draft, when no model draft passes', async () => {
    const none = fakeTf({ submissions: { fastest: [BAD], balanced: [BAD], lightest: [BAD] } });
    const { out, events } = await run(none.tf, { options: { maxRepairRounds: 0 } });
    expect(out.plans.map((p) => [p.id, p.label])).toEqual([['p-code-built', 'code-built']]);
    expect(out.plans[0].terms.map((t) => t.term)).toEqual(['WI27', 'SP27', 'FA27']);
    expect(out.plans[0].rationale).toMatch(/^Built by rule/);
    // Its report is in the list (the approval gate reads it) and the drafts still count as rejected.
    expect(out.reports.map((r) => [r.planId, r.ok])).toEqual([['p-fastest', false], ['p-balanced', false], ['p-lightest', false], ['p-code-built', true]]);
    expect(out.rejectedDrafts).toBe(3);
    expect(verify(out.plans[0], after).ok).toBe(true);
    expect(steps(events).slice(-2)).toEqual([
      'No model draft passed the verifier; adding the code-built plan.',
      expect.stringMatching(/^1 plan passed the verifier in [\d,]+ ms; 3 drafts rejected\.$/),
    ]);
    expect(events.slice(-4).map((e) => e.type)).toEqual(['step', 'verifier', 'step', 'done']);
    expect(events.at(-3)).toMatchObject({ type: 'verifier', report: { planId: 'p-code-built', ok: true } });
    expect(out.ledger).toHaveLength(3); // the fallback is code, not a model call

    // With nothing to plan (no requirement files) the fallback has no eligible course, and the run ends with no plans as before.
    const bare: StudentState = { ...demoA, majorFile: null, collegeFile: null };
    const { out: empty, events: bareEvents } = await run(fakeTf({ submissions: { fastest: [BAD], balanced: [BAD], lightest: [BAD] } }).tf, { state: bare, impact: impact(bare, drop, NOW), options: { maxRepairRounds: 0 } });
    expect(empty.plans).toEqual([]);
    expect(empty.rejectedDrafts).toBe(3);
    expect(steps(bareEvents).at(-1)).toMatch(/^No plan passed the verifier in 1 round \([\d,]+ ms\); 3 drafts rejected\.$/);
    expect(steps(bareEvents)).not.toContain('No model draft passed the verifier; adding the code-built plan.');
  });

  it('counts a draft whose repair call fails as rejected with a model-error report, and keeps going', async () => {
    const { tf } = fakeTf({ submissions: { fastest: [BAD, new Error('forcedTool(submit_plan) on super failed after one retry: finish_reason=length')], balanced: [GOOD], lightest: [GOOD] } });
    const { out, events } = await run(tf);
    expect(out.plans.map((p) => p.id)).toEqual(['p-balanced', 'p-lightest']);
    expect(out).toMatchObject({ rejectedDrafts: 2, rounds: 2 });
    expect(out.reports[3]).toMatchObject({ planId: 'p-fastest-2', ok: false, violations: [{ rule: 'model-error', severity: 'error', message: expect.stringMatching(/fastest draft produced no valid plan: forcedTool.*finish_reason=length/) }] });
    expect(out.rejectedDrafts).toBe(out.reports.filter((r) => !r.ok).length);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('lets the spend cap and a missing fixture end the run with an error event', async () => {
    const cap = fakeTf({ submissions: { fastest: [new BudgetExceededError('total', 1, 1)], balanced: [GOOD], lightest: [GOOD] } });
    const events: TraceEvent[] = [];
    await expect(planRun({ state: demoA, action: drop, impact: imp, onEvent: (e) => events.push(e), tf: cap.tf })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/spend cap reached/) });

    const missing = new Error('No Token Factory fixture abc');
    missing.name = 'MissingFixtureError';
    const mock = fakeTf({ submissions: { fastest: [GOOD], balanced: [missing], lightest: [GOOD] } });
    await expect(planRun({ state: demoA, action: drop, impact: imp, tf: mock.tf })).rejects.toThrow(/No Token Factory fixture/);
  });
});

describe('planRun: options', () => {
  it('drafts on Super with thinking off for draftRole plan + reasoningEffort none, and names it in the step', async () => {
    const { tf, calls } = fakeTf({ submissions: { fastest: [BAD, GOOD], balanced: [GOOD], lightest: [GOOD] } });
    const { events } = await run(tf, { options: { draftRole: 'plan', reasoningEffort: 'none' } });
    expect(calls.filter((c) => c.fn === 'toolLoop').every((c) => c.role === 'plan' && c.thinking?.enable === false)).toBe(true);
    expect(calls.find((c) => c.fn === 'forcedTool')).toMatchObject({ role: 'plan', thinking: { enable: false } });
    expect(steps(events)[0]).toMatch(/Drafting 3 plans in parallel on Nemotron 3 Super \(thinking off\)/);
    expect(steps(events)[2]).toMatch(/repairing fastest on Nemotron 3 Super \(thinking off\)/);
  });

  it('reads QB_DRAFT_ROLE and QB_REPAIR_EFFORT, lets an explicit option win, and rejects unknown values', async () => {
    expect(resolveOptions()).toEqual(DEFAULT_OPTIONS);
    vi.stubEnv('QB_DRAFT_ROLE', 'plan');
    vi.stubEnv('QB_REPAIR_EFFORT', 'medium');
    expect(resolveOptions()).toEqual({ ...DEFAULT_OPTIONS, draftRole: 'plan', reasoningEffort: 'medium' });
    expect(resolveOptions({ draftRole: 'extract', maxRepairRounds: 1 })).toEqual({ ...DEFAULT_OPTIONS, draftRole: 'extract', reasoningEffort: 'medium', maxRepairRounds: 1 });
    const { tf, calls } = fakeTf({ submissions: { fastest: [BAD, GOOD], balanced: [GOOD], lightest: [GOOD] } });
    await run(tf);
    expect(calls.filter((c) => c.fn === 'toolLoop').every((c) => c.role === 'plan' && c.thinking?.effort === 'medium')).toBe(true);
    expect(calls.find((c) => c.fn === 'forcedTool')?.thinking).toEqual({ enable: true, effort: 'medium' });
    vi.stubEnv('QB_DRAFT_ROLE', 'nano');
    expect(() => resolveOptions()).toThrow(/QB_DRAFT_ROLE must be one of extract, plan, critic/);
  });
});

describe('toPlan', () => {
  const asDraft = (label: string, args: SubmitArgs): DraftPlan => ({ label, ...args });
  it('normalizes codes, terms and labels, sums catalog units, and never reuses an id', () => {
    const used = new Set<string>();
    const p = toPlan(asDraft('Fastest', BAD), used);
    expect(p.id).toBe('p-fastest');
    expect(p.label).toBe('fastest');
    expect(p.terms[0]).toEqual({ term: 'WI27', courses: ['CSE 100', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 });
    expect(p.graduationTerm).toBe('SP29');
    expect(toPlan(asDraft('fastest', BAD), used).id).toBe('p-fastest-2');
    expect(toPlan(asDraft(' Light est! ', GOOD), used).id).toBe('p-light-est');
    // The model's unit number is overridden by the catalog when every course has a fixed unit value…
    expect(toPlan(asDraft('balanced', { ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 29', 'CSE 21'], units: 99 }] }), used).terms[0].units).toBe(8);
    // …and kept for a variable-unit course, where the catalog cannot decide.
    expect(toPlan(asDraft('balanced', { ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 199'], units: 2 }] }), used).terms[0].units).toBe(2);
    expect(toPlan(asDraft('balanced', { ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4, partTime: true }] }), used).terms[0].partTime).toBe(true);
  });
  it('produces plans the engine verifier can judge (the GOOD fixture passes, BAD fails)', () => {
    expect(verify(toPlan(asDraft('balanced', GOOD), new Set()), after).ok).toBe(true);
    expect(verify(toPlan(asDraft('fastest', BAD), new Set()), after).ok).toBe(false);
  });
});
