# Orchestrator notes (2026-09-27 → 28) — facts the docs must reflect

Verified on the Vercel preview of the Stage B commit (bypass header, raw curl):
- SSE streams live from `GET /api/trace/[runId]` on Vercel: events arrived at 1 s, 15 s, 42 s, 49 s, 72 s
  wall-clock while a live Super run executed; total 72 s, 4 Super calls, $0.037, 1 plan passed, 2 drafts
  rejected. `maxDuration = 300` was honoured.
- The private Blob store works from inside Vercel (overwrite + immediate read-back verified with a temporary
  diagnostic route, since removed); its v2 token is refused from a laptop, so local dev uses the disk store
  (`QB_DATA_DIR=.data` in .env.local, no Blob token locally).
- Bug found and fixed (commit 6b46b16): the store's process-local LRU served stale `runs/<id>` records —
  a warm instance that had cached the freshly created run kept returning it with no plans after another
  instance had stored the results. Now only write-once keys (`ledger/`, `approvals/`, `critic-cache/`) are
  cached; runs, saved copies and traces always read through.
- Deployment protection bypass secret for automated preview testing lives in `.vercel/bypass-secret`
  (git-ignored); use header `x-vercel-protection-bypass`. Previews are deployed from a clean clone of the
  committed tree so half-written files never ship.
- Token Factory prompt caching, measured 2026-09-27 with an identical 37.7k-token prefix: Lightning hit
  33,536 cached tokens on the 2nd call (1,653 → ~590 ms); Super hit 0 across 5 probe calls and 18 planner
  calls, with and without `prompt_cache_key`.
- TritonPlan side: PR https://github.com/SahirSSharma/tritonlink/pull/23 (branch `quarterback-import`),
  staging mirror https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import; production
  ships only on Sahir's OK. tritonplan.com is behind a ucsd.edu Google sign-in, so demo/replay runs should
  point their import link at the staging mirror.
- Production alias https://quarterback-delta.vercel.app still serves the scaffold; promotion is Sahir's call.
