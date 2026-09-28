# Video — shot list and recording checklist

_Target length 2:45, hard limit 3:00. One continuous screen recording of the deployed demo in replay mode,
voice recorded live or over the top. Say "Nebius" and each model's name aloud; the exact model ids appear as
on-screen text so the audio and the text agree with the README and the Devpost form. Record on Sat Oct 24
after the deadline-week numbers are in._

## Must be true before recording

- [ ] `https://quarterback-delta.vercel.app` serves the product in replay mode; two demo students load in under
      two seconds each.
- [ ] The demo student's Stress-test produces a refusal whose quote, URL and fetch time are real rows from
      `data/offerings/<DEPT>.json`.
- [ ] Send to TritonPlan loads the plan into the Degree Planner on tritonplan.com and the restore button works.
- [ ] The trace panel shows the three model ids and per-step cost; the ledger totals are the ones we will state.
- [ ] E1 and E3 numbers frozen (Oct 18) and the live counters as of Oct 24 written down before recording.
- [ ] Browser at 1920x1080, 100% zoom, no extensions, no bookmarks bar, no notifications, dark or light theme
      matching the gallery frames.

## Shot list

| Time | Shot | On-screen text | Spoken |
|---|---|---|---|
| 0:00–0:12 | Title card over the registrar calendar page, the two dates highlighted | Quarterback. UC San Diego, Fall 2026: drop without a W by Oct 23; change grading option or drop with a W by Nov 6. | "Every fall, UC San Diego students have until October 23 to drop a class without a W, and until November 6 to change it to Pass / No Pass. Most decide by guessing. I built TritonPlan, the planner about nine and a half thousand UCSD students have accounts on, and this year I built the tool for that window: Quarterback." |
| 0:12–0:30 | Start page: pick the demo student; record loads | Paste your Academic History, or pick a demo student. Nothing is stored until you click Save. | "Paste your academic history, or pick a demo student. The record is parsed by deterministic code; nothing is stored until you save." |
| 0:30–0:55 | Situation: choose a course, click Drop; Impact card appears instantly | Impact: blocks 2 courses, next offered WI27; delay 1 quarter; 12-unit floor: below; P/NP: not accepted for this requirement; deadlines Oct 23 / Nov 6. `[replace with the demo student's real card]` | "Pick a class and an action. The impact card is instant and costs nothing: what this blocks, when each course is next offered, the delay in quarters, the unit floor, whether the requirement even accepts Pass / No Pass, and the deadlines." |
| 0:55–1:25 | Re-plan: trace panel streams tool calls; verifier rejects a plan with rule ids; second round goes green; three plans appear | `nvidia/nemotron-3-super-120b-a12b` on Nebius Token Factory. Tool calls: check_prereqs, offering_status, unit_check. Verifier: prereq-unsatisfied CSE 140 WI27 -> round 2 -> ok. | "Re-plan runs on Nebius Token Factory. The planner is NVIDIA Nemotron 3 Super, one hundred twenty B, thinking on, calling tools for prerequisites, offering status and unit checks. Every proposal goes to a deterministic verifier. Here it rejects a plan with a rule id, sends the violation back, and the second round passes. A plan that fails is never shown." |
| 1:25–1:55 | Stress-test button; refusal card with the quote, URL and fetched-at; hover the URL | `nvidia/Nemotron-3-Ultra-550b-a55b`. Refused: fastest plan. Quote: "`[verbatim row from the department page]`" — `[url]`, fetched `[date]`. Evidence via Tavily /search + /extract. | "Stress-test is NVIDIA Nemotron 3 Ultra, five hundred fifty B, the only expensive call, behind a click. It reads the plans against the department's offering pages, found by Tavily, and refuses the fastest plan, quoting the exact line, the URL and when it was fetched. Overriding means typing 'I understand' and a reason." |
| 1:55–2:20 | Review & approve: side-by-side plans, verifier checklist, ledger; click Approve; click Send to TritonPlan; TritonPlan tab shows the plan loaded, restore button visible | Approve mints a one-time signed token. Send to TritonPlan. Download .ics. Draft advisor email. | "Review the recommended plan next to the refused one, with the verifier's checks and what every step cost. Approve mints a one-time signed token, and only then can the plan go anywhere: into TritonPlan's degree planner, with one-click restore, or into a calendar file, or into an email to your advisor." |
| 2:20–2:40 | Ledger and README eval table; live counters | `nvidia/Nemotron-3_5-Lightning`: extraction and explanation, thinking off, `[ms]`, `[cents]`. Whole run: `[cents]`. E1 validity after 3 rounds `[x]`; E3 not-offered placements with vs without Tavily `[x]` vs `[y]`. `[n]` students, `[n]` plans approved before Oct 23. | "Extraction and explanations run on NVIDIA Nemotron 3.5 Lightning with thinking off, in under half a second. A full run costs `[cents]`. In the evaluation, `[one sentence with the E1 and E3 numbers]`. Since launch inside TritonPlan, `[n]` students have used it and `[n]` plans were approved." |
| 2:40–2:50 | Closing card | github.com/SahirSSharma/quarterback (MIT). quarterback-delta.vercel.app. Built on Nebius Token Factory with NVIDIA Nemotron 3.5 Lightning, Nemotron 3 Super and Nemotron 3 Ultra, and Tavily. | "Quarterback: the model proposes, code decides, and you approve. Built on Nebius Token Factory with three NVIDIA Nemotron models and Tavily. Repo and demo on screen." |

Total: 2:50 with a 10-second margin. If the E1/E3 sentence runs long, cut the .ics and email mentions in
1:55–2:20 first.

## Recording checklist

- [ ] 1920x1080, 30 fps or 60 fps, screen recording of the browser window only (no desktop, no dock).
- [ ] Audio: a spoken explanation for the whole video; microphone tested; no background music, or only music
      with a licence that allows YouTube publication (no copyrighted tracks).
- [ ] The three model ids are visible on screen in the shots where they are spoken, spelled exactly as in the
      README: `nvidia/Nemotron-3_5-Lightning`, `nvidia/nemotron-3-super-120b-a12b`,
      `nvidia/Nemotron-3-Ultra-550b-a55b`.
- [ ] "Nebius Token Factory" said aloud at least twice and shown on screen at least once.
- [ ] No real student data on screen; demo students only.
- [ ] No API keys, env files, terminals or browser autofill visible.
- [ ] Export at 1920x1080; check the length is under 3:00 in the file's metadata, not only the timeline.
- [ ] Upload to YouTube as **Public** (not Unlisted), title "Quarterback — Nebius x NVIDIA Global AI
      Hackathon", description with the repo and demo links.
- [ ] Watch it once end to end on another device; paste the URL into SUBMISSION.md and the Devpost form.
