// Pure helpers behind the trace panel. Events arrive as a flat stream of TraceEvents; the panel shows them as
// rows with elapsed time, each tool call folded together with its result, and a spinner for the call in flight.
// Nothing here knows the planner's step names: new steps render from their message, and the model badge for
// the call in flight is guessed from the step name's words, else from the last model call seen in that step.
import type { TraceEvent } from '@/lib/types';
import { modelTier, type ModelTier } from './models';

type ToolCall = Extract<TraceEvent, { type: 'tool_call' }>;
type ToolResult = Extract<TraceEvent, { type: 'tool_result' }>;

export type TraceRow =
  | { kind: 'event'; at: string; event: Exclude<TraceEvent, ToolCall> }
  | { kind: 'tool'; at: string; call: ToolCall; result: ToolResult | null };

/** One row per tool call, carrying the next result of the same name; a result with no open call stays its own row. */
export function collapseTools(events: TraceEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  const open: Extract<TraceRow, { kind: 'tool' }>[] = [];
  for (const e of events) {
    if (e.type === 'tool_call') {
      const row = { kind: 'tool' as const, at: e.at, call: e, result: null };
      rows.push(row);
      open.push(row);
    } else if (e.type === 'tool_result') {
      const i = open.findIndex((r) => r.call.name === e.name);
      if (i >= 0) open.splice(i, 1)[0].result = e;
      else rows.push({ kind: 'event', at: e.at, event: e });
    } else {
      rows.push({ kind: 'event', at: e.at, event: e });
    }
  }
  return rows;
}

/** Milliseconds from `from` to `to`; 0 when either timestamp is unreadable or `to` is earlier. */
export function elapsedMs(from: string | undefined, to: string): number {
  if (!from) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, b - a);
}

/** 'm:ss' from a millisecond count: 0 → '0:00', 83400 → '1:23'. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Which Nemotron tier a step name points at, by its words; null when the name says nothing. The planner's 'plan'
 * step is deliberately unmapped: it runs Lightning drafts and then Super repairs, so its badge follows the calls.
 */
export function stepTier(step: string): ModelTier | null {
  const s = step.toLowerCase();
  if (/stress|critic/.test(s)) return 'Ultra';
  if (/explain|intake|extract/.test(s)) return 'Lightning';
  return null;
}

/** The call in flight while the trace is live: its step and the badge to show, or null once done/error arrived. */
export function inFlight(events: TraceEvent[], live: boolean): { step: string; tier: ModelTier | null } | null {
  if (!live) return null;
  const last = events[events.length - 1];
  if (last && (last.type === 'done' || last.type === 'error')) return null;
  const step = last?.step ?? 'plan';
  let tier = stepTier(step);
  if (tier === null) {
    // The last model call in this step (Lightning while drafting, Super while repairing), else the last one anywhere.
    const models = events.filter((e): e is Extract<TraceEvent, { type: 'model' }> => e.type === 'model');
    const m = models.findLast((e) => e.step === step) ?? models[models.length - 1];
    if (m) tier = modelTier(m.entry.model);
  }
  return { step, tier };
}
