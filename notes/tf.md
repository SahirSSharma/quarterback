# lib/tf — notes and requests for other modules

## Requests

1. `lib/types.ts` — add `fallback?: boolean` to `LedgerEntry` ("served by the role's fallback model"). Until
   then `lib/tf/ledger.ts` exports `TFLedgerEntry extends LedgerEntry { fallback?: true }`, which is
   structurally a `LedgerEntry`, so nothing breaks; the trace panel can read `entry.fallback` today.
2. `tsconfig.json` (optional) — `"allowImportingTsExtensions": true` (legal because `noEmit` is set) would let
   scripts import lib with `.ts` specifiers and drop the `registerHooks` shim at the top of
   `scripts/tf-probe.ts`. Other module owners' scripts will hit the same Node ESM constraint.
3. `lib/tf/replay.ts` `Fixture` carries one field beyond the agreed `{request, response, recordedAt, usage}`:
   `ms` (wall time of the recorded call), so replayed ledger entries and the trace panel show real latencies.
4. `package.json` (optional) — `"type": "module"` silences Node's `MODULE_TYPELESS_PACKAGE_JSON` warning when
   running `node scripts/*.ts` and Vite's matching warning about `vitest.config.ts`. Renaming scripts to
   `.mts` is the per-file alternative.

## Observed on the platform (live probe, 2026-09-27, $0.000362 for 5 calls)

- Super with thinking on returns the reasoning in BOTH `message.reasoning` and `message.reasoning_content`,
  with `content: ""` when the answer is a forced tool call; `usage.completion_tokens_details.reasoning_tokens`
  is populated (58 of 116 completion tokens with `reasoning_budget: 256`).
- Lightning returns `prompt_tokens_details: null` and `prompt_cache_hit_tokens: 0`; Super returns
  `prompt_tokens_details: {cached_tokens, created_cache_tokens}` as well. The ledger reads either.
- Streaming with `stream_options: {include_usage: true}` delivers usage in a final chunk with empty `choices`.
- Latency on this run: Lightning 367–2676 ms (first call cold), Super 1283 ms.

## How other modules call this

- `chat(req, {step})`, `chatStream(req, {step})` in `lib/tf/client.ts`; `req.role` picks the model
  (`extract` | `plan` | `critic`), `req.model` overrides it for ablations.
- `structured(role, {system, user, schema, name, maxTokens})`, `forcedTool(role, {messages, tool, thinking,
  maxTokens})`, `toolLoop(role, {messages, tools, maxRounds, thinking, onEvent})` in `lib/tf/helpers.ts`.
  Schemas are zod; `forcedTool` returns `{args, result}`; `toolLoop` returns `{message, messages, rounds,
  exhausted}` so the planner can finish with `forcedTool` on the same history.
- Spend: `setLedgerSink(sink)` in `lib/tf/ledger.ts` takes `{record(entry), spent(sinceIso?)}`; the app
  layer's Blob-backed sink goes here. `BudgetExceededError` from `lib/tf/budget.ts` is what the app catches to
  flip to replay.
- Mock mode: an unknown request throws `MissingFixtureError` naming the fixture and the last user message.
  Record with `QB_MODE=live QB_RECORD=1`; keep prompts and tool results deterministic or keys will drift.
