# Progress

Deadline: **Fri Oct 30, 2026, 10:00 am PT** (Devpost). Judging Dec 1–15; the demo must stay live and cheap
through Dec 15. Target: soft launch inside TritonPlan by Sun Oct 11, ahead of the **Oct 23** drop deadline;
eval frozen Oct 18; video Oct 24; submit Wed Oct 28. Dates in the log are UTC, as the result files are stamped.

| Week | Dates | Goal | Status (2026-09-28) |
|---|---|---|---|
| 1 | Sep 27 – Oct 4 | Repo, data snapshot, Token Factory client with record/replay, deterministic impact engine + verifier + tests, Lightning intake fallback, Tavily offerings pipeline, preview deploy. Milestone: "drop CSE 29 → prereq chain, P/NP and graduation impact" works end to end in mock and live. | **Milestone met.** Everything listed is in the tree; demo (a) ran end to end in mock through the real route handlers (tests) and live against Token Factory (recorded 2026-09-28 04:13 UTC; a route-level live check on 2026-09-27 cost $0.1032; a Vercel preview streamed a live run over SSE). Left from week 1: the demo recordings predate the planner restructure and must be re-recorded. |
| 2 | Oct 5 – 11 | Planner loop + verifier iteration, Ultra stress-test, trace panel + ledger, Review & approve, signed TritonPlan import, .ics, mailto, replay students, spend cap. Soft launch. | Pulled forward: all of it is built (planner restructured 2026-09-28 into parallel drafts → verify → repair). Not done: the TritonPlan import page is an open pull request (branch `quarterback-import`, staging mirror only); production alias not promoted; no soft launch. |
| 3 | Oct 12 – 18 | Fix what real students break; E1–E4 evals overnight; README model map + cost table; live counters. | Started early: planner configuration measured live (12 students × 4 configs, $1.04); E4 measured in mock (30 pastes); E1 mock only; E2, E3 not run. README model table and measurements written 2026-09-28. Live counters exist (`GET /api/ledger/summary`, About page). |
| 4 | Oct 19 – 29 | Monitor the deadline spike; Oct 24 numbers + voiceover; Oct 26 demo freeze; Oct 27 Devpost text + feedback doc; Oct 28 submit. | Not started. Devpost text and feedback drafted with placeholders for the numbers that do not exist yet. |

## Needs Sahir (yes/no unless noted)

1. TritonPlan stays live and linkable through Dec 15?
2. OK to publish TritonPlan's structured public data and pure engine modules in this MIT repo? (Done under
   that assumption — `data/` and `lib/vendor/tritonplan/`; `rmp.json` and instructor data excluded.)
3. Check the ITS conflict-of-interest question with his supervisor, or proceed?
4. ~~Create a Vercel Blob store for the `quarterback` project.~~ Done: the private store works from inside
   Vercel (verified 2026-09-27); its token is refused from a laptop, so local dev uses `QB_DATA_DIR=.data`.
5. Production deploy + public URL: his explicit OK per change. **Pending:** the alias
   https://quarterback-delta.vercel.app still serves the scaffold; the Stage B commit is verified on a preview.
6. TritonPlan import page: pull request open on the TritonPlan repository (branch `quarterback-import`),
   staging mirror at https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import; merge only on
   his OK. Should demo and replay runs point their import link at the staging mirror (production tritonplan.com
   needs a ucsd.edu sign-in)? Today the link targets tritonplan.com.
7. New: in production, "why not?" on a demo student is a real Lightning call (≈ 600 prompt tokens, under
   $0.0001, budget-guarded) — the one runtime Token Factory call a judge can trigger on a recorded demo. Keep
   it live, or replay it?
8. New: `notes/screens/` holds 82 PNGs (51 MB) from the browser verification pass. Keep them in git, or move
   them out before the next commit?
9. New: the two "confirm or cut" lines in `devpost/SUBMISSION.md` (Inspiration).

## Log

- **2026-09-27** — Rules, credits and platform verified (four Nemotron models live on Token Factory; tool
  calling, json_schema, reasoning toggles, streaming, 600 RPM confirmed with our key). Research sweep (9
  lenses + critic), 16-proposal / 5-judge idea panel, synthesis → Quarterback; advisor concurred. Registrar
  deadlines verified on the official Enrollment Calendar (FA26: Oct 23 no-W, Nov 6 W / P-NP / units).
  Department offering pages verified (CSE sheet → CSV, MATH and ECE tables, COGS index). Repo scaffolded
  (Next.js 16, TypeScript, Tailwind 4, Vitest); TritonPlan data snapshot and pure engine modules copied;
  DESIGN.md written.
- **2026-09-27 (late)** — Public repo live at github.com/SahirSSharma/quarterback (MIT). Vercel project
  `quarterback` created and linked; API keys set for preview/production/development. **Incident:** the very
  first deployment of the new project landed as *Production* even with `--target=preview` (the flag is
  honoured from the second deploy on, verified). It is the empty Next.js scaffold, nothing else. Deployment
  protection switched from "all deployments" to "preview only" so the production alias can be public for
  judges. Vitest wired (`npm test`), first data-snapshot tests green.
- **2026-09-27, Stage A (commit cc8e7d8)** — Token Factory client with record/replay and a budget guard;
  deterministic engine and verifier; Tavily discovery and the offerings pipeline (MATH read from the page HTML
  because Tavily's markdown drops empty cells; COGS found to be a Google Sheet like CSE; ECE via `/extract`;
  5 calls, 4 credits); UI shell on stubs; README and Devpost package with placeholders. Catalog prerequisite
  parse defects found and corrected with 8 hand-checked overrides.
- **2026-09-27, Stage B (commit 6431de1)** — Agents (Super planner loop, Ultra critic, Lightning explain and
  intake), storage over private Blob / disk, approval gate and ECDSA P-256 signed import token, `.ics`,
  `mailto:`, routes wired to the pipeline with an SSE trace and replay mode, eval harness (synthetic students,
  greedy optimum, E1, E4). Three demo runs recorded live (Super planner: (a) 2 plans and 1 rejected draft,
  9 calls, 165 s, $0.10; (b) 3 plans, 8 calls, 100 s, $0.07; (c) 3 plans, 5 calls, 131 s, $0.07; no critic
  refusal in any). Live route check of demo (a): $0.1032, 0 cache hits. Vercel preview verified with a raw
  `curl`: SSE events arrived live while a Super run executed (72 s, 4 Super calls, $0.037), `maxDuration = 300`
  honoured; private Blob overwrite and read-back verified from inside Vercel. Bug found and fixed (6b46b16): the
  store's process-local cache served stale run records; only write-once keys are cached now. Prompt caching
  measured with a 37.7k-token identical prefix: Lightning 33,536 cached tokens on the second call (1,653 →
  ≈ 590 ms), Super 0 across every probe and planner call.
- **2026-09-28** — Planner measured live (`scripts/measure-planner.ts`, 12 students × 4 configurations, 46
  runs, $1.04; total live spend of the pass $1.64): Super's `reasoning_effort:"low"` and `reasoning_budget`
  never bounded its reasoning here (19/19 calls to the 1,200-token cap, 0 tool calls), Super's prompt cache
  never hit, Lightning's did. Planner restructured into parallel Lightning drafts → verify → Super repair
  (thinking off) from a code-computed menu; shipped config A: 1.75 plans per student, 83% of students with a
  plan, 23.9 s mean / 27 s p50 / 37 s max, $0.025 per student; demos 8–14 s, $0.014–0.020. UI polish pass
  verified in a browser at five widths (no horizontal scroll at 390 px, CLS ≤ 0.007, keyboard path through
  the whole flow, reconnect proven with a TCP proxy); `POST /api/explain` and the "Why not?" card; rejected
  drafts panel; ledger columns and totals; live figures on About. Intake pre-normalizer for wrapped rows (E4
  wrapped recall 40.8% → 100%, overall 95.7%). Docs truth pass across README, DESIGN, CHANGELOG, this file,
  `devpost/*`, the Stage 1 checklist and `eval/README.md`. **Open:** re-record the three demos with the new
  planner (≈ $0.10–0.15) and refresh the four tests that read the old recordings; production promotion;
  TritonPlan import PR.
