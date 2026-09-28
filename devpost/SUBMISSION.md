# Devpost submission — paste-ready

_Everything below maps to a field on the Devpost form. Bracketed items are numbers or links that do not exist
yet and must be filled in before submitting (target: Wed Oct 28, 2026; hard deadline Fri Oct 30, 10:00 am PT).
Model ids are spelled exactly as Token Factory lists them; do not shorten them in the form._

## Project name

Quarterback

## Tagline

Pick one; each is at most 200 characters.

1. Before UC San Diego's Oct 23 drop deadline: see what dropping a class does to your degree, get code-verified re-plans, and send the one you approve to TritonPlan.
2. Drop, P/NP or keep? Quarterback shows the graduation impact, re-plans with Nemotron under a deterministic veto, refuses risky plans with a quoted source, and writes to TritonPlan on approval.
3. A degree re-planner for UC San Diego that quotes the department page when it says no, and only touches your plan after you click Approve.

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

1. **Impact.** Paste your TSS Academic History page (or pick a demo student), choose a current course and an
   action: drop, switch to P/NP, or keep. Instantly, with no model call, you see which downstream courses this
   blocks, when each is next offered, the delay in quarters, whether you fall below the 12-unit floor, whether
   the requirement accepts P/NP (or "check with your department" when the rules are silent), the two deadlines
   for the current term, and the change in requirement progress.
2. **Re-plan.** Up to three plans for the coming quarters (fastest to degree, balanced, lightest). Every plan
   you see has passed a deterministic verifier: prerequisites by the term they are needed, no course in a
   quarter the department says it is not offered, unit floor and cap, no duplicates, nothing already earned,
   graduation still reachable. A plan that fails is never shown.
3. **Stress-test.** A second model reads the plans against the department offering pages and either
   recommends one or refuses one, showing the verbatim line from the page, its URL and when it was fetched.
   Overriding a refusal requires typing "I understand" and a reason.
4. **Approve, then act.** Recommended and refused plans side by side, the verifier checks as a checklist, and a
   ledger of what every step cost. After Approve, and only then: send the plan to TritonPlan (it loads into
   the Degree Planner with one-click restore of the old plan), download an .ics of deadlines and planned
   courses, or open a prefilled advisor email.

A trace panel streams every step: model, milliseconds, tokens, cents, cache hits, tool calls.

### How we built it

- **Nebius Token Factory** serves all inference through its OpenAI-compatible endpoint. Three NVIDIA Nemotron
  models, each with one job and a measured reason:
  - `nvidia/Nemotron-3_5-Lightning` for extraction and explanation, thinking off
    (`chat_template_kwargs:{enable_thinking:false}` plus `reasoning_effort:"none"`), `response_format:
    json_schema` where the output is structured. 1M context, $0.06 / $0.24 per 1M tokens, 350–400 ms answers.
  - `nvidia/nemotron-3-super-120b-a12b` as the planner, thinking on with `reasoning_budget: 4096`, tools for
    eligibility, prerequisites, requirement progress, offering status, unit checks and grade history, and a
    forced `submit_plans` tool call for the final answer. Prompt-cache fields let a byte-identical shared
    prefix hit the cache across students.
  - `nvidia/Nemotron-3-Ultra-550b-a55b` as the critic behind the Stress-test button, `reasoning_effort:
    "high"`, forced `submit_verdict` tool call. The only place the $1 / $3 model is spent; click-gated, cached,
    rate-limited.
- **A deterministic engine** (pure TypeScript, no model) owns the prerequisite graph, impact, requirement
  progress, deadlines and the verifier. The model proposes; code disposes. The requirement-engine modules are
  the ones TritonPlan runs, vendored under MIT.
- **Tavily** `/search` re-discovers the department tentative-offerings pages (they move every year) and
  `/extract` pulls their tables; Lightning turns each row into `{course, term, status, quote, url, fetchedAt}`.
  The CSE page hides its table in an embedded Google Sheet, so the pipeline finds the sheet in the page HTML
  and reads its CSV export. These quotes are what a refusal shows.
- **Next.js 16, TypeScript, Tailwind 4 on Vercel.** No database: runs, approvals, the spend ledger and the
  offerings cache are small JSON blobs (Vercel Blob in production, disk locally). Three modes: `mock`
  (recorded fixtures, used by tests, $0), `replay` (curated demo traces, the default for judging), `live`. A
  spend cap flips live to replay with a banner so the demo survives the judging window.
- **The write to TritonPlan** is a signed one-time token (Ed25519) minted on Approve; TritonPlan verifies it
  in the browser before loading the plan.

### Challenges

- With thinking on, Lightning's reasoning leaks into `content` on Token Factory and json_schema output stops
  validating. The fix was structural: thinking off for every extraction step, and structured answers from
  thinking-on calls always through a forced tool call. A test asserts no think-leak on every Lightning path.
- The CSE offerings page is a Google Sheet that `/extract` returns as 75 characters. Reading the sheet's CSV
  export solved it, but every department publishes differently (CSV, HTML table, index of sub-pages), so the
  pipeline needed a per-source shape.
- The demo must stay up and cheap through two weeks of judging on a $[budget] budget. Replay by default, live
  behind a cap, and every expensive call behind a click.
- The product had to exist before October 23 to be useful this quarter, which set the whole schedule.

### Accomplishments

- Three-model behaviour on Token Factory verified on day one (tool round trips on all four NVIDIA models,
  streamed tool-call deltas, json_schema with thinking off, the two thinking switches) and turned into rules
  the tests enforce.
- `[n]` students used Quarterback from inside TritonPlan before the Oct 23 deadline; `[n]` plans approved;
  `[n]` refusals shown, `[n]` overridden. `[Replace with E5 numbers.]`
- Plan validity after at most three planner rounds: `[E1]`. Refusal precision / recall on planted risks:
  `[E1]`. Share of plans placing a course in a quarter the department says it is not offered, with vs without
  Tavily evidence: `[E3]`.
- `[n]` deterministic tests at $0 in mock mode.

### What we learned

- Split "propose" from "decide". Letting the model propose and code decide made the failure modes boring: a
  bad proposal costs one more round, never a wrong plan on screen.
- On Nemotron via Token Factory, thinking off is the reliable setting for structured output, and a forced tool
  call is the reliable way to get a record out of a thinking-on call.
- Whole-slice reading vs retrieval: `[E2 result]`.
- `[E5 hypothesis, replace with what the live period shows:]` web evidence needs provenance to be trusted by
  a student; a refusal that quotes the line, the URL and the fetch time should be acted on more often than one
  that says "may not be offered".

### What's next

- Winter 2027: the same flow against the Winter schedule when it publishes in November, with the Jan 29 and
  Feb 12 deadlines.
- COGS and more departments in the offerings pipeline; grade projection from public syllabi (the stretch
  Tavily use).
- `[Anything the live period shows students actually need.]`

## Built with

nebius-token-factory, nvidia-nemotron, nvidia-nemotron-3.5-lightning, nvidia-nemotron-3-super,
nvidia-nemotron-3-ultra, tavily, next.js, react, typescript, tailwind-css, vercel, vercel-blob, vitest, zod,
ed25519, ics

## Links

- Repository (MIT): https://github.com/SahirSSharma/quarterback
- Demo: https://quarterback-delta.vercel.app
- Video: `[YouTube URL, public, at most 3 minutes, with audio — see VIDEO.md]`
- TritonPlan (data source and write target): https://tritonplan.com

## Track

Best Apps and Agents

## Tavily bonus

Tavily is load-bearing, not decorative. Two facts change the decision and live only on the web: whether a
course is offered in a given quarter, and (stretch) a course's grading weights. `/search` re-discovers the
department tentative-offerings pages each night because they move every year; `/extract` in advanced mode
pulls the tables; a content hash skips unchanged pages; every course-term status is stored with the verbatim
quote, URL and fetch time. The verifier's `not-offered` rule and every Stress-test refusal cite these rows.
Eval E3 measures the difference: plans with vs without Tavily evidence, and the share that place a course in a
quarter the department says it is not offered: `[E3 result]`. Credits used over the project: `[n]` of the
Researcher plan's 1,000 per month.

## Feedback field

Paste the contents of [feedback.md](feedback.md) (re-verified on Oct 26 or 27).
