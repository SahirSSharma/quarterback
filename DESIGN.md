# Quarterback — design

_Plan of record for the Nebius x NVIDIA Global AI Hackathon entry (Best Apps and Agents track). Every module
below is a contract: an agent implementing a module may not change another module's interface without
updating this file in the same commit._

## The one sentence

Before UC San Diego's drop deadline, Quarterback reads a student's academic record, shows exactly what
dropping or P/NP-ing a class does to their graduation, re-plans the degree with deterministic code holding
the veto over every model proposal, refuses the fastest plan when a department page says a course is only
tentative (and quotes the page), and hands the approved plan to TritonPlan, the planner 9,500 UCSD students
already use, only after the student clicks approve.

## Why this shape wins

- **Dated, real problem.** Fall 2026: drop without a W by **Fri Oct 23**; change units / grading option /
  drop with W by **Fri Nov 6** (official Enrollment Calendar, `data/registrar-calendar.json`). Students guess.
- **Real audience with a channel.** A link inside TritonPlan (9,564 registered UCSD accounts) before Oct 23
  gives the video a real usage number, which almost no hackathon entry has.
- **LLM proposes, code disposes.** A deterministic engine (vendored from TritonPlan, 100% unit-tested) decides
  prerequisite chains, unit floors, requirement progress and plan validity. Nemotron proposes, explains and
  refuses; it never gets to be wrong about a fact the engine knows.
- **Refuses its own optimum with a quote.** The fastest plan is rejected when its key course is blank on a
  department's tentative-offerings page. The refusal shows the quoted line, its URL and when it was fetched.
- **Three Nemotron models, each with a measured reason** (ablation table in the README), on Nebius Token
  Factory; Tavily discovers and extracts the department pages that carry offering evidence.

## Nemotron model map (Token Factory, `https://api.tokenfactory.nebius.com/v1`)

| Role | Model id | Settings | Why |
|---|---|---|---|
| Extraction & explanation | `nvidia/Nemotron-3_5-Lightning` | `chat_template_kwargs:{enable_thinking:false}` + `reasoning_effort:"none"`, `response_format: json_schema` where structured | 1M context, $0.06/$0.24 per 1M, 350–400 ms answers. With thinking on its reasoning leaks into `content` on Token Factory and json_schema collapses; thinking off is verified 100% schema-valid. Fallback `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. |
| Planner | `nvidia/nemotron-3-super-120b-a12b` | `chat_template_kwargs:{enable_thinking:true, reasoning_budget:4096}`, `tools`, final answer via forced `submit_plans` tool call | Judgment over trade-offs with verified tool round-trips; $0.30/$0.90 keeps a 2-round plan ≈ $0.05; prompt-cache fields present. Fallback Ultra with budget 2048. |
| Critic ("Stress-test") | `nvidia/Nemotron-3-Ultra-550b-a55b` | `reasoning_effort:"high"`, forced `submit_verdict` tool call | Cross-quarter feasibility under uncertainty; only place the $1/$3 model is spent; click-gated, cached, rate-limited. Fallback Super. |

Verified on 2026-09-27 with our key: tool calling round-trips (thinking on/off), streamed tool-call deltas,
json_schema with thinking off, `chat_template_kwargs` pass-through, `reasoning_effort:"none"`, 600 RPM /
400k TPM base limits, prompt-cache usage fields on Super.

Model ids live in **one** registry (`lib/tf/models.ts`) with a fallback order; a test exercises the fallback.
Nebius removed three `nvidia/` models from serverless on Aug 31 with little notice.

## User flow (v1)

1. **Start** — paste the TSS *Academic History* page, or pick a demo student (replay). Deterministic parse
   (`lib/vendor/tritonplan/parse-academic-history.js` + `program-match.js`) → `StudentState`. If the parser
   cannot find the major/college or the paste is unstructured, Lightning (thinking off, json_schema) reads it
   and the UI shows what it inferred for confirmation. Nothing is stored until Save.
2. **Situation** — pick a current-term course and an action: *drop*, *switch to P/NP*, or *keep*. The
   **Impact card** is instant and $0: downstream courses this unlocks/blocks (prereq graph), when each is
   next offered (offerings evidence + CAPE history), delay in quarters, 12-unit full-time floor, P/NP
   eligibility for the requirement bucket (rule-based; "check with your department" when the file is
   silent, never a guess), deadline chips (Oct 23 / Nov 6 from the calendar for the current term),
   requirement-progress delta.
3. **Re-plan** — Super proposes up to three plans (fastest-to-degree / balanced / lightest) for the next
   N quarters (default WI27, SP27, FA27) using tools; the deterministic **verifier** rejects invalid plans
   with rule ids; Super iterates ≤3 rounds. A plan that fails verification is never shown.
4. **Stress-test** (button) — Ultra reads the plans plus offering evidence and either recommends or
   **refuses** a plan with `{reason, quote, url, fetched_at}`. Overriding a refusal requires typing
   "I understand" and a reason; it is logged.
5. **Review & approve** — recommended vs refused plans side by side, verifier checks as a checklist,
   consequence summary, model ledger (model, ms, tokens, cents, cache hits). **Approve** writes an
   approval record and mints a signed one-time token that every action requires:
   - *Send to TritonPlan*: opens `tritonplan.com/tools/quarterback-import?plan=<token>` where
     `token = base64url(JSON ImportPayload) + "." + base64url(ECDSA P-256 / SHA-256 signature)`; the page
     verifies the signature in the browser with WebCrypto against the embedded public key (P-256 chosen over
     Ed25519 for universal WebCrypto support), shows the plan, and on confirm writes it into the Degree
     Planner store (`{ [quarterId]: [courseKey…] }`, signed-in → account sync, signed-out → localStorage)
     with one-click restore of the previous plan. The private key lives only in the Quarterback server env
     (`QB_SIGNING_KEY`).
   - *Download .ics*: deadlines, planned courses per term, collision flags.
   - *Draft advisor email*: `mailto:` prefilled; the student sends it.

Cross-cutting: a **trace panel** streams every agent step over SSE (model badge, ms, tokens, cents, cache
hits, tool calls). `QB_MODE=live|mock|replay`. A spend cap flips live mode to replay with a banner so the
demo never dies during judging (Dec 1–15). Term and deadlines are parameters, never constants: in December
the live flow plans Winter 2027 against the schedule that publishes in November.

## Tavily (load-bearing, `lib/tavily`)

Two facts change the decision and live only on the web:

1. **Offering status by quarter** — department pages (`data/offerings/sources.json`): CSE (Google Sheet
   behind the page, exported as CSV), MATH and ECE (HTML tables), COGS (index → sub-pages). Nightly:
   `/search` re-discovers the pages (they move yearly), `/extract` (advanced) pulls the tables, a hash gate
   skips unchanged pages, Lightning (thinking off, json_schema) emits
   `{course, term, status: offered|tentative|not_offered|unknown, quote, url, fetched_at}`. `unknown` is
   never upgraded. This is the quote Ultra cites in a refusal.
2. **Public syllabus / course site** (stretch) — when the student wants grade projection and did not paste
   weights: `/search` (include_domains ucsd.edu, github.io) + `/extract`; Lightning extracts weights and
   exam windows with quotes.

Every call sets `include_usage:true`; a live credit meter sits in the ledger. Budget ≈ 900 credits over the
period against 1,000/month free plus the Builders credit.

## Deterministic core (`lib/engine`, no model, 100% unit-tested)

- `StudentState` — `{ college, majors[], catalogYear, courses[{code, term, units, grade, status: earned|inProgress|planned}], transfer, apIb }`.
- `prereqGraph` — from `data/catalog/*.json` (`prereqs` = AND of OR-groups, `prereqText` for prose flags).
  `blockedBy(code)`, `unlocks(code)`, `satisfied(code, earnedSet)`, `chain(code)`.
- `impact(state, action)` — prereq chain, next offering per blocked course, delay in quarters, unit floor,
  P/NP eligibility (bucket rule + campus 25% P/NP cap flag), deadlines for the term, progress delta.
- `requirements` — thin wrapper over vendored `allocate` / `prepareBands` / `courseProgress`.
- `verifier(plan, state, data)` → `{ ok, violations:[{rule, message, course?, term?}] }`. Rules: prereqs
  satisfied by the term they are needed, offering status not `not_offered`, unit min 12 / max per term,
  no duplicates, no course already earned, bucket double-counting per engine, graduation feasibility
  (longest remaining prerequisite chain ≤ quarters left), no "assumed offered".
- `terms` — `qStep`, ordering, registrar deadlines lookup by term code.

## Token Factory client (`lib/tf`)

- `chat(req)` thin fetch wrapper: model registry + fallback order, `chat_template_kwargs` at the top level
  of the body, json_schema helper (`{name, schema, strict}`), forced-tool helper, streaming with tool-call
  delta assembly, retries on 429 honouring `Retry-After`, per-request **ledger** entry
  `{model, ms, promptTokens, completionTokens, reasoningTokens, cacheHitTokens, usd}` computed from the
  registry prices.
- Record/replay: in `mock` mode every request is keyed by `sha256(canonical request)` and served from
  `fixtures/tf/`; unknown keys fail loudly (no silent fallbacks). `record` writes fixtures from live.
- Budget guard: daily and total caps from env; over cap → `QB_MODE=replay` behaviour + banner.

## Agents (`lib/agents`)

- `intake` (Lightning, fallback only) → `StudentState` candidates.
- `planner` (Super) — tools: `eligible_courses(term)`, `check_prereqs(code, term)`,
  `requirement_progress(plan)`, `offering_status(code, term)`, `unit_check(plan)`, `grade_history(code)`,
  `submit_plans(plans)`. Context pack ≤ 30k tokens: byte-identical shared prefix (system + major/college
  requirement text + eligibility table) then the student suffix, so Super's prompt cache hits.
- `critic` (Ultra) — input: plans, verifier reports, offering evidence with quotes, prereq DAG for the next
  three quarters; output via forced `submit_verdict`.
- `explain` (Lightning) — "why not CSE 105?" over the shortlist + eligibility table, sub-second.

## Storage

No database. Vercel Blob (`BLOB_READ_WRITE_TOKEN`) holds runs, approval records, the spend ledger,
offerings cache and replay traces as small JSON blobs; without the token (local dev, CI) the same interface
writes to `.data/` on disk. Pasted history is processed in memory and stored only on Save (random id,
delete button). Telemetry is aggregate only.

## Repo layout

```
app/                Next.js 16 App Router (TypeScript, Tailwind 4)
  page.tsx          start (paste / demo students)
  plan/[id]/        impact → plans → stress-test → review & approve
  api/…             route handlers, SSE trace
lib/engine/         deterministic core + tests
lib/tf/             Token Factory client, registry, ledger, record/replay
lib/tavily/         discovery, extraction, offerings cache
lib/agents/         intake, planner, critic, explain
lib/vendor/tritonplan/  pure engine modules copied from TritonPlan (MIT; see NOTICE)
data/               public UCSD data snapshot (majors 144, college GE 8, catalog 92 files/15,249 courses,
                    CAPE grades 2,750, FA26 sections 2,267 courses, registrar calendar, offerings)
fixtures/           recorded Token Factory / Tavily responses for mock mode
eval/               synthetic students, eval runners, results.md
devpost/            SUBMISSION.md (paste-ready), gallery, video run sheet, feedback.md
scripts/            refresh-offerings, export-data, record-fixtures
```

## Evaluation (README table, losing configs kept)

- **E1 plan validity and optimality** — 200 synthetic students from the 126 high-confidence major files ×
  8 colleges plus 40 planted-risk cases (tentative offerings, not-offered courses, heavy loads). Configs:
  Lightning-only planner; Lightning+Super; +Ultra critic on a subset; Super `reasoning_budget` 0/2k/8k.
  Metrics: validity first pass and after ≤3 rounds, rounds to green, progress per quarter vs a brute-force
  optimum on the same requirement sets, refusal precision/recall on planted risks, tool-call success,
  cache-hit ratio, $ and latency per plan.
- **E2 recall by context length** — whole-slice reads at 100k/200k/300k on Lightning vs a RAG arm
  (`Qwen/Qwen3-Embedding-8B`, top-20 chunks) with the same judge; measured prefill latency at 250k.
- **E3 Tavily ablation** — plans with vs without offering evidence; % placing a course in a quarter where
  the department page says it is not offered.
- **E4 intake accuracy** — 30 synthetic Academic History formats.
- **E5 live telemetry** — sessions, plans approved, verifier rejections per round, refusals shown/overridden,
  cache-hit rate, total spend.

Deterministic tests (Vitest, target ≥150, CI at $0 in mock mode) cover the engine, verifier, schemas,
forced-tool parsing and retry, approval state machine (no write without token), token signing, .ics,
TPM queue, registry fallback, no-think-leak assertion on every Lightning path, and mock end-to-end snapshots.

## Stage 1 compliance

Runtime Token Factory calls from the live demo (three Nemotron models, named identically in README,
Devpost, Built With and the video audio); genuine multi-step tool-chaining workflow with a real action
behind an approval gate; fresh public MIT repo with meaningful history; working public demo URL that
survives Dec 1–15 (replay default, live capped); ≤3-minute YouTube video with audio; required written
feedback on Nebius/NVIDIA tools drawn from day-1 measurements; Tavily `/search` + `/extract` calls that
change the decision. TritonPlan is the data source and the write target, not the product.

## What we deliberately do not build

RAG (the whole slice fits in context; E2 measures the gap), a database, auth, Sandboxes (no code execution
in this product), fine-tuning (Nemotron cannot be fine-tuned on Token Factory), a chat interface.

## Deployment

Vercel project `quarterback` (team sss-4bfd). Public production alias: **https://quarterback-delta.vercel.app**
(also quarterback-sss-4bfd.vercel.app). Deployment protection is preview-only, so previews need a Vercel login
and production is public. Staging = `vercel deploy --yes --target=preview`; production = Sahir's explicit OK.
Env vars (`NEBIUS_API_KEY`, `TAVILY_API_KEY`) are set for all environments; `QB_MODE` defaults to `mock`
locally and must be `live` in production with `QB_DAILY_CAP_USD` / `QB_TOTAL_CAP_USD` set.

## Decisions log

- 2026-09-27 — Chosen from a 16-proposal, 5-judge panel; runner-up "Registrar" (compile prose degree
  requirements into tested rule files) shares 60% of this data layer and is the pivot if UCSD-facing work
  becomes impossible. Postgres, Serverless Job and the nightly whole-cohort Lightning read were cut from v1
  (Vercel Cron + on-demand slice reads instead). Registrar deadlines and department offering pages verified
  against primary sources the same day.
