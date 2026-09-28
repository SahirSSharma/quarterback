import { describe, expect, it } from 'vitest';
import type { Action, OfferingEvidence, Plan, TraceEvent, VerifierReport } from '../types';
import { offeringStatus } from '../engine/offerings';
import { demoStudents } from '../engine/student';
import type { AssistantMessage, ChatMessage } from '../tf/client';
import { makeEntry } from '../tf/ledger';
import { ULTRA } from '../tf/models';
import { buildEvidenceIndex, horizonTerms } from './context';
import { resolveVerdict, stressTest, submitVerdictSchema, verdictCacheKey, type StressInput, type VerdictArgs } from './critic';

const demoA = demoStudents()[0];
const drop: Action = { kind: 'drop', course: 'CSE 29' };

const fastest: Plan = {
  id: 'p-fastest', label: 'fastest', rationale: 'Ethics early.', graduationTerm: 'WI29',
  terms: [
    { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'PHIL 174'], units: 16 },
    { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'MATH 183', 'HUM 4'], units: 16 },
    { term: 'FA27', courses: ['CSE 101', 'CSE 151A', 'CSE 150B', 'HUM 5'], units: 16 },
  ],
};
const balanced: Plan = { ...fastest, id: 'p-balanced', label: 'balanced', graduationTerm: 'SP29', rationale: 'Steady.' };
const plans = [fastest, balanced];
const reports: VerifierReport[] = plans.map((p) => ({ planId: p.id, ok: true, violations: [{ rule: 'assumed-offered', severity: 'warning', course: 'CSE 150B', term: 'FA27', message: 'no evidence' }] }));
const index = buildEvidenceIndex(plans, horizonTerms(demoA));

describe('resolveVerdict', () => {
  const base: VerdictArgs = { recommend: 'p-balanced', refused: [], risks: ['r1'], summary: 's' };

  it('resolves evidence ids to the stored evidence objects, tolerating case and spaces', () => {
    const v = resolveVerdict({ ...base, refused: [{ planId: 'p-fastest', reason: 'CSE 150B has no FA27 row.', evidenceIds: ['ev_cse150b_fa27', ' ev_CSE150B_FA27 '] }] }, plans, index);
    expect(v.refused).toHaveLength(1);
    expect(v.refused[0].evidence).toEqual([offeringStatus('CSE 150B', 'FA27')]); // deduped
    expect(v.refused[0].evidence[0].quote).toBe(index.ev_CSE150B_FA27.quote);
    expect(v.recommend).toBe('p-balanced');
    expect(v.risks).toEqual(['r1']);
  });

  it('drops unknown ids and notes it, keeping the refusal when at least one id resolves', () => {
    const v = resolveVerdict({ ...base, refused: [{ planId: 'p-fastest', reason: 'x', evidenceIds: ['ev_CSE150B_FA27', 'ev_NOPE1_WI27', 'garbage'] }] }, plans, index);
    expect(v.refused[0].evidence).toHaveLength(1);
    expect(v.risks).toEqual(['r1', 'Evidence ids not on file were ignored for p-fastest: ev_NOPE1_WI27, garbage.']);
  });

  it('downgrades a refusal with no resolved evidence to a risk', () => {
    const v = resolveVerdict({ ...base, refused: [{ planId: 'p-fastest', reason: 'Feels risky.', evidenceIds: ['ev_NOPE1_WI27'] }] }, plans, index);
    expect(v.refused).toEqual([]);
    expect(v.risks).toHaveLength(2);
    expect(v.risks[1]).toMatch(/^p-fastest: Feels risky\. \(downgraded from a refusal: no stored evidence supports it; unknown evidence ids ev_NOPE1_WI27\)$/);
    const empty = resolveVerdict({ ...base, refused: [{ planId: 'p-fastest', reason: 'None.', evidenceIds: [] }] }, plans, index);
    expect(empty.refused).toEqual([]);
    expect(empty.risks[1]).toMatch(/downgraded from a refusal: no stored evidence supports it\)$/);
  });

  it('turns a refusal of a plan that is not shown into a risk, and nulls a recommendation that is refused or unknown', () => {
    const v = resolveVerdict({ ...base, recommend: 'p-fastest', refused: [
      { planId: 'p-ghost', reason: 'g', evidenceIds: ['ev_CSE150B_FA27'] },
      { planId: 'p-fastest', reason: 'f', evidenceIds: ['ev_CSE150B_FA27'] },
    ] }, plans, index);
    expect(v.refused.map((r) => r.planId)).toEqual(['p-fastest']);
    expect(v.recommend).toBeNull();
    expect(v.risks[1]).toMatch(/named plan "p-ghost"/);
    expect(resolveVerdict({ ...base, recommend: 'p-nope' }, plans, index).recommend).toBeNull();
    expect(resolveVerdict({ ...base, recommend: null }, plans, index).recommend).toBeNull();
  });
});

describe('verdictCacheKey', () => {
  it('is a sha256 that depends on the plan set and the evidence ids, not on rationale wording', () => {
    const k = verdictCacheKey(plans, index);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(verdictCacheKey(plans, index)).toBe(k);
    expect(verdictCacheKey(plans.map((p) => ({ ...p, rationale: 'other words' })), index)).toBe(k);
    expect(verdictCacheKey([fastest], index)).not.toBe(k);
    expect(verdictCacheKey(plans, { ...index, ev_EXTRA1_WI27: index.ev_CSE150B_FA27 })).not.toBe(k);
    expect(verdictCacheKey(plans.map((p) => ({ ...p, terms: p.terms.map((t) => ({ ...t, courses: [...t.courses].reverse() })) })), index)).not.toBe(k);
  });
});

describe('stressTest', () => {
  function fake(args: VerdictArgs) {
    const captured: { messages: ChatMessage[]; step: string }[] = [];
    const tf: StressInput['tf'] = {
      forcedTool: async (_role, opts) => {
        captured.push({ messages: opts.messages, step: opts.step ?? '' });
        const entry = makeEntry({ step: opts.step ?? '', model: ULTRA, ms: 9, usage: { prompt_tokens: 3000, completion_tokens: 400 }, replayed: true });
        const message: AssistantMessage = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: opts.tool.name, arguments: JSON.stringify(args) } }] };
        return { args: opts.tool.schema.parse(args), result: { model: ULTRA, message, finish_reason: 'tool_calls', usage: { prompt_tokens: 3000, completion_tokens: 400 }, entry } };
      },
    };
    return { tf, captured };
  }

  it('renders plans, verifier reports, prerequisite satisfaction, the evidence table and page caveats, and emits events', async () => {
    const { tf, captured } = fake({ recommend: 'p-balanced', refused: [{ planId: 'p-fastest', reason: 'CSE 150B is not on the FA27 sheet.', evidenceIds: ['ev_CSE150B_FA27'] }], risks: ['WI27 schedule publishes in November.'], summary: 'Take balanced.' });
    const events: TraceEvent[] = [];
    const verdict = await stressTest({ state: demoA, action: drop, plans, reports, evidenceIndex: index, onEvent: (e) => events.push(e), tf });

    expect(verdict.recommend).toBe('p-balanced');
    expect(verdict.refused[0].evidence[0]).toEqual(index.ev_CSE150B_FA27);
    expect(events.map((e) => e.type)).toEqual(['step', 'model', 'step', 'done']);
    expect(events.every((e) => e.step === 'stress-test')).toBe(true);
    expect(events[2]).toMatchObject({ type: 'step', message: 'Recommends p-balanced; refused 1; 1 risk.' });

    expect(captured).toHaveLength(1);
    const [system, user] = captured[0].messages as { role: string; content: string }[];
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/REFUSE a plan .* when BOTH hold/);
    expect(system.content).toMatch(/evidence status is "not_offered" or "unknown \(not on dept page\)"/);
    expect(system.content).toMatch(/Do NOT refuse for: plain "unknown" in a quarter beyond the published page/);
    expect(user.content).toMatch(/### p-fastest \(fastest\) — graduation WI29/);
    expect(user.content).toMatch(/WI27 \(16u\): CSE 29, CSE 21, MATH 18, PHIL 174/);
    expect(user.content).toMatch(/\[assumed-offered\/warning\] CSE 150B FA27/);
    // The record shown is the one after the drop: CSE 29 is planned, not in progress.
    expect(user.content).toMatch(/In progress \(FA26\): CSE 20, MATH 20C, HUM 3\./);
    expect(user.content).toMatch(/CSE 30 \(SP27\): CSE 15L\|CSE 29\|ECE 15 ← CSE 29 planned WI27/);
    expect(user.content).toMatch(/CSE 100 \(SP27\): .*CSE 12 ← CSE 12 earned/);
    expect(user.content).toMatch(/ev_CSE150B_FA27 \| CSE 150B FA27 \| unknown \| cape-history/); // FA27 is beyond the CSE sheet: plain unknown
    expect(user.content).toMatch(/ev_CSE29_WI27 \| CSE 29 WI27 \| offered \| department-page/);
    expect(user.content).toMatch(/ev_HUM4_WI27 \| HUM 4 WI27 \| unknown \| cape-history/); // HUM has no page: plain unknown
    expect(user.content).toMatch(/CSE: publishes FA26, WI27, SP27 .*page caveat: "This page is tentative and subject to change/);
    expect(user.content).toMatch(/No offerings page on file for: HUM, PHIL/);
  });

  it('never lets model text become a quote: a refusal with only unknown ids is shown as a risk', async () => {
    const { tf } = fake({ recommend: null, refused: [{ planId: 'p-fastest', reason: 'The page says "CSE 150B cancelled".', evidenceIds: ['ev_MADEUP1_FA27'] }], risks: [], summary: 's' });
    const verdict = await stressTest({ state: demoA, plans, reports, evidenceIndex: index, tf });
    expect(verdict.refused).toEqual([]);
    expect(verdict.risks[0]).toMatch(/downgraded from a refusal/);
    expect(verdict.recommend).toBeNull();
  });

  it('validates the verdict schema shape', () => {
    expect(submitVerdictSchema.safeParse({ recommend: null, refused: [], risks: [], summary: 's' }).success).toBe(true);
    expect(submitVerdictSchema.safeParse({ recommend: 'x', refused: [{ planId: 'p', reason: 'r' }], risks: [], summary: 's' }).success).toBe(false);
  });
});

it('buildEvidenceIndex covers every planned course × horizon term', () => {
  const codes = new Set(plans.flatMap((p) => p.terms.flatMap((t) => t.courses)));
  expect(Object.keys(index)).toHaveLength(codes.size * 3);
  for (const ev of Object.values(index) as OfferingEvidence[]) expect(ev).toEqual(offeringStatus(ev.course, ev.term));
});
