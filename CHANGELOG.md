# Changelog

All notable changes to Quarterback are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are dated (UTC, the stamp the result files
carry) rather than versioned until the first tagged release.

## 2026-09-28 — in the working tree, not yet committed

### Changed

- Planner (`lib/agents`): `planRun` restructured into DRAFT (three strategies drafted concurrently on
  Lightning, thinking off, at most one lookup round with `eligible_courses` / `check_prereqs` /
  `offering_status` before a terminal `submit_plan`), VERIFY (engine `verify()` on every draft) and REPAIR
  (failing drafts only, concurrently, on Super with thinking off, as a fresh request carrying the rejected
  attempt, its violations and a code-computed replacement menu; at most two rounds). `unit_check`,
  `requirement_progress` and `grade_history` removed; unit arithmetic, per-course units, the needed
  prerequisite and the quarters to avoid moved into the context pack. Options `{draftRole, repairRole,
  reasoningEffort, maxRepairRounds, horizonTerms}` with env `QB_DRAFT_ROLE` / `QB_REPAIR_EFFORT`; per-phase
  `step` events with elapsed ms; every model call emits a `model` event. Defaults chosen by a live
  measurement of four configurations on 12 students (46 runs, $1.04): `eval/results.md` "Planner
  configuration (measured)", `scripts/measure-planner.ts` (with a $0 `--render` mode).
- Token Factory helpers (`lib/tf/helpers.ts`, additive): `toolLoop({terminal})` returns the call to a named
  tool without running it; `forcedTool({onEvent})` emits a `model` event per call, retry included.
- UI (`app/`): replay banner gated on `run.mode === 'replay'`; "What the code rejected" panel listing each
  rejected draft's error violations; client-side FNV fingerprint removed, the approval's sha256 shown as its
  first 8 characters; ledger with in / out / reasoning / cache / cost columns, replayed and fallback tags and a
  totals row; About page pulls `GET /api/ledger/summary` as live figures; trace panel reconnects on a dropped
  stream (server replays the stored trace), reads the server's JSON error on a fatal close, shows elapsed
  m:ss, folds tool call and result into one row, spinner with a model badge, capped height; actions captions
  name the import host and the dated / undated .ics terms; Situation copy per action; deadline "passed" chips
  and headline; Start page TSS copy hint and the Nebius Token Factory / NVIDIA Nemotron line; keyboard focus
  moves to each step as it appears; no horizontal scroll at 390 px; cumulative layout shift cut from 0.117 to
  ≤ 0.007 at every width measured.
- Intake (`lib/engine/paste.ts`): `joinWrappedRows()` re-joins course rows wrapped over two or three physical
  lines before the vendored parser; E4 wrapped-layout row recall 40.8% → 100%, overall 87.2% → 95.7%.
- Eval (`eval/e1.ts`): the shipped E1 row runs `planRun`'s defaults; other cells still force one model and one
  thinking setting on every call.
- Docs truth pass: README, DESIGN, PROGRESS, this file, `devpost/*`, `notes/stage1-checklist.md` and
  `eval/README.md` rewritten to describe the code and data as they are (planner shape, no Lightning in the
  offerings pipeline, Super's prompt cache never hits while Lightning's does, `reasoning_budget` advisory,
  ECDSA P-256 import token, what is stored and when, data counts, eval status).

### Added

- `POST /api/explain {runId, code}` → `{code, text, entry}`: "why not this course?" answered by Lightning over
  the run's eligibility table; the ledger entry is appended to the run. `WhyNot` card in the UI.
- `eval/results/planner-configs-2026-09-28.jsonl` (+ pilot file) and the E4 re-runs
  (`e4-2026-09-28T05-19-02Z.jsonl` before the fix, `e4-2026-09-28T05-24-41Z.jsonl` after).
- `lib/engine/fixtures/academic-history-demo-wrapped.txt` golden fixture; tests for the pre-normalizer and for
  every new UI helper (`app/lib/trace.ts`, `deadlineHeadline`, `icsCoverage`).
- `notes/ui-polish.md` and 82 browser screenshots under `notes/screens/` (51 MB; whether they belong in git
  is an open question).

### Known issues

- The three demo recordings (`fixtures/runs/demo-*.json`, `fixtures/tf/`) still come from the 2026-09-27
  Super planner. Replay and mock mode, and demo students in production, show that trace (Super on every
  planning call, tools `unit_check` / `requirement_progress` / `submit_plans`). `lib/agents/demo-replay.test.ts`
  and the `eval/e1.test.ts` replay assertion fail with `MissingFixtureError` until
  `QB_MODE=live QB_RECORD=1 QB_FIXTURES_DIR=<scratch dir> node --import ./scripts/node-ts.ts scripts/record-demos.ts`
  (≈ $0.10–0.15) is run and the new fixtures replace the old set (keeping the five probe fixtures).
- `eval/e4.test.ts:58` and `:91` assert the wrapped-row limitation the pre-normalizer removed; replacements are
  written in `notes/engine.md`. `npm test` stays red (4 failures of 435) until both items above land.
- `app/_mock/mock.test.ts` asserts "plan-step ledger entries are all Super" and "the trace calls tools"; both
  need updating once the demos are re-recorded with Lightning drafts.

## 2026-09-27

### Added (Stage B, commit 6431de1, and the fixes after it)

- Agents: Super planner tool loop with verifier iteration (superseded on 2026-09-28), Ultra critic
  (`submit_verdict`, evidence ids resolved to stored quotes), Lightning `whyNot` and `aiIntake`; planner context
  pack with a byte-identical shared prefix; `scripts/record-demos.ts` and the three recorded demo runs.
- Storage: one `ObjectStore` over private Vercel Blob or disk (`QB_DATA_DIR` / `.data`), runs, saved copies,
  approvals, persistent spend ledger with Tavily credits, `.ics`, advisor `mailto:`, ECDSA P-256 signed
  TritonPlan import token (`lib/keys/import-public.json`).
- Routes wired to the pipeline: `POST /api/plan` creates the run, `GET /api/trace/[runId]` does the work over
  SSE with a stored trace for reconnects, `POST /api/stress` (one live Ultra call per run, cached per plan set,
  20 a day), approve 400/409 gate, `GET /api/ledger/summary`, spend caps flipping demo students to their
  recording, production always replaying demo students.
- Eval harness: deterministic synthetic students, greedy optimum, E1 and E4 runners, `eval/results.md`.
- Catalog prerequisite overrides (`data/catalog-overrides.json`, 8 rows) with `scripts/audit-prereqs.ts`;
  `PlanTerm.partTime`.
- Store fix (commit 6b46b16): only write-once keys are served from the process-local cache; runs, saved copies
  and traces always read through (stale-run bug seen on the Vercel preview).

### Added (Stage A, commit cc8e7d8)

- Token Factory client (`lib/tf`): registry with fallback order and prices, `chat` / `chatStream`, retries
  honouring `Retry-After`, ledger entries, sha256 record / replay fixtures, budget guard, `structured` /
  `forcedTool` / `toolLoop` helpers, probe script and recorded probe fixtures.
- Deterministic engine (`lib/engine`): data loaders, prerequisite graph, impact, requirements, offerings
  evidence, terms and deadlines, verifier, Academic History parsing over the vendored modules.
- Tavily client and offerings pipeline (`lib/tavily`, `lib/offerings`, `scripts/refresh-offerings.ts`):
  discovery by `/search`, per-source fetching (Google-Sheet CSV for CSE and COGS, MATH page HTML, ECE via
  `/extract`), deterministic parsers, `data/offerings/<DEPT>.json` with quotes, URLs, fetch times and page
  disclaimers.
- UI shell on stubs (start, plan flow, about), README and the Devpost package.

### Added (scaffold, commits 0b2c91e–a3d150b)

- Scaffold: Next.js 16 App Router, TypeScript strict, Tailwind 4; MIT `LICENSE`; `NOTICE.md` for the
  vendored TritonPlan modules, the UC San Diego data and the model licences.
- `DESIGN.md`, the plan of record; `PROGRESS.md`; `AGENTS.md` conventions; shared contracts in
  `lib/types.ts`; `lib/env.ts`; Vitest with data-snapshot smoke tests; `engines.node >= 24`.
- Public data snapshot under `data/`: General Catalog courses with prerequisites, 142 major requirement files,
  8 college GE files, CAPE average grades for 2,750 courses, the Fall 2026 Schedule of Classes, the 2026–27
  Enrollment and Registration Calendar, department tentative-offering sources.
- `lib/vendor/tritonplan/`: seven pure engine modules copied from TritonPlan.
- Public repository at github.com/SahirSSharma/quarterback; Vercel project `quarterback` linked, API keys set,
  deployment protection preview-only so the production alias is public for judges.

### Fixed

- Smoke test: `data/majors/index.json` and `uncovered.json` are registries, not major files; 142 majors carry
  `buckets`.

### Known issues (2026-09-27)

- The first deployment of the new Vercel project landed as Production despite `--target=preview` (the flag is
  honoured from the second deploy on). The production alias `quarterback-delta.vercel.app` therefore serves the
  empty Next.js scaffold; promotion of the product is Sahir's call.
- The private Blob store's token is refused from a laptop ("Access denied"); local dev uses the disk store
  (`QB_DATA_DIR=.data`, no Blob token in `.env.local`).
