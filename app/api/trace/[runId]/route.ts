import { NextResponse } from 'next/server';
import { getRun, updateRun } from '@/lib/store/runs';
import type { TraceEvent } from '@/lib/types';
import type { RunRecord } from '@/app/lib/contracts';
import { fixtureFor } from '../../_lib/mock';
import { PLAN_STEP, deps, getTrace, planWork, putTrace, serveMode } from '../../_lib/pipeline';

// This request performs the planner work (Super rounds + verifier), so it needs the long budget; the client
// only sees events as they happen.
export const runtime = 'nodejs';
export const maxDuration = 300;
/** A 'running' trace older than this belongs to a function that was cut off; the work starts over. */
const STALE_MS = 6 * 60_000;
/** How long a reconnect waits for the other request's work; under maxDuration so the timeout message can be sent. */
const WAIT_MS = 270_000;

const headers = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

/** GET /api/trace/[runId] → text/event-stream of TraceEvent JSON, one `data:` line per event, ending with done or error. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return new Response('Unknown run', { status: 404 });
  if (serveMode(run) === 'mock' && !fixtureFor(run.state, run.action)) {
    return NextResponse.json({
      error: `No recorded run for ${run.action.kind} ${run.action.course} on ${run.state.majorFile ?? 'this record'} in QB_MODE=mock; record it with scripts/record-demos.ts.`,
    }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: TraceEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      // A client that leaves stops receiving; the work itself runs on so the results are stored for a reconnect.
      req.signal.addEventListener('abort', () => { closed = true; });
      controller.enqueue(encoder.encode('retry: 30000\n\n'));
      void serve(run, send).finally(finish);
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers });
}

async function serve(run: RunRecord, send: (event: TraceEvent) => void): Promise<void> {
  const now = () => new Date().toISOString();
  const startedAt = now();
  const events: TraceEvent[] = [];
  const emit = (event: TraceEvent) => {
    events.push(event);
    send(event);
  };
  let working = false;
  try {
    let stored = await getTrace(run.runId);
    if (stored && (stored.status !== 'running' || Date.now() - Date.parse(stored.startedAt) < STALE_MS)) {
      // Already done, or another request is doing the work: never run Super twice for one run.
      if (stored.status === 'running') {
        send({ type: 'step', step: PLAN_STEP, at: now(), message: 'Planning is already in progress for this run; waiting for it to finish.' });
        const deadline = Date.now() + WAIT_MS;
        while (stored.status === 'running' && Date.now() < deadline) {
          await deps.sleep(2000);
          stored = (await getTrace(run.runId)) ?? stored;
        }
        if (stored.status === 'running') {
          send({ type: 'error', step: PLAN_STEP, at: now(), message: 'Planning did not finish in time. Start a new re-plan.' });
          return;
        }
      }
      for (const event of stored.events) send(event);
      return;
    }

    working = true;
    await putTrace(run.runId, { status: 'running', startedAt, events });
    const patch = await planWork(run, emit);
    const failed = events.some((e) => e.type === 'error');
    await updateRun(run.runId, patch);
    // 'done' only after the results are stored: the UI fetches the run the moment it sees it.
    if (!failed) emit({ type: 'done', step: PLAN_STEP, at: now() });
    await putTrace(run.runId, { status: failed ? 'error' : 'done', startedAt, events });
  } catch (e) {
    emit({ type: 'error', step: PLAN_STEP, at: now(), message: e instanceof Error ? e.message : String(e) });
    if (working) await putTrace(run.runId, { status: 'error', startedAt, events }).catch(() => { /* the store is the failure */ });
  }
}
