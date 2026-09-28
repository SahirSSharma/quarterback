# UI polish pass (app/ owner, 2026-09-27)

What changed in `app/`, what was measured in a browser, and where the screens are. Everything below ran against
`QB_MODE=mock QB_DATA_DIR=.data next dev --port 3900` (disk store, $0), driven by Playwright for Python (Chromium
headless), at 390 / 768 / 1336 / 1920 / 2560 px. Screens: `notes/screens/<state>-<width>.png`.

## Screens

| State | What it shows |
|---|---|
| `start-<w>` | Start page with the "How to copy your Academic History from TSS" hint open and the Nebius/Nemotron line under the demo cards. |
| `situation-<w>` | Demo (a), drop CSE 29: course chips from `state.courses` (wip, current term), Drop / P/NP / Keep with the copy for the chosen action, deadline chips, the impact card (blocked list capped at 8, fold for the rest). |
| `impact-passed-<w>` | Same page with the browser clock at 2026-11-10: every deadline chip says "passed" and the impact card's top line says both drop deadlines have passed. |
| `trace-live-<w>` | Mid-replay: elapsed gutter, a folded tool call/result row, the spinner with the Nemotron Super badge for the call in flight. |
| `plans-<w>` | Replay banner, the two plans that passed, the closed "What the code rejected" panel, the "Why not a course?" card. |
| `rejected-<w>` | The rejected panel open: the Fastest draft with `already-earned` (CSE 89 · Winter 2027) and `prereq-unsatisfied` (CSE 151B · Fall 2027). |
| `whynot-<w>` | "Why not CSE 105?" answered from the recorded Lightning call, with its ledger line (1.2 s · 567 in · 32 out · <0.1¢ · replayed). |
| `verdict-<w>` | Stress-test verdict; the ledger below now has in / out / reasoning / cache / cost columns, replayed tags and a totals row. |
| `approve-dialog-<w>` | The approval dialog (no client-side fingerprint any more). |
| `actions-<w>` | After approval: approval id and the sha256 fingerprint's first 8 chars, "Send to TritonPlan" with "opens TritonPlan · tritonplan.com", the .ics caption naming dated and undated terms, the mail link that opens in a new tab. |
| `saved-<w>` | The saved (hydrated, read-only) view of the same run, banner included. |
| `about-<w>` | About page with the live figures from `GET /api/ledger/summary`. |
| `paste-error-1336` | A pasted record (the demo Academic History) re-planned in mock mode: the trace's fatal 500 surfaces as the server's message instead of a fake "done". |
| `situation-b-<w>`, `plans-b-<w>`, `whynot-b-<w>`, `verdict-b-<w>`, `actions-b-<w>` | Demo (b), Marshall · Cognitive Science, drop COGS 109 (390 and 1336). |
| `situation-c-<w>`, `plans-c-<w>`, `whynot-c-<w>`, `verdict-c-<w>`, `actions-c-<w>` | Demo (c), Sixth · Mathematics–Computer Science, drop CSE 101 (390 and 1336). |

## Measured (final run, all five widths)

- Horizontal overflow: `document.documentElement.scrollWidth` == `innerWidth` in every state at every width. Before the
  fix the plans state was 404 px at 390 (a `<fieldset>` defaults to `min-inline-size: min-content` and a nowrap course
  title inside the term grid widened it); fixed with `min-w-0` on the fieldset and an explicit shrinkable column.
- Cumulative layout shift (PerformanceObserver `layout-shift`, injected before navigation, summed without recent
  input) across the whole flow: 390 → 0.0054, 768 → 0.0028, 1336 → 0.0071, 1920 → 0.0039, 2560 → 0.0022. Page load
  alone: zero layout-shift entries at every width. Before: 0.09–0.12 at 390; the one source was the layout footer
  sliding out of view when the short loading skeleton was replaced (`FOOTER` from y=795 to off-screen), so the
  record and page skeletons now fill the viewport and are shaped like the header + situation card; the impact and
  plans skeletons are sized like the capped impact card and a plan card.
- Replay of demo (a) from clicking Re-plan to plans on screen: 11.4–11.6 s (server-paced, gaps capped at 1.5 s).
  Trace rows after folding tool call/result pairs: 19 for 25 events.
- Ledger after the flow: 9 calls (7 Super, 1 Ultra, 1 Lightning from "why not?"), 165.4 s, 166.3k in, 35.3k out,
  33.7k reasoning, no cache hits, 10.1¢, "all replayed, no live spend".
- Keyboard-only pass at 1336 (Tab / Space / Arrow / Enter only): Skip link → header links → course radios (Space
  selects) → action radios (arrows switch) → 11 tab stops through the impact card's disclosure summaries → Re-plan.
  Focus after each step lands on the step that appeared (`h2 Re-plan`, `h2 Verdict`, `h3 Approved…`, then the
  share link after Save) instead of dropping to the top of the page when the activated control disables or
  unmounts. The approval dialog focuses Cancel first (native `showModal`). Focus ring: 2 px solid accent
  (rgb 15,95,76) on links and summaries; on the green primary button the computed ring is light (rgb 247,250,249),
  which reads well against the button.
- Trace: `aria-live="polite"` list; the in-flight row is `role="status"` with a stable label (the ticking timer is
  `aria-hidden`).
- Fatal trace path (pasted record, no recording in mock): the error row appears 0.8 s after Re-plan with the
  server's message, "No plans to show." above an error notice; nothing pretends to be done.

## Demos (b) and (c) in the browser (390 and 1336)

- (b) chips COGS 100, COGS 107B, COGS 109, COGS 101C; impact line "12 courses on your requirement path depend on it;
  1 is delayed by this alone."; replay 11.0–12.0 s; 45 trace rows; 3 plans, no "What the code rejected" panel (0
  drafts, the component renders nothing); why-not "CSE 105" → "No recorded answer for CSE 105 in this mode." (no
  hint: nothing recorded); verdict recommends the Fastest plan; ledger 8 calls · 100.2 s · 109.9k in · 21.5k out ·
  17.0k reasoning · 6.5¢, all replayed; fingerprint 716b43ce; no overflow; CLS 0.0066 (390) / 0.0144 (1336).
- (c) chips CSE 101, MATH 103B, MATH 180A, MATH 170A; "6 courses … depend on it; 4 are delayed by this alone.";
  replay 6.4 s; 12 trace rows; 3 plans, no rejected panel; same why-not message; recommends the Balanced plan;
  ledger 5 calls · 131.1 s · 84.0k in · 29.4k out · 28.0k reasoning · 7.2¢; fingerprint f3806dc4; no overflow;
  CLS 0.0054 / 0.0056.

## Behaviour notes

- EventSource: `onerror` with `readyState !== CLOSED` just marks the panel "reconnecting" and lets the browser
  retry; the server's `retry: 30000` means a real reconnect waits 30 s. On reopen the collected rows are dropped
  because the server replays the stored trace from its first event (replayed `at` stamps can collide, so no
  dedupe by timestamp). `CLOSED` is fatal: one `fetch` reads the JSON error the EventSource hides.
  Exercised for real (`notes/screens/reconnect-1336.png`): the browser ran through a TCP proxy whose 14 open
  sockets were aborted 4 rows into demo (a)'s replay. The panel said "· reconnecting" 0.03 s later with the status
  row "Connection lost; the browser is retrying and the server keeps working."; the plans appeared 30.2 s after
  the drop (the 30 s retry, then the stored trace replayed in one burst); the final trace was 19 rows / 25 events
  and the ledger 7 plan + 1 stress-test rows, exactly what an undisturbed run shows, so the reset-on-reopen
  removed the 4 pre-drop rows rather than duplicating them. Chromium's `set_offline` does not sever an open
  SSE socket, which is why a proxy was needed. In mock the replay finishes long before the retry, so this hit the
  stored-trace path, not the "already in progress" wait.
- The in-flight badge comes from the last event's step name by words (`plan|draft|verif|repair` → Super,
  `stress|critic` → Ultra, `explain|intake|extract` → Lightning), else the last model call seen, so the planner
  owner's new step events render without UI changes.
- A stress-test placeholder (`recommend === null`, nothing refused) is shown as a notice and the button stays.
- The impact card's deadline headline uses the client's `deadlinesFor(currentTerm, now)` (same as the chips), so a
  saved run's stale `passed` flags do not matter and the state is screenshot-able with a fixed browser clock.
