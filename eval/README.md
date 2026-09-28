# eval/ — synthetic students, E1 and E4

Everything here runs in `QB_MODE=mock` at $0 by default. A live run needs **both** `QB_MODE=live` in the shell
(a `QB_MODE` in `.env.local` is ignored on purpose) **and** `--budget-usd <n>`; the runner sets
`QB_TOTAL_CAP_USD` to that number, the Token Factory client refuses the next call once the ledger reaches it,
and the runner stops, writes what it has and says so. Results go to `eval/results/<eval>-<UTC stamp>.jsonl`
(one row per run, appended as it goes) and to a section of [`eval/results.md`](results.md) (each eval replaces
only its own section; losing configs are kept).

Scripts run with the repo's Node preload (`node --import ./scripts/node-ts.ts …`); nothing is installed.

## Files

| File | What |
|---|---|
| `synth.ts` | `makeStudents({n, seed, majors?, currentTerm?})` → deterministic `StudentState[]` from the high-confidence major files (124 in `data/majors/index.json`) × the 8 college files. `plantedRisks(students)` → not_offered / unknown / heavy-load variants. `chooseAction(state)` → the drop E1 plans against. |
| `optimum.ts` | `optimum(state, terms, {unitCap})` — greedy reference plan under the verifier's hard rules; `planProgress(state, plan)` scores any plan the same way. |
| `e1.ts` | E1 runner and its matrix; `plannerTf(cfg)` carries the model / thinking ablation through `planRun({tf})`. |
| `e4.ts` | Academic History paste generator (six layouts), `scoreIntake(expected, got)`, E4 runner. |
| `results.ts` | JSONL writer, markdown table, `results.md` section writer. |
| `*.test.ts` | Vitest, `$0`: synth determinism and the prerequisite invariant, plants vs `verify()`, optimum ≥ verified plans, the E4 scorer on the recorded demo paste, table formatting, and `runOne` replaying demo (a) from fixtures with the network stubbed out. |

## Synthetic students

A student is a pure function of `(seed, index, majorFile, collegeFile, currentTerm)`. The walk goes quarter by
quarter through the requirement buckets and the catalog prerequisite graph: a course is taken only when every
prerequisite group has a member in an **earlier** quarter (or in transfer credit), so `verify()`'s
`prereq-unsatisfied` never fires on a synthetic record. Grades are passing letter grades (W/NP/F would not count
for prerequisites), with some P on college courses; 3–4 courses are in progress in `currentTerm`; one student in
four has 1–3 transfer rows shaped exactly like the vendored parser's output. `currentTerm` comes from
`data/registrar-calendar.json` (`currentTermFromCalendar(now)`), never a constant.

Planted risks (`plantedRisks`), all derived from the data, never by editing it:

- **not_offered** — a course the student may take next quarter (prerequisites met by earned rows only, so any
  drop leaves it eligible; not on the record) whose department page says it is not offered then. `verify()`
  rejects a plan that places it (`not-offered`, error); the planner should never show it.
- **unknown** — same, with `unknown (not on dept page)` evidence (the department's page covers the quarter and
  has no row for the course). `verify()` only warns (`assumed-offered`), so the plan can reach the critic, whose
  rule says to refuse when the course is load-bearing.
- **heavy_load** — a re-synthesised student with ≥ 18 units in every quarter on record and five courses in
  progress; the temptation is a plan above 19.5 units (`unit-cap` warning).

## E1 — plan validity and optimality

```
node --import ./scripts/node-ts.ts eval/e1.ts                                   # mock: 3 demo students × 10 configs, $0
QB_MODE=live node --import ./scripts/node-ts.ts eval/e1.ts --budget-usd 5 \
    --students 20 --planted 10 --seed 1 [--configs super-b4096+critic,lightning]
```

Configs (`MATRIX` in `e1.ts`): planner `super` × reasoning budget `4096` (shipped) `0` `2048` `8192` × critic on/off,
plus `lightning-only` × critic on/off — 10 in all. The names describe the planner as it was on 2026-09-27 (one
Super tool loop). Since the 2026-09-28 restructure the shipped row (`super-b4096…`) runs `planRun`'s own defaults
(three parallel Lightning drafts, Super repair with thinking off; `DEFAULT_OPTIONS` in `lib/agents/planner.ts`),
which is what the demo fixtures are meant to replay; every other cell still forces one model and one thinking
setting on every call (drafts and repairs alike). Budget `0` means thinking **off** (`enable_thinking:false`);
Lightning always runs thinking off. The override travels through the agents' `tf` seam
(`planRun({tf: plannerTf(cfg)})`), so no env var is needed and the critic keeps its own model.

Mock mode replays the three recorded demo runs (`fixtures/runs/demo-{a,b,c}.json`). Fixture keys include the
model, `chat_template_kwargs` and `max_tokens`, so only the shipped config (`super-b4096+critic` and its
critic-off twin) can replay; every other cell is a `no-fixture` row at $0 — the table still renders with all ten
configs, which is what the mock run is for. As of 2026-09-28 the recordings predate the planner restructure, so
the shipped row also ends `no-fixture` (and `e1.test.ts`'s replay assertion fails) until the demos are
re-recorded with `scripts/record-demos.ts`; the E1 section of `results.md` is the 2026-09-28T05:00Z run against
the old recordings. `--students N` switches to synthetic students in any mode.

Metrics per run (JSONL fields in brackets):

- **Valid 1st pass** — a draft passed `verify()` in the first `submit_plans` round (`firstPass.ok > 0`).
  Rounds are read off the planner's `Round N: the verifier rejected …` step events.
- **Valid ≤3 rounds** — at least one plan survived (`validAfter`). **Rounds**, **Rejected drafts** — from `planRun`.
- **Progress / optimum** — closed requirement slots of the best shown plan over the greedy optimum's
  (`progress.best / progress.optimum`), both scored on the post-action record by the engine's own allocator;
  `progress.perTerm[]` carries the plan's and the optimum's closed slots for each horizon quarter.
  A slot is one course of a course bucket or 4 units of a units bucket. The optimum is greedy per quarter
  (cheapest eligible courses with an open slot, ≤ 22 units, no `not_offered`, prerequisites by term) with no
  look-ahead — a strong reference, not a proven maximum; see the header of `optimum.ts`.
- **Refusals / Refusal precision** — critic refusals, and the share backed by negative evidence
  (`not_offered` or `unknown (not on dept page)`); `resolveVerdict` already guarantees a stored quote.
- **Plant recall** — over planted not_offered / unknown runs where a draft **attempted** the plant (a verifier
  violation names the course and quarter, or a shown plan contains it): caught by the verifier or refused by the
  critic ÷ attempted. `plant` per run is `avoided` (never drafted), `verifier`, `critic`, `risk` (only a risk
  line names it), or `missed` (shown, not refused). Heavy-load runs report `over-cap` / `within-cap` and
  **Plans > 19.5u** counts shown plans over the standard cap.
- **Tool calls ok** — `tool_result` events not starting with `Error:` (the recorded `submit_plans` inside the
  loop in demo (c) is the known failure).
- **Cache-hit tokens**, **$ / run**, **s / run** — from the ledger sink for the run's calls (not `planRun().ledger`,
  which undercounts internal retries); replayed runs carry the recording's price and latency with `replayed: true`
  and cost nothing now.

Expected cost of a full live E1. From the three recorded ledgers (`fixtures/runs/*.json`, old Super planner): a
Super plan run averaged **$0.054** (range $0.043–0.073, 4–7 calls, ~114 k prompt + ~22 k completion tokens,
~115 s wall); an Ultra stress-test **$0.025** (range $0.019–0.029, ~17 s). The shipped planner measured on
2026-09-28 (`results.md`, "Planner configuration (measured)") costs **$0.025** per student and ≈ 24 s mean, so
the shipped row is now about half the old estimate; the other Super cells still cost what the recordings did.
One student through all ten configs ≈ 7 × $0.054 + $0.025 + 5 × $0.025 + 2 × $0.012 ≈ **$0.55** and ≈ 15
minutes serial. DESIGN.md's 200 + 40 students ≈ **$130** and ≈ 2.5 days of wall time — run slices instead:
`--students 20 --planted 10` (30 students) ≈ $17 and ≈ 8 h; `--configs super-b4096+critic,super-b0+critic`
narrows further. Prompt-cache savings exist only on Lightning calls (16–23k cached of ≈ 22–32k per draft on demo (a) once
the prefix is warm; 8k of 12k on demo (b)); Super recorded 0 cache hits on every call, so no Super saving is assumed.

Not run live here. The Lightning-only arm has never been exercised on a forced `submit_plan` call in this
matrix (the 2026-09-28 measurement's config D — Lightning drafts + Lightning repair — is the closest data point:
1.18 plans per student, never three).

## E4 — intake accuracy

```
node --import ./scripts/node-ts.ts eval/e4.ts [--n 30] [--seed 1]            # mock, $0
QB_MODE=live node --import ./scripts/node-ts.ts eval/e4.ts --budget-usd 0.25 # also runs aiIntake on low-confidence pastes
```

30 synthetic students are rendered as TritonLink "Academic History" pastes, layouts round-robin: `web`
(select-all copy, like `lib/engine/fixtures/academic-history-demo.txt`), `wrapped` (long titles wrap onto a second
line), `reordered` (events and transfer block first, quarters newest-first), `pdf` (tab columns, repeated page
headers, `page N of M` footers), `double-major` (two `Major:` lines), `transfer` (a Transfer Courses block). Each
paste goes through `fromAcademicHistory()` and is scored against the student it came from:

- **Row precision / recall** on `(course, quarter)` pairs, including the XFER equivalents a transfer block yields.
- **Grades**, **Units** — agreement on the matched rows (`null` grade = in progress).
- **Major file**, **College file**, **All majors** (every `Major:` line, in order), **GPA** (the TOTAL row).
- **Low confidence (→ ai-intake)** — pastes the parser reads at `confidence: 'low'`, which is when the app would
  call Lightning's `aiIntake`. Mock mode counts them (`ai: 'skipped (mock)'`); live mode runs and scores them too
  (`ai-intake row recall`).

Mock result (seed 1, 30 pastes, 2026-09-28T05:24Z): see the E4 section of `results.md`. Row precision 100% on
every layout; recall 100% on web, wrapped, pdf, double-major and transfer layouts (the `wrapped` layout was
40.8% until `lib/engine/paste.ts` started re-joining wrapped rows before the vendored parser; the earlier run
is kept as `e4-2026-09-28T05-19-02Z.jsonl`); `reordered` 76.0%, all of it one paste whose transfer block
precedes the quarters and loses every later course row (the vendored parser's transfer state is reset only by an
`Academic Events` heading — diagnosed in `notes/engine.md`, not fixed); overall recall 95.7%; one major is
ambiguous in the index itself ("Cognitive and Behavioral Neuroscience (B.S.)" appears under two files), so one
paste reads at low confidence. Details in `notes/eval.md` and `notes/engine.md`.

## Tests

```
npx vitest run eval
```

36 tests, $0, network stubbed where a Token Factory call could occur. On 2026-09-28 three fail for known
reasons: `e4.test.ts:58` and `:91` still assert the wrapped-row limitation the pre-normalizer removed
(replacements in `notes/engine.md`), and `e1.test.ts`'s replay of demo (a) needs the demos re-recorded with the
restructured planner.
