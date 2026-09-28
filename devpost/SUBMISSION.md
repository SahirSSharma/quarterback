# Devpost submission — paste-ready

_Everything below maps to a field on the Devpost form. Bracketed items are numbers or links that do not exist
yet and must be filled in before submitting (target: Wed Oct 28, 2026; hard deadline Fri Oct 30, 10:00 am PT).
Model ids are spelled exactly as Token Factory lists them; do not shorten them in the form. Every number that
is not bracketed was measured; the source is named next to it._

## Project name

Quarterback

## Tagline

Pick one; each is at most 200 characters.

1. Before UC San Diego's Oct 23 drop deadline: see what dropping a class does to your degree, get re-plans that deterministic code has checked, and send the one you approve to TritonPlan.
2. Drop, P/NP or keep? Quarterback shows the graduation impact, re-plans with Nemotron under a deterministic veto that quotes the department page, and writes to TritonPlan only on approval.
3. A degree re-planner for UC San Diego that shows every plan the code rejected and why, and only touches your TritonPlan after you click Approve.

## About the project

### Inspiration

I am a second-year at UC San Diego and I built TritonPlan, the degree planner that about 9,500 UCSD students
have accounts on (TritonPlan's own registry, September 2026). `[Sahir: confirm or cut — "Every fall the same
messages arrive in the two weeks before the drop deadline: if I drop this now, am I still on track?"]` This
year the dates are Friday October 23 (drop without a W) and Friday November 6 (change units or grading option,
drop with a W). The information needed to answer is all public, but it is spread across the General Catalog,
the department's tentative-offerings page, the registrar calendar and the student's own record, and nobody
assembles it before the deadline. `[Sahir: confirm or cut — "I have made this decision by guessing myself."]`
Quarterback is the tool for the week before October 23.

### What it does

1. **Impact.** Paste your TritonLink Academic History page (or pick a demo student), choose a current course
   and an action: drop, switch to P/NP, or keep. Instantly, with no model call, you see which downstream
   courses depend on it and which are delayed by this alone, when each is next listed by its department (with
   the source row one click away), the delay in quarters, whether you fall below the 12-unit floor, whether the
   requirement accepts P/NP (or "check with your department" when the rules are silent), the deadlines for the
   current term, and the change in requirement progress.
2. **Re-plan.** Three plans for the coming quarters (fastest to degree, balanced, lightest) are drafted at
   once, and every draft goes to a deterministic verifier: prerequisites by the quarter they are needed, no
   course in a quarter the department says it is not offered, unit floor and cap, no duplicates, nothing
   already earned, no double-counting, graduation still reachable. A failing draft is repaired from the
   violations and a replacement menu the code computed; a plan that still fails is never shown. "What the
   code rejected" lists each rejected draft with the rule that rejected it.
3. **Stress-test.** The largest model reads the surviving plans against the department offering evidence and
   recommends one, listing the risks to re-check. It refuses a plan only when the plan hinges on a course the
   department's page covers but does not list for that quarter, and every refusal shows the stored quote, its
   URL and when it was fetched. Overriding a refusal requires typing "I understand" and a reason.
4. **Why not that course?** Name a course you expected and get the reason in a sentence or three: what is
   missing and the earliest quarter it fits.
5. **Approve, then act.** Recommended plan next to the alternative, the verifier checks as a checklist, and a
   ledger of what every step cost. After Approve, and only then: send the plan to TritonPlan (a signed link;
   the import page verifies it in your browser and restores your old plan on request), download an .ics of
   deadlines and planned courses, or open a prefilled advisor email.

A trace panel streams every step: model, milliseconds, tokens in, out and reasoning, cache hits, cost, tool
calls, verifier reports.

### How we built it

- **Nebius Token Factory** serves all inference through its OpenAI-compatible endpoint. Three NVIDIA Nemotron
  models, each with one job and a measured reason (`eval/results.md` in the repository):
  - `nvidia/Nemotron-3_5-Lightning` drafts the three plans in parallel (tools for eligibility, prerequisites
    and offering status, then a terminal `submit_plan` call), reads a paste the parser cannot place
    (`response_format: json_schema`) and answers "why not?". Always thinking off
    (`chat_template_kwargs:{enable_thinking:false}` plus `reasoning_effort:"none"`): with thinking on its
    reasoning leaks into `content`. $0.06 / $0.24 per 1M tokens; its prompt cache serves 16–23k of the
    largest demo's ≈ 22–32k-token planner prompt once the shared prefix is warm (8k of 12k on the smallest).
  - `nvidia/nemotron-3-super-120b-a12b` repairs the drafts the verifier rejected, thinking off, through a
    forced `submit_plan` call from a fresh request that carries the violations and a code-computed replacement
    menu. $0.30 / $0.90 per 1M. We measured its thinking-on modes and its prompt cache and chose not to use
    either (see Challenges).
  - `nvidia/Nemotron-3-Ultra-550b-a55b` is the critic behind the Stress-test button: thinking on,
    `reasoning_effort:"high"`, a forced `submit_verdict` call that cites evidence by id. The only place the
    $1 / $3 model is spent: one call per run, on your click, cached per plan set, 20 live calls a day.
- **A deterministic engine** (pure TypeScript, no model) owns the prerequisite graph, impact, requirement
  progress, deadlines, offering evidence lookup and the verifier. The models propose; code disposes. The
  requirement-engine modules are the ones TritonPlan runs, vendored under MIT.
- **Tavily** `/search` re-discovers the department tentative-offerings pages (they move every year). Each page
  publishes differently: CSE and COGS embed a Google Sheet that `/extract` cannot read, so the pipeline finds the
  sheet in the page HTML and reads its CSV export; MATH is fetched as HTML because Tavily's markdown drops empty
  table cells; ECE's table comes through `/extract`. Deterministic parsers turn every cell into `{course, term,
  status, quote, url, fetchedAt}` with the page's own caveat kept verbatim. These rows are what the Impact card,
  the verifier's `not-offered` rule and the critic quote.
- **Next.js 16, TypeScript, Tailwind 4 on Vercel.** No database: runs, approvals, traces, the spend ledger and
  the critic cache are small JSON objects (private Vercel Blob in production, disk locally). Three modes:
  `mock` (recorded fixtures, used by tests, $0), `replay` (the recorded demo runs), `live`. Daily and total
  spend caps flip a demo student to its recording with a banner; in production a demo student always replays.
- **The write to TritonPlan** is a one-time token signed with ECDSA P-256 on Approve; the import page verifies
  it with WebCrypto in the browser before showing the plan.

### Challenges

- With thinking on, Lightning's reasoning leaks into `content` on Token Factory and json_schema output stops
  validating. The fix was structural: thinking off for every Lightning call (the client forces both switches),
  and structured answers from thinking-on calls always through a forced tool call.
- `reasoning_budget` is advisory on Token Factory. Super with a 4,096 budget spent 2,016–6,013 reasoning tokens
  per call in our first recorded demo (2026-09-27), and Ultra with 3,072 spent 6,865 then, and 6,916–9,338 on the shipped 2026-09-28 recordings. `reasoning_effort:"low"` did not bound
  it either: 19 of 19 Super calls ran to the 1,200-token cap with no tool call. `reasoning_effort:"none"` gives
  0 reasoning tokens every time, so the planner runs Super with thinking off and puts the judgment into the
  context pack and a code-computed repair menu instead.
- Super's prompt cache never hit: 0 cached tokens across 23 calls with a byte-identical 22k-token prefix, with
  and without `prompt_cache_key`. Lightning's did (33,536 of 37,732 tokens on the second call), which is one
  reason the drafts moved to Lightning: three concurrent drafts share one cached prefix.
- The CSE offerings page is a Google Sheet that `/extract` returns as headings; MATH's empty cells vanish from
  Tavily's markdown so a one-lecture-a-year course could not be placed in a quarter. Every department needed
  its own fetch shape.
- The demo must stay up and cheap through two weeks of judging. Demo students replay in production, live
  planning runs behind daily and total caps, the expensive model runs only on a click.

### Accomplishments

- Planner configuration chosen by a live measurement, not taste: 12 students × 4 configurations, 46 runs,
  $1.04. The shipped configuration (Lightning drafts + Super repair, thinking off) gives 1.75 verified plans
  per student, 83% of students with at least one plan, 23.9 s mean / 27 s median / 37 s max, $0.025 per
  student; the three demo students finish in 8–14 s for $0.014–0.020. Super drafting everything was within
  noise on validity, 2.2× slower and twice the cost. Losing configurations stay in the table.
- Intake accuracy (E4, 30 synthetic Academic History pastes in six layouts): row precision 100% on every
  layout, recall 100% on five layouts and 95.7% overall after a pre-normalizer that re-joins wrapped rows
  (40.8% → 100% on the wrapped layout).
- 454 deterministic tests at $0 in mock mode (453 passing on 2026-09-28, one gated live test skipped; the three demos were re-recorded with the shipped planner and replay bit-for-bit
  the demos), plus a docs consistency test that keeps the model ids identical everywhere.
- `[n]` students used Quarterback from inside TritonPlan before the Oct 23 deadline; `[n]` plans approved;
  `[n]` refusals shown, `[n]` overridden. `[Replace with E5 numbers; no soft launch yet.]`
- `[E1 live validity and refusal precision / recall; E3 not-offered placements with vs without Tavily evidence
  — not run yet.]`

### What we learned

- Split "propose" from "decide". Letting the models propose and code decide made the failure modes boring: a
  bad draft costs one repair round, never a wrong plan on screen.
- Measure the thinking switches before designing around them. On Nemotron via Token Factory, thinking off is
  the reliable setting for structured output, `reasoning_budget` is a hint, and a forced tool call is the
  reliable way to get a record out of a thinking-on call.
- A no-thinking model plans well when the prompt does the arithmetic: putting each course's units, the
  prerequisite it still needs and the quarters to avoid next to it took Lightning's first-pass validity on the
  demo from 33% to 50%.
- Whole-slice reading vs retrieval: `[E2 result — not run yet]`.
- `[E5 hypothesis, replace with what the live period shows:]` web evidence needs provenance to be trusted by
  a student; a verifier message that quotes the line, the URL and the fetch time should be acted on more often
  than one that says "may not be offered".

### What's next

- Winter 2027: the same flow against the Winter schedule when it publishes in November, with the Jan 29 and
  Feb 12 deadlines.
- More departments in the offerings pipeline; grade projection from public syllabi (the stretch Tavily use).
- `[Anything the live period shows students actually need.]`

## Built with

nebius-token-factory, nvidia-nemotron, nvidia-nemotron-3.5-lightning, nvidia-nemotron-3-super,
nvidia-nemotron-3-ultra, tavily, next.js, react, typescript, tailwind-css, vercel, vercel-blob, vitest, zod,
ecdsa, webcrypto, ics

## Links

- Repository (MIT): https://github.com/SahirSSharma/quarterback
- Demo: `[live demo — https://quarterback-delta.vercel.app once promoted; the alias serves the scaffold as of 2026-09-28]`
- Video: `[YouTube URL, public, at most 3 minutes, with audio — see VIDEO.md]`
- TritonPlan (data source and write target): https://tritonplan.com

## Track

Best Apps and Agents

## Tavily bonus

Tavily is load-bearing, not decorative. Whether a course runs in a given quarter lives only on the department
pages, and they move every year. `/search` re-discovers the CSE, MATH, ECE and COGS pages; the source behind
each is fetched in the shape it publishes (Google-Sheet CSV for CSE and COGS, page HTML for MATH, `/extract`
for ECE); a content hash skips unchanged pages; every course-term status is stored with the verbatim quote, URL
and fetch time. The Impact card shows these rows, the verifier's `not-offered` rule rejects a draft on them and
quotes the row, and the Stress-test cites them by id. Discovery cost 4 credits over 5 calls on 2026-09-27; the
refresh is a script today (a schedule is planned). Eval E3 will measure the difference: plans with vs without
Tavily evidence, and the share that place a course in a quarter the department says it is not offered:
`[E3 result — not run yet]`. Credits used over the project: `[n]` of the Researcher plan's 1,000 per month.

## Feedback field

Paste the contents of [feedback.md](feedback.md) (re-verified on Oct 26 or 27).
