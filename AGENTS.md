# Working in this repo

Read `DESIGN.md` (plan of record) and `lib/types.ts` (shared contracts) before touching anything.

- Stack: Next.js 16 App Router, TypeScript strict, ESM, Tailwind 4, Vitest. Node ≥ 24 (26 locally, 24 on Vercel).
- Style: 2-space indent, semicolons, single quotes, small pure modules, comments say *why*. Minimum code that
  solves the problem; no speculative abstractions or configurability nobody asked for.
- Module ownership: `lib/engine` (deterministic core), `lib/tf` (Token Factory client), `lib/tavily` +
  `lib/offerings` (web evidence), `lib/agents` (planner, critic, explain, intake), `app/` (UI + routes),
  `eval/`, `scripts/`, `devpost/`. Stay inside the module you own; if you need a change to `lib/types.ts` or
  another module, write the request into `notes/<your-module>.md` instead of editing it.
- Dependencies: do not add packages. If something is genuinely necessary, say so in your report.
- Secrets: `.env.local` holds `NEBIUS_API_KEY` and `TAVILY_API_KEY` (git-ignored). Load with
  `loadEnv()` from `lib/env.ts`. Never print, log, echo or commit a key; never put one on a command line.
- Modes: `QB_MODE=mock` (default: fixtures only, fails loudly on an unknown request), `replay` (curated
  traces), `live`. Tests run in mock mode and cost $0. Live calls belong in clearly named scripts, are cheap
  (Lightning first), and log `usage` to the ledger.
- Nemotron on Token Factory: thinking OFF (`chat_template_kwargs:{enable_thinking:false}` plus
  `reasoning_effort:"none"`) for extraction and JSON; thinking ON with `reasoning_budget` only for judgment
  steps; `response_format: json_schema` only with thinking off; final structured answers from a thinking-on
  call come back through a forced tool call, never json_schema. Model ids live only in `lib/tf/models.ts`.
- Tests: `npx vitest run lib/<module>` while you work, `npm test` before you report. Prefer tests that can
  visibly fail. Every model-output schema has a test with a recorded fixture.
- Data: `data/` is a public snapshot; never add anything personal. Course codes are normalized upper case with
  one space (`CSE 100`). Terms are TritonPlan quarter codes (`FA26`, `WI27`, `SP27`); never hard-code the
  current term — read it from the request or `data/registrar-calendar.json`.
- Product copy describes what the user sees and gets, not how it was built. Anything that ships into
  TritonPlan must not contain AI/agentic authorship wording (its deploy script blocks it).
- Do not commit, push or deploy from a module task; the orchestrator does that after review.
