import { fixtureFor } from '../../_lib/mock';
import { store } from '../../_lib/store';

/** GET /api/trace/[runId] → text/event-stream of TraceEvent JSON, one `data:` line per event. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = store.runs.get(runId);
  if (!run) return new Response('Unknown run', { status: 404 });
  const script = fixtureFor(run.state).trace;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener('abort', finish);
      let i = 0;
      const next = () => {
        if (closed) return;
        if (i >= script.length) return finish();
        const { delayMs, event } = script[i++];
        timer = setTimeout(() => {
          if (closed) return;
          const payload = { ...event, at: new Date().toISOString() };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          next();
        }, delayMs);
      };
      controller.enqueue(encoder.encode('retry: 30000\n\n'));
      next();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
