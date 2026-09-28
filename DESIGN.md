# Quarterback — design

_Plan of record for the Nebius x NVIDIA Global AI Hackathon entry (Best Apps and Agents track). Every module
below is a contract: an agent implementing a module may not change another module's interface without
updating this file in the same commit. Updated 2026-09-28 (UTC) to describe the code as it exists; anything
not yet built is marked as a target._

## The one sentence

Before UC San Diego's drop deadline, Quarterback reads a student's academic record, shows exactly what
dropping or P/NP-ing a class does to their graduation, re-plans the degree with deterministic code holding
the veto over every model proposal (a rejected draft is shown with its rule ids and, for an offering
violation, the department page's verbatim row), stress-tests the surviving plans against the department
offering evidence, and hands the approved plan to TritonPlan, the planner about 9,500 UCSD students have
accounts on, only after the student clicks approve.

## Why this shape wins

- **Dated, real problem.** Fall 2026: drop without a W by **Fri Oct 23**; change units / grading option /
  drop with W by **Fri Nov 6** (official Enrollment Calendar, `data/registrar-calendar.json`). Students guess.
- **Real audience with a channel.** A link inside TritonPlan (9,564 registered UCSD accounts, TritonPlan's own
  registry) before Oct 23 gives the video a real usage number, which almost no hackathon entry has. Target:
  the import page is a pull request on the TritonPlan repository (branch `quarterback-import`), not merged.
- **LLM proposes, code disposes.** A deterministic engine (requirement modules vendored from TritonPlan, the
  rest written here, all unit-tested) decides prerequisite chains, unit floors, requirement progress and plan
  validity. Nemotron drafts, repairs, explains and stress-tests; it never gets to be wrong about a fact the
  engine knows.
- **The refusal is the code's, with a quote.** The verifier rejects any draft that places a course in a
  quarter the department page marks as not offered, and its message carries the page's verbatim row, URL and
  fetch time. The critic refuses a plan only when it hinges on a course the department's page covers but does
  not list for that quarter, citing stored evidence by id; otherwise it records risks. The three recorded
  demos show verifier rejections and critic risks, not critic refusals.
- **Three Nemotron models, each with a measured reason** (planner configuration table in `eval/results.md`),
  on Nebius Token Factory; Tavily discovers the department pages that carry the offering evidence.

## Nemotron model map (Token Factory, `https://api.tokenfactory.nebius.com/v1`)

| Role | Model id | Settings | Why (measured) |
|---|---|---|---|
| Drafts, extraction, explanation (`extract`) | `nvidia/Nemotron-3_5-Lightning` | `chat_template_kwargs:{enable_thinking:false}` + `reasoning_effort:"none"` forced by the client for this role; `response_format: json_schema` for the intake fallback; tools + terminal `submit_plan` for the three parallel plan drafts | 1M context, $0.06/$0.24 per 1M, 600 RPM / 400k TPM. Thinking off is schema- and tool-call-valid in every run made; with thinking on its reasoning leaks into `content` on Token Factory and json_schema collapses. Its prompt cache engages on the shared prefix (33,536 of 37,732 tokens cached on the second identical-prefix call, 1,653 → ≈ 590 ms; 20,960–23,056 of ≈ 24–31k per draft on demo (a) once warm, 8,384 of ≈ 12k on demo (b), 16,768–18,864 of ≈ 20–22k on demo (c) in the shipped recordings; hits on 12/12 measured runs). Fallback `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. |
| Repair (`plan`) | `nvidia/nemotron-3-super-120b-a12b` | Thinking **off** (`enable_thinking:false` + `reasoning_effort:"none"`), forced `submit_plan`, `max_tokens: 1200`; a fresh request per repair with the rejected attempt, its violations and a code-computed replacement menu | $0.30/$0.90 per 1M; 5/5 repairs on the demos from the menu, 2.0–2.5 s per call alone. Thinking on is not used here: `reasoning_effort:"low"`, with or without `reasoning_budget: 512`, ran 19 of 19 calls to the 1,200-token cap with no tool call; `reasoning_budget` is advisory (4096 → 2,016–6,013 reasoning tokens per call in the 2026-09-27 recording). Super's prompt cache never hit (0 of 23 calls with a byte-identical 22k prefix). Fallback Ultra (same request on the fallback model). |
| Critic ("Stress-test", `critic`) | `nvidia/Nemotron-3-Ultra-550b-a55b` | `enable_thinking:true`, `reasoning_effort:"high"`, `reasoning_budget: 3072` (advisory: the recorded demo calls spent 6,916–9,338 reasoning tokens; one call ran to the earlier 8,192 `max_tokens` with no verdict, hence the cap), forced `submit_verdict`, `max_tokens: 16384` | Cross-quarter feasibility under uncertainty; the only place the $1/$3 model is spent: click-gated, one live call per run, cached per plan set (`critic-cache/`), 20 live calls a day. Fallback Super. |

Verified on 2026-09-27 with our key: tool calling round-trips (thinking on/off), streamed tool-call deltas,
json_schema with thinking off, `chat_template_kwargs` pass-through, `reasoning_effort:"none"`, 600 RPM /
400k TPM on Lightning. Prompt-cache usage fields are present on Super's responses but report 0 cached tokens;
Lightning's report the hits. Measured 2026-09-28: the planner configuration table in `eval/results.md`.

Model ids live in **one** registry (`lib/tf/models.ts`) with a fallback order; a test exercises the fallback.
Nebius removed three `nvidia/` models from serverless on Aug 31 with little notice.

## User flow (v1, as built)

1. **Start** — paste the TritonLink *Academic History* page, or pick one of three demo students (replay).
   Deterministic parse (`lib/engine/paste.ts` re-joins wrapped rows, then the vendored
   `parse-academic-history.js` + `program-match.js`) → `StudentState`. When the parser reports low confidence
   or no major file, Lightning (thinking off, json_schema) reads the paste and the UI shows the warnings for
   confirmation (`source: 'ai-intake'`, never `confidence: 'high'`).
2. **Situation** — pick a current-term course and an action: *drop*, *switch to P/NP*, or *keep*. The
   **Impact card** is instant and $0: downstream courses (direct and transitive dependents in the student's
   requirement set) and which are delayed by this alone, next listed quarter per course with its evidence row,
   delay in quarters, units against the 12-unit floor, P/NP eligibility for the requirement bucket (rule-based;
   "check with your department" when the file is silent, never a guess), deadline chips for the current term
   from the calendar, requirement-progress delta, longest remaining chain, graduation risk.
3. **Re-plan** — `planRun()`: Lightning drafts the three strategies (fastest / balanced / lightest) for the
   next three main quarters (default WI27, SP27, FA27) **in parallel**, one call each with at most one lookup
   round (`eligible_courses`, `check_prereqs`, `offering_status`) before the terminal `submit_plan`; the
   deterministic **verifier** judges every draft; failing drafts are repaired concurrently by Super (thinking
   off) from a fresh request carrying the violations and a code-computed replacement menu, at most two rounds.
   A plan that fails verification is never shown; the rejected drafts are listed with their rule ids.
4. **Stress-test** (button) — Ultra reads the plans plus offering evidence and either recommends a plan with
   risks or **refuses** one, citing evidence ids that the code resolves to stored `{quote, url, fetchedAt}`
   rows (a refusal with no stored evidence is downgraded to a risk). Overriding a refusal requires typing
   "I understand" and a reason; it is recorded on the approval.
5. **Review & approve** — recommended plan next to an alternative (or the refused plan), verifier checks as a
   checklist, consequence summary, model ledger (model, ms, tokens in / out / reasoning, cache hits, cost,
   replayed tag). **Approve** writes an approval record (sha256 of the plan's canonical JSON) and mints a
   signed one-time token:
   - *Send to TritonPlan*: opens `https://tritonplan.com/tools/quarterback-import?plan=<token>` where
     `token = base64url(JSON ImportPayload) + "." + base64url(ECDSA P-256 / SHA-256 signature, raw r||s)`; the
     page verifies the signature in the browser with WebCrypto against the public key in
     `lib/keys/import-public.json` (P-256 chosen over Ed25519 for universal WebCrypto support), shows the plan,
     and on confirm writes it into the Degree Planner store with a restore of the previous plan. The private
     key lives only in the server env (`QB_SIGNING_KEY`). Target: production tritonplan.com requires a ucsd.edu
     sign-in, so demo and replay runs should point at the staging mirror
     (https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import). `buildImportUrl` does exactly
     that: demo and replayed runs get the staging mirror, live pasted runs get tritonplan.com; `QB_IMPORT_BASE`
     overrides both.
   - *Download .ics*: the current term's deadlines and one all-day event per planned course on each dated
     term's first day of instruction; a term the calendar does not cover is named in an `X-QB-NOTE` line.
   - *Draft advisor email*: `mailto:` with no recipient, body under 1,500 characters; the student sends it.
6. **"Why not X?"** — after the plans, a course code gets a Lightning answer over the same eligibility table
   the planner saw, with its ledger line (`POST /api/explain`).

Cross-cutting: a **trace panel** streams every step over SSE (`GET /api/trace/[runId]` performs the planning
work; `POST /api/plan` only creates the run); the browser reconnects on a dropped stream and the server
replays the stored trace. `QB_MODE=live|mock|replay`. Daily and total spend caps flip a live demo student to
its recording with a banner; a pasted record over the cap gets an error. In production a demo student always
replays, so judging never spends on it. Term and deadlines are parameters, never constants.

## Tavily (load-bearing, `lib/tavily` + `lib/offerings`)

Whether a course runs in a given quarter lives only on the department pages
(`data/offerings/sources.json`: CSE, MATH, ECE, COGS), and they move yearly.

- `/search` re-discovers each page (`<DEPT> tentative course offerings 2026-2027 site:ucsd.edu`); the known URL
  wins when the results still contain it.
- Fetching follows the source shape: CSE and COGS embed a published Google Sheet that `/extract` cannot read,
  so the sheet's CSV export is found in the page HTML and fetched directly; MATH is fetched as HTML directly
  because Tavily's markdown drops empty `<td>` cells (a one-lecture-a-year course could not be placed in a
  quarter); ECE's table is served by `/extract` as markdown (status-faithful: 0 of 555 cells differ).
- A sha256 content hash skips unchanged sources. Parsing is deterministic (`lib/offerings/parse-*.ts`, no
  model): a filled cell is `offered`, a blank cell `not_offered`, only FA26 / WI27 / SP27 are emitted, and the
  page's own caveat is kept verbatim in `disclaimer`. `unknown` is never upgraded.
- The rows feed the Impact card's evidence links, the verifier's `not-offered` rule (which quotes the row),
  the planner's course table (status + evidence id per quarter) and the critic's evidence table.
- Every call sets `include_usage:true`; credits land in the spend ledger and the About page. Discovery on
  2026-09-27 cost 4 credits over 5 calls; budget ≈ 900 credits over the period against 1,000/month.
- Target, not built: a scheduled refresh (`scripts/refresh-offerings.ts` is run by hand) and the stretch use
  (public syllabus weights for grade projection).

## Deterministic core (`lib/engine`, no model)

- `StudentState` — `lib/types.ts`: `{ college, collegeFile, major, majors[], majorFile, catalogYear?, courses[{code, title?, term, units, grade, status: earned|wip|planned}], transfer, gpa, currentTerm, source, confidence, warnings }`.
- `paste` — `joinWrappedRows()` re-joins course rows a browser copy or PDF wrapped over two or three lines
  before the vendored parser sees them (E4 wrapped-layout recall 40.8% → 100%).
- `prereqs` — from `data/catalog/*.json` via `catalogByCode()` (`prereqs` = AND of OR-groups; the hand-checked
  `data/catalog-overrides.json` replaces mis-parsed rows). `prereqGroups`, `satisfied`, `missingGroups`,
  `dependents`, `transitiveDependents`, `chainQuarters`.
- `impact(state, action, now)` — dependents and delay per course, next listed quarter with evidence, unit
  floor, P/NP eligibility (bucket rule + the campus P/NP cap note), deadlines for the term, progress delta,
  longest remaining chain before / after, graduation risk, and a `notes` line for every judgment.
- `requirements` — thin wrapper over the vendored `prepareBands` / `allocate` / `courseProgress`.
- `offerings` — `offeringStatus(code, term)`: department page row, else the FA26 Schedule of Classes snapshot
  (`offered`), else CAPE history (`unknown`), else `unknown` with a "no source found" quote; `nextOffered`.
- `verifier(plan, state)` → `{ planId, ok, violations:[{rule, message, course?, term?, severity}] }`, `ok` when
  no error-severity violation. Rules: `prereq-unsatisfied` (error; a prerequisite must be complete in an
  earlier quarter), `not-offered` (error; message quotes the row, URL and fetch time), `assumed-offered`
  (warning; no evidence for the quarter), `unit-floor` (error below 12 unless the term is `partTime`),
  `unit-cap` (warning above 19.5, error above 22), `duplicate`, `already-earned` (errors), `double-count`
  (warning), `graduation-infeasible` (error). Units come from the catalog whenever every course has a fixed
  value. The planner adds `model-error` for a draft whose model call failed.
- `terms` — main-quarter arithmetic over the vendored `quarters.js`, `deadlinesFor(term, now)` from the
  registrar calendar with `passed` judged on the Pacific calendar day.

## Token Factory client (`lib/tf`)

- `chat(req)` / `chatStream(req)`: model registry + fallback order, `chat_template_kwargs` at the top level of
  the body, the `extract` role forced to thinking off, streaming with tool-call delta assembly, up to 3 retries
  on 429 / 5xx / network errors honouring `Retry-After` (capped at 20 s), 120 s timeout per attempt, one retry
  on the role's fallback model when a model is gone or keeps rate-limiting (ledger entry marked `fallback`),
  per-request **ledger** entry `{model, ms, promptTokens, completionTokens, reasoningTokens, cacheHitTokens,
  usd, replayed}` priced from the registry. No TPM queue and no `waiting` event are implemented.
- Helpers: `structured()` (json_schema, thinking off, one correction retry), `forcedTool()` (forced tool call,
  one correction retry, emits a `model` event per call), `toolLoop()` (assistant ↔ tool rounds; `terminal`
  tool names end the loop without running).
- Record/replay: in `mock` and `replay` mode every request is keyed by `sha256(stable JSON of model, messages,
  tools, tool_choice, response_format, chat_template_kwargs, reasoning_effort, temperature, max_tokens)` and
  served from `fixtures/tf/`; unknown keys throw `MissingFixtureError`. `QB_RECORD=1` in live mode writes
  fixtures.
- Budget guard: `QB_DAILY_CAP_USD` / `QB_TOTAL_CAP_USD` from env, checked against the persistent ledger's
  non-replayed spend before every live call; `BudgetExceededError` is what the routes catch.

## Agents (`lib/agents`)

- `intake` (Lightning, fallback only) → `StudentState` with `source: 'ai-intake'`.
- `planner` — `planRun({state, action, impact, options?, onEvent?, tf?})` → `{plans, reports, rejectedDrafts,
  rounds, ledger}`. Phases DRAFT (three concurrent Lightning calls, tools `eligible_courses(term, planned)`,
  `check_prereqs(code, term, planned)`, `offering_status(code, term)`, terminal `submit_plan(terms, rationale,
  graduationTerm)`), VERIFY, REPAIR (Super, thinking off, `repairBrief` with `replacementMenu()` per bad slot,
  ≤ 2 rounds). Options `{draftRole, repairRole, reasoningEffort, maxRepairRounds, horizonTerms}` with env
  overrides `QB_DRAFT_ROLE`, `QB_REPAIR_EFFORT`; defaults from the measurement. Context pack: byte-identical
  shared prefix (system + requirement buckets + course table with units, prerequisites and an evidence id per
  quarter, a pure function of major file, college file, current term, horizon and data snapshot) then the
  student suffix; tests assert prefix identity across students of one major/college. Plan ids `p-<label>`,
  `p-<label>-2`, `p-<label>-3` for draft and repairs.
- `critic` (Ultra) — input: plans, verifier reports, the evidence index (every planned course × horizon term,
  `ev_<CODE>_<TERM>`), the student after the action, prerequisite satisfaction per planned course, the
  department pages' caveats; output via forced `submit_verdict`; `resolveVerdict` drops unknown ids, downgrades
  unsupported refusals to risks and only recommends a shown, non-refused plan.
- `explain` (Lightning) — "why not CSE 105?" over the eligibility row, the record and alternatives for the
  same requirement; ≤ 3 sentences, `max_tokens: 220`.

## Storage (`lib/store`)

No database. One `ObjectStore` interface: private Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (the token
is accepted only from inside Vercel; locally it is refused), else `QB_DATA_DIR` or `.data/` on disk. Keys:
`runs/<runId>`, `saved/<qb_id>`, `approvals/<apr_id>`, `traces/<runId>`, `ledger/<UTC day>/<ulid>`,
`critic-cache/<sha256>`, `critic-quota/<UTC day>`. Only write-once keys are served from the process-local
cache (a stale-run bug seen on the Vercel preview). The pasted text is parsed in memory; the parsed record is
written with the run when planning starts (a serverless request has to read it back), Save copies the run to a
shareable random id, Delete removes the run, its saved copy, its trace and its approvals. Telemetry is
aggregate only.

## Repo layout

```
app/                Next.js 16 App Router (TypeScript, Tailwind 4)
  page.tsx          start (paste / three demo students)
  plan/             /plan?demo=a&course=CSE%2029&action=drop; plan/[id] = saved run
  about/            how it works, model table, live spend figures, sources
  api/…             intake, impact, plan, trace (SSE, does the work), run, stress, explain, approve, ics,
                    save, catalog, ledger/summary
lib/engine/         deterministic core + tests
lib/tf/             Token Factory client, registry, ledger, budget, record/replay, helpers
lib/tavily/         Tavily client (search / extract / map) with credit ledger
lib/offerings/      discovery and the per-source parsers that write data/offerings/<DEPT>.json
lib/agents/         intake, planner (context pack, tools), critic, explain
lib/store/          Blob/disk store, runs, approvals + signed import token, ledger sink, .ics, mailto
lib/vendor/tritonplan/  seven pure engine modules copied from TritonPlan (MIT; see NOTICE)
data/               public UCSD data snapshot: 90 catalog subject files (15,249 entries), 142 major files
                    (index: 124 high / 16 medium confidence), 8 college GE files, CAPE grades 2,750 courses,
                    FA26 sections 2,267 courses, registrar calendar, offerings (CSE, MATH, ECE, COGS), 3 demo
                    students, catalog prerequisite overrides
fixtures/           recorded Token Factory (tf/) and Tavily responses, the three recorded demo runs (runs/)
eval/               synthetic students, E1 and E4 runners, greedy optimum, results.md
scripts/            record-demos, measure-planner, refresh-offerings, tf-probe, audit-prereqs, node-ts preload
devpost/            SUBMISSION.md (paste-ready), GALLERY.md, VIDEO.md, feedback.md, docs.test.ts
notes/              module owners' hand-offs and requests
```

## Evaluation (tables in `eval/results.md`; losing configs kept)

- **Planner configuration** — measured live 2026-09-28: 12 students (3 demos + 9 synthetic, 12 major/college
  pairs) × 4 configs, 46 runs, $1.04. A (Lightning drafts + Super repair, thinking off) shipped: 1.75 plans per
  student, 83.3% of students with a plan, 23.9 s mean / 27.0 s p50 / 37.2 s max, $0.0249 per student.
- **E1 plan validity and optimality** — target: synthetic students from the 124 high-confidence major files ×
  8 colleges plus planted-risk cases (not-offered, unknown-on-page, heavy load). Metrics: validity first pass
  and after repair, rounds, progress per quarter vs a greedy optimum, refusal precision and plant recall,
  tool-call success, cache hits, $ and latency. Run so far: mock only; the table in `eval/results.md` replays the
  2026-09-27 recordings, the replay test in `eval/e1.test.ts` the 2026-09-28 ones.
- **E2 recall by context length** — target: whole-slice reads on Lightning vs a RAG arm
  (`Qwen/Qwen3-Embedding-8B`, top-20 chunks) with the same judge. Not run.
- **E3 Tavily ablation** — target: plans with vs without offering evidence; share placing a course in a
  quarter the department page marks not offered. Not run.
- **E4 intake accuracy** — measured 2026-09-28, mock: 30 synthetic Academic History pastes in six layouts; row
  precision 100%, recall 95.7% overall (100% on five layouts, 76.0% on `reordered` from one paste whose
  transfer block precedes the quarters — upstream parser state), major file 96.7%.
- **E5 live telemetry** — target: sessions, plans approved, verifier rejections, refusals shown / overridden,
  cache-hit rate, total spend. Aggregate only. Not started.

Deterministic tests (Vitest, CI at $0 in mock mode): 454 tests in 53 files on 2026-09-28 (453 pass, 1 skipped
gated live run, 0 failures; the demo-replay, E1 replay, explain-route and recorded-demo tests run against the
2026-09-28 recordings), plus `devpost/docs.test.ts` (8). `npx tsc --noEmit`, eslint and `next build` clean.

## Stage 1 compliance

Runtime Token Factory calls from the live demo (three Nemotron models, named identically in README, Devpost,
Built With and the video audio); genuine multi-step tool-chaining workflow with a real action behind an
approval gate; fresh public MIT repo with meaningful history; working public demo URL that survives Dec 1–15
(demo students replay in production, live capped); ≤3-minute YouTube video with audio; required written
feedback on Nebius/NVIDIA tools drawn from measurements; Tavily `/search` + `/extract` calls that change the
decision. TritonPlan is the data source and the write target, not the product.

## What we deliberately do not build

RAG (the whole slice fits in context; E2 is to measure the gap), a database, auth, Sandboxes (no code
execution in this product), fine-tuning (Nemotron cannot be fine-tuned on Token Factory), a chat interface.

## Deployment

Vercel project `quarterback` (team sss-4bfd). Public production alias: **https://quarterback-delta.vercel.app**
(also quarterback-sss-4bfd.vercel.app). Deployment protection is preview-only, so previews need a Vercel login
and production is public. Staging = `vercel deploy --yes --target=preview` from a clean clone of the committed
tree; production = Sahir's explicit OK per change. As of 2026-09-28 the alias still serves the scaffold; the
Stage B commit is verified on a preview (SSE streamed live from `GET /api/trace`, `maxDuration = 300`
honoured, private Blob overwrite and read-back verified from inside Vercel). Env vars: `NEBIUS_API_KEY`,
`TAVILY_API_KEY` (all environments), `BLOB_READ_WRITE_TOKEN` (works only inside Vercel; local dev uses
`QB_DATA_DIR=.data`), `QB_SIGNING_KEY`, and in production `QB_MODE=live` with `QB_DAILY_CAP_USD` /
`QB_TOTAL_CAP_USD`. `QB_MODE` defaults to `mock` locally.

## Decisions log

- 2026-09-27 — Chosen from a 16-proposal, 5-judge panel; runner-up "Registrar" (compile prose degree
  requirements into tested rule files) shares 60% of this data layer and is the pivot if UCSD-facing work
  becomes impossible. Postgres, Serverless Job and the nightly whole-cohort Lightning read were cut from v1
  (on-demand slice reads instead). Registrar deadlines and department offering pages verified against
  primary sources the same day.
- 2026-09-27 — MATH offerings parsed from the page HTML, not Tavily's markdown (empty cells dropped); COGS
  found to be a Google Sheet like CSE, read as CSV via the iframe discovered in the page HTML; ECE via
  `/extract`. Offering rows parsed deterministically; the earlier plan to have Lightning emit them was not
  needed.
- 2026-09-27 — Import token is ECDSA P-256 (WebCrypto-verifiable in every browser), not Ed25519; import URL
  is `/tools/quarterback-import`.
- 2026-09-28 — Planner restructured from one Super tool loop (thinking on, `reasoning_budget: 4096`, ≤ 3
  rounds, tools `unit_check` / `requirement_progress` / `grade_history`) to parallel Lightning drafts →
  verify → Super repair (thinking off) from a code-computed menu, chosen by the measured table (A vs B within
  noise on validity, 2.2× faster, half the cost). Reason: `reasoning_effort:"low"` and `reasoning_budget` do
  not bound Super's reasoning on this task, and Super's prompt cache never hits while Lightning's does.
- 2026-09-28 — Store serves only write-once keys from the process cache (stale run seen on the preview).
- 2026-09-28 — Intake pre-normalizer for wrapped rows (E4 wrapped recall 40.8% → 100%).
