# Notes from the app/ owner (UI + route stubs)

Requests and assumptions that touch other modules. Nothing outside `app/` and `public/` was edited.

## Route contracts implemented (stubs, mock data from `app/_mock/*.json`)

`POST /api/intake`, `POST /api/impact`, `POST /api/plan`, `GET /api/trace/[runId]` (SSE), `GET|DELETE /api/run/[runId]`,
`POST /api/stress`, `POST /api/approve`, `GET /api/ics/[approvalId]`, `POST /api/save` — exactly as specified.
Response envelopes the UI reads are typed in `app/lib/contracts.ts` (`RunRecord`, `ApproveResponse`, `SaveResponse`).
Stub internals live in `app/api/_lib/{store,mock,impact,catalog}.ts`; the agents/routes owner replaces those and keeps
the `route.ts` files' shapes.

- **Added one read-only route not in the list: `GET /api/catalog?codes=CSE 29,…` → `{code: {title, units}}`.**
  `Plan.terms[].courses` carries codes only and the spec asks for "course code + title + units per term", so the UI
  looks titles up from `data/catalog/<page>.json` via `data/catalog/_page-map.json`. It reads with `fs` under a
  static `data/catalog` prefix; on Vercel, confirm the directory is traced into the function bundle
  (`outputFileTracingIncludes` in `next.config.ts` if not). The engine module will hit the same question.
- `GET /api/run/[id]` accepts either a runId or a saved id (Save mints `qb_…` and aliases it). `DELETE` removes the
  run, its saved aliases and its approvals.
- `POST /api/approve` returns 409 when the plan is in `verdict.refused` and no override
  `{refusalPlanId, reason, phrase: 'I understand'}` is present. The approval record stores the overrides.
- Import URL follows the task text: `https://tritonplan.com/tools/quarterback-import?plan=<token>`.
  DESIGN.md says `tritonplan.com/tools/import?plan=`. One of the two should be corrected; the UI just opens
  `ApproveResponse.importUrl`. The stub token is `base64url(ImportPayload).unsigned-stub`; the real one is Ed25519-signed.
- The trace is *replayed* by `GET /api/trace` from a scripted fixture; `POST /api/plan` fills plans/reports/ledger at
  once so `GET /api/run` is consistent whenever it is hit. `GET /api/trace` honours `request.signal` and clears its timer.
- The paste path (`POST /api/intake {text}`) is not parsed in this build: it returns the first demo record with
  `source: 'paste'`, `confidence: 'low'` and a warning that says so. The intake agent replaces that branch.

## Assumption that needs the engine + offerings owners' agreement

The demo (a) refusal story only works if the verifier does **not** hard-fail a blank cell on a *tentative*
department sheet. `data/offerings/sources.json` says a blank CSE cell means "not offered", and DESIGN's verifier
rejects `not_offered` — but a refused plan must have `VerifierReport.ok: true` or it is never shown. The fixtures assume:

- Evidence from a `department-page` (tentative sheet) with a blank cell has `status: 'not_offered'` and the verifier
  emits `rule: 'assumed-offered', severity: 'warning'` (plan still `ok`). `not_offered` from `schedule-of-classes`
  is an `error` (`rule: 'not-offered'`).
- The critic (Ultra) then refuses the plan that hinges on such a course, quoting the row.

Demo (a) uses **CSE 194 in WI27** (`CSE-194,"Race, Gender, and Computing",Imani Munyaka,,`), not the CSE 141 row named
in the task: CSE 141 needs CSE 30 and CSE 140, which a student who just dropped CSE 29 cannot have, so the verifier
would reject it as `prereq-unsatisfied` and it could never be a *refused* plan. CSE 194 is in the AI major's Ethics
bucket and its prerequisites (CSE 12 + HUM 2) are on the demo record. Quotes are verbatim lines from
`data/offerings/raw-cse-2026-27.csv` / `raw-math-2026-27.md` (a test checks this; the CSE-100 quote contains the
embedded newline of its quoted cell).

## Semantics the UI relies on

- `Impact.deadlines` are computed from `data/registrar-calendar.json` for `state.currentTerm`; `passed` compares
  LA calendar days (deadlines are 11:59 p.m. PT). `app/lib/deadlines.ts` also derives the current term from the
  calendar (`currentTermFromCalendar`) for the Start page — the engine's `terms` module should agree.
- `BlockedCourse.nextOffered` is read as "next term the department lists it"; `delayQuarters` carries the student's
  actual delay. Rendered as "Next listed Winter 2027 · 1 quarter later".
- `LedgerEntry.usd` in the fixtures is priced from the DESIGN rates (Lightning 0.06/0.24, Super 0.30/0.90,
  Ultra 1/3 per 1M) — the test asserts it, so keep `lib/tf/models.ts` prices in sync or update the fixtures.
- Model badges match the id by substring (`lightning|nano` → Lightning, `super`, `ultra`); no ids in `app/` code.

## Side effects noticed

- `next dev` / `next build` (Next 16) append a `<!-- BEGIN:nextjs-agent-rules -->` block to `AGENTS.md`. I removed
  it after each run; set `agentRules: false` in `next.config.ts` (root config, not mine) to stop it.
- `next dev` warns that a `package-lock.json` in `/Users/sahir` sits outside the repo and suggests `turbopack.root`.
- Mid-task `npx tsc --noEmit` failed in `lib/offerings/parse-sheet-csv.test.ts` (missing `./parse-cse-csv`); it was
  clean again by the time I finished, so no action needed.

---

# Routes are wired to the real pipeline (agents/routes owner, 2026-09-27)

Everything above describes the stub build; where this section differs, it supersedes it. Nothing in `app/components`
or `app/page.tsx` was edited. Edits outside `app/api/**`: `app/lib/contracts.ts` (two optional `RunRecord` fields and a
`LedgerSummary` type), `app/lib/flow.test.ts` (one line: `f.impact` for `f.impacts[…]`), `app/_mock/*`.

## What changed under the routes

- `app/api/_lib/store.ts` and `_lib/impact.ts` are gone: runs live in `lib/store` (Vercel Blob with
  `BLOB_READ_WRITE_TOKEN`, else `QB_DATA_DIR || .data/` on disk), impacts come from `lib/engine`'s `impact()`.
- `app/api/_lib/mock.ts` keeps its exports (`demo`, `demoIds`, `demoCards`) but now loads the RECORDED runs
  `fixtures/runs/demo-{a,b,c}.json` (static JSON imports, bundled by Next). The authored `app/_mock/demo-*.json` are
  deleted; `app/_mock/mock.test.ts` asserts the recorded fixtures' invariants against the engine and the model registry.
- `app/api/_lib/pipeline.ts` installs the persistent ledger sink at module scope, decides the serving mode, runs or
  replays the planner and keeps `traces/<runId>`, `critic-cache/<key>` and `critic-quota/<UTC day>` beside a run.
- New route: `GET /api/ledger/summary` → `LedgerSummary` (`app/lib/contracts.ts`): live (non-replayed) spend by model
  and step, Tavily credits, today's and total spend against `QB_DAILY_CAP_USD` / `QB_TOTAL_CAP_USD`, live stress-tests
  today against the cap of 20. For the About page and the video's numbers card.
- Route tests: `app/api/routes.test.ts` runs all three demo flows through the real handlers in mock mode (intake → impact
  → plan → trace SSE → run → stress → approve → ics → save → delete), the 409/400 approval gate, the live→replay
  fallbacks and the reconnect guard; `app/api/intake/route.test.ts` covers the Lightning fallback branch;
  `app/api/live.e2e.test.ts` is the gated live run (`QB_LIVE_E2E=1 QB_MODE=live …`, ≈ $0.10).

## The demo students changed

The recorded runs use `data/demo`: (a) Revelle · Artificial Intelligence, drop CSE 29; (b) **Marshall · Cognitive
Science, drop COGS 109**; (c) **Sixth · Mathematics–Computer Science (transfer), drop CSE 101**. `demoCards` derives the
cards from the fixtures, so the Start page needs no change. Real recordings differ from the authored mock:
rejected drafts 1 / 0 / 0 (the "code rejected N drafts" copy already hides N = 0), **no refusal in any verdict** (the
RefusalCard / override flow is exercised only by the constructed verdict in `routes.test.ts`; see notes/agents.md for the
engine rule behind that), Lightning appears in no route trace (explain/intake are not part of the flow).

## What the UI must render differently

1. **`POST /api/plan` only creates the run; `GET /api/trace/[runId]` performs the work.** `run.plans` is `[]` until the
   stream ends with `done`. The `es.onerror` branch in `PlanFlow.tsx` ("the stub's plans are complete as soon as the run
   exists") is now wrong: on a dropped connection it fetches an empty run and shows "0 plans passed". Let `EventSource`
   reconnect instead of closing on error — the server replays the stored events for a finished run, and for a run still
   being planned it emits a step ("Planning is already in progress…"), waits for the other request, then replays. Only
   a `done` or `error` event should end the stream. Live planning takes 90–170 s (recorded: a 144 s, b 89 s, c 111 s,
   live check 105 s), so the "About ten seconds" hint needs a rewrite; a replay takes ≈ 11 s / 11 s / 6 s (gaps capped at
   1.5 s).
2. **`RunRecord.mode`** is `'live'` or `'replay'` once the trace has run (absent before). Show a banner for `'replay'`:
   in `QB_MODE=replay|mock`, for a demo student in production (`VERCEL_ENV=production` never spends on a recorded demo),
   and after a live failure — the spend cap (`BudgetExceededError`) or a Token Factory error — in which case a `step`
   event in the trace says "Live mode is paused for the day: … Showing the recorded run for this demo student." A pasted
   record with no recording ends in an `error` event with that message instead. `RunRecord.options` carries
   `{horizonTerms}` when the client sent it (the UI does not today).
3. **Replayed ledger entries carry `replayed: true`** (Ledger.tsx already shows the "replay" tag) with `at` stamped on
   the replay's clock (start + recorded offset), so `at` stays unique per entry — `PlanFlow.stress()` dedupes by it.
   Live entries are real: 0 cache hits every time so far (do not claim cache savings).
4. **Only the recorded situation replays.** For a demo student the picker is still live; another course/action gives:
   mock → `GET /api/trace` responds 500 JSON (`error` names the missing recording); replay → a single `error` event;
   live (incl. production) → a real Super run, which costs money. Consider locking the picker to the card's headline for
   demo students in production, or accept the spend.
5. **Stress-test.** Replay returns the recorded verdict (and its Ultra ledger entry, replayed). Live: cached per plan
   set (`critic-cache/`), at most one live call per run (`run.verdict` is final) and 20 per day; over the cap or after a
   failure a recorded demo gets its verdict with a note appended to `summary`; a pasted record gets a placeholder
   `{recommend: null, refused: [], risks: [], summary: 'The daily limit … Try again tomorrow…'}` that is NOT stored — the
   flow currently hides the button after any verdict, so a placeholder blocks a retry until reload; the UI could keep the
   button when `recommend === null && refused.length === 0`.
6. **Approve.** 400 for an unknown plan or one that failed verification, 409 for a refused plan without an exact
   `{refusalPlanId, reason, phrase: 'I understand'}` override, 500 with an explicit message when `QB_SIGNING_KEY` is
   unset (the approval record is still written). `importUrl` is the ECDSA P-256 signed
   `https://tritonplan.com/tools/quarterback-import?plan=<token>`; `mailto` comes from `lib/store/mailto` (no recipient,
   ≤ 1,500 chars); `icsUrl` serves `lib/store/ics` — one all-day event per course on the term's first day of instruction,
   and an `X-QB-NOTE` line for terms the calendar does not cover (every demo plan's FA27); calendar apps hide X- lines, so
   say it next to the download link. `ApprovalRecord.planHash` is the 64-char sha256 (pre-existing mismatch with the
   8-char FNV in `ApproveDialog`/`PlanFlow`; store owner's suggestion: show `planHash.slice(0, 8)` or compute sha256
   client-side).
7. **Intake.** `{text}` runs the deterministic parser; when confidence is `low` or the major file is null, Lightning
   reads the paste (`source: 'ai-intake'`, `confidence: 'medium' | 'low'`, `warnings` say what to confirm). If that call
   is unavailable (mock mode, cap, outage) the parser's result comes back with an extra warning. `{demo}` returns the
   `data/demo` record. `Impact.notes` from the engine can run to 20+ lines (demo a); the card may want a cap.
8. **`DELETE /api/run/[id]`** also removes the stored trace; `GET /api/run/[id]` accepts a runId or a saved `qb_` id.

## Deployment and local-dev flags

- Production: `QB_MODE=live`, `QB_DAILY_CAP_USD`, `QB_TOTAL_CAP_USD`, `QB_SIGNING_KEY`, a VALID `BLOB_READ_WRITE_TOKEN`.
  `VERCEL_ENV=production` (set by Vercel) makes demo situations replay at $0.
- Local: the `BLOB_READ_WRITE_TOKEN` currently in `.env.local` is refused by Vercel Blob ("Access denied") — with it
  present every store call (and so every route) fails under `next dev`; remove it or create the project's Blob store.
  The tests never hit Blob (`setStore(createStore({dir}))`).
- `next build` (2026-09-27) succeeds; it warns that `lib/store/blob.ts`'s `path.resolve(process.cwd(), QB_DATA_DIR ||
  '.data')` makes Turbopack trace the whole project into the server bundle — store owner's file, see the report.
- Live check of demo (a) through the routes on 2026-09-27: $0.1032 (Super 7 calls $0.0819 / 104.8 s, Ultra 1 call
  $0.0214 / 13.5 s), 2 plans passed, 1 draft rejected, verdict recommended p-fastest, no refusal, 0 cache hits, no
  fallback model.

---

# UI polish pass (app/ owner, 2026-09-27, later)

Details and measurements in `notes/ui-polish.md`. Requests and things other owners should know:

- **engine (`lib/types.ts` `Violation`)** — please add `evidence?: OfferingEvidence` to the violations the verifier
  emits for `not-offered` / `assumed-offered`. The "What the code rejected" panel (`app/components/RejectedDrafts.tsx`)
  reads it structurally today (quote, source link, fetched date) and falls back to the message text, which for
  `not-offered` embeds the quote and URL as prose. No recorded draft carries one yet (demo a's rejected draft fails on
  `already-earned` and `prereq-unsatisfied`).
- **New route `POST /api/explain {runId, code}` → `{code, text, entry}`** (`app/api/explain/route.ts`,
  `ExplainResponse` in `app/lib/contracts.ts`). It rebuilds the planner's eligibility table from the stored run
  (`buildPlannerContext(run.state, run.action, run.impact, {horizonTerms: run.options?.horizonTerms})`), calls
  `whyNot` with `applyAction(run.state, run.action)`, appends the Lightning entry to `run.ledger`, and answers 400 for a
  malformed or unknown course code, 503 with a hint (`fixtureFor(...).explain.code`) on `MissingFixtureError`, 502 on
  any other failure. Its test depends on the recorded fixture the same way `lib/agents/demo-replay.test.ts` does: a
  prompt or table change re-keys it (re-record with `scripts/record-demos.ts`).
- **agents / deployment** — in production (`QB_MODE=live`) "why not?" on a demo student is a real Lightning call
  (`chat()` reads `mode()`, not `serveMode(run)`), ≈ 600 prompt tokens, under $0.0001; the budget guard applies. That
  is the one runtime Token Factory call a judge can trigger on a recorded demo. Say so if you would rather it replay.
- **routes** — `RunRecord.rejectedDrafts` is no longer read by the UI; the panel derives from `reports` (`ok:false`).
  The field stays in the contract. `GET /api/trace`'s `retry: 30000` is what a browser reconnect waits; 5–10 s would
  make a dropped stream recover visibly faster.
- **store** — resolved: the client-side FNV fingerprint is gone; the UI shows `approval.planHash.slice(0, 8)` (title
  attribute carries the full sha256) on the review line, the approved notice and the actions panel.
- `app/lib/planHash.ts` and its test were deleted; new pure helpers with tests: `app/lib/trace.ts` (`collapseTools`,
  `elapsedMs`, `formatElapsed`, `stepTier`, `inFlight`) and `deadlineHeadline` / `icsCoverage` in `app/lib/deadlines.ts`;
  new reducer messages `trace-reset`, `trace-connection`, `ledger` in `app/lib/flow.ts`.
- The ledger table, About page live figures and the actions captions all show replayed calls as replayed; no cache
  savings are claimed anywhere (0 cache hits in every recording).
