# Quarterback

Before UC San Diego's drop deadline, Quarterback reads a student's academic record, shows exactly what
dropping or switching a class to P/NP does to their graduation, re-plans the degree with deterministic code
holding the veto over every model proposal, refuses the fastest plan when a department page says a course is
only tentative (and quotes the page), and hands the approved plan to TritonPlan only after the student
clicks Approve.

Built for the Nebius x NVIDIA Global AI Hackathon (Best Apps and Agents track) on Nebius Token Factory with
three NVIDIA Nemotron models, with Tavily supplying the web evidence the decision depends on.

- Repository: https://github.com/SahirSSharma/quarterback (MIT)
- Demo: https://quarterback-delta.vercel.app (public; as of 2026-09-27 the alias serves the Next.js scaffold,
  not the product; see [PROGRESS.md](PROGRESS.md) for the alias incident)
- Plan of record: [DESIGN.md](DESIGN.md). Progress: [PROGRESS.md](PROGRESS.md). Changes: [CHANGELOG.md](CHANGELOG.md).

**Status, 2026-09-27.** Design of record, public data snapshot, shared contracts (`lib/types.ts`), env loader and
test runner are in. The deterministic engine, Token Factory client, Tavily pipeline, agents and UI are being
built in parallel; this README describes the product as designed and marks every number that has not been
measured yet as `[to be measured]`.

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

1. **Impact, instantly.** Paste the TSS Academic History page or pick a demo student, choose a current-term
   course and an action (drop, switch to P/NP, keep). The Impact card shows which downstream courses this
   unlocks or blocks, when each blocked course is next offered, the delay in quarters, whether the term falls
   below the 12-unit floor, whether the requirement accepts P/NP (or "check with your department" when the
   requirement file is silent; never a guess), the two deadlines for the current term, and the change in
   requirement progress. No model call is needed for this step.
2. **Plans that have been checked by code.** Up to three re-plans for the next quarters (fastest to degree,
   balanced, lightest). Every plan shown has passed the verifier: prerequisites satisfied by the term they are
   needed, no course placed in a quarter where the department says it is not offered, unit floor and cap, no
   duplicates, nothing already earned, no double-counting, graduation still reachable. A plan that fails is
   never shown.
3. **A refusal with a quote.** Stress-test reads the plans against the department offering pages and either
   recommends a plan or refuses one, showing the verbatim line from the page, its URL and when it was fetched.
   Overriding a refusal requires typing "I understand" and a reason.
4. **Approve, then act.** Recommended and refused plans side by side, the verifier checks as a checklist, a
   consequence summary and a ledger of what each step cost. Approve mints a one-time signed token, and only
   then can the student:
   - **Send to TritonPlan** — the plan loads into the Degree Planner they already use, with one-click restore
     of the previous plan;
   - **Download .ics** — deadlines and planned courses per term;
   - **Draft advisor email** — a prefilled `mailto:` the student sends themselves.

A trace panel streams every step as it happens: which model, how long it took, tokens, cost in cents, cache
hits, tool calls. Nothing is stored until the student clicks Save; saved records carry a random id and a
delete button.

## How it works

### Three Nemotron models on Nebius Token Factory

All inference runs through the OpenAI-compatible endpoint at `https://api.tokenfactory.nebius.com/v1`. Each
model has one job and a measured reason for having it. Settings are exactly as sent in the request body.

| Role | Model id | Settings | Why |
|---|---|---|---|
| Extraction and explanation | `nvidia/Nemotron-3_5-Lightning` | `chat_template_kwargs:{enable_thinking:false}` + `reasoning_effort:"none"`, `response_format: json_schema` where structured | 1,048,576-token context, $0.06 / $0.24 per 1M tokens in / out, 350–400 ms answers with thinking off (first streamed byte 234 ms), 600 RPM / 400k TPM on our account. With thinking on, its reasoning leaks into `content` on Token Factory and json_schema output collapses; thinking off is schema-valid in every run we made. Fallback `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (same price, 262,144 context, 100 RPM / 800k TPM; strictly dominated by Lightning, kept only as a fallback). |
| Planner | `nvidia/nemotron-3-super-120b-a12b` | `chat_template_kwargs:{enable_thinking:true, reasoning_budget:4096}`, `tools`, final answer via forced `submit_plans` tool call | Judgment over trade-offs with verified tool round trips and parallel tool calls; 262,144-token context as served; $0.30 / $0.90 per 1M keeps a two-round plan at roughly $0.05 (estimate; `[to be measured]`); prompt-cache usage fields are present, so the context pack uses a byte-identical shared prefix. Fallback Ultra with `reasoning_budget:2048`. |
| Critic (Stress-test) | `nvidia/Nemotron-3-Ultra-550b-a55b` | `reasoning_effort:"high"`, forced `submit_verdict` tool call | Cross-quarter feasibility under uncertainty; 1,048,576-token context; the only place the $1.00 / $3.00 per 1M model is spent, so it is click-gated, cached and rate-limited. Fallback Super. |

Model ids live in one registry, `lib/tf/models.ts`, with a fallback order and a test that exercises the
fallback. Verified with our key on 2026-09-27: tool-calling round trips on all four NVIDIA models with
thinking on or off; streamed tool-call deltas; `response_format: json_schema` reliable with thinking off;
`chat_template_kwargs` `{enable_thinking, reasoning_budget}` passes through at the top level of the body;
`reasoning_effort:"none"` accepted. The full log, including what did not work, is in
[devpost/feedback.md](devpost/feedback.md).

Two rules follow from those measurements and are enforced by tests: thinking is off for every extraction and
JSON step, and a structured answer from a thinking-on call always comes back through a forced tool call,
never through `response_format`.

### The deterministic veto

`lib/engine` is pure TypeScript with no model in the loop. It owns the prerequisite graph (from
`data/catalog`), the impact computation, requirement progress (over the engine modules vendored from
TritonPlan in `lib/vendor/tritonplan/`), registrar deadlines by term, and the verifier. The verifier returns
`{ ok, violations: [{ rule, message, course?, term? }] }` with stable rule ids (`prereq-unsatisfied`,
`not-offered`, `unit-floor`, `unit-cap`, `duplicate`, `already-earned`, `double-count`,
`graduation-infeasible`, `assumed-offered`).

The planner proposes; the verifier disposes. Super gets the violations back as tool results and iterates at
most three rounds. Nemotron proposes, explains and refuses; it never gets to be wrong about a fact the engine
knows. The engine is the part of the system the tests cover exhaustively (target: 100% of engine branches;
current coverage `[to be measured]`).

### Tavily: two load-bearing uses

Two facts change the decision and live only on the web.

1. **Offering status by quarter.** Department pages publish which courses run in which quarter, and they
   move every year. `/search` re-discovers the pages (`data/offerings/sources.json`: CSE, MATH, ECE, COGS);
   `/extract` in advanced mode pulls the tables (markdown tables for `math.ucsd.edu` and `ece.ucsd.edu`); a
   content-hash gate skips unchanged pages; Lightning (thinking off, json_schema) turns each row into
   `{ course, term, status: offered | tentative | not_offered | unknown, quote, url, fetchedAt }`. `unknown`
   is never upgraded. The CSE page embeds a Google Sheet that `/extract` cannot read (it returns 75
   characters), so the pipeline finds the sheet in the page HTML and reads its CSV export instead. These
   rows are what the verifier's `not-offered` rule checks and what Stress-test quotes in a refusal.
2. **Public syllabus or course site** (stretch). When the student wants a grade projection and did not paste
   the weights: `/search` restricted to `ucsd.edu` and `github.io`, then `/extract`; Lightning extracts
   weights and exam windows with quotes.

Every Tavily call sets `include_usage: true` and the credit count appears in the ledger. Plan: about 900
credits over the project against the Researcher plan's 1,000 per month.

### What we deliberately did not build

- **RAG.** A student's whole requirement slice fits in Lightning's context; E2 below measures the gap against
  a retrieval arm instead of assuming it.
- **A database.** Runs, approvals, the ledger and the offerings cache are small JSON blobs (Vercel Blob in
  production, `.data/` on disk locally).
- **Auth.** Nothing is stored until Save, and saved records are addressed by random id with a delete button.
- **Sandboxes / code execution.** The product never runs code on the student's behalf.
- **Fine-tuning.** Nemotron cannot be fine-tuned on Token Factory; prompts plus a deterministic verifier do
  the work.
- **A chat interface.** The flow is a form with four steps and an approval gate.

## Run it locally

Requires Node 24 or newer.

```bash
git clone https://github.com/SahirSSharma/quarterback.git
cd quarterback
npm install
```

Create `.env.local` (git-ignored):

```
NEBIUS_API_KEY=...      # Nebius Token Factory
TAVILY_API_KEY=...      # Tavily
QB_MODE=mock            # mock (default) | replay | live
```

- `QB_MODE=mock` serves every model and Tavily request from recorded fixtures in `fixtures/` and fails loudly
  on a request it has not seen. Tests run in this mode and cost nothing.
- `QB_MODE=replay` plays curated traces for the demo students.
- `QB_MODE=live` calls Token Factory and Tavily; every call writes a ledger entry. A spend cap flips live back
  to replay with a banner.

```bash
npm run dev                                   # http://localhost:3000
npm test                                      # Vitest, mock mode
npx tsc --noEmit                              # typecheck
node scripts/refresh-offerings.ts --offline   # rebuild data/offerings/<DEPT>.json from the raw captures, no network
```

Without `--offline` the refresh script needs both keys and spends Tavily credits and Lightning tokens.

## Evaluation

Every number below is a placeholder until the eval runs; losing configurations stay in the table.

| Eval | Question | Method | Result |
|---|---|---|---|
| E1 Plan validity and optimality | Does the planner produce valid, near-optimal plans, and which model mix is worth its cost? | 200 synthetic students from the 126 high-confidence major files x 8 colleges, plus 40 planted-risk cases (tentative offerings, not-offered courses, heavy loads). Metrics: validity on first pass and after at most 3 rounds, rounds to green, progress per quarter vs a brute-force optimum on the same requirement sets, refusal precision and recall on planted risks, tool-call success, cache-hit ratio, dollars and latency per plan. | `[to be measured]` |
| E2 Recall by context length | Is whole-slice reading good enough, or does retrieval win? | Whole-slice reads at 100k / 200k / 300k tokens on Lightning vs a RAG arm (`Qwen/Qwen3-Embedding-8B`, top-20 chunks), same judge; prefill latency at 250k. | `[to be measured]` |
| E3 Tavily ablation | Does offering evidence change the plans? | Plans with vs without offering evidence; share of plans placing a course in a quarter where the department page says it is not offered. | `[to be measured]` |
| E4 Intake accuracy | Does the fallback intake read real pastes? | 30 synthetic Academic History formats against the deterministic parser plus Lightning fallback. | `[to be measured]` |
| E5 Live telemetry | What happened with real students? | Sessions, plans approved, verifier rejections per round, refusals shown and overridden, cache-hit rate, total spend. Aggregate only. | `[to be measured]` |

E1 configuration grid:

| Config | Valid first pass | Valid after 3 rounds | Rounds to green | Progress vs optimum | Refusal precision / recall | $ per plan | ms per plan |
|---|---|---|---|---|---|---|---|
| Lightning-only planner | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` |
| Lightning + Super | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` |
| Lightning + Super + Ultra critic (subset) | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` |
| Super `reasoning_budget` 0 / 2k / 8k | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` | `[to be measured]` |

Deterministic tests (Vitest, `npm test`, $0 in mock mode) cover the engine, verifier, schemas, forced-tool
parsing and retry, the approval state machine (no write without a token), token signing, .ics, the TPM queue,
registry fallback, a no-think-leak assertion on every Lightning path, and mock end-to-end snapshots. Target:
at least 150 tests; current count `[to be measured]`.

## Data

`data/` is a public snapshot compiled for TritonPlan. Counts measured 2026-09-27.

| Path | Contents | Source |
|---|---|---|
| `data/catalog/` | 91 subject files, 15,336 course entries with prerequisites (`prereqs` as AND of OR-groups, `prereqText` for prose), plus `_page-map.json` | UC San Diego General Catalog (catalog.ucsd.edu) |
| `data/majors/` | 142 major requirement files (126 high confidence, 16 medium), plus `index.json` and `uncovered.json` | Transcribed from the General Catalog program pages; source URLs on every file |
| `data/college-ge/` | 8 college general-education files plus `index.json` | College pages and the General Catalog |
| `data/grades.json` | CAPE average-grade summaries for 2,750 courses (generated 2026-08-13) | UC San Diego Class Planner public endpoint |
| `data/sections/FA26.json` | Fall 2026 Schedule of Classes, 2,267 courses | As published on tritonplan.com |
| `data/registrar-calendar.json` | Enrollment and Registration Calendar 2026–27 (FA26, WI27, SP27), fetched 2026-09-27 | blink.ucsd.edu |
| `data/offerings/` | [`sources.json`](data/offerings/sources.json) (CSE, MATH, ECE, COGS) and raw captures from 2026-09-27: CSE as CSV (92 course rows), MATH and ECE as markdown tables | Department tentative-offering pages, discovered with Tavily |
| `lib/vendor/tritonplan/` | Seven pure modules: requirements engine and progress, academic-history parser, program matching, AP/IB credit, record reconciliation, quarter arithmetic | TritonPlan (MIT) |

The offerings refresh writes `data/offerings/<DEPT>.json` as
`{ dept, sourceUrl, fetchedAt, contentHash, terms, rows: OfferingEvidence[] }`, where each row carries the
verbatim source line, its URL and the fetch time (type in [`lib/types.ts`](lib/types.ts)). Term codes are
TritonPlan quarter codes: `FA26`, `WI27`, `SP27`.

No student data is included. Course descriptions and requirement text remain the property of The Regents of
the University of California; attribution and licence notes are in [NOTICE.md](NOTICE.md).

## Built for the Nebius x NVIDIA Global AI Hackathon

Track: Best Apps and Agents. Each Stage 1 requirement, as recorded in [DESIGN.md](DESIGN.md), and where it is
satisfied. The per-item checklist with status lives in [notes/stage1-checklist.md](notes/stage1-checklist.md).

| Requirement | Where |
|---|---|
| Runtime Token Factory calls from the live demo, with the models named identically in README, Devpost, Built With and the video audio | `lib/tf/models.ts` registry; ledger entries in the trace panel; model table above; [devpost/SUBMISSION.md](devpost/SUBMISSION.md); [devpost/VIDEO.md](devpost/VIDEO.md) spoken lines |
| A genuine multi-step tool-chaining workflow with a real action behind an approval gate | Planner tools (`eligible_courses`, `check_prereqs`, `requirement_progress`, `offering_status`, `unit_check`, `grade_history`, `submit_plans`) → verifier → critic → approval record and signed token → TritonPlan import / .ics / email |
| Fresh public MIT repository with meaningful history | https://github.com/SahirSSharma/quarterback, [LICENSE](LICENSE), [CHANGELOG.md](CHANGELOG.md) |
| Working public demo URL that survives judging (Dec 1–15) | https://quarterback-delta.vercel.app; replay mode by default, live mode behind a spend cap |
| Video of at most 3 minutes with audio, on YouTube | [devpost/VIDEO.md](devpost/VIDEO.md); link `[to be added]` |
| Written feedback on Nebius and NVIDIA tools | [devpost/feedback.md](devpost/feedback.md) |
| Tavily `/search` and `/extract` calls that change the decision | `lib/tavily`, `data/offerings/`, verifier rule `not-offered`, Stress-test refusal quote, eval E3 |

TritonPlan is the data source and the write target, not the product: Quarterback reads the public snapshot
TritonPlan compiled and, after approval, writes a plan into TritonPlan's Degree Planner. Standing, the
author's other project, shares no code or corpus with this repository.

## Feedback for Nebius and NVIDIA

The required tool feedback is a dated log of what we measured on Token Factory, what we saw and what we
changed, plus concrete requests: [devpost/feedback.md](devpost/feedback.md).

## License

MIT, see [LICENSE](LICENSE). Third-party notices, including the TritonPlan modules and the UC San Diego
data, are in [NOTICE.md](NOTICE.md).
