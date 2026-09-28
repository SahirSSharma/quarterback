# Notes from the lib/agents owner (planner, critic, explain, intake; scripts/record-demos.ts)

## How to call it (app/ owner)

- `planRun({state, action, impact, options?: {horizonTerms?}, onEvent?, tf?})` in `lib/agents/planner.ts` →
  `{plans, reports, rejectedDrafts, rounds, ledger}`. `plans` are only the verifier-passing ones; `reports` has
  one entry per submitted draft (failing ones `ok:false`), so the UI can say "the code rejected N drafts".
  Events: `step`, `model`, `tool_call`, `tool_result`, `verifier`, then `done` / `error`, all with `step:'plan'`.
- `stressTest({state, action?, plans, reports, evidenceIndex, onEvent?, tf?})` in `lib/agents/critic.ts` → `Verdict`.
  Build `evidenceIndex` with `buildEvidenceIndex(plans, horizonTerms(state))` from `lib/agents/context.ts`; cache
  the verdict under `verdictCacheKey(plans, evidenceIndex)` (sha256 of the plan set + evidence ids). Pass the
  `action` so the critic sees the record after a drop. Refusal quotes are always the stored `OfferingEvidence`.
- `whyNot({state, code, eligibility, onEvent?})` in `lib/agents/explain.ts` → string. `eligibility` is
  `buildPlannerContext(state, action, impact).eligibility`; pass `applyAction(state, action)` as the state.
- `aiIntake(text, {currentTerm})` in `lib/agents/intake.ts` → `StudentState` (`source:'ai-intake'`,
  `confidence:'medium'` when a major file matched, else `'low'`; `warnings` list what to confirm). Call it only
  when `fromAcademicHistory()` returns `confidence:'low'`; read `currentTerm` from the calendar, never a constant.
- The planner plans against the record AFTER the action (`applyAction`: a drop removes the in-progress row, so
  the course can be retaken and no longer satisfies prerequisites; P/NP and keep change nothing). `RunRecord.state`
  should stay the original state; the plans and reports are relative to the post-action record.
- `fixtures/runs/demo-{a,b,c}.json` (written by `scripts/record-demos.ts`) is a RunRecord-like object:
  `{demo, recordedAt, now, state, action, impact, plans, reports, rejectedDrafts, rounds, verdict, ledger,
  events: {t: msSinceStart, event: TraceEvent}[], explain?: {code, text}, intake?: {file, state}}`. The impact was
  computed with `now = 2026-10-01T12:00:00-07:00`; recompute `impact.deadlines` (and the deadline notes) at request
  time as the app mock already does. Replay the `events` with their `t` offsets for the trace panel.
- Ledger entries are collected from `model` events (`planRun` returns them; the critic emits one). Steps are
  `plan`, `stress-test`, `explain`, `intake`.

## Requests / conflicts for other modules

- **engine (verifier) — refusals are rare by design under today's rule.** `verify()` fails a plan on
  `not_offered` from a *department page* (`rule:'not-offered'`, error), so a plan with a blank-cell placement never
  reaches the critic. The critic refuses only when a load-bearing course sits in a quarter whose evidence is
  `not_offered` or `unknown (not on dept page)` — the department page covers that quarter and simply has no row
  for the course (CSE 15L in WI27) — and the planner is told to avoid exactly those placements. Plain `unknown`
  (FA27, beyond every published sheet; departments with no page) is a risk, never a refusal — that is my reading
  of "not_offered or unknown on a tentative page"; the alternative (refuse on any FA27 unknown) refused all
  three plans in a recorded attempt. Result: **none of the three recorded demos contains a refusal**
  (a: 2 plans, 1 rejected draft, verdict recommends p-balanced; b: 3/0, p-fastest; c: 3/0, p-balanced), so the
  DESIGN.md headline ("refuses the fastest plan and quotes the page") is not in any fixture. `notes/app.md`
  assumed a blank cell on the tentative sheet would be a *warning* (`assumed-offered`); if the verifier adopts
  that, a plan like the app mock's (CSE 194 in WI27) reaches the critic and gets refused with the sheet's own row
  as the quote — then re-record everything (`QB_MODE=live QB_RECORD=1 node --import ./scripts/node-ts.ts
  scripts/record-demos.ts`, ≈ $0.25).
- **app** — `app/_mock/mock.test.ts` asserts `rejectedDrafts > 0` for every demo, a refusal in (a), and a
  Lightning entry in every trace. The real recordings differ: rejected drafts 1 / 0 / 0, no refusals, and
  Lightning appears only in (a) (explain + intake). Adjust the UI copy and that test when swapping the mock for
  `fixtures/runs/*` ("the code rejected N drafts" must tolerate N = 0).
- **engine** — `applyAction()` in `lib/agents/context.ts` duplicates the "after" record that `impact()` builds
  inline. If the engine exports it, the planner will import it.
- **engine / data** — any change to `data/catalog-overrides.json`, `data/offerings/*.json`, the requirement files or
  `offeringStatus()` quotes changes the planner prefix / tool results and therefore the fixture keys: re-record.
  The prefix is a pure function of `(majorFile, collegeFile, currentTerm, horizon, data snapshot)`.
- **tf** — `forcedTool()` does not emit a `model` TraceEvent (only `toolLoop` does), so the planner and critic
  emit one from `result.entry`. When `forcedTool()` / `structured()` retry internally, that first call reaches
  the ledger sink but no event, so `planRun().ledger` undercounts by that call; an `onEvent` on both helpers (or
  a returned `entries[]`) would close the gap. Exporting `forHistory()` would let the planner stop stripping
  `reasoning` itself when it appends the rejected `submit_plans` turn to the history.
- **tf (terminal tool)** — `toolLoop()` has no notion of a terminal tool, so `submit_plans` is kept out of the
  loop's tool list and the model is told so; in demo (c) Super called it anyway once, got `Error: unknown tool
  submit_plans` back, and reached the forced call one round later (recorded that way; replay is deterministic). A
  `terminal: string[]` option on `toolLoop` (return when the model calls one of these) would save that round.
- **types** — nothing needed. (`PlanTerm.partTime`, `OfferingsFile`, `LedgerEntry.fallback` are already there.)

## Design notes

- Context pack (demo a): shared prefix ≈ 7.7k tokens, suffix ≈ 2.6k at the agreed 4 chars/token; (b) 4.3k + 1.5k;
  (c) 6.9k + 2.2k — the test caps the whole pack at 24k estimated (target ≤ 30k). Measured on Token Factory the
  ratio is closer to 2 chars/token for this content (course codes, punctuation): demo (a)'s first Super request
  billed 21.8k prompt tokens including the six tool schemas — still under 30k, but the estimate is optimistic by
  ~2×. Per-bucket shortlist caps: 20 candidates per major bucket, 8 per college bucket, ordered
  student-independently (offered somewhere in the horizon → fewer prerequisite groups → code); the rest are one
  `eligible_courses(term)` call away.
- Two kinds of `unknown`, rendered as data everywhere the model reads (table cells, `offering_status` tool,
  critic evidence rows): `unknown (not on dept page)` — the department's page covers the quarter and has no row
  for the course (CSE 15L in WI27); plain `unknown` — nobody publishes anything for that quarter (FA27, or HUM).
  The planner treats the first like not_offered unless nothing else fits; the critic may refuse on it, and only
  flags the second as a risk. `departmentPageTerms()` / `statusText()` in `lib/agents/context.ts`.
- Live spend on 2026-09-27: $0.383 over five runs (three attempts at demo a while the prompts were tuned:
  $0.078, $0.067, $0.101; demo b $0.065; demo c $0.072). The fixtures on disk are the last a, b and c: $0.239,
  23 Token Factory calls (Super 18, Ultra 3, Lightning 2). Per demo: a 10 calls / $0.101 (7 Super rounds incl. one
  verifier correction), b 8 / $0.065, c 5 / $0.072.
- Measured model behaviour that shaped the settings (2026-09-27, three live runs of demo a, $0.25 in total):
  Ultra with `reasoning_effort:'high'` and no budget deliberated past 6000 tokens over 45 evidence rows, with the
  reasoning in `content` and no tool call (`finish_reason:'length'`) — now `reasoning_budget:3072`,
  `max_tokens:8192`. Super's `reasoning_budget:4096` is advisory: one loop turn spent 6000 reasoning tokens and
  hit the cap without a tool call — `max_tokens` raised to 8192 so an overshoot still leaves room for the calls.
  Super only calls tools when the procedure says the FIRST reply must be tool calls; "stop calling tools when
  done" alone produced a one-line reply and no tool use.
- **Prompt cache did not engage** (for devpost/feedback.md): seven consecutive Super calls within 2.5 minutes,
  each starting with the same 22k-token byte-identical prefix, all returned
  `prompt_tokens_details: {cached_tokens: 0, created_cache_tokens: 0}` and `prompt_cache_hit_tokens: 0`
  (see any Super fixture from `fixtures/runs/demo-a.json`'s ledger). Either the cache needs an opt-in we have
  not found or it is not active on this model; the prefix design costs nothing either way, but the README
  should not claim cache savings until a hit is observed.
- Intake mapping: TritonLink prints the grade-points cell (`0.00`) next to in-progress rows; Lightning copied it
  into `grade` and left `inProgress` false. `toStudentState()` treats anything that is not a grade as "no grade
  yet" (in progress), so the mapping — not the prompt — carries that rule and the recorded fixture stays valid.
- Nothing time-dependent reaches a prompt or a tool result: deadline `passed` flags and the engine's "has passed"
  notes are left out of the suffix (the dates come from the calendar), evidence `fetchedAt` comes from data files.
- Evidence ids are `ev_<CODE without space>_<TERM>` (`ev_CSE194_WI27`), derivable from the course and term, so the
  critic can cite any cell of the table and the resolver can re-derive an id the model mangled.
- `submit_plans` is not in the tool loop's tool list (toolLoop has no terminal-tool notion); the prompt tells the
  model to stop calling tools and it is then forced. Correction rounds are forced calls only (the violations name
  rule, course and term); ≤ 3 submit rounds, ≤ 6 tool rounds.
- Demo actions: (a) drop CSE 29, (b) drop COGS 109, (c) drop CSE 101 — each a prerequisite for later courses on
  the record's path, so the impact card and the re-plan have something to say.
