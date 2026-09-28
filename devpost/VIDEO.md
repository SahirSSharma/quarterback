# Video — shot list and recording checklist

_Target length 2:45, hard limit 3:00. One continuous screen recording of the deployed demo, voice recorded
live or over the top. Say "Nebius" and each model's name aloud; the exact model ids appear as on-screen text
(the ledger's Model column prints them) so the audio and the text agree with the README and the Devpost form.
Record on Sat Oct 24 after the deadline-week numbers are in. On-screen copy below is quoted from the
components in `app/`; the trace lines are the planner's step messages as the code emits them today._

## Must be true before recording

- [ ] The three demos are re-recorded with the shipped planner (`QB_MODE=live QB_RECORD=1 QB_FIXTURES_DIR=<dir>
      node --import ./scripts/node-ts.ts scripts/record-demos.ts`, ≈ $0.10–0.15) and the mock replay prints
      "replay matches" for a, b and c. Done on 2026-09-28: the replayed trace shows Lightning drafts, the verifier and Super repair.
- [ ] Production is promoted (Sahir's OK) and `https://quarterback-delta.vercel.app` serves the product; a
      demo student replays there at $0 and loads in under two seconds.
- [ ] Pick the demo student whose re-recorded run best shows the moment: at least one rejected draft in
      "What the code rejected", ideally with a `not-offered` violation (its message quotes the department row,
      URL and fetch date). If no rejected draft carries a quote, show the same row through the Impact card's
      Evidence link instead.
- [ ] The Stress-test verdict recommends a plan and lists risks; if a refusal card appears, it quotes a stored
      row. Do not promise a refusal on screen unless the recording has one (none of the current three does).
- [ ] Send to TritonPlan opens the import page (the staging mirror
      https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import until the pull request is
      merged; production tritonplan.com requires a ucsd.edu sign-in) and the restore control works.
- [ ] The ledger shows the three model ids and per-step cost; the totals we will state are written down.
- [ ] Eval numbers frozen (Oct 18) and the live counters as of Oct 24 written down before recording.
- [ ] Browser at 1920x1080, 100% zoom, no extensions, no bookmarks bar, no notifications, light theme matching
      the gallery frames.

## Shot list

| Time | Shot | On-screen text (quoted from the UI unless bracketed) | Spoken |
|---|---|---|---|
| 0:00–0:12 | Title card over the registrar calendar page, the two dates highlighted | `[Quarterback. UC San Diego, Fall 2026: drop without a W by Oct 23; change grading option or drop with a W by Nov 6.]` | "Every fall, UC San Diego students have until October 23 to drop a class without a W, and until November 6 to switch it to Pass / No Pass. Most decide by guessing. I built TritonPlan, the planner about nine and a half thousand UCSD students have accounts on, and this year I built the tool for that window: Quarterback." |
| 0:12–0:28 | Start page; hover the demo cards; click "Revelle · Artificial Intelligence · 2nd year" | "Before you drop a class, know what it costs you." · "Paste your Academic History from TritonLink" · "Or try a demo student" · "Taking CSE 29, CSE 20, MATH 20C and HUM 3 in Fall 2026. Thinking about dropping CSE 29." · "Runs on Nebius Token Factory with NVIDIA Nemotron. Every model call is shown in the trace with its time, tokens and cost." | "Paste your academic history, or pick a demo student. The record is parsed by deterministic code; what you paste is processed in memory, and a run is kept only as long as you want it." |
| 0:28–0:52 | Situation: CSE 29 chip selected, action "Drop"; the Impact card appears; open the Evidence link on the CSE 30 row | "Dropping CSE 29" · "Systems Programming and Software Tools · 4 units" · "Graduation risk: possible" · "63 courses on your requirement path depend on it; 2 are delayed by this alone." · "CSE 30 · Next listed Winter 2027 · 1 quarter later" · Evidence popover: the CSE sheet row, cse.ucsd.edu, fetched date · "Units this quarter 12 after · floor 12 · Exactly at the full-time floor." · "P/NP: check with your department" · "Longest chain left 2 → 2 quarters" · deadline chips "Drop without a W Oct 23, 2026", "Drop with a W Nov 6, 2026" | "Pick a class and an action. The impact card is instant and costs nothing: which courses depend on it and which are delayed by this alone, when each is next listed by its department, with the department's own row one click away, your units against the full-time floor, whether the requirement even accepts Pass / No Pass, and the deadlines." |
| 0:52–1:25 | Click "Re-plan the next three quarters"; the trace streams; pause on the verifier's rejection; the plans land; open "What the code rejected" | Trace: "Context pack built: 176 courses in the table across WI27, SP27, FA27 … Drafting 3 plans in parallel on Nemotron 3.5 Lightning (thinking off), one lookup round allowed before submit_plan." · "→ eligible_courses({"term":"WI27"})" · "Verifier · p-fastest · rejected · 2 errors · already-earned, prereq-unsatisfied" `[rule ids from the re-recorded run]` · "Round 1: the verifier rejected 1 of 3 drafts; repairing fastest on Nemotron 3 Super (thinking off)." · "3 plans passed the verifier in N ms; 1 draft rejected." · Panel: "What the code rejected — 1 draft failed a check before you saw it. Open to see which rule." with the rule tags and, for a `not-offered` row, the quoted department line | "Re-plan runs on Nebius Token Factory. Three drafts are written at once by NVIDIA Nemotron 3.5 Lightning, with tools for eligibility, prerequisites and offering status. Every draft goes to a deterministic verifier. Here it rejects one: the rule ids, and when a course sits in a quarter the department page marks as not offered, the page's own line, its URL and when we fetched it. NVIDIA Nemotron 3 Super repairs the draft from a menu the code computed. A plan that fails is never shown; this panel shows what the code rejected." |
| 1:25–1:50 | Click "Stress-test these plans"; the Verdict card appears; scroll the risks; if a refusal card is present, hover its URL | "Recommended · Balanced plan" `[label from the recording]` · the summary sentences · "Risks to keep in view" · `[if present: "Refused: Fastest plan" with the quoted row, host and "fetched <date>"; "Override this refusal — Requires typing "I understand" and a reason. It is logged."]` | "Stress-test is NVIDIA Nemotron 3 Ultra, the only expensive call, behind a click. It reads the plans against the department evidence Tavily found, recommends one plan and names what to re-check. It refuses a plan only when the plan hinges on a course the department's page covers but does not list for that quarter, and then it shows the stored quote, the URL and the fetch time. Overriding means typing 'I understand' and a reason." |
| 1:50–2:15 | Review & approve: the two plan summaries, the verifier checklist, the ledger; click "Approve the Balanced plan"; confirm; the actions card; click "Send to TritonPlan"; the import page tab shows the plan and its restore control | "Review & approve — Nothing leaves this page until you approve." · Ledger rows with `nvidia/Nemotron-3_5-Lightning`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b` · dialog "Approve the Balanced plan … The approval record carries the fingerprint of this plan." · "Approved. Where should it go?" · "Send to TritonPlan — opens TritonPlan · <host>. You confirm there before anything is written." · "Download .ics" · "Draft advisor email" | "Review the recommended plan next to the alternative, with the verifier's checks and what every step cost. Approve writes a record with the plan's fingerprint and signs a one-time token, and only then can the plan go anywhere: into TritonPlan's degree planner, where you confirm and can restore your old plan, or into a calendar file, or into a note to your advisor." |
| 2:15–2:38 | "Why not a course you expected?" card: type CSE 105, the answer and its ledger line; then the About page's "What it has spent" figures | "CSE 105: You cannot enroll; you are missing MATH 184 or MATH 188. The earliest quarter it fits is FA27." `[answer from the recording]` · "Nemotron Lightning · 1.2 s · 567 in · 32 out · <0.1¢" `[from the recording]` · About: "Spent today", "Spent in total", "Stress-tests today" · `[E4 recall, the planner table's per-student time and cost, the live counters]` | "Ask why a course you expected is missing and NVIDIA Nemotron 3.5 Lightning answers from the same table the planner saw, in about a second, for a fraction of a cent. `[One sentence with the measured numbers: intake recall, seconds and cents per plan, students and plans approved since launch.]`" |
| 2:38–2:50 | Closing card | `[github.com/SahirSSharma/quarterback (MIT). quarterback-delta.vercel.app. Built on Nebius Token Factory with nvidia/Nemotron-3_5-Lightning, nvidia/nemotron-3-super-120b-a12b and nvidia/Nemotron-3-Ultra-550b-a55b, and Tavily.]` | "Quarterback: the models propose, code decides, and you approve. Built on Nebius Token Factory with three NVIDIA Nemotron models and Tavily. Repo and demo on screen." |

Total: 2:50 with a 10-second margin. If the numbers sentence runs long, cut the .ics and email mentions in
1:50–2:15 first.

## Recording checklist

- [ ] 1920x1080, 30 fps or 60 fps, screen recording of the browser window only (no desktop, no dock).
- [ ] Audio: a spoken explanation for the whole video; microphone tested; no background music, or only music
      with a licence that allows YouTube publication (no copyrighted tracks).
- [ ] The three model ids are visible on screen in the shots where they are spoken (the ledger prints them),
      spelled exactly as in the README: `nvidia/Nemotron-3_5-Lightning`, `nvidia/nemotron-3-super-120b-a12b`,
      `nvidia/Nemotron-3-Ultra-550b-a55b`.
- [ ] "Nebius Token Factory" said aloud at least twice and shown on screen at least once (the Start page line,
      the trace panel header and the footer all print it).
- [ ] No real student data on screen; demo students only ("Demo records are synthetic. No real student is shown.").
- [ ] No API keys, env files, terminals or browser autofill visible.
- [ ] Export at 1920x1080; check the length is under 3:00 in the file's metadata, not only the timeline.
- [ ] Upload to YouTube as **Public** (not Unlisted), title "Quarterback — Nebius x NVIDIA Global AI
      Hackathon", description with the repo and demo links.
- [ ] Watch it once end to end on another device; paste the URL into SUBMISSION.md and the Devpost form.
