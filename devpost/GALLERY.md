# Gallery — frames to capture

_Devpost shows gallery images at a 3:2 ratio. Capture every frame at 1800x1200 (PNG, no scaling) from the
deployed demo in replay mode, same browser theme as the video. Each frame gets a one-line caption in the
Devpost gallery; alt text below is for the image itself. Capture after the demo freeze on Oct 26 so the
frames match the video. No real student data; demo students only._

## Thumbnail (1200x800)

Concept: a split frame. Left two thirds, the refusal card: "Refused: fastest plan", the verbatim quoted row
from the department page, the URL, the fetch time. Right third, three stacked chips: `nvidia/Nemotron-3_5-Lightning`,
`nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`, with "Nebius Token Factory" above
them. One line of title text at the top: "Quarterback — the model proposes, code decides, you approve." No
logos of other organisations. Export at exactly 1200x800.

## Frames

| # | Frame | State to set up | Caption | Alt text |
|---|---|---|---|---|
| 1 | Start page | Demo-student picker visible, paste box empty, "Nothing is stored until you click Save" line in view | Paste your Academic History or pick a demo student. | Quarterback start page with a text area for the TSS Academic History paste and two demo students. |
| 2 | Impact card | Demo student loaded, one current course selected, action Drop; card fully rendered | Instant, no model call: what this blocks, when it is next offered, the delay, the unit floor, P/NP eligibility, the deadlines. | Impact card listing blocked courses with next-offered terms, a below-12-units warning, a P/NP eligibility line and two deadline chips reading Oct 23 and Nov 6. |
| 3 | Re-plan trace panel mid-run | Trace panel open while the planner is on round 2; a verifier rejection with rule ids visible above the green pass | The planner proposes, the verifier disposes: a rejected round with rule ids, then a pass. | Streaming trace panel showing tool calls to check_prereqs and offering_status, a verifier report with a prereq-unsatisfied violation, and a second round marked ok, with the model id nvidia/nemotron-3-super-120b-a12b in a badge. |
| 4 | Three plans | Fastest, balanced and lightest plans side by side, each with its term-by-term courses and units | Three plans for the coming quarters. Every one shown has passed the verifier. | Three plan columns labelled fastest, balanced and lightest, each listing WI27, SP27 and FA27 courses and unit totals. |
| 5 | Refusal | Stress-test complete; the refusal card with the quote, URL and fetched-at; the recommended plan marked | Refused with a quote: the department page's own line, its URL, and when we fetched it. | Refusal card reading "Refused: fastest plan", a quoted table row from a department tentative-offerings page, a URL and a fetch timestamp, with the model badge nvidia/Nemotron-3-Ultra-550b-a55b. |
| 6 | Review & approve | Recommended vs refused, verifier checklist all green, consequence summary, ledger with per-step model, ms, tokens, cents | Review everything before anything happens. Approve mints a one-time signed token. | Review screen with two plans side by side, a checklist of verifier rules, a consequence summary and a ledger table listing three Nemotron model ids with milliseconds, tokens and cents. |
| 7 | Sent to TritonPlan | tritonplan.com Degree Planner tab with the imported plan loaded and the "Restore previous plan" control visible | The approved plan in TritonPlan's Degree Planner, with one-click restore of the old plan. | TritonPlan degree planner page showing the imported quarters and a restore-previous-plan button. |
| 8 | .ics and advisor email | Calendar app with the imported deadlines and planned courses; the prefilled mailto draft alongside | Deadlines and planned courses in your calendar; a prefilled note to your advisor. | A calendar month view with Oct 23 and Nov 6 deadline events and planned-course entries, next to an email draft addressed to an advisor. |
| 9 | How it works | The README model table and the eval table rendered on GitHub, or a single diagram: student record -> impact (code) -> planner (Super) -> verifier (code) -> critic (Ultra) -> approve -> TritonPlan / .ics / email, with Tavily feeding offering evidence into the verifier and the critic | Three Nemotron models on Nebius Token Factory, one deterministic veto, Tavily for the facts that live only on the web. | Architecture diagram with boxes for the deterministic engine, the three Nemotron models on Nebius Token Factory, Tavily search and extract, and the three approved actions. |

## Before uploading

- [ ] All nine frames are 3:2 and at least 1800x1200; the thumbnail is exactly 1200x800.
- [ ] Model ids in frames 3, 5, 6 and 9 are legible at Devpost's display size (zoom the browser to 125% if
      needed before capture).
- [ ] No keys, env files, terminals, personal tabs or notifications in any frame.
- [ ] Frame 7 shows tritonplan.com with the demo student's plan, not a real account.
- [ ] Captions pasted into Devpost as written above; alt text kept in this file.
