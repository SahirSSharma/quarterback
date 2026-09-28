# Engine notes — requests for other modules

## lib/types.ts (shared contract; not edited by the engine owner)

- `PlanTerm.partTime?: boolean` — the verifier's `unit-floor` rule (< 12 units is an error) is meant to be
  waived when a plan marks a term part-time. `verify()` currently reads the flag structurally
  (`(term as PlanTerm & { partTime?: boolean }).partTime`); please add it to the type so the planner can set it.
- `OfferingEvidence.source` has no value for "no evidence at all". `offeringStatus()` returns
  `{ status: 'unknown', source: 'cape-history', quote: '<code>: no department page row, no <term> section and no
  CAPE history' }` for a course like CSE 29 (no CAPE row). A `'none'` source, or a nullable evidence, would be
  more honest.

## app/ (Next.js) — data files on Vercel

`lib/engine/data.ts` reads `data/**` with `readdirSync`/`readFileSync` relative to `process.cwd()`. Next's
output file tracing follows literal `readFileSync` paths but not directory listings, so route handlers that
import the engine need `outputFileTracingIncludes: { '/api/**': ['./data/**'] }` (or equivalent) in
`next.config.ts`, otherwise the serverless bundle will not contain the catalog.

## data/ — catalog prerequisite parse defects (kept faithful in the graph; fix at the source)

Both `data/catalog/CSE.json`/`MATH.json` and `data/catalog/prereqs-structured.json` carry these:

- `CSE 29`: `[["CSE 11","CSE 8B","ECE 15"],["CSE 15L"]]` — the second group is a mis-parse of "two units of
  credit offered for CSE 29 if CSE 15L taken previously". Correct: `[["CSE 11","CSE 8B","ECE 15"]]`. Effect:
  any plan that RETAKES CSE 29 (the whole demo after "drop CSE 29") gets `prereq-unsatisfied` from the
  verifier, and `chainQuarters('CSE 29')` is 2 instead of 1. This is the only course in the catalog whose
  `prereqText` matches `/taken previously|credit (?:offered|given)/i` with a trailing single-member group.
- `MATH 180A`: `[["MATH 31BH"]]` — text says "Math 20C or MATH 31BH" (lower-case "Math" missed). Correct:
  `[["MATH 20C","MATH 31BH"]]`. Same pattern in `MATH 174` ("Math 20D or MATH 21D" → `[["MATH 21D"], …]`).
  Demo (c) has MATH 180A in progress.

## data/sections — provenance

`data/sections/FA26.json` has no fetch timestamp. `offeringStatus()` stamps schedule-of-classes evidence with
`2026-09-27T00:00:00.000Z` (the day the snapshot was compiled, per NOTICE.md) and the public Schedule of
Classes URL. A `_meta` block in the file would let the engine stop hard-coding that.

## Unit caps (verifier)

- `> 22` units → error: General Catalog, "Undergraduate and Graduate Registration": more than twenty-two units
  in a quarter needs the college provost's approval.
- `> 19.5` units → warning: ASSUMED standard cap during initial enrollment; not found on a primary source page
  (two blink.ucsd.edu URLs 404'd). Please verify or drop.
- The "P/NP capped at one-quarter of UC San Diego units" sentence in `pnpNote` follows DESIGN.md's "campus 25%
  P/NP cap flag"; primary source not fetched.

## Semantics other modules should know

- `BlockedCourse.nextOffered` is the type's literal meaning: the first future quarter with offered/tentative
  evidence for that course (department page, else Schedule of Classes; CAPE alone never yields one).
  `delayQuarters` is separate and chain-aware: earliest feasible term with the action minus without it,
  where a missing prerequisite pushes the course to the quarter after its own earliest term, and quarters with
  no evidence are treated as possible (a note says so). For demo (a) "drop CSE 29": CSE 30 is delayed one
  quarter; CSE 100 is not (it is waiting on CSE 21 anyway) — the note explains this.
- `impact()` treats the current term as completing as enrolled ("before"), then removes the dropped course
  ("after"). P/NP leaves the prerequisite graph unchanged (a P satisfies prerequisites).
- `graduationRisk`: `likely` when the longest remaining chain exceeds `ceil((180 − units banked) / 15)`
  quarters; `possible` when the action lengthens the chain or delays any blocked course; else `none`.
- Requirement progress (`requirements.ts`) keeps TritonPlan's rule that every graded row counts as earned,
  including W/NP/F. Prerequisite and verifier logic use `earnedCodes()` from `student.ts`, which excludes
  W/NP/F/I/U.
- `remainingCourses()` candidates are filtered to codes that resolve in the catalog, so college tokens such as
  `MATH 10A-10C` or `BILD X13` never reach the planner.
