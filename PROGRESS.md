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
4. **Promote to production (one word from him).** Commit `5132760` is verified on a Vercel preview end to end
   (live planning 11–14 s / $0.017–0.032, stress-test 44 s, signed import link accepted and loaded on the
   TritonPlan staging mirror, .ics, save, delete). The public alias https://quarterback-delta.vercel.app still
   serves the empty scaffold. On his OK the orchestrator runs the production build from a clean clone of that
   exact commit (`vercel deploy --prod --yes` — never from the working tree, never `vercel promote` of a
   preview, because a demo student must replay at $0 only when `VERCEL_ENV=production`), then re-runs the
   end-to-end script against the alias and checks that a demo run comes back with `mode: 'replay'` and the
   ledger does not move.
5. TritonPlan import page: PR https://github.com/SahirSSharma/tritonlink/pull/23 (branch `quarterback-import`),
   live on the staging mirror https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import. Verified
   2026-09-28 with a link signed by the deployed preview (after fixing the signer, which had signed the base64url
   text instead of the decoded bytes and was refused by the page): signature accepted, plan rendered, Load wrote
   the three quarters to the Degree Planner store, Restore offered. Note: `scripts/build-staging.sh` was run from
   the branch, so the staging mirror currently reflects `quarterback-import`, not `main`. Merge + `scripts/deploy.sh`
   only on his OK. Demo and replayed runs link to the staging mirror (production tritonplan.com needs a ucsd.edu
   sign-in); live pasted runs link to tritonplan.com.
6. Nebius Builders Program (https://dev.nebius.com/builders): the second $25 Token Factory credit and $25 of
   Tavily credit; not yet applied for.
7. The two "confirm or cut" lines in `devpost/SUBMISSION.md` (Inspiration).
8. Did the $25 promo code (emailed 2026-09-27) get redeemed in the Token Factory console? Live spend so far
   (all Nemotron on Token Factory, 2026-09-27 → 28): about $2.60 — probes < $0.01, first demo recordings
   $0.38, route-level live check $0.10, planner configuration measurement $1.64, second demo recordings
   $0.22, verification smoke $0.06, preview runs on Vercel $0.20. Tavily: 7 of the 1,000 free monthly credits.

Resolved without him: the private Blob store works from inside Vercel (token refused locally → `QB_DATA_DIR=.data`);
"why not?" on a demo student stays a real Lightning call (≈ $0.0001, budget-guarded); browser screenshots
(`notes/screens/`, `notes/verify/`) are git-ignored.

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
- **2026-09-28 (Stage D)** — Rejected drafts carry the department row as evidence; a code-built fallback plan
  guarantees a valid plan when every model draft fails; demo/replay runs link to the TritonPlan staging mirror;
  UI copy made truthful; the three demos re-recorded with the shipped planner ($0.15) and replaying bit-for-bit;
  Ultra critic max_tokens raised to 16,384 after a verdict-less run. Independent verification: 453 tests, tsc,
  eslint and build clean; all three demo flows driven in Chromium at 390 and 1336 px; live paste-path run 3 plans
  in 20.7 s for $0.024. Preview deployment of `ff49d41` driven live through the routes: plans in 11 s ($0.017,
  Lightning cache hits 21–23k tokens per draft, Super repaired the fastest draft in 3 s), stress-test 44 s,
  approval → signed staging-mirror link (534-char token) → .ics with 14 events → save → delete. Production
  promotion awaits Sahir.
