# Feedback for Nebius and NVIDIA

_Required tool feedback for the Nebius x NVIDIA Global AI Hackathon, kept as an engineering log. Each entry
records what we did, what we saw and what we changed in Quarterback because of it. Measurements were made on
2026-09-27 with our own Token Factory key unless the entry says otherwise. "Changed" records the design
decision taken as a result: as of 2026-09-27 these decisions are written into DESIGN.md and AGENTS.md and are
being implemented; the re-verify pass confirms each one is in the code. Every entry is marked **to re-verify
before submission**: we re-run the check during the demo freeze (Oct 26–27) and replace any number that
moved._

Endpoint under test: `https://api.tokenfactory.nebius.com/v1` (OpenAI-compatible).

## Nebius Token Factory — 2026-09-27

### 1. Model inventory

- **Did.** Listed `/models` and filtered to `nvidia/`.
- **Saw.** 25 serverless models, four of them NVIDIA: `nvidia/Nemotron-3_5-Lightning` (1,048,576 context),
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (262,144), `nvidia/nemotron-3-super-120b-a12b` (262,144 as
  served), `nvidia/Nemotron-3-Ultra-550b-a55b` (1,048,576). No NVIDIA embedding, speech or vision model on
  serverless. Three `nvidia/` models (Nano Omni, Cosmos3-Super-Reasoner, Llama-3.1-Nemotron-Ultra) were
  removed from serverless on 2026-08-31; we observed their absence, we did not measure the removal.
- **Changed.** Three-model map (Lightning, Super, Ultra) with Nano as a fallback only. The E2 retrieval arm
  uses `Qwen/Qwen3-Embedding-8B` because there is no NVIDIA embedding model to use. Model ids live in one
  registry with a fallback order, and a test exercises the fallback, because a model can disappear with
  little notice.
- to re-verify before submission.

### 2. Lightning latency and rate limits

- **Did.** Timed short completions on `nvidia/Nemotron-3_5-Lightning` with thinking off, non-streaming and
  streaming.
- **Saw.** About 350–400 ms per answer; first streamed byte at 234 ms; 600 RPM / 400k TPM on our account.
- **Changed.** Lightning is the default for every extraction and explanation step. The client's TPM queue is
  sized to the 400k figure and surfaces a `waiting` trace event instead of failing.
- to re-verify before submission.

### 3. Nano vs Lightning

- **Did.** Same prompts on `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
- **Saw.** Same price as Lightning ($0.06 / $0.24 per 1M tokens in / out); roughly one fifth of Lightning's
  tokens per second; a quarter of the context; 100 RPM / 800k TPM.
- **Changed.** Nano is strictly dominated at this price, so it is the fallback for Lightning and nothing more.
- to re-verify before submission.

### 4. The two thinking switches

- **Did.** Sent `chat_template_kwargs: { enable_thinking, reasoning_budget }` at the top level of the request
  body, and separately `reasoning_effort: "none"`.
- **Saw.** Both pass through and take effect. `chat_template_kwargs` is not in the OpenAI schema and we did
  not find it in the Token Factory docs.
- **Changed.** "Thinking off" in our client means both switches together
  (`chat_template_kwargs:{enable_thinking:false}` plus `reasoning_effort:"none"`). "Thinking on" means
  `enable_thinking:true` with an explicit `reasoning_budget`.
- to re-verify before submission.

### 5. Thinking on with Lightning: reasoning leaks into `content`, json_schema collapses

- **Did.** `enable_thinking:true` on Lightning with `response_format: json_schema`.
- **Saw.** The reasoning text arrives inside `message.content` rather than in a separate reasoning field (a
  Token Factory response-parser quirk, as far as we can tell), and the json_schema output stops validating. A
  third-party compatibility matrix reports 8% schema-valid output for this combination; that figure is
  theirs, not ours.
- **Changed.** Thinking is off for every extraction and JSON step. A test asserts no think-leak on every
  Lightning path. Any structured answer we need from a thinking-on call (Super's plans, Ultra's verdict) comes
  back through a forced tool call, never through `response_format`.
- to re-verify before submission.

### 6. Tool calling

- **Did.** Tool round trips (call, tool result, final answer) on all four NVIDIA models, thinking on and off,
  streaming and non-streaming.
- **Saw.** All four complete the round trip either way. `nvidia/nemotron-3-super-120b-a12b` emits parallel
  tool calls with thinking off; `nvidia/Nemotron-3_5-Lightning` emits one call per turn. Streamed tool-call
  deltas arrive and assemble correctly.
- **Changed.** The planner runs on Super. The client assembles streamed deltas and does not assume parallel
  calls, so the Lightning path works too.
- to re-verify before submission.

### 7. `response_format: json_schema` with thinking off

- **Did.** Schema-constrained extraction on Lightning, thinking off.
- **Saw.** Schema-valid output in every run we made.
- **Changed.** json_schema is used only with thinking off; this is a written rule in the repo (AGENTS.md) and
  a test.
- to re-verify before submission.

### 8. Prompt cache on Super

- **Did.** Repeated a long shared prefix on `nvidia/nemotron-3-super-120b-a12b`.
- **Saw.** Prompt-cache usage fields present in `usage`.
- **Changed.** The planner's context pack (at most 30k tokens) is a byte-identical shared prefix (system,
  requirement text, eligibility table) followed by the student-specific suffix; cache hits show in the ledger
  and go into E1's cache-hit ratio.
- to re-verify before submission.

### 9. Pricing and where the expensive model is spent

- **Saw.** Lightning and Nano $0.06 / $0.24; Super $0.30 / $0.90; Ultra $1.00 / $3.00 per 1M tokens in / out.
- **Changed.** The ledger computes dollars per call from the registry prices. Ultra runs only behind a click
  (Stress-test), is cached and rate-limited. A spend cap flips live mode to replay with a banner so the demo
  survives judging.
- to re-verify before submission.

### 10. Fine-tuning

- **Saw.** Nemotron models cannot be fine-tuned on Token Factory.
- **Changed.** No fine-tuning in the design; prompts plus a deterministic verifier carry the accuracy.
- to re-verify before submission.

### 11. Batch API

- **Saw.** A 403 "temporarily unavailable" from the Batch API on 2026-09-23, reported by another participant.
  Not measured with our key.
- **Changed.** Evals run against the serverless endpoints behind a TPM queue; nothing depends on Batch.
- to re-verify before submission (with our key).

### 12. Sandboxes (Contree)

- **Saw.** Beta, enabled per project on request; requests need a Project header. The project id was not
  obvious to find from the flow we used.
- **Changed.** Not used. Quarterback executes no code on the student's behalf, so this was a cost of
  discovery, not a blocker.
- to re-verify before submission.

## Tavily — 2026-09-27 (bonus)

- **Did.** `/search` for the CSE, MATH, ECE and COGS tentative-offerings pages; `/extract` (advanced) on each.
- **Saw.** `/search` in about 1.6 s. `/extract` returned markdown tables for `math.ucsd.edu` and
  `ece.ucsd.edu`. The CSE page embeds a Google Sheet, and `/extract` returned 75 characters for it.
  Researcher plan: 1,000 credits per month.
- **Changed.** The pipeline discovers the sheet URL in the page HTML and reads its CSV export. Every call sets
  `include_usage: true` and the credit count appears in the ledger.
- **Request.** Surface embedded iframe and published-sheet URLs in `/extract` results, or follow them when
  `extract_depth` is advanced.
- to re-verify before submission.

## Requests to Nebius and NVIDIA

1. **Document `chat_template_kwargs`.** It is the only way to set `enable_thinking` and `reasoning_budget`
   on Nemotron through the OpenAI-compatible API, and it is not in the Token Factory docs we found. One
   paragraph with the accepted keys per model would settle it.
2. **Document, or fix, the Lightning think-leak.** With `enable_thinking:true`, reasoning text lands in
   `message.content`. Either route it to a separate reasoning field or state the behaviour so people know to
   turn thinking off for structured output.
3. **Keep `response_format: json_schema` working with thinking on.** The combination is the natural one
   for "reason, then emit a record". Today the workaround is a forced tool call.
4. **Publish model deprecation windows.** Three `nvidia/` models left serverless on 2026-08-31 with little
   notice. A dated deprecation list, and a minimum notice period, would let a demo that must survive a
   two-week judging window be planned with confidence.
5. **A spend cap on the account.** Daily and total hard caps at the platform level, not only alerts. We built
   our own (live mode flips to replay over the cap) because the demo must not die during judging.
6. **Sandboxes project id discoverability.** Show the Project header value where the API key is issued, and
   say on the Sandboxes page that the Beta is per project.
7. **Batch API status.** A status page entry or an error body that says when to retry, instead of a bare 403
   "temporarily unavailable".

## Re-verify before submission

- [ ] Re-run items 1–12 against the platform on Oct 26 or 27 and update any figure that moved.
- [ ] Add measured usage from the live period: `[calls]`, `[tokens]`, `[USD]` per model from the ledger.
- [ ] Confirm the four `nvidia/` model ids still resolve on `/models` and note any new arrival or removal.
- [ ] Paste this file's contents into the Devpost feedback field (see [SUBMISSION.md](SUBMISSION.md)).
