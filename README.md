# Quarterback

Before UC San Diego's drop deadline, Quarterback reads a student's academic record, shows what dropping or
switching a class to P/NP does to their graduation, re-plans the degree with deterministic code holding the
veto over every model proposal (every rejected draft is listed with the rule that rejected it; an offering
violation carries the department page's verbatim row, its URL and the fetch time), stress-tests the surviving
plans against the department offering evidence, and hands the approved plan to TritonPlan only after the
student clicks Approve.

Built for the Nebius x NVIDIA Global AI Hackathon (Best Apps and Agents track) on Nebius Token Factory with
three NVIDIA Nemotron models, with Tavily discovering the department pages the offering evidence comes from.

- Repository: https://github.com/SahirSSharma/quarterback (MIT)
- Demo: `[live demo]` — the production alias https://quarterback-delta.vercel.app still serves the Next.js
  scaffold as of 2026-09-28; the product is promoted only on the author's explicit OK (see
  [PROGRESS.md](PROGRESS.md)). Previews are deployed and verified; they need a Vercel login.
- Plan of record: [DESIGN.md](DESIGN.md). Progress: [PROGRESS.md](PROGRESS.md). Changes: [CHANGELOG.md](CHANGELOG.md).

**Status, 2026-09-28 (UTC).** The whole flow runs end to end in mock mode at $0 (paste or demo student →
impact → plans → stress-test → approve → TritonPlan link / .ics / advisor email → save / delete), and ran live
against Token Factory between 2026-09-27 and 2026-09-28 UTC (the recorded demos, a Vercel preview, one measured
run through the routes, the planner measurement).
The planner was restructured on 2026-09-28 after a live measurement (table below). Not done yet: the three demo
recordings still come from the previous planner, so what a judge sees in replay mode is not what the shipped
code does live; the production alias is not promoted; the TritonPlan import page is a pull request on the
TritonPlan repository; E1 has only run against the old recordings, and E2, E3 and E5 have not run. Every
number in this file is either measured (with its source) or marked as a target.

## The problem

Fall 2026 at UC San Diego, from the official Enrollment and Registration Calendar
([blink.ucsd.edu](https://blink.ucsd.edu/instructors/courses/enrollment/calendars/2026.html), snapshot in
[`data/registrar-calendar.json`](data/registrar-calendar.json)):

| Deadline (11:59 pm PT) | What closes |
|---|---|
| Fri Oct 23, 2026 | Drop without a W |
| Fri Nov 6, 2026 | Change units, change grading option (letter or P/NP), drop with a W |

Between those dates a student asks: if I drop this class now, what happens to next year? The honest answer
depends on the prerequisite chain, whether the follow-on course is offered in Winter at all, the 12-unit
full-time floor, whether the requirement bucket accepts P/NP, and how many quarters are left. Every piece of
that is public, but it is spread across the General Catalog, a department's tentative-offerings page, the
registrar calendar and the student's own record. Nobody assembles it before the deadline, so students guess.

## What the student gets

1. **Impact, instantly.** Paste the TritonLink Academic History page or pick one of three demo students,
   choose a current-term course and an action (drop, switch to P/NP, keep). The Impact card shows which
   downstream courses depend on it and which are delayed by this alone, when each is next listed by its
   department (with the source row behind an Evidence link), the delay in quarters, units against the
   12-unit floor, whether the requirement accepts P/NP (or "check with your department" when the file is
   silent; never a guess), the deadlines for the current term, the change in requirement progress and the
   longest remaining prerequisite chain. No model call is made for this step.
2. **Plans that have been checked by code.** Re-plan drafts three plans for the next three quarters (fastest
   to degree, balanced, lightest) in parallel, verifies every draft, and repairs the failing ones with the
   violations and a code-computed replacement menu. Every plan shown has passed the verifier: prerequisites
   complete by the quarter they are needed, no course in a quarter its department page marks as not offered,
   unit floor and cap, no duplicates, nothing already earned, no double-counting, graduation still reachable.
   A plan that fails is never shown; the "What the code rejected" panel lists each rejected draft with the
   rule ids that rejected it, and an offering violation carries the page's verbatim row, URL and fetch time.
3. **A stress-test with evidence.** The critic reads the surviving plans against the offering evidence and
   recommends one plan with the risks to re-check. It refuses a plan only when the plan hinges on a course the
   department's page covers but does not list for that quarter (placements the page marks as not offered
   never reach it; the verifier rejects them first). A refusal shows the stored quote, URL and fetch time;
   overriding it requires typing "I understand" and a reason, which is recorded on the approval. None of the
   three recorded demos contains a refusal; each recommends a plan and lists risks.
4. **"Why not X?"** Name a course you expected and get a short answer from the same eligibility table the
   planner saw: what is missing and the earliest quarter it fits, with the call's own ledger line.
5. **Approve, then act.** Recommended plan next to an alternative, the verifier checks as a checklist, a
   consequence summary and the ledger of what each step cost. Approve writes an approval record (with the
   plan's sha256 fingerprint) and mints a signed token; only then can the student:
   - **Send to TritonPlan** — a signed link that opens the TritonPlan import page, which verifies the
     signature in the browser and, on confirm, writes the plan into the Degree Planner with a restore of the
     previous plan;
   - **Download .ics** — the current term's deadlines and one all-day event per planned course on each dated
     term's first day of instruction (a term the calendar does not cover yet is listed, not dated);
   - **Draft advisor email** — a prefilled `mailto:` with no recipient; the student sends it.

A trace panel streams every step over SSE as it happens: model, milliseconds, tokens, reasoning tokens,
cost, cache hits, tool calls, verifier reports. The browser reconnects on a dropped connection and the server
replays the stored trace.

**What is stored.** The pasted text is parsed in memory by `POST /api/intake` and kept in the browser's
session storage. When the student clicks Re-plan, the parsed record and the run are written to the store
(`runs/<runId>`, Vercel Blob in production, `.data/` on disk locally) so a serverless request can read them
back; Save copies the run to a shareable random id; Delete removes the run, the saved copy, the trace and the
approvals. Telemetry is aggregate only (spend by model and step).

## How it works

### Three Nemotron models on Nebius Token Factory

All inference runs through the OpenAI-compatible endpoint at `https://api.tokenfactory.nebius.com/v1`. Model
ids live in one registry, `lib/tf/models.ts`, with a fallback order and a test that exercises the fallback.
Settings are exactly as sent in the request body.

| Role | Model id | Settings | Why (measured) |
|---|---|---|---|
| Drafts, extraction, explanation | `nvidia/Nemotron-3_5-Lightning` | `chat_template_kwargs:{enable_thinking:false}` + `reasoning_effort:"none"` on every call (the client forces both for this role); `response_format: json_schema` for the intake fallback; tools + terminal `submit_plan` for the three parallel plan drafts | 1,048,576-token context, $0.06 / $0.24 per 1M tokens in / out, 600 RPM / 400k TPM on our key. With thinking off every json_schema and tool-call reply we made was valid; with thinking on its reasoning leaks into `content` and json_schema collapses. Its prompt cache engages on the planner's byte-identical prefix (table below), so three concurrent drafts cost ≈ $0.003 each. Fallback `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (same price, 262,144 context, 100 RPM / 800k TPM). |
| Repair | `nvidia/nemotron-3-super-120b-a12b` | Thinking **off** (`enable_thinking:false` + `reasoning_effort:"none"`), forced `submit_plan` tool call, `max_tokens: 1200`, a fresh request per repair carrying the rejected attempt, its violations and a code-computed replacement menu | 262,144-token context, $0.30 / $0.90 per 1M. Repairs from the menu passed 5/5 on the demos; Lightning as the repairer resubmits the same plan. Thinking on is not used: `reasoning_effort:"low"` (with or without `reasoning_budget: 512`) ran every one of 19 calls to the 1,200-token cap with no tool call, and its prompt cache never hit (0 cached tokens across 23 calls with a byte-identical 22k prefix). Fallback Ultra (the same request on the fallback model). |
| Critic (Stress-test) | `nvidia/Nemotron-3-Ultra-550b-a55b` | `enable_thinking:true`, `reasoning_effort:"high"`, `reasoning_budget: 3072` (advisory: the recorded demo (a) call spent 6,865 reasoning tokens), forced `submit_verdict`, `max_tokens: 8192` | Cross-quarter feasibility under uncertainty; 1,048,576-token context; the only place the $1.00 / $3.00 per 1M model is spent, so it runs on a click, once per run, cached per plan set, at most 20 live calls a day. Fallback Super. |

Two rules follow from the day-one measurements and are enforced by tests: thinking is off on every
extraction-role request (the client sets both switches itself), and a structured answer from a thinking-on
call comes back through a forced tool call, never through `response_format`. The full log, including what
did not work, is in [devpost/feedback.md](devpost/feedback.md).

Token Factory behaviour measured with our key (2026-09-27 and 2026-09-28; sources: `scripts/tf-probe.ts`,
`scripts/measure-planner.ts`, `fixtures/runs/demo-*.json`, `eval/results/planner-configs-2026-09-28*.jsonl`):

| What | Measured |
|---|---|
| Lightning prompt cache | 33,536 of 37,732 prompt tokens served from cache on the second call with an identical prefix; latency 1,653 → ≈ 590 ms. In the planner, once the prefix is warm and including across the three concurrent drafts: 16,768–23,056 cached of 22,034–31,570 prompt tokens per draft on demo (a), 8,384 of ≈ 12.3k on demo (b), 10,480–16,768 of ≈ 20–22k on demo (c); the first ever call of a prefix misses. Config A: 733,600 cache-hit tokens over 12 students, every run with hits. |
| Super prompt cache | 0 cached tokens across 23 calls with a byte-identical 22k-token prefix, with and without `prompt_cache_key`; 0 in every recording. |
| `reasoning_budget` | Advisory, not a cap: Super with `reasoning_budget: 4096` spent 2,016–6,013 reasoning tokens per call in recorded demo (a) (4 of 7 calls over budget); Ultra with 3072 spent 6,865. |
| `reasoning_effort:"none"` | 0 reasoning tokens on every call (60+ Super calls, every Lightning call). |
| `reasoning_effort:"low"` on Super | 19 of 19 calls ran to the 1,200-token `max_tokens` with 1,200 reasoning tokens and no tool call (6.3–7.0 s alone, 12.4–14.3 s with three in flight); `reasoning_budget: 512` added changed nothing. |
| Super, thinking off, `tool_choice: auto` | 2 of 3 draft calls produced 1,200 tokens of prose before the forced submit; a `submit_plan` call itself is 194–330 completion tokens in 2.0–2.5 s alone. |
| Billed prompt tokens | ≈ 2.3× the 4-characters-per-token estimate for the planner's course-code-heavy prefix (22,034–31,570 billed for demo (a) vs ≈ 11.3k estimated). |

### The planner: draft in parallel, verify, repair

`planRun()` in `lib/agents/planner.ts` runs three phases. **Draft:** the three strategies are drafted
concurrently by Lightning, one call each, with at most one round of lookups (`eligible_courses`,
`check_prereqs`, `offering_status`) before the terminal `submit_plan` call; a draft that ends without a valid
submit is forced to make one. Unit arithmetic, per-course units, the prerequisite each course still needs and
the quarters to avoid are rendered into the context pack, not fetched by tools. **Verify:** `lib/engine`'s
`verify()` judges every draft. **Repair:** only failing drafts, concurrently, on Super with thinking off, as a
fresh request with the rejected attempt, its violations and a replacement menu code computed under the
verifier's own rules; at most two rounds. A draft still failing is counted and its report kept for the
"What the code rejected" panel.

The context pack is a byte-identical shared prefix (system, requirement buckets, course table with units,
prerequisites and an evidence id per quarter) that depends only on the major file, college file, current
term and horizon, followed by the student suffix. Tests assert the prefix is identical across students of
the same major and college.

Configuration chosen by measurement (`scripts/measure-planner.ts`, live, 2026-09-28, 12 students = 3 demos +
9 synthetic across 12 major/college pairs, 46 runs, $1.04; full table with per-run rows in
[eval/results.md](eval/results.md)):

| Config | Drafts + repair | Students | First-pass validity | Plans / student | ≥ 1 plan | 3 plans | Wall-clock mean / p50 / max | $ / student | Cache-hit tokens |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| **A (shipped)** | Lightning drafts + Super repair, thinking off | 12 | 22.2% | 1.75 | 83.3% | 33.3% | 23.9 s / 27.0 s / 37.2 s | $0.0249 | 733,600 (12/12 runs) |
| B | Super drafts + Super repair, thinking off | 11 | 30.3% | 1.82 | 90.9% | 18.2% | 52.7 s / 50.2 s / 112.0 s | $0.0502 | 0 |
| C | Lightning drafts, no repair (cache-warm) | 12 | 13.9% | 0.42 | 25.0% | 8.3% | 6.7 s / 5.5 s / 16.2 s | $0.0061 | 899,184 |
| D | Lightning drafts + Lightning repair | 11 | 15.2% | 1.18 | 90.9% | 0% | 13.4 s / 11.9 s / 24.7 s | $0.0106 | 1,433,664 |

A and B are within noise on validity at this n; B is 2.2× slower and 2× the cost. The three demo students
under A: (a) 3 plans, 8.5 s, $0.0169; (b) 2 plans of 7 drafts, 14.1 s, $0.0203; (c) 3 plans, 8.0 s, $0.0140.
The synthetic students (unfamiliar majors, five courses a quarter) are what push the mean to 24 s.

**Recorded demos vs shipped code.** `fixtures/runs/demo-{a,b,c}.json` were recorded on 2026-09-28 04:13–04:20
UTC with the previous planner (Super, thinking on with `reasoning_budget: 4096`, tools `unit_check` /
`requirement_progress` / `check_prereqs` / `offering_status`, forced `submit_plans`). Replay and mock mode,
and a demo student in production, serve those recordings: (a) 2 plans, 1 rejected draft, 9 calls (7 Super,
1 Ultra, 1 Lightning), 165.4 s, 166.3k tokens in, 35.3k out, 33.7k reasoning, 0 cache hits, $0.1009;
(b) 3 plans, 8 calls, 100.2 s, $0.0654; (c) 3 plans, 5 calls, 131.1 s, $0.0721. Re-recording with the new
planner (`scripts/record-demos.ts`, ≈ $0.10–0.15) is the next step; until then a replayed trace shows the old
tool names and Super on every planning call.

### The deterministic veto

`lib/engine` is pure TypeScript with no model in the loop. It owns the prerequisite graph (from
`data/catalog`, with hand-checked overrides in `data/catalog-overrides.json` for mis-parsed rows), the impact
computation, requirement progress (over the engine modules vendored from TritonPlan in
`lib/vendor/tritonplan/`), registrar deadlines by term, offering evidence lookup (department page row, then
the Schedule of Classes snapshot, then CAPE history as `unknown`), the Academic History pre-normalizer that
re-joins wrapped rows, and the verifier. The verifier returns `{ ok, violations: [{ rule, message, course?,
term?, severity }] }`; a plan is `ok` when it has no error-severity violation. Rules: `prereq-unsatisfied`,
`not-offered` (error, message quotes the row), `assumed-offered` (warning: no evidence for the quarter),
`unit-floor` (12, waived when a term is marked part-time), `unit-cap` (warning above 19.5, error above 22),
`duplicate`, `already-earned`, `double-count` (warning), `graduation-infeasible`; the planner adds
`model-error` for a draft whose model call failed.

The models propose; the verifier disposes. A model never gets to be wrong about a fact the engine knows.

### Tavily: where the offering evidence comes from

Whether a course runs in a given quarter lives only on the department pages, and they move every year.

1. **Discovery.** `/search` (`<DEPT> tentative course offerings 2026-2027 site:ucsd.edu`) re-finds each page
   listed in [`data/offerings/sources.json`](data/offerings/sources.json): CSE, MATH, ECE, COGS. The three
   searches made on 2026-09-27 are recorded under `fixtures/tavily/`.
2. **Fetching, per source shape.** CSE and COGS embed a published Google Sheet that `/extract` cannot read (it
   returns the page's headings), so the pipeline finds the sheet's iframe in the page HTML and reads its CSV
   export. MATH is fetched as HTML directly, because Tavily's markdown drops empty `<td>` cells and a course
   with one lecture a year could not be placed in a quarter (MATH 31A in Fall and MATH 31B in Winter rendered
   identically). ECE's table comes through `/extract` as markdown (0 of 555 cells differ from the HTML in
   blank / non-blank). A sha256 content hash skips unchanged sources.
3. **Parsing, deterministic.** `lib/offerings` parses each shape into `{ course, term, status, quote, url,
   fetchedAt, instructor?, source }` rows with no model: a filled cell is `offered`, a blank cell
   `not_offered` (the CSE and ECE pages state that rule; COGS does not, so its blanks are weaker evidence),
   and the page's own caveat is kept verbatim in `disclaimer`. Rows today: CSE 276 (122 offered / 154 not),
   MATH 525 (271 / 254), ECE 555 (164 / 391), COGS 276 (98 / 178), all for FA26 / WI27 / SP27, fetched
   2026-09-28. No row is `tentative`; the whole page is.

These rows are what the Impact card's Evidence links show, what the verifier's `not-offered` rule checks and
quotes, what the planner's course table carries per quarter, and what the critic cites by evidence id. The
refresh is a script (`npm run offerings:offline` rebuilds from the saved raw captures at $0; `QB_MODE=live`
re-discovers and re-fetches); a nightly schedule is a target, not configured. Every Tavily call sets
`include_usage: true` and the credits land in the spend ledger; the 2026-09-27 discovery cost 4 credits over 5
calls. The stretch use (public syllabi for grade weights) is not built.

### What we deliberately did not build

- **RAG.** A student's requirement slice and course table fit in one prompt (22–32k billed tokens for the
  largest demo); E2 is the planned measurement of the gap against a retrieval arm and has not run.
- **A database.** Runs, approvals, traces, the spend ledger and the critic cache are small JSON objects
  (private Vercel Blob in production, `.data/` on disk locally, one interface).
- **Auth.** Saved records are addressed by random id with a delete button.
- **Sandboxes / code execution.** The product never runs code on the student's behalf.
- **Fine-tuning.** Nemotron cannot be fine-tuned on Token Factory; prompts, a context pack and a
  deterministic verifier do the work.
- **A chat interface.** The flow is a form with five steps and an approval gate.

## Run it locally

Requires Node 24 or newer (26 locally, 24 on Vercel).

```bash
git clone https://github.com/SahirSSharma/quarterback.git
cd quarterback
npm install
```

Create `.env.local` (git-ignored):

```
NEBIUS_API_KEY=...      # Nebius Token Factory (live mode and recording only)
TAVILY_API_KEY=...      # Tavily (live offerings refresh only)
QB_MODE=mock            # mock (default) | replay | live
QB_DATA_DIR=.data       # disk store for runs, traces, approvals and the ledger
QB_SIGNING_KEY=...      # base64 PKCS8 ECDSA P-256 private key; Approve fails without it
```

- Do not set `BLOB_READ_WRITE_TOKEN` locally. The project's Blob store is private and its token is accepted
  only from inside Vercel; with the token present every store call fails with "Access denied". Without it the
  same store interface writes to `QB_DATA_DIR` (or `.data/`).
- `QB_MODE=mock` serves every model and Tavily request from recorded fixtures in `fixtures/` and fails loudly
  on a request it has not seen. Tests run in this mode and cost nothing.
- `QB_MODE=replay` serves the three recorded demo runs; an unrecorded situation ends in an error event.
- `QB_MODE=live` calls Token Factory and Tavily; every call writes a ledger entry. `QB_DAILY_CAP_USD` and
  `QB_TOTAL_CAP_USD` cap live spend; over a cap a demo student falls back to its recording with a banner and
  a pasted record gets an error. In production (`VERCEL_ENV=production`) a demo student always replays.
- `QB_DRAFT_ROLE=extract|plan` and `QB_REPAIR_EFFORT=none|low|medium|high` override the planner defaults.

```bash
npm run dev                  # http://localhost:3000
npm test                     # vitest run (mock mode) && node --test devpost/docs.test.ts
npm run typecheck            # tsc --noEmit
npm run test:docs            # docs consistency checks only
npm run offerings:offline    # rebuild data/offerings/<DEPT>.json from the raw captures, no network
npm run tf:probe             # replay the four recorded Token Factory probe calls at $0
node --import ./scripts/node-ts.ts scripts/record-demos.ts                        # compare a mock replay with fixtures/runs
node --import ./scripts/node-ts.ts scripts/measure-planner.ts --render eval/results/planner-configs-2026-09-28.jsonl
node --import ./scripts/node-ts.ts eval/e4.ts                                     # E4 in mock mode, $0
```

Live variants of the scripts (`QB_MODE=live` in the shell plus a `--budget-usd` or `QB_TOTAL_CAP_USD`) spend
money and are documented in each script's header and in [eval/README.md](eval/README.md).

## Evaluation

Status of each planned eval; losing configurations stay in the tables. Results and per-run rows:
[eval/results.md](eval/results.md), `eval/results/*.jsonl`; definitions in [eval/README.md](eval/README.md).

| Eval | Question | Status | Result |
|---|---|---|---|
| Planner configuration | Which draft / repair model mix gives the most valid plans for the time and money? | Measured live 2026-09-28 (12 students × 4 configs, $1.04) | Table above; A shipped |
| E1 Plan validity and optimality | Valid, near-optimal plans across synthetic students and planted risks; refusal precision / recall | Mock run only (2026-09-28), replaying the three old recordings: the shipped config 100% valid after ≤ 3 rounds, progress 0.80 of the greedy optimum, 0 refusals; every other cell `no-fixture`. Live E1 not run; the replay test fails until the demos are re-recorded | `[E1 live: to be measured]` |
| E2 Recall by context length | Is whole-slice reading good enough, or does retrieval win? | Not run | `[to be measured]` |
| E3 Tavily ablation | Do plans with offering evidence avoid not-offered quarters more often than plans without it? | Not run | `[to be measured]` |
| E4 Intake accuracy | Does the deterministic parser read real Academic History pastes? | Measured 2026-09-28, mock, 30 synthetic pastes in six layouts, $0 | Row precision 100% on every layout; recall 100% on web, wrapped, pdf, double-major and transfer, 76.0% on reordered (one paste: a transfer block before the quarters; documented upstream parser state), 95.7% overall; major file 96.7% (one ambiguous index entry) |
| E5 Live telemetry | What happened with real students? | Not started (no soft launch yet) | `[to be measured]` |

Deterministic tests (Vitest, `npm test`, $0 in mock mode): 435 tests in 50 files as of 2026-09-28 — 430
pass, 1 skipped (the gated live end-to-end run), 4 fail for known reasons: `lib/agents/demo-replay.test.ts`
and `eval/e1.test.ts` replay the old demo recordings against the new planner's prompts (they pass once the
demos are re-recorded), and two `eval/e4.test.ts` assertions still encode the wrapped-row limitation the
pre-normalizer removed. `npx tsc --noEmit` is clean. Coverage by module: engine (prerequisite graph, impact,
requirements, verifier, offerings, terms, paste normalizer, demo golden impact), Token Factory client
(fixtures, fallback, retries, forced tool and tool loop, thinking switches), offerings parsers and discovery,
Tavily client, store (runs, approvals and token signing, ledger sink, .ics, mailto), agents (context prefix
identity, planner phases with a fake model, critic verdict resolution, intake), routes (all three demo flows
through the real handlers in mock mode, the approval 400/409 gate, live→replay fallbacks, reconnect guard),
UI helpers, eval runners, and the docs consistency checks in `devpost/docs.test.ts`.

## Data

`data/` is a public snapshot compiled for TritonPlan. Counts measured 2026-09-28 with the engine's own loaders.

| Path | Contents | Source |
|---|---|---|
| `data/catalog/` | 90 subject files (15,249 course entries, 7,559 distinct codes, 5,616 with prerequisite text, 2,253 with parsed groups) plus `_page-map.json` and `prereqs-structured.json`; `data/catalog-overrides.json` holds 8 hand-checked prerequisite corrections | UC San Diego General Catalog (catalog.ucsd.edu) |
| `data/majors/` | 142 major requirement files; `index.json` lists 140 (124 high confidence, 16 medium) plus `uncovered.json` | Transcribed from the General Catalog program pages; source URLs on every file |
| `data/college-ge/` | 8 college general-education files plus `index.json` | College pages and the General Catalog |
| `data/grades.json` | CAPE average-grade summaries for 2,750 courses (generated 2026-08-13) | UC San Diego Class Planner public endpoint |
| `data/sections/FA26.json` | Fall 2026 Schedule of Classes, 2,267 courses | As published on tritonplan.com |
| `data/registrar-calendar.json` | Enrollment and Registration Calendar 2026–27 (FA26, WI27, SP27), fetched 2026-09-27 | blink.ucsd.edu |
| `data/offerings/` | [`sources.json`](data/offerings/sources.json) (CSE, MATH, ECE, COGS); parsed `<DEPT>.json` files; raw captures: CSE as CSV (92 course rows) plus the page HTML, COGS as CSV plus the page HTML, MATH as HTML (and the Tavily markdown kept as the record of its dropped cells), ECE as markdown | Department tentative-offering pages, discovered with Tavily |
| `data/demo/` | Three synthetic demo students (Revelle · Artificial Intelligence; Marshall · Cognitive Science; Sixth · Mathematics–Computer Science, transfer) | Authored; no real student |
| `lib/vendor/tritonplan/` | Seven pure modules: requirements engine and progress, academic-history parser, program matching, AP/IB credit, record reconciliation, quarter arithmetic | TritonPlan (MIT) |

The offerings refresh writes `data/offerings/<DEPT>.json` as
`{ dept, sourceUrl, fetchedAt, contentHash, disclaimer?, terms, rows: OfferingEvidence[] }`, where each row
carries the verbatim source line, its URL and the fetch time (type in [`lib/types.ts`](lib/types.ts)). Term
codes are TritonPlan quarter codes: `FA26`, `WI27`, `SP27`.

No student data is included. Course descriptions and requirement text remain the property of The Regents of
the University of California; attribution and licence notes are in [NOTICE.md](NOTICE.md).

## Built for the Nebius x NVIDIA Global AI Hackathon

Track: Best Apps and Agents. Each Stage 1 requirement, as recorded in [DESIGN.md](DESIGN.md), and where it is
satisfied. The per-item checklist with status lives in [notes/stage1-checklist.md](notes/stage1-checklist.md).

| Requirement | Where |
|---|---|
| Runtime Token Factory calls from the live demo, with the models named identically in README, Devpost, Built With and the video audio | `lib/tf/models.ts` registry; ledger entries in the trace panel and the About page's live figures; model table above; [devpost/SUBMISSION.md](devpost/SUBMISSION.md); [devpost/VIDEO.md](devpost/VIDEO.md) spoken lines |
| A genuine multi-step tool-chaining workflow with a real action behind an approval gate | Three parallel Lightning drafts with tools `eligible_courses`, `check_prereqs`, `offering_status` and a terminal `submit_plan` → verifier → Super repair from a code-computed menu → Ultra `submit_verdict` → approval record and ECDSA P-256 signed token → TritonPlan import / .ics / email |
| Fresh public MIT repository with meaningful history | https://github.com/SahirSSharma/quarterback, [LICENSE](LICENSE), [CHANGELOG.md](CHANGELOG.md) |
| Working public demo URL that survives judging (Dec 1–15) | `[live demo]` at https://quarterback-delta.vercel.app once promoted; demo students always replay in production, live mode behind daily and total spend caps |
| Video of at most 3 minutes with audio, on YouTube | [devpost/VIDEO.md](devpost/VIDEO.md); link `[to be added]` |
| Written feedback on Nebius and NVIDIA tools | [devpost/feedback.md](devpost/feedback.md) |
| Tavily `/search` and `/extract` calls that change the decision | `lib/tavily`, `lib/offerings`, `data/offerings/`; the verifier's `not-offered` rule and the critic's evidence ids read these rows; eval E3 planned |

TritonPlan is the data source and the write target, not the product: Quarterback reads the public snapshot
TritonPlan compiled and, after approval, writes a plan into TritonPlan's Degree Planner through the import
page (branch `quarterback-import` of the TritonPlan repository, pull request open; staging mirror at
https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import; production tritonplan.com requires
a ucsd.edu sign-in). Standing, the author's other project, shares no code or corpus with this repository.

## Feedback for Nebius and NVIDIA

The required tool feedback is a dated log of what we measured on Token Factory, what we saw and what we
changed, plus concrete requests: [devpost/feedback.md](devpost/feedback.md).

## License

MIT, see [LICENSE](LICENSE). Third-party notices, including the TritonPlan modules and the UC San Diego
data, are in [NOTICE.md](NOTICE.md).
