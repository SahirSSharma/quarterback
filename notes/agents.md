# Notes from the lib/agents owner (planner, critic, explain, intake; scripts/record-demos.ts, scripts/measure-planner.ts)

_2026-09-28: the planner was restructured (parallel drafts → verify → repair). The sections below supersede the
2026-09-27 notes; what still holds from them is repeated here rather than referenced._

## How to call it (app/ owner)

- `planRun({state, action, impact, options?, onEvent?, tf?})` in `lib/agents/planner.ts` →
  `{plans, reports, rejectedDrafts, rounds, ledger}`. Three phases:
  1. **DRAFT** — the three strategies (`fastest` / `balanced` / `lightest`) are drafted **concurrently**, one call each on
     the draft role (`'extract'` = Lightning, thinking off — the default), with at most ONE round of lookups
     (`eligible_courses` / `check_prereqs` / `offering_status`) before `submit_plan`; a draft that ends without a valid
     `submit_plan` call is forced to make one. Unit arithmetic and requirement progress are in the context pack, not
     tools (`unit_check`, `requirement_progress`, `grade_history` are gone).
  2. **VERIFY** — `lib/engine` `verify()` on every draft; a failing draft is never returned as a plan.
  3. **REPAIR** — only failing drafts, concurrently, on the repair role (`'plan'` = Super, **thinking off** by default) as
     a fresh request: same prefix and suffix, then the rejected attempt, its violations and — per bad slot — a
     replacement menu that code computed under the verifier's own rules (`replacementMenu()` in `context.ts`). At most
     `maxRepairRounds` (2) rounds; a draft still failing counts in `rejectedDrafts` and its report (`ok:false`) is kept.
- `options`: `{draftRole, repairRole, reasoningEffort, maxRepairRounds, horizonTerms}`; defaults `DEFAULT_OPTIONS`
  (`extract` / `plan` / `'none'` / 2) chosen by the measurement below; env `QB_DRAFT_ROLE=extract|plan` and
  `QB_REPAIR_EFFORT=none|low|medium|high` override the defaults (read per run; an unknown value throws).
  `reasoningEffort` applies to every `'plan'`-role call; `'none'` is thinking off, anything else is thinking on with that
  `reasoning_effort` — see the measurements before turning it on.
- `plans` come back in strategy order (fastest, balanced, lightest), only the verifier-passing ones. Plan ids are
  `p-<label>` for the draft and `p-<label>-2` / `p-<label>-3` for its repairs, so `reports` (one per verified draft, draft
  phase first, then each repair round) tell the story of every strategy. `rejectedDrafts === reports.filter(!ok).length`
  still holds. `rounds` is now 1 + repair rounds run (1–3). A draft whose model call failed outright (a Token Factory
  error that is not the spend cap) is a report with `rule: 'model-error'`, never a crash of the whole run; the spend cap
  (`BudgetExceededError`) and a missing fixture still end the run with an `error` event.
- Events: the same types as before (`step` / `model` / `tool_call` / `tool_result` / `verifier` / `waiting` / `done` /
  `error`, all `step:'plan'`), plus a `step` per phase with elapsed ms — see "What the UI should render differently".
  Every model call now emits a `model` event (`forcedTool` got an `onEvent`), so `planRun().ledger` is complete.
- `stressTest(...)` (`critic.ts`), `whyNot(...)` (`explain.ts`) and `aiIntake(...)` (`intake.ts`) are unchanged; call them as
  the 2026-09-27 notes said (evidence index from `buildEvidenceIndex(plans, horizonTerms(state))`, the critic sees
  the record after the action, `aiIntake` only on `confidence:'low'`).
- `fixtures/runs/demo-{a,b,c}.json` keep their shape (`{demo, recordedAt, now, state, action, impact, plans, reports,
  rejectedDrafts, rounds, verdict, ledger, events, errors, explain?, intake?}`); the impact was computed at
  `now = 2026-10-01T12:00:00-07:00`, recompute `impact.deadlines` at request time as the app already does. Replay the
  `events` with their `t` offsets; concurrent drafts interleave in the recording exactly as they happened.

## What the UI should render differently

1. **Parallel drafting step.** The first `step` still starts `Context pack built: …` (the routes test pins that) and now
   continues `… Drafting 3 plans in parallel on Nemotron 3.5 Lightning (thinking off), one lookup round allowed before
   submit_plan.` Treat it as the phase header; the `model` / `tool_call` / `tool_result` / `verifier` events that follow,
   up to the step `Drafted 3 plans in N ms: k passed the verifier, m rejected.`, belong to the draft phase. The three
   drafts run at once, so their events interleave; the `verifier` event's `report.planId` (`p-fastest`, `p-balanced`,
   `p-lightest`) is the only per-draft key — `tool_call` / `model` events carry no draft id (TraceEvent has none).
2. **Repair step.** `Round 1: the verifier rejected k of 3 drafts; repairing fastest, balanced on Nemotron 3 Super
   (thinking off).` opens it; `verifier` events for `p-<label>-2` follow; `Repair round 1 done in N ms: k passed, m still
   failing.` closes it; a second round reads `Round 2: … of k repaired drafts …` and yields `p-<label>-3`. The last step
   before `done` is the summary (`3 plans passed the verifier in N ms; 1 draft rejected.` or `No plan passed …`). The
   eval's first-pass metric keys on `^Round \d+: the verifier rejected`, so that prefix is stable.
3. **Per-draft status** = the latest verifier report per label: strip the `-N` suffix of `planId` to get the strategy;
   `ok:true` → shown plan (its `Plan.label` is the strategy, its id may carry the suffix), `ok:false` with a later report of
   the same label → repaired, `ok:false` with no later report → rejected for good (`RejectedDrafts` can list the rules).
   A `model-error` violation means the model produced no plan for that slot.
4. **Timing copy.** Live planning is now ≈ 6–15 s for the demo students (measured below), not 90–170 s; "About ten
   seconds" is right again. Replay gaps stay capped at 1.5 s in the pipeline.
5. **Ledger rows.** With three calls in flight, two `model` entries can share the same `at` millisecond; dedupe by index
   (or `(at, model, promptTokens)`), not by `at` alone. Plan-step entries are now mostly Lightning with a Super entry per
   repair; the model badge already handles both. `cacheHitTokens` is non-zero on Lightning calls (16–23k of a 24k prompt
   once the prefix is warm) — the "no cache hits" copy can go.
6. **Rejected-draft copy.** `rejectedDrafts` counts every failing verified draft including repair attempts, so "the code
   rejected N drafts" is still true; N is larger than before (1–5 on the demos).

## Requests / conflicts for other modules (2026-09-28)

- **app (`app/_mock/mock.test.ts`)** — two assertions no longer hold for the re-recorded demos: "plan-step ledger entries
  are all Super" (they are Lightning plus Super repairs) and "the planner trace calls tools" (Lightning may submit
  directly; the recordings do call `eligible_courses`, but do not rely on it). Fixed with the re-recording: the test
  now asserts Lightning (with Super allowed) on the plan step and that every tool call is a planner tool with a result.
- **eval (`eval/e1.test.ts`)** — the replay test's recorded numbers for demo (a) (plans 2 / rejected 1 / first pass 3→2 /
  6 tool calls / progress 12 of 17 / ≥ 8 calls) belong to the old recording. Fixed with the re-recording: the test
  now computes every expected number from `fixtures/runs/demo-a.json` (plans, reports, first pass from the recorded
  events, progress against `optimum()`, verdict counts, calls and USD from the recorded ledger, tool results). `eval/e1.ts` got one knob plumbed: the
  shipped row (`super-b4096…`) now passes `base` through, i.e. runs `planRun`'s defaults, which is what the fixtures
  replay; the other cells still force one model and one thinking setting on every call (they now override the draft
  and the repair alike). The `MATRIX` names ("b4096") describe the old planner; renaming is the eval owner's call.
- **README / DESIGN / devpost** — the planner row of the model table (Super, `reasoning_budget:4096`, tools, ≤ 3 rounds),
  the tool list (`unit_check`, `requirement_progress`, `grade_history`, `submit_plans`) and `devpost/VIDEO.md`'s
  "unit_check" line describe the old planner. New facts: Lightning drafts three plans in parallel with the shared
  prefix cached, Super (thinking off) repairs from a code-computed menu, `submit_plan` (singular) is the terminal tool.
- **tf (`lib/tf/helpers.ts`, additive, done here)** — `toolLoop({terminal: string[]})` returns `{…, terminal: ToolCall}`
  when the model calls one of the named tools (nothing in that reply is run); `forcedTool({onEvent})` emits a `model`
  event per call, retry included. Both requested in the 2026-09-27 notes; tests in `helpers.test.ts`.
- **engine** — nothing new. `applyAction()` still duplicates the engine's "after" record.
- **types** — nothing needed. A `draft?: string` on `tool_call` / `model` events would let the trace panel group the
  interleaved events per draft; until then the verifier's `planId` is the key.

## Measured (2026-09-28, live, scripts/measure-planner.ts)

`scripts/measure-planner.ts` ran the three demos plus synthetic students from `eval/synth.ts` (seed 3, distinct
major/college pairs) through four configurations; rows in `eval/results/planner-configs-2026-09-28.jsonl`, table in
`eval/results.md` ("Planner configuration (measured)"; re-render at $0 with `--render <jsonl>`). The run was stopped
after 12 students (46 runs, $1.041): all four configs on 11 students, A and C on the twelfth. Order per student was
A (cold), C, D (cache-warm repeats of the same Lightning draft requests), then B.

| Config | Drafts + repair | Students | First-pass validity | Final plans / student | ≥ 1 plan | 3 plans | Wall-clock mean / p50 / max | $ / student | Cache-hit tokens |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| **A (default)** | Lightning drafts + Super repair, thinking off | 12 | 22.2% | 1.75 | 83.3% | 33.3% | 23.9 s / 27.0 s / 37.2 s | $0.0249 | 733,600 (12/12 runs) |
| B | Super drafts, thinking off + Super repair, thinking off | 11 | 30.3% | 1.82 | 90.9% | 18.2% | 52.7 s / 50.2 s / 112.0 s | $0.0502 | 0 |
| C | Lightning drafts, no repair | 12 | 13.9% | 0.42 | 25.0% | 8.3% | 6.7 s / 5.5 s / 16.2 s | $0.0061 | 899,184 |
| D | Lightning drafts + Lightning repair | 11 | 15.2% | 1.18 | 90.9% | 0% | 13.4 s / 11.9 s / 24.7 s | $0.0106 | 1,433,664 |

**Choice: A.** By the rule (final validity, then latency, then cost) B edges A on validity by one student (10/11 vs 10/12
with ≥ 1 plan; 1.82 vs 1.75 plans per student, n = 11–12, within noise) but takes 2.2× longer (52.7 s mean, 112 s max —
Super with thinking off rambles to the 1,200-token cap on ~2 of 3 draft calls before the forced submit) and costs 2×.
Lightning drafts are not markedly worse on validity, so A is the default: `DEFAULT_OPTIONS = {draftRole:'extract',
repairRole:'plan', reasoningEffort:'none', maxRepairRounds:2}`. D is the cheapest way to get *a* plan (90.9% ≥ 1) but
never three, and its repairs mostly resubmit the same plan. The three demos under A: (a) 3 plans, 8.5 s, $0.0169;
(b) 2 plans of 7 drafts, 14.1 s, $0.0203; (c) 3 plans, 8.0 s, $0.0140 — the synthetic students (unfamiliar majors, five
courses a quarter) are what pushes A's mean to 24 s: two repair rounds of up to three concurrent Super calls at ≈ 9 s a
round. Note the 30 s goal is met on the demos and at the p50 (27 s) but not at the max (37 s).

Token Factory behaviour measured on the way (2026-09-28, live, $0.59 before the table above; total live spend $1.64):

- `reasoning_effort: 'low'` does **not** bound Super's reasoning for this task: 19 of 19 thinking-on Super calls (effort
  low, with and without `reasoning_budget: 512`) ran to the 1,200-token `max_tokens` (`finish_reason: 'length'`, no tool
  call, 6.3–6.7 s alone, 12.4–14.3 s with three calls in flight). The pilot with the task's intended config (Lightning
  drafts + Super repair at effort low) gave 1 plan in 34.5 s; Super drafts at effort low gave 0 plans in 55.9 s
  (`planner-configs-2026-09-28-pilot.jsonl`). `reasoning_effort: 'none'` gives 0 reasoning tokens every time.
- Lightning's prompt cache engages on the shared prefix, including across the three **concurrent** drafts: 16,768–23,056
  cached of ≈ 24,000 prompt tokens on demo (a) once the prefix is warm (the first ever call of a prefix misses); on the
  warm repeat (config C) every run had cache hits. Prompt tokens billed are ≈ 2.3× the 4-chars/token estimate.
- Super with thinking off generates ≈ 250–330 tokens for a `submit_plan` call in 2.1–2.5 s alone, 4–7 s when three
  calls share the account; with `tool_choice: auto` and tools present it ran to 1,200 tokens of prose on 2 of 3 draft
  calls (config B's 37–72 s draft phases).
- Repair prompts: given its own `submit_plan` call in the history, Super (thinking off) resubmitted the identical plan
  (0/2); as a fresh request listing violations only, 1/8; with the code-computed replacement menu per bad slot, 5/5 on
  the demos and 1.75 plans per student over the synthetic set. Lightning as the repairer resubmits the same plan
  (0/12 without the menu, 2/3 then 0/1 with it) — cheap, but not a repairer.
- Lightning drafts: with the first prompt, 33% first-pass validity on demo (a) (unit-cap from 6–8 courses a quarter,
  prerequisite chains, already-earned courses); after the mechanical rendering (units and the needed prerequisite next
  to each eligible course, course counts per strategy, quarters to avoid) 50% on demo (a), 22% over the harder
  synthetic set. Every draft spent its one lookup round on `eligible_courses(WI27)` (1.4–1.9 s), then submitted in
  1.5–4.9 s; a draft is 2 Lightning calls, ≈ $0.003, and the phase is ≈ 6 s.

**Status (2026-09-28, re-recorded):** the three demos were re-recorded with the shipped planner at 07:42–07:45 UTC
(`QB_MODE=live QB_RECORD=1 QB_FIXTURES_DIR=<scratch dir> QB_TOTAL_CAP_USD=0.075 node --import ./scripts/node-ts.ts
scripts/record-demos.ts --demo a|b|c`, one demo per invocation so a failure never spends the others' budget).
`fixtures/tf` now holds exactly 33 fixtures: the five probe fixtures (`0460c550`, `122ce1f0`, `88ca93ae`, `c2d72fa8`,
`f5c2bca5`) plus the 28 the three runs made (a 10 = 6 Lightning drafts + 1 Super repair + 1 Ultra + explain + intake;
b 10 = 6 + 3 Super + 1 Ultra; c 8 = 6 + 1 + 1); 21 fixtures of the 2026-09-27 Super planner are gone, and the
explain and intake fixtures (`6e50ff7b`, `89d4c0db`: same prompts, same keys) carry the new responses.
`node --import ./scripts/node-ts.ts scripts/record-demos.ts` (mock) prints "replay matches" for a, b and c, and
`lib/agents/demo-replay.test.ts`, `eval/e1.test.ts` and `app/api/explain/route.test.ts` replay them at $0.

| Demo | Plans | Rejected drafts | Rounds | Plans at | Verdict at | Entries | $ | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| (a) drop CSE 29 | 3 | 1 (fastest: `prereq-unsatisfied` CSE 55 SP27; its 20-unit quarters are `unit-cap` warnings) | 2 | 10.7 s | 34.9 s | 9 | $0.0541 | recommends `p-fastest-2`, 3 risks, 0 refused |
| (b) drop COGS 109 | 3 | 3 (all first drafts; balanced and lightest carry `not-offered` COGS 112 SP27 with the COGS row as `evidence`) | 2 | 11.1 s | 36.7 s | 10 | $0.0531 | recommends `p-fastest-2`, 2 risks, 0 refused |
| (c) drop CSE 101 | 3 | 1 (fastest: `not-offered` MATH 158 SP27, `prereq-unsatisfied` CSE 127) | 2 | 8.8 s | 27.2 s | 8 | $0.0445 | recommends `p-fastest-2`, 2 risks, 0 refused |

The code-built fallback was not needed on any demo. Lightning's cache hit on every draft call (8,384–23,056 tokens);
Super repaired 5 of 5 failing drafts in one round. Ultra spent 6,916–9,338 reasoning tokens per verdict — above the
critic's old `max_tokens: 8192`: the first attempt at (a) ($0.0665, discarded, fixtures not kept) ran to `finish_reason:
length` with no `submit_verdict` and the correction retry produced a verdict claiming no plans were supplied.
`lib/agents/critic.ts` `MAX_TOKENS` is 16384 since (DESIGN/README model tables updated); nothing else in the prompts
changed, so no other fixture key moved. Live spend of the pass: $0.2185 including the discarded attempt.

## Design notes (still true, from 2026-09-27, plus what changed)

- Context pack: shared prefix ≈ 8.0k / 4.6k / 7.3k estimated tokens for demos a / b / c at 4 chars/token; Token Factory
  bills ≈ 19k / 8k / 17k for it (≈ 2.3 chars/token for course codes), plus a student suffix of ≈ 3–5k. The prefix is a
  pure function of `(majorFile, collegeFile, currentTerm, horizon, data snapshot)` and is byte-identical across
  students of the same major and college (tests in `context.test.ts` and `planner.test.ts`); the suffix is identical
  across a student's three drafts, only the closing `## Your draft` brief differs, so Lightning's prompt cache covers
  prefix + suffix from the second draft on.
- The suffix now carries what a no-thinking model needs mechanically: per course in the "Eligible from" lists its units,
  the prerequisite it still needs planned in an earlier quarter, and the horizon quarters it is `not_offered` in;
  course counts per strategy (5 / 4 / 3 courses a quarter) in the briefs; the unit rule spelled out in the constraints.
  Each addition removed a class of first-pass failure seen live (unit-cap from 6–8 courses, prereq chains, not_offered
  placements, 10-unit quarters).
- Two kinds of `unknown` (`unknown (not on dept page)` vs plain `unknown`), evidence ids `ev_<CODE>_<TERM>`, and the
  critic's refusal rule are unchanged from the 2026-09-27 notes; none of the three recorded demos contains a refusal.
- Nothing time-dependent reaches a prompt or a tool result (deadline `passed` flags and "has passed" notes are left out;
  `fetchedAt` comes from data files), so fixture keys are stable across days. A second repair of an unchanged plan
  carries the round number in its brief so it is never the byte-identical request of the first (the fixture would be
  overwritten and replay would drift).
- Demo actions: (a) drop CSE 29, (b) drop COGS 109, (c) drop CSE 101.
