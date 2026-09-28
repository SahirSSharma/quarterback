import { describe, expect, it } from 'vitest';
import type { Action, TraceEvent } from '../types';
import { impact } from '../engine/impact';
import { demoStudents } from '../engine/student';
import { verify } from '../engine/verifier';
import type { AssistantMessage, ChatMessage } from '../tf/client';
import type { LoopTool } from '../tf/helpers';
import { makeEntry } from '../tf/ledger';
import { SUPER } from '../tf/models';
import { applyAction } from './context';
import { planRun, toPlan, type PlannerTF } from './planner';
import type { DraftPlan } from './tools';

const NOW = '2026-10-01T12:00:00-07:00';
const demoA = demoStudents()[0];
const drop: Action = { kind: 'drop', course: 'CSE 29' };
const after = applyAction(demoA, drop);

// CSE 100 and CSE 30 both need CSE 29, which was just dropped: two prereq-unsatisfied errors in WI27.
const BAD: DraftPlan = {
  label: 'Fastest',
  terms: [
    { term: 'wi27', courses: ['cse100', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 },
    { term: 'SP27', courses: ['CSE 101', 'CSE 151A', 'MATH 183'], units: 12 },
    { term: 'FA27', courses: ['CSE 150A', 'CSE 55', 'COGS 1'], units: 12 },
  ],
  rationale: 'too fast',
  graduationTerm: 'sp29',
};
const GOOD: DraftPlan = {
  label: 'balanced',
  terms: [
    { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'], units: 16 },
    { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'MATH 183', 'HUM 5'], units: 16 },
    { term: 'FA27', courses: ['CSE 101', 'CSE 151A', 'CSE 55', 'COGS 1'], units: 16 },
  ],
  rationale: 'retake first',
  graduationTerm: null,
};

interface Captured {
  loop: { messages: ChatMessage[]; tools: LoopTool[]; step: string }[];
  forced: { messages: ChatMessage[]; step: string }[];
}

/** A scripted Token Factory: one tool round in the loop, then one submit_plans answer per call from `submissions`. */
function fakeTf(submissions: DraftPlan[][]): { tf: PlannerTF; calls: Captured } {
  const calls: Captured = { loop: [], forced: [] };
  const entry = (step: string) => makeEntry({ step, model: SUPER, ms: 7, usage: { prompt_tokens: 1000, completion_tokens: 50 }, replayed: true });
  let n = 0;
  const toolLoop: PlannerTF['toolLoop'] = async (_role, opts) => {
    calls.loop.push({ messages: opts.messages, tools: opts.tools, step: opts.step ?? '' });
    const step = opts.step ?? '';
    const e = entry(step);
    opts.onEvent?.({ type: 'model', step, at: e.at, entry: e });
    const tool = opts.tools.find((t) => t.def.function.name === 'check_prereqs')!;
    const args = { code: 'CSE 100', term: 'WI27' };
    opts.onEvent?.({ type: 'tool_call', step, at: e.at, name: 'check_prereqs', args });
    const out = JSON.stringify(await tool.run(args));
    opts.onEvent?.({ type: 'tool_result', step, at: e.at, name: 'check_prereqs', ms: 1, summary: out.slice(0, 200) });
    const call = { id: 'call_loop', type: 'function' as const, function: { name: 'check_prereqs', arguments: JSON.stringify(args) } };
    const messages: ChatMessage[] = [...opts.messages, { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: 'call_loop', content: out }, { role: 'assistant', content: 'Ready.' }];
    return { message: { role: 'assistant', content: 'Ready.' }, messages, rounds: 2, exhausted: false };
  };
  const forcedTool: PlannerTF['forcedTool'] = async (_role, opts) => {
    calls.forced.push({ messages: opts.messages, step: opts.step ?? '' });
    const plans = submissions.shift();
    if (!plans) throw new Error('fake tf: no submission left');
    n += 1;
    const e = entry(opts.step ?? '');
    const message: AssistantMessage = {
      role: 'assistant',
      content: null,
      reasoning: 'thinking…',
      tool_calls: [{ id: `call_submit_${n}`, type: 'function', function: { name: opts.tool.name, arguments: JSON.stringify({ plans }) } }],
    };
    const args = opts.tool.schema.parse({ plans });
    return { args, result: { model: SUPER, message, finish_reason: 'tool_calls', usage: { prompt_tokens: 1000, completion_tokens: 50 }, entry: e } };
  };
  return { tf: { toolLoop, forcedTool }, calls };
}

describe('planRun', () => {
  it('rejects the bad draft, asks for corrections with the violations, and returns only the passing plan', async () => {
    const { tf, calls } = fakeTf([[BAD], [GOOD]]);
    const events: TraceEvent[] = [];
    const out = await planRun({ state: demoA, action: drop, impact: impact(demoA, drop, NOW), onEvent: (e) => events.push(e), tf });

    expect(out.plans.map((p) => p.id)).toEqual(['p-balanced']);
    expect(out.rejectedDrafts).toBe(1);
    expect(out.rounds).toBe(2);
    expect(out.reports.map((r) => [r.planId, r.ok])).toEqual([['p-fastest', false], ['p-balanced', true]]);
    const bad = out.reports[0];
    expect(bad.violations.filter((v) => v.severity === 'error').map((v) => `${v.rule}:${v.course}`)).toEqual(expect.arrayContaining(['prereq-unsatisfied:CSE 100', 'prereq-unsatisfied:CSE 30']));
    expect(out.reports[1].violations.every((v) => v.severity === 'warning')).toBe(true);
    expect(out.ledger).toHaveLength(3);
    expect(out.ledger.every((e) => e.model === SUPER && e.replayed)).toBe(true);

    // The planner works against the record after the drop: CSE 29 is gone, so the loop tool says CSE 100 is not ready.
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ summary: expect.stringMatching(/"satisfied":false/) });
    expect(calls.loop[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringMatching(/^You are Quarterback's degree planner/) });
    expect(calls.loop[0].messages[1]).toMatchObject({ role: 'user', content: expect.stringMatching(/Action: drop CSE 29/) });
    expect(calls.loop[0].tools.map((t) => t.def.function.name)).not.toContain('submit_plans');

    // Round 2 continues the same history: loop, the rejected submit call, its tool result, then the user message.
    const retry = calls.forced[1].messages;
    expect(retry.slice(0, calls.forced[0].messages.length)).toEqual(calls.forced[0].messages);
    const [assistant, toolMsg, user] = retry.slice(-3);
    expect(assistant).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_submit_1' }] });
    expect(assistant).not.toHaveProperty('reasoning');
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call_submit_1' });
    expect(user.role).toBe('user');
    const text = (user as { content: string }).content;
    expect(text).toMatch(/rejected every plan/);
    expect(text).toMatch(/\[prereq-unsatisfied\] CSE 100 in WI27/);
    expect(text).toMatch(/\[prereq-unsatisfied\] CSE 30 in WI27/);
    expect(text).toMatch(/submit_plans again/);
    expect(text).not.toMatch(/assumed-offered/); // warnings are not asked to be fixed
  });

  it('emits trace events in order: step, model, tool_call, tool_result, model, verifier, step, model, verifier, step, done', async () => {
    const { tf } = fakeTf([[BAD], [GOOD]]);
    const events: TraceEvent[] = [];
    await planRun({ state: demoA, action: drop, impact: impact(demoA, drop, NOW), onEvent: (e) => events.push(e), tf });
    expect(events.map((e) => e.type)).toEqual(['step', 'model', 'tool_call', 'tool_result', 'model', 'verifier', 'step', 'model', 'verifier', 'step', 'done']);
    expect(events.every((e) => e.step === 'plan')).toBe(true);
    expect(events[0]).toMatchObject({ type: 'step', message: expect.stringMatching(/Context pack built: \d+ courses .* shared prefix ≈ [\d.]+k tokens/) });
    expect(events[6]).toMatchObject({ type: 'step', message: expect.stringMatching(/Round 1: the verifier rejected all 1 draft;/) });
    expect(events[5]).toMatchObject({ type: 'verifier', report: { planId: 'p-fastest', ok: false } });
    expect(events[8]).toMatchObject({ type: 'verifier', report: { planId: 'p-balanced', ok: true } });
    expect(events[9]).toMatchObject({ type: 'step', message: '1 plan passed the verifier; 1 draft rejected.' });
  });

  it('keeps passing plans and counts failing ones when a round is mixed, without asking again', async () => {
    const { tf, calls } = fakeTf([[BAD, GOOD, { ...GOOD, label: 'lightest', terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4 }] }]]);
    const out = await planRun({ state: demoA, action: drop, impact: impact(demoA, drop, NOW), tf });
    expect(out.plans.map((p) => p.id)).toEqual(['p-balanced']);
    expect(out.rejectedDrafts).toBe(2);
    expect(out.rounds).toBe(1);
    expect(out.reports.map((r) => r.planId)).toEqual(['p-fastest', 'p-balanced', 'p-lightest']);
    expect(out.reports[2].violations.map((v) => v.rule)).toContain('unit-floor');
    expect(calls.forced).toHaveLength(1);
  });

  it('gives up after three submit rounds, returning no plans and every report', async () => {
    const { tf, calls } = fakeTf([[BAD], [BAD], [BAD]]);
    const events: TraceEvent[] = [];
    const out = await planRun({ state: demoA, action: drop, impact: impact(demoA, drop, NOW), onEvent: (e) => events.push(e), tf });
    expect(out.plans).toEqual([]);
    expect(out.rejectedDrafts).toBe(3);
    expect(out.rounds).toBe(3);
    expect(out.reports.map((r) => r.planId)).toEqual(['p-fastest', 'p-fastest-2', 'p-fastest-3']);
    expect(calls.forced).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.at(-2)).toMatchObject({ type: 'step', message: expect.stringMatching(/No plan passed/) });
  });

  it('emits an error event and rethrows when the model layer fails', async () => {
    const { tf } = fakeTf([]);
    const events: TraceEvent[] = [];
    await expect(planRun({ state: demoA, action: drop, impact: impact(demoA, drop, NOW), onEvent: (e) => events.push(e), tf })).rejects.toThrow(/no submission left/);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/no submission left/) });
  });
});

describe('toPlan', () => {
  it('normalizes codes, terms and labels, sums catalog units, and never reuses an id', () => {
    const used = new Set<string>();
    const p = toPlan(BAD, used);
    expect(p.id).toBe('p-fastest');
    expect(p.label).toBe('fastest');
    expect(p.terms[0]).toEqual({ term: 'WI27', courses: ['CSE 100', 'CSE 30', 'MATH 18', 'HUM 4'], units: 16 });
    expect(p.graduationTerm).toBe('SP29');
    expect(toPlan(BAD, used).id).toBe('p-fastest-2');
    expect(toPlan({ ...GOOD, label: ' Light est! ' }, used).id).toBe('p-light-est');
    // The model's unit number is overridden by the catalog when every course has a fixed unit value…
    expect(toPlan({ ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 29', 'CSE 21'], units: 99 }] }, used).terms[0].units).toBe(8);
    // …and kept for a variable-unit course, where the catalog cannot decide.
    expect(toPlan({ ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 199'], units: 2 }] }, used).terms[0].units).toBe(2);
    expect(toPlan({ ...GOOD, terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4, partTime: true }] }, used).terms[0].partTime).toBe(true);
  });
  it('produces plans the engine verifier can judge (the GOOD fixture passes, BAD fails)', () => {
    expect(verify(toPlan(GOOD, new Set()), after).ok).toBe(true);
    expect(verify(toPlan(BAD, new Set()), after).ok).toBe(false);
  });
});
