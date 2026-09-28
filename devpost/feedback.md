# Feedback for Nebius and NVIDIA

_Required tool feedback for the Nebius x NVIDIA Global AI Hackathon, kept as an engineering log. Each entry
records what we did, what we saw and what we changed in Quarterback because of it. Measurements were made with
our own Token Factory key on the date in the heading; "Changed" names what the code does today. Every entry is
marked **to re-verify before submission**: we re-run the check during the demo freeze (Oct 26–27) and replace
any number that moved. Sources: `scripts/tf-probe.ts` and `lib/tf/probe-cases.ts`, `scripts/measure-planner.ts`
with `eval/results/planner-configs-2026-09-28*.jsonl`, the recorded runs in `fixtures/runs/`._

Endpoint under test: `https://api.tokenfactory.nebius.com/v1` (OpenAI-compatible).

## Nebius Token Factory — 2026-09-27

### 1. Model inventory

- **Did.** Listed `/models` and filtered to `nvidia/`.
- **Saw.** 25 serverless models, four of them NVIDIA: `nvidia/Nemotron-3_5-Lightning` (1,048,576 context),
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (262,144), `nvidia/nemotron-3-super-120b-a12b` (262,144 as
  served), `nvidia/Nemotron-3-Ultra-550b-a55b` (1,048,576). No NVIDIA embedding, speech or vision model on
  serverless. Three `nvidia/` models (Nano Omni, Cosmos3-Super-Reasoner, Llama-3.1-Nemotron-Ultra) were
  removed from serverless on 2026-08-31; we observed their absence, we did not measure the removal.
- **Changed.** Three-model map (Lightning, Super, Ultra) with Nano as a fallback only. The planned E2
  retrieval arm names `Qwen/Qwen3-Embedding-8B` because there is no NVIDIA embedding model to use. Model ids
  live in one registry with a fallback order, and a test exercises the fallback, because a model can disappear
  with little notice.
- to re-verify before submission.

### 2. Lightning latency and rate limits

- **Did.** Timed short completions on `nvidia/Nemotron-3_5-Lightning` with thinking off, non-streaming and
  streaming.
- **Saw.** About 350–400 ms per short answer; first streamed byte at 234 ms; 600 RPM / 400k TPM on our
  account. In the planner, a lookup call over a 12–32k-token prompt takes 1.1–2.4 s and a `submit_plan` call
  1.3–6.9 s (2026-09-28).
- **Changed.** Lightning is the default for every extraction and explanation step, and since 2026-09-28 for
  the three parallel plan drafts. The client retries 429 and 5xx responses up to three times honouring
  `Retry-After` (capped at 20 s); we did not need a token-per-minute queue at this volume and did not build
  one.
- to re-verify before submission.

### 3. Nano vs Lightning

- **Did.** Same prompts on `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
- **Saw.** Same price as Lightning ($0.06 / $0.24 per 1M tokens in / out); roughly one fifth of Lightning's
  tokens per second; a quarter of the context; 100 RPM / 800k TPM.
- **Changed.** Nano is strictly dominated at this price, so it is the fallback for Lightning and nothing more.
- to re-verify before submission.

### 4. The two thinking switches

- **Did.** Sent `chat_template_kwargs: { enable_thinking, reasoning_budget }` at the top level of the request
  body, and separately `reasoning_effort`.
- **Saw.** Both pass through and take effect on `enable_thinking`; `reasoning_budget` does not bound the
  reasoning (item 13). `chat_template_kwargs` is not in the OpenAI schema and we did not find it in the Token
  Factory docs.
- **Changed.** "Thinking off" in our client means both switches together
  (`chat_template_kwargs:{enable_thinking:false}` plus `reasoning_effort:"none"`), and the client forces it on
  every Lightning call. "Thinking on" means `enable_thinking:true` with `reasoning_effort` and, where set, a
  `reasoning_budget` that we treat as a hint.
- to re-verify before submission.

### 5. Thinking on with Lightning: reasoning leaks into `content`, json_schema collapses

- **Did.** `enable_thinking:true` on Lightning with `response_format: json_schema`.
- **Saw.** The reasoning text arrives inside `message.content` rather than in a separate reasoning field (a
  Token Factory response-parser quirk, as far as we can tell), and the json_schema output stops validating. A
  third-party compatibility matrix reports 8% schema-valid output for this combination; that figure is
  theirs, not ours.
- **Changed.** Thinking is off for every Lightning call; with it off, every json_schema and tool-call reply we
  made (the intake fixture, the probe calls, 46 planner runs on 2026-09-28) was valid. Any structured answer we
  need from a thinking-on call (Ultra's verdict) comes back through a forced tool call, never through
  `response_format`.
- to re-verify before submission.

### 6. Tool calling

- **Did.** Tool round trips (call, tool result, final answer) on all four NVIDIA models, thinking on and off,
  streaming and non-streaming.
- **Saw.** All four complete the round trip either way. `nvidia/nemotron-3-super-120b-a12b` emits parallel
  tool calls with thinking off; `nvidia/Nemotron-3_5-Lightning` emits one call per turn. Streamed tool-call
  deltas arrive and assemble correctly.
- **Changed.** The planner drafts on Lightning with tools and a terminal `submit_plan` call, and repairs on
  Super through a forced tool call. The client assembles streamed deltas and does not assume parallel calls.
- to re-verify before submission.

### 7. `response_format: json_schema` with thinking off

- **Did.** Schema-constrained extraction on Lightning, thinking off.
- **Saw.** Schema-valid output in every run we made.
- **Changed.** json_schema is used only with thinking off; this is a written rule in the repo (AGENTS.md) and
  a test.
- to re-verify before submission.

### 8. Prompt cache: Lightning yes, Super no

- **Did.** Repeated a byte-identical 37.7k-token prefix on both models (2026-09-27), then 23 Super calls with a
  byte-identical 22k-token prefix, with and without `prompt_cache_key`, plus 46 planner runs on 2026-09-28.
- **Saw.** Lightning: 33,536 of 37,732 prompt tokens served from cache on the second call, latency 1,653 →
  ≈ 590 ms; in the planner, once the prefix is warm and including on three concurrent calls, 16,768–23,056 cached
  of 22,034–31,570 prompt tokens per draft on demo (a), 8,384 of ≈ 12.3k on demo (b), 10,480–16,768 of ≈ 20–22k on
  demo (c); 0 on the first-ever call of a prefix; every one of the 12 measured students had hits. Super: the `prompt_tokens_details` fields
  are present but `cached_tokens` was 0 on every one of the 23 probe and planner calls and in every recording.
- **Changed.** The three plan drafts run on Lightning against a byte-identical shared prefix (a pure function
  of major file, college file, current term and horizon), so the cache covers the prefix and most of the
  student section from the second draft on. Nothing assumes a Super cache saving; the ledger prices cache hits
  at the full input rate because no discount is published.
- **Request.** Say which models cache prompts and what the discount is, or make Super cache.
- to re-verify before submission.

### 9. Pricing and where the expensive model is spent

- **Saw.** Lightning and Nano $0.06 / $0.24; Super $0.30 / $0.90; Ultra $1.00 / $3.00 per 1M tokens in / out.
  Measured per student with the shipped planner: $0.0249 mean over 12 students, $0.014–0.020 on the three
  demos; the recorded stress-test calls cost $0.030–0.037 each on the 2026-09-28 recordings ($0.019–0.029 on the first, 2026-09-27, recordings).
- **Changed.** The ledger computes dollars per call from the registry prices. Ultra runs only behind a click
  (Stress-test), once per run, cached per plan set and capped at 20 live calls a day. Daily and total spend
  caps flip a demo student to its recording with a banner.
- to re-verify before submission.

### 10. Fine-tuning

- **Saw.** Nemotron models cannot be fine-tuned on Token Factory.
- **Changed.** No fine-tuning in the design; a context pack plus a deterministic verifier carry the accuracy.
- to re-verify before submission.

### 11. Batch API

- **Saw.** A 403 "temporarily unavailable" from the Batch API on 2026-09-23, reported by another participant.
  Not measured with our key.
- **Changed.** Evals run against the serverless endpoints; nothing depends on Batch.
- to re-verify before submission (with our key).

### 12. Sandboxes (Contree)

- **Saw.** Beta, enabled per project on request; requests need a Project header. The project id was not
  obvious to find from the flow we used.
- **Changed.** Not used. Quarterback executes no code on the student's behalf, so this was a cost of
  discovery, not a blocker.
- to re-verify before submission.

## Nebius Token Factory — 2026-09-28

### 13. `reasoning_budget` is advisory; `reasoning_effort` is what bounds cost

- **Did.** Ran the planner with Super thinking on (`reasoning_budget: 4096`) on 2026-09-27 (the recorded demos),
  then on 2026-09-28 with `reasoning_effort:"low"` alone and with `reasoning_budget: 512` added, all with
  `max_tokens: 1200`; and Ultra with `reasoning_effort:"high"`, `reasoning_budget: 3072`.
- **Saw.** Budget 4096: 2,016–6,013 reasoning tokens per Super call (4 of 7 calls over budget) in recorded
  demo (a); the demo took 144 s over 7 rounds. Ultra budget 3072: 6,865 reasoning tokens. Effort `low`, with
  or without budget 512: 19 of 19 Super calls ran to the 1,200-token cap with `reasoning_tokens` 1,200,
  `finish_reason: "length"` and no tool call (6.3–7.0 s alone, 12.4–14.3 s with three calls in flight). Effort
  `none`: 0 reasoning tokens on every one of 60+ Super calls and every Lightning call. An earlier probe with
  budget 256 on a trivial prompt produced 58 reasoning tokens, so small budgets may hold on trivial prompts;
  they did not on this task.
- **Changed.** Super runs with thinking off in the shipped planner; `reasoning_effort` is the knob the code
  exposes (`QB_REPAIR_EFFORT`), and `reasoning_budget` is sent only to Ultra, as a hint.
- **Request.** Either enforce `reasoning_budget` (stop reasoning at the budget and answer) or document it as
  advisory, and document what `reasoning_effort` levels mean in tokens per model.
- to re-verify before submission.

### 14. Super with thinking off and `tool_choice: "auto"` writes prose

- **Did.** Let Super draft plans with tools available and `tool_choice: "auto"`, thinking off.
- **Saw.** On 2 of 3 draft calls it produced 1,200 tokens of prose (no reasoning, no tool call) before the
  forced `submit_plan` follow-up; draft phases of 15–72 s. A forced `submit_plan` call is 194–330 completion
  tokens in 2.0–2.5 s alone, 4–7 s with three calls in flight.
- **Changed.** Super is used only through forced tool calls; the drafts with tools run on Lightning.
- to re-verify before submission.

### 15. Repair prompts: history vs fresh request vs menu

- **Did.** Asked Super (thinking off) to repair a rejected plan three ways.
- **Saw.** Given its own `submit_plan` call in the history and the violations as a tool result, it resubmitted
  the identical plan (0 of 2). As a fresh request listing the violations only, 1 of 8. As a fresh request with
  a code-computed replacement menu per bad slot, 5 of 5 on the demos. Lightning as the repairer resubmitted the
  same plan (0 of 12 without the menu; 2 of 3 then 0 of 1 with it).
- **Changed.** Repairs are fresh requests with the violations and the menu; Lightning never repairs.
- to re-verify before submission.

### 16. Billed prompt tokens vs a character estimate

- **Saw.** The planner's course-code-heavy prefix bills ≈ 2.3× the 4-characters-per-token estimate
  (22,034–31,570 prompt tokens for demo (a) against ≈ 11.3k estimated).
- **Changed.** The context pack's size is reported as an estimate in the trace and the ledger reports the
  billed figure.
- **Request.** A token-count endpoint or a published tokenizer for the Nemotron models.
- to re-verify before submission.

## Tavily — 2026-09-27 (bonus)

- **Did.** `/search` for the CSE, MATH, ECE and COGS tentative-offerings pages; `/extract` (advanced) on each.
- **Saw.** `/search` in about 1.6 s. `/extract` returned the ECE table faithfully as markdown (0 of 555 cells
  differ from the HTML in blank / non-blank). For MATH, the markdown drops empty `<td>` cells, so a course with
  one lecture a year could not be assigned to a quarter (MATH 31A in Fall and MATH 31B in Winter render
  identically). The CSE and COGS pages embed a published Google Sheet; `/extract` returns the page's headings
  without the sheet. 5 calls, 4 credits. Researcher plan: 1,000 credits per month.
- **Changed.** ECE is read through `/extract`; MATH is fetched as HTML directly; CSE and COGS are read from the
  sheet's CSV export, whose URL the pipeline finds in the page HTML. Every call sets `include_usage: true` and
  the credit count lands in the spend ledger.
- **Request.** Preserve empty table cells in the markdown (an empty cell is data), and surface embedded iframe
  and published-sheet URLs in `/extract` results or follow them when `extract_depth` is advanced.
- to re-verify before submission.

## Requests to Nebius and NVIDIA

1. **Document `chat_template_kwargs`.** It is the only way to set `enable_thinking` and `reasoning_budget`
   on Nemotron through the OpenAI-compatible API, and it is not in the Token Factory docs we found. One
   paragraph with the accepted keys per model would settle it.
2. **Enforce or document `reasoning_budget`.** Today it is advisory (item 13): Super spent up to 6,013
   reasoning tokens under a 4,096 budget and Ultra 6,865 under 3,072, and `reasoning_effort:"low"` ran every
   call to `max_tokens`. A hard stop at the budget, or a table of what each effort level costs per model, would
   let a planner use thinking on with a predictable bill.
3. **Prompt caching on Super, or say which models cache.** Lightning caches (33.5k of 37.7k tokens); Super
   returned 0 cached tokens on 23 identical-prefix calls (item 8). The usage fields are there; the hits are not.
4. **Document, or fix, the Lightning think-leak.** With `enable_thinking:true`, reasoning text lands in
   `message.content`. Either route it to a separate reasoning field or state the behaviour so people know to
   turn thinking off for structured output.
5. **Keep `response_format: json_schema` working with thinking on.** The combination is the natural one
   for "reason, then emit a record". Today the workaround is a forced tool call.
6. **Publish model deprecation windows.** Three `nvidia/` models left serverless on 2026-08-31 with little
   notice. A dated deprecation list, and a minimum notice period, would let a demo that must survive a
   two-week judging window be planned with confidence.
7. **A spend cap on the account.** Daily and total hard caps at the platform level, not only alerts. We built
   our own (live mode flips to the recording over the cap) because the demo must not die during judging.
8. **A token counter.** Billed prompt tokens were 2.3× our character estimate on course-code-heavy text
   (item 16).
9. **Sandboxes project id discoverability.** Show the Project header value where the API key is issued, and
   say on the Sandboxes page that the Beta is per project.
10. **Batch API status.** A status page entry or an error body that says when to retry, instead of a bare 403
    "temporarily unavailable".

## Re-verify before submission

- [ ] Re-run items 1–16 against the platform on Oct 26 or 27 and update any figure that moved.
- [ ] Add measured usage from the live period: `[calls]`, `[tokens]`, `[USD]` per model from the ledger.
- [ ] Confirm the four `nvidia/` model ids still resolve on `/models` and note any new arrival or removal.
- [ ] Paste this file's contents into the Devpost feedback field (see [SUBMISSION.md](SUBMISSION.md)).
