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
