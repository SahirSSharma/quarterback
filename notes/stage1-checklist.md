# Stage 1 checklist

_Source of the requirement wording: the "Stage 1 compliance" section of [DESIGN.md](../DESIGN.md), written
from the hackathon rules on 2026-09-27. Before Oct 28, cross-check every line against the official rules page,
paste the rule's exact text and URL into the "Rule text" column, and tick only what has been verified against
the deployed demo, not the code. Status as of 2026-09-27._

Deadlines: Devpost submission Fri Oct 30, 2026, 10:00 am PT (internal target Wed Oct 28). Judging Dec 1–15;
the demo must stay up and cheap through Dec 15.

| Done | Requirement (as recorded in DESIGN.md) | Evidence location | Status 2026-09-27 | Rule text (fill in) |
|---|---|---|---|---|
| [ ] | Runtime Token Factory calls from the live demo | `lib/tf` client with ledger; trace panel showing model, ms, tokens, cents per step; `QB_MODE=live` path on the deployed demo behind the spend cap | Not yet: client being built | |
| [ ] | Three Nemotron models named identically in README, Devpost, Built With and the video audio | `README.md` model table; `devpost/SUBMISSION.md` "How we built it" and "Built with"; `devpost/VIDEO.md` on-screen text and spoken lines; `devpost/docs.test.ts` asserts the ids match `DESIGN.md` | Docs consistent (test passes); video not recorded | |
| [ ] | Genuine multi-step tool-chaining workflow | Planner tools `eligible_courses`, `check_prereqs`, `requirement_progress`, `offering_status`, `unit_check`, `grade_history`, `submit_plans` in `lib/agents/planner`; verifier loop of at most 3 rounds; critic `submit_verdict`; visible in the trace panel | Not yet: agents being built | |
| [ ] | A real action behind an approval gate | `ApprovalRecord` and signed one-time token (`lib/types.ts`); Send to TritonPlan, .ics, advisor email only after Approve; test "no write without token" | Types defined; implementation pending | |
| [ ] | Fresh public MIT repository with meaningful history | https://github.com/SahirSSharma/quarterback; `LICENSE`; `CHANGELOG.md`; commit history from 2026-09-27 | Public since 2026-09-27 (four commits) | |
| [ ] | Working public demo URL that survives judging (Dec 1–15) | https://quarterback-delta.vercel.app; replay mode default; spend cap flips live to replay with a banner | Alias public but serves the scaffold; alias returned a 500 at last check (see `PROGRESS.md`) | |
| [ ] | Video of at most 3 minutes, with audio, on YouTube (public) | `devpost/VIDEO.md` shot list and recording checklist; URL in `devpost/SUBMISSION.md` | Not recorded (planned Oct 24) | |
| [ ] | Required written feedback on Nebius and NVIDIA tools | `devpost/feedback.md`, dated log with did / saw / changed and seven requests; pasted into the Devpost feedback field | Drafted from 2026-09-27 measurements; re-verify Oct 26–27 | |
| [ ] | Tavily `/search` and `/extract` calls that change the decision | `lib/tavily`; `data/offerings/sources.json` and `<DEPT>.json` rows with quote, URL, fetch time; verifier rule `not-offered`; Stress-test refusal quote; eval E3 | Sources discovered and raw pages captured; pipeline being built | |
| [ ] | TritonPlan is the data source and the write target, not the product | `README.md` "Built for" section; `NOTICE.md`; import token contract in `lib/types.ts` | Stated in docs | |
| [ ] | Devpost form complete: name, tagline (at most 200 chars), about, built with, links, track, gallery, thumbnail | `devpost/SUBMISSION.md`; `devpost/GALLERY.md` | Text drafted with bracketed placeholders; frames not captured | |
| [ ] | Every bracketed placeholder in `README.md` and `devpost/` replaced with a measured number or removed | `grep -rn -e "\[to be measured\]" -e "\[n\]" -e "\[E[1-5]" README.md devpost/` returns nothing | Placeholders present by design until evals run (Oct 18) and live period ends | |

## Before submitting (Oct 27–28)

- [ ] Re-run `node --test devpost/docs.test.ts` and `npm test`; both green.
- [ ] Open the demo URL in a private window; the product loads in replay mode with no key in the client.
- [ ] Confirm the video is Public on YouTube and under 3:00.
- [ ] Confirm the repo's default branch shows the README with the final numbers.
- [ ] Paste `devpost/SUBMISSION.md` sections into the form field by field; paste `devpost/feedback.md` into the
      feedback field.
- [ ] Submit by Wed Oct 28; hard deadline Fri Oct 30, 10:00 am PT.
