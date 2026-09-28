# Notes from the eval/ owner (synthetic students, E1, E4)

Nothing outside `eval/` was edited. No change to `lib/types.ts` is needed.

## Findings for other modules (from the $0 mock runs)

- **data / engine (`data/majors/index.json`)** — "Cognitive and Behavioral Neuroscience (B.S.)" is listed twice
  with confidence `high`, under `cognitive-science-cognitive-and-behavioral-neuroscience.json` and
  `psychology-cognitive-and-behavioral-neuroscience.json`. `matchProgram` is therefore AMBIGUOUS for that exact
  name + degree, `fromAcademicHistory()` returns `confidence: 'low'`, and `aiIntake` cannot resolve it either
  (same name, same degree). E4 paste #19 (seed 1) shows it. One of the two entries needs a distinguishing name
  or a lower confidence.
- **engine / vendored parser (`lib/vendor/tritonplan/parse-academic-history.js`)** — two layout limits E4
  measures: (1) a `Transfer Courses` block that appears **before** the quarter blocks sets `transferStarted` and
  nothing resets it except an `Academic Events` heading, so every later quarter row is skipped (E4 #26: 33 rows →
  2); (2) a course title wrapped onto a second line loses the row (`ROW` matches one physical line) — recall
  27–50% on the `wrapped` layout. Both are upstream TritonPlan parser behaviour; noted, not patched here.
- **agents** — `withPlan()` in `lib/agents/tools.ts` (the student with a draft's courses added as earned) is not
  exported; `eval/optimum.ts` re-implements it as `withCourses()`. Exporting it would remove the duplicate.
- **engine** — the count in DESIGN.md ("126 high-confidence major files") is 124 in the index today
  (`confidence: 'high'`, all `found: true`); `eval/synth.ts` reads the index rather than the number.
- **critic / DESIGN story** — as `notes/agents.md` says, `verify()` hard-fails `not_offered`, so a critic refusal
  on a not_offered plant is impossible by construction; E1 therefore reports verifier catches (`plant: 'verifier'`)
  separately from critic refusals (`'critic'`), and refusal recall counts both. Only the `unknown (not on dept
  page)` plants can reach the critic today.

- **agents (coupling to know about)** — E1's "valid on the first pass" metric attributes verifier reports to
  submit rounds by matching the planner's step message `Round N: the verifier rejected …`
  (`firstPassFromEvents` in `eval/e1.ts`). Rewording that message silently zeroes the metric; a `round` field on
  the `verifier` TraceEvent, or a returned per-round report list, would remove the coupling.

## Requests

- **package.json (root, optional)** — scripts `"eval:e1": "node --import ./scripts/node-ts.ts eval/e1.ts"` and
  `"eval:e4": "node --import ./scripts/node-ts.ts eval/e4.ts"`.
- **tf (optional)** — `toolLoop` / `forcedTool` already accept `model` and `thinking`, which is all E1 needs; a
  `model` on `stressTest()` would let E1 ablate the critic's model too (today only on/off).
- **agents (optional)** — recording a live E1 slice with `QB_RECORD=1` needs `QB_FIXTURES_DIR` set (the runner
  refuses to write eval traffic into `fixtures/tf`); if you want replayable E1 fixtures for the other configs,
  pick a directory and add it to `vitest`'s fixture lookup.

## What was run

- `node --import ./scripts/node-ts.ts eval/e4.ts` (mock, 30 pastes, $0) and
  `node --import ./scripts/node-ts.ts eval/e1.ts` (mock, 3 demo students × 10 configs, $0). Numbers in
  `eval/results.md`; rows in `eval/results/*.jsonl`.
- Not run: anything live. No Token Factory or Tavily call was made from this module.
