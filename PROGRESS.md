# Progress

Deadline: **Fri Oct 30, 2026, 10:00 am PT** (Devpost). Judging Dec 1–15; the demo must stay live and cheap
through Dec 15. Target: soft launch inside TritonPlan by Sun Oct 11, ahead of the **Oct 23** drop deadline;
eval frozen Oct 18; video Oct 24; submit Wed Oct 28.

| Week | Dates | Goal | Status |
|---|---|---|---|
| 1 | Sep 27 – Oct 4 | Repo, data snapshot, Token Factory client with record/replay, deterministic impact engine + verifier + tests, Lightning intake fallback, Tavily offerings pipeline, preview deploy. Milestone: "drop CSE 29 → prereq chain, P/NP and graduation impact" works end to end in mock and live. | in progress |
| 2 | Oct 5 – 11 | Super planner loop + verifier iteration, Ultra stress-test, trace panel + ledger, Review & approve, signed TritonPlan import, .ics, mailto, replay students, spend cap. Soft launch. | |
| 3 | Oct 12 – 18 | Fix what real students break; E1–E4 evals overnight; README model map + cost table; live counters. | |
| 4 | Oct 19 – 29 | Monitor the deadline spike; Oct 24 numbers + voiceover; Oct 26 demo freeze; Oct 27 Devpost text + feedback doc; Oct 28 submit. | |

## Needs Sahir (yes/no unless noted)
1. TritonPlan stays live and linkable through Dec 15?
2. OK to publish TritonPlan's structured public data and pure engine modules in this MIT repo? (Done under
   that assumption — `data/` and `lib/vendor/tritonplan/`; `rmp.json` and instructor data excluded.)
3. Check the ITS conflict-of-interest question with his supervisor, or proceed?
4. Create a Vercel Blob store for the `quarterback` project (Storage → Create → Blob) once the project exists.
5. Production deploy + public URL: his explicit OK per change (staging previews are automatic).
6. TritonPlan import page: a PR on the TritonPlan repo, staged first, merged only on his OK.

## Log
- **2026-09-27** — Rules, credits and platform verified (four Nemotron models live on Token Factory; tool
  calling, json_schema, reasoning toggles, streaming, 600 RPM confirmed with our key). Research sweep (9
  lenses + critic), 16-proposal / 5-judge idea panel, synthesis → Quarterback; advisor concurred. Registrar
  deadlines verified on the official Enrollment Calendar (FA26: Oct 23 no-W, Nov 6 W / P-NP / units).
  Department offering pages verified (CSE sheet → CSV, MATH and ECE tables, COGS index). Repo scaffolded
  (Next.js 16, TypeScript, Tailwind 4, Vitest); TritonPlan data snapshot and pure engine modules copied;
  DESIGN.md written.
