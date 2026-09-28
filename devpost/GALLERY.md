# Gallery — frames to capture

_Devpost shows gallery images at a 3:2 ratio. Capture every frame at 1800x1200 (PNG, no scaling) from the
deployed demo in replay mode, same browser theme as the video. Each frame gets a one-line caption in the
Devpost gallery; alt text below is for the image itself. Capture after the demo freeze on Oct 26 so the
frames match the video. No real student data; demo students only._

## Thumbnail (1200x800)

Concept: a split frame. Left two thirds, the "What the code rejected" panel open on a rejected draft: the rule
tag, the course and quarter, and (when the rule is `not-offered`) the verbatim quoted row from the department
page, its host and the fetch date. Right third, three stacked chips: `nvidia/Nemotron-3_5-Lightning`,
`nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`, with "Nebius Token Factory" above
them. One line of title text at the top: "Quarterback — the model proposes, code decides, you approve." No
logos of other organisations. Export at exactly 1200x800.

## Frames

| # | Frame | State to set up | Caption | Alt text |
|---|---|---|---|---|
| 1 | Start page | The three demo-student cards visible, paste box empty, the "Processed in memory. Stored only if you choose Save" line and the "Runs on Nebius Token Factory with NVIDIA Nemotron" line in view | Paste your Academic History or pick a demo student. | Quarterback start page with a text area for the TritonLink Academic History paste and three demo students. |
| 2 | Impact card | Demo (a) loaded, CSE 29 selected, action Drop; card fully rendered with one Evidence popover open | Instant, no model call: which courses depend on it and which are delayed, when each is next listed (with the department's row), the unit floor, P/NP eligibility, the deadlines. | Impact card listing dependent courses with next-listed terms and an open evidence popover quoting a department row, a units-this-quarter meter at the 12-unit floor, a P/NP line reading "check with your department" and four deadline chips reading Oct 23 and Nov 6, 2026. |
| 3 | Re-plan trace panel mid-run | Trace panel open during a re-recorded run: the "Drafting 3 plans in parallel on Nemotron 3.5 Lightning" step, a folded eligible_courses call, a verifier rejection with rule ids, then the "Round 1: … repairing … on Nemotron 3 Super" step and the repaired draft passing | The models propose, the verifier disposes: three parallel drafts, a rejection with rule ids, a repair that passes. | Streaming trace panel showing a Nemotron Lightning badge on the draft calls, a folded tool call to eligible_courses, a red verifier row reading rejected with rule ids, and a Nemotron Super badge on the repair call followed by a green verifier row reading passed. |
| 4 | Three plans | Fastest, balanced and lightest plans side by side, each with its term-by-term courses and units | Three plans for the coming quarters. Every one shown has passed the verifier. | Three plan columns labelled fastest, balanced and lightest, each listing WI27, SP27 and FA27 courses and unit totals. |
| 5 | Verdict and what the code rejected | Stress-test complete: the Verdict card with "Recommended" and the risks; below it, "What the code rejected" open on a draft with its rule tags and, when the rule is `not-offered`, the quoted department row, host and fetch date (a refusal card only if the recording has one; none of the current three does) | The code's veto with a quote: the rule that rejected the draft, the department page's own line, its URL, and when we fetched it; the critic's recommendation and risks above it. | Verdict card reading "Recommended · Balanced plan" with a list of risks, and below it an open panel headed "What the code rejected" showing a red rule tag, a course and quarter, and a quoted table row from a department tentative-offerings page with a host link and a fetch date. |
| 6 | Review & approve | Recommended vs alternative, verifier checklist, "What you would be approving", ledger with per-step model, time, in / out / reasoning / cache tokens and cost | Review everything before anything happens. Approve records the plan's fingerprint and signs a one-time token. | Review screen with two plan summaries side by side, a checklist of verifier rules, a consequence summary and a ledger table listing three Nemotron model ids with time, tokens and cost columns and a totals row. |
| 7 | Sent to TritonPlan | The import page (staging mirror until the pull request is merged) with the verified plan loaded and the restore control visible | The approved plan in TritonPlan's Degree Planner, with restore of the old plan. | TritonPlan import page showing the imported quarters and a restore-previous-plan button. |
| 8 | .ics and advisor email | Calendar app with the imported deadlines and planned courses; the prefilled mailto draft alongside | Deadlines and planned courses in your calendar; a prefilled note to your advisor. | A calendar month view with Oct 23 and Nov 6 deadline events and planned-course entries, next to an email draft addressed to an advisor. |
| 9 | How it works | The README model table and the planner configuration table rendered on GitHub, or a single diagram: student record -> impact (code) -> three parallel drafts (Lightning) -> verifier (code) -> repair (Super) -> critic (Ultra) -> approve -> TritonPlan / .ics / email, with Tavily-discovered offering rows feeding the impact card, the verifier and the critic | Three Nemotron models on Nebius Token Factory, one deterministic veto, Tavily for the facts that live only on the web. | Architecture diagram with boxes for the deterministic engine, the three Nemotron models on Nebius Token Factory, Tavily search and extract, and the three approved actions. |

## Before uploading

- [ ] All nine frames are 3:2 and at least 1800x1200; the thumbnail is exactly 1200x800.
- [ ] Model ids in frames 3, 5, 6 and 9 are legible at Devpost's display size (zoom the browser to 125% if
      needed before capture).
- [ ] No keys, env files, terminals, personal tabs or notifications in any frame.
- [ ] Frame 7 shows the import page with the demo student's plan, not a real account.
- [ ] Captions pasted into Devpost as written above; alt text kept in this file.
