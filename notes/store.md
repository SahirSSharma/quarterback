# Notes from the lib/store owner (persistence, ledger sink, runs, approvals, signing, .ics, mailto)

Nothing outside `lib/store/` was edited. Tests: `npx vitest run lib/store` (disk backend in a temp dir, $0).

## How the routes owner wires it

- `store()` in `lib/store/blob.ts` picks Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (private blobs,
  stable keys, overwrite allowed, CDN cache bypassed on read), else `QB_DATA_DIR` or `./.data` on disk
  (git-ignored). Keys have no extension (`runs/<runId>` → `runs/<runId>.json`). `setStore()` swaps it in tests.
  `@vercel/blob` pulls in `undici`, so route handlers using the store must run on the Node runtime, not Edge.
- Spend: call `installLedgerSink()` (`lib/store/ledger-sink.ts`) once at module scope of the route(s) that call
  Token Factory; it does `setLedgerSink(new BlobLedgerSink())`. Tavily credits: `createTavilyClient({ sink:
  (e) => sink.recordCredits(e) })`. `sink.totals()` → `{byModel, byStep, usd, credits}` for the ledger panel
  (live spend only; replayed entries are excluded everywhere, as `spent()` already does for the caps).
  Writes never reject; reads (`spent`, `totals`) can, and only run behind the live-mode budget check.
- Runs: `POST /api/plan` → `createRun({state, action, impact, …})` → runId; later steps `updateRun(runId,
  patch)`; `GET /api/run/[id]` → `getRun(id)` (runId or saved id); `POST /api/save` → `saveRun(runId)` →
  `qb_…`; `DELETE /api/run/[id]` → `deleteRun((await getRun(id)).runId)` (also removes the saved copy and
  every approval record for the run). The stub's in-memory Map goes away: `approve()` calls `updateRun`, so a
  run must exist in the store before it can be approved.
- Approve: `approve({run, planId, overrides})` → `ApprovalRecord` (persisted with `runId`, written onto the
  run); `ApprovalError.status` is 400 (unknown plan / failed verification) or 409 (refused, no exact
  `'I understand'` override). Then `signImportToken(importPayload(record, plan))`, `buildImportUrl(payload)`,
  `icsUrl: /api/ics/${record.id}`, `advisorMailto({state, plan, impact})`.
- `.ics`: `getApproval(id)` → `{…record, runId}` → `getRun(runId)` → `icsFor(run, record)`.

## Requests and flags for other owners

1. **app/** — `ApprovalRecord.planHash` is the sha256 hex (64 chars) of the plan's canonical JSON, as the task
   specifies; `app/lib/planHash.ts` shows an 8-char FNV-1a in `ApproveDialog` and next to the selected plan, and
   `PlanFlow` prints `run.approval.planHash` in full. The two fingerprints will not match on screen. Either show
   `planHash.slice(0, 8)` on the approved line and drop the dialog fingerprint, or compute sha256 client-side
   with `crypto.subtle.digest` (async) over the same canonical JSON (`canonicalJson` in `lib/tavily/client.ts`).
2. **DESIGN.md** — says `tritonplan.com/tools/import?plan=`; the task text and the app stub say
   `/tools/quarterback-import`. `IMPORT_BASE` in `lib/store/approval.ts` uses `quarterback-import`; one of the
   two documents should be corrected. The approve stub's comment says the real token is Ed25519-signed; it is
   ECDSA P-256 (DESIGN.md), raw 64-byte `r||s`, verifiable with WebCrypto against `lib/keys/import-public.json`.
   The exact byte contract is in the header of `lib/store/approval.ts`.
3. **Deployment** — `QB_SIGNING_KEY` (base64 of the PKCS8 DER private key) must be set on Vercel; without it
   `signImportToken` throws (no unsigned fallback). `lib/store/approval.test.ts` has a `deployed key pair` test
   that runs only when the variable is present and checks it matches the shipped public key; it passes locally.
4. **DESIGN.md "Storage"** says pasted history is stored only on Save. The agreed key layout puts the working
   `RunRecord` (with its `StudentState`) under `runs/<runId>` from `POST /api/plan` on, because a serverless
   `GET /api/run` needs it between requests. Flagging the wording, not resolving it: options are a TTL sweep of
   `runs/` (Vercel Cron) or keeping only ids in the run and re-posting state from the client.
5. **app/lib as a dependency of lib/store** — `lib/store` imports, relatively, the type `RunRecord` from
   `app/lib/contracts.ts`, `icsEscape`/`foldLine` from `app/lib/ics.ts` and `formatDate` from
   `app/lib/format.ts` (all pure). `icsFor` re-implements the private all-day `event()` builder because it emits
   one event per course, not per term; exporting `event`/`icsDate` from `app/lib/ics.ts`, or moving the ics
   helpers under `lib/`, would remove the duplication.
6. **.ics for terms the calendar does not cover** (every demo plan has an FA27 term; the 2026–27 calendar ends
   at SP27): no events are invented; an `X-QB-NOTE:` calendar line says which term and how many courses were
   skipped. Calendar apps do not display X- properties, so the UI may want to say the same thing next to the
   download link.
7. **lib/types.ts** — no change requested. `StoredApproval = ApprovalRecord & { runId }` and the ledger's
   `kind: 'tf' | 'tavily'` tag live only in stored objects (`lib/store/approval.ts`, `lib/store/ledger-sink.ts`).
8. **Two semantics to know when wiring routes** — `deleteSaved(id)` removes only `saved/<id>`; the run keeps
   `state.id`, so the next `updateRun` (e.g. an approval) re-creates the saved copy. Today's Delete button is
   `deleteRun`, which is complete; a "remove share link" button would need `updateRun(runId, {state: {…state,
   id: undefined}})` as well. `updateRun` is read-merge-write without an etag: two concurrent patches to one run
   can drop one. The UI is sequential, so this does not bite now; Blob's `ifMatch` is the fix if it ever does.
9. **Scale note** — `spent()`/`totals()` list the whole `ledger/` prefix once per call and read entries per key
   (past UTC days memoized per process, today's re-read; a 200-entry LRU sits in front of every read). Fine for
   the hackathon's volume; if the ledger grows past a few thousand objects, switch the total-cap path to a
   per-day rollup or Blob's `mode: 'folded'` listing.
