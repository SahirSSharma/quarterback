// The four cheap calls scripts/tf-probe.ts records and lib/tf tests replay. They live here so the script and
// the tests build byte-identical requests (the fixture key is the request). Keep every prompt and tool
// result pure and constant: a timestamp in a tool result would change the second round's key.
import { z } from 'zod';
import type { TraceEvent } from '../types';
import { chatStream, type ChatResult } from './client';
import { forcedTool, structured, toolLoop, type LoopTool } from './helpers';

export const recordSchema = z.object({
  courses: z.array(z.object({ code: z.string(), grade: z.string() })),
});

export const FAKE_RECORD = [
  'CSE 8A   Intro to Programming 1     4.00   A-',
  'MATH 20A Calculus/Sci & Engineering 4.00   B+',
  'CSE 12   Basic Data Struct & OO Des 4.00   IP',
].join('\n');

export function probeStructured() {
  return structured('extract', {
    system:
      'Extract the courses from this UCSD academic history. Course codes are upper case with one space (CSE 100). grade is the letter grade, or IP when in progress.',
    user: FAKE_RECORD,
    schema: recordSchema,
    name: 'academic_record',
    maxTokens: 300,
    step: 'probe-extract',
  });
}

export const plansSchema = z.object({
  plans: z.array(z.object({ label: z.string(), courses: z.array(z.string()) })),
});

export function probeForcedTool() {
  return forcedTool('plan', {
    messages: [
      { role: 'system', content: 'You are a UCSD degree planner. Answer only by calling submit_plans with exactly one plan.' },
      {
        role: 'user',
        content:
          'A student has completed CSE 8A and MATH 20A. Propose one WI27 plan of three courses chosen from: CSE 8B, MATH 20B, CSE 12, CSE 15L, COGS 1. Label it "balanced".',
      },
    ],
    tool: { name: 'submit_plans', description: 'Submit the proposed plans.', schema: plansSchema },
    thinking: { enable: true, budget: 256 },
    maxTokens: 400,
    step: 'probe-plan',
  });
}

export const offeringStatusTool: LoopTool = {
  def: {
    type: 'function',
    function: {
      name: 'offering_status',
      description: 'Whether a course is offered in a quarter, from the department offerings page.',
      parameters: {
        type: 'object',
        properties: { course: { type: 'string' }, term: { type: 'string' } },
        required: ['course', 'term'],
        additionalProperties: false,
      },
    },
  },
  run: (args) => {
    const { course, term } = args as { course: string; term: string };
    return { course, term, status: 'tentative', quote: `${course} — ${term}: tentative (instructor TBD)` };
  },
};

export function probeToolLoop(onEvent?: (e: TraceEvent) => void) {
  return toolLoop('extract', {
    messages: [
      { role: 'system', content: 'Answer in one sentence. Call offering_status before answering any question about course offerings.' },
      { role: 'user', content: 'Is CSE 100 offered in WI27?' },
    ],
    tools: [offeringStatusTool],
    maxRounds: 2,
    maxTokens: 200,
    step: 'probe-tools',
    onEvent,
  });
}

export async function probeStream(onDelta?: (text: string) => void): Promise<{ text: string; deltas: number; result: ChatResult }> {
  let text = '';
  let deltas = 0;
  for await (const chunk of chatStream(
    { role: 'extract', messages: [{ role: 'user', content: 'In exactly 20 words, explain what a course prerequisite is.' }], max_tokens: 80 },
    { step: 'probe-stream' },
  )) {
    if (chunk.done) return { text, deltas, result: chunk.result };
    text += chunk.delta;
    deltas += 1;
    onDelta?.(chunk.delta);
  }
  throw new Error('stream ended without a final chunk');
}
