# Stage 1 checklist

_Source of the requirement wording: the "Stage 1 compliance" section of [DESIGN.md](../DESIGN.md), written
from the hackathon rules on 2026-09-27. Before Oct 28, cross-check every line against the official rules page,
paste the rule's exact text and URL into the "Rule text" column, and tick only what has been verified against
the deployed demo, not the code. Status as of 2026-09-28 (UTC)._

Deadlines: Devpost submission Fri Oct 30, 2026, 10:00 am PT (internal target Wed Oct 28). Judging Dec 1–15;
the demo must stay up and cheap through Dec 15.

| Done | Requirement (as recorded in DESIGN.md) | Evidence location | Status 2026-09-28 | Rule text (fill in) |
|---|---|---|---|---|
| [ ] | Runtime Token Factory calls from the live demo | `lib/tf` client with the persistent ledger; trace panel and ledger showing model, ms, tokens, cents per step; About page live figures from `GET /api/ledger/summary`; `QB_MODE=live` path behind daily and total spend caps | Built and exercised live (recorded demos, a Vercel preview streamed a live run, a route-level live check, the 2026-09-28 planner measurement). Not yet on the public alias: production still serves the scaffold. In production a demo student replays; a pasted record runs live | |
| [ ] | Three Nemotron models named identically in README, Devpost, Built With and the video audio | `README.md` model table; `devpost/SUBMISSION.md` "How we built it" and "Built with"; `devpost/VIDEO.md` on-screen text and spoken lines; `devpost/docs.test.ts` asserts the ids match `DESIGN.md` and `lib/tf/models.ts` | Docs consistent (`npm run test:docs` 8/8 on 2026-09-28); video not recorded | |
| [ ] | Genuine multi-step tool-chaining workflow | `lib/agents/planner.ts`: three parallel Lightning drafts with tools `eligible_courses`, `check_prereqs`, `offering_status` and a terminal `submit_plan`; verifier on every draft; Super repair from a code-computed menu (≤ 2 rounds); Ultra `submit_verdict`; all visible in the trace panel | Built and measured (46 live runs). The recorded demos still show the previous Super-only loop; re-record before judging | |
| [ ] | A real action behind an approval gate | `lib/store/approval.ts`: approval record with the plan's sha256, ECDSA P-256 signed import token, 400/409 gate (refused plan needs an "I understand" override); Send to TritonPlan, .ics, advisor email only after Approve; tests in `lib/store/approval.test.ts` and `app/api/routes.test.ts` | Built and tested. The TritonPlan import page is an open pull request (branch `quarterback-import`; staging mirror live); the link targets tritonplan.com, which needs a ucsd.edu sign-in | |
| [ ] | Fresh public MIT repository with meaningful history | https://github.com/SahirSSharma/quarterback; `LICENSE`; `CHANGELOG.md`; commit history from 2026-09-27 | Public; 11 commits on 2026-09-27; the 2026-09-28 work (planner restructure, UI polish, intake fix, docs) is in the working tree, not yet committed | |
| [ ] | Working public demo URL that survives judging (Dec 1–15) | https://quarterback-delta.vercel.app; demo students replay in production; spend caps flip live to the recording with a banner | Alias public but serves the scaffold; the Stage B commit is verified on a preview (needs a Vercel login). Promotion is Sahir's call | |
| [ ] | Video of at most 3 minutes, with audio, on YouTube (public) | `devpost/VIDEO.md` shot list and recording checklist; URL in `devpost/SUBMISSION.md` | Not recorded (planned Oct 24); shot list rewritten to the real UI copy | |
| [ ] | Required written feedback on Nebius and NVIDIA tools | `devpost/feedback.md`, dated log with did / saw / changed, 16 items and ten requests; pasted into the Devpost feedback field | Drafted from the 2026-09-27 and 2026-09-28 measurements; re-verify Oct 26–27 | |
| [ ] | Tavily `/search` and `/extract` calls that change the decision | `lib/tavily`, `lib/offerings`; `data/offerings/sources.json` and `<DEPT>.json` rows with quote, URL, fetch time; Impact card evidence; verifier rule `not-offered`; critic evidence ids; eval E3 | Pipeline built; four departments parsed (CSE, MATH, ECE, COGS); `/search` recorded for three, `/extract` serves ECE. E3 not run | |
| [ ] | TritonPlan is the data source and the write target, not the product | `README.md` "Built for" section; `NOTICE.md`; import token contract in `lib/types.ts` and `lib/store/approval.ts` | Stated in docs; import page pending merge | |
| [ ] | Devpost form complete: name, tagline (at most 200 chars), about, built with, links, track, gallery, thumbnail | `devpost/SUBMISSION.md`; `devpost/GALLERY.md` | Text drafted; measured numbers filled where they exist (planner table, E4, tests); bracketed placeholders for E1 live, E2, E3, E5 and the live counters; frames not captured | |
| [ ] | Every bracketed placeholder in `README.md` and `devpost/` replaced with a measured number or removed | `grep -rn -e "\[to be measured\]" -e "\[n\]" -e "\[E[1-5]" -e "\[live demo\]" README.md devpost/` returns nothing | Placeholders present by design until the evals run (Oct 18), the alias is promoted and the live period ends | |

## Before submitting (Oct 27–28)

- [ ] Re-record the three demos with the shipped planner and refresh the tests that read the old recordings;
      `npm test` green (it runs Vitest and then `devpost/docs.test.ts`).
- [ ] Open the demo URL in a private window; the product loads and a demo student replays with no key in the
      client.
- [ ] Confirm the video is Public on YouTube and under 3:00.
- [ ] Confirm the repo's default branch shows the README with the final numbers.
- [ ] Paste `devpost/SUBMISSION.md` sections into the form field by field; paste `devpost/feedback.md` into the
      feedback field.
- [ ] Submit by Wed Oct 28; hard deadline Fri Oct 30, 10:00 am PT.
