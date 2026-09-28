# Notes from the offerings / Tavily owner (2026-09-27)

## Requests for other modules

- **`lib/types.ts`** — please add the file type the engine reads, currently exported from `lib/offerings/build.ts`:
  ```ts
  export interface OfferingsFile {
    dept: string; sourceUrl: string; fetchedAt: string;
    contentHash: string;          // sha256 of the raw source text (CSV / HTML / markdown)
    disclaimer?: string;          // the page's own caveat, verbatim (CSE, ECE, COGS have one; MATH has none)
    terms: TermCode[];            // ['FA26','WI27','SP27']
    rows: OfferingEvidence[];
  }
  ```
  `disclaimer` is additive to the agreed schema. Rows for a Google-Sheet page (CSE, COGS) are `offered` /
  `not_offered` per cell; the page-level "tentative" caveat lives in `disclaimer`, as agreed.
- **`tsconfig.json` / `package.json`** — nothing required. Scripts run with
  `node --import ./scripts/node-ts.ts scripts/<script>.ts`; the preload adds `.ts` extension resolution
  (Node strips types but does not resolve extensionless relative imports). Other owners' scripts can reuse it.
  A `"refresh-offerings": "node --import ./scripts/node-ts.ts scripts/refresh-offerings.ts"` entry in
  `package.json` scripts would be nice. Node also warns `MODULE_TYPELESS_PACKAGE_JSON` because package.json
  has no `"type"`; harmless.

## What the engine / critic owners should know about the rows

- `quote` shape differs by source. CSE/COGS: the verbatim CSV record (embedded `\n` between multiple
  instructors kept; `raw.includes(quote)` holds). MATH/ECE: the *rendered* table row, cells joined with
  ` | ` (MATH from HTML cell text, ECE with markdown link syntax removed); every non-empty cell is verbatim
  page text, but the whole quote is not a substring of the raw HTML/markdown. Blank cells keep their
  position (`MATH 31B | Honors Multivariable Calculus | 001 |  | Nava Trejo, Julio | `).
- `instructor` joins several sections/rows with `; ` (`Debashis Sahoo; Paul Cao`). ECE uses last names in
  caps; `TBD` and parenthetical topics count as offered (the page's own rule: a filled box = offered).
- Only FA26 / WI27 / SP27 are emitted. ECE's `SU27 (TBD)` and COGS's `Summer 1/2` columns are skipped
  (no session code can be derived; COGS's summer columns are entirely blank today).
- COGS blank cells are `not_offered` by analogy with CSE/ECE; the COGS page does not state a blank-cell
  rule, only "These are tentative schedules. Classes and/or instructors may change or be canceled." (in
  `disclaimer`). Treat COGS `not_offered` as weaker evidence than CSE/ECE.
- COGS lists `COGS 18 / 108 / 160` once per section (`A00`, `B00`); rows merge per course (offered if any
  section has a name).

## Source-fidelity findings (why the pipeline looks the way it does)

- **MATH is parsed from the page HTML, not Tavily's markdown.** Tavily drops empty `<td></td>` cells, so a
  course with one lecture per year (116 of 175 MATH courses) cannot be placed in a quarter: `MATH 31A`
  (Fall) and `MATH 31B` (Winter) render identically. `data/offerings/raw-math-2026-27.md` is kept only as
  the record of that; the parser reads `raw-math-2026-27.html`. Two fetches hashed identically, so the
  content hash gate works on the whole document.
- **ECE via Tavily is status-faithful**: 0 of 555 cells differ in blank/non-blank between the HTML and the
  markdown. 7 graduate special-topics cells (ECE 283/284/285/287) lose the instructor name before a
  parenthetical topic (`KANG (Low-power VLSI …)` → `(Low-power VLSI …)`); status unaffected.
- **COGS**: the "COGS Course Offerings 2026-27" accordion is a published Google Sheet iframe (gid
  866922720) like CSE's; Tavily `/extract` returns only the accordion heading. `sources.json` now marks
  COGS as `page-with-google-sheet`. The second iframe (gid 1868356496) is DSGN, not covered.
- Node's `fetch` hit one connect timeout to docs.google.com and succeeded on retry; `discoverSource`
  retries a direct fetch once.

## Tavily usage today (from `usage.credits`)

5 calls, 4 credits: `/search` CSE (1), MATH (1), COGS (1); two basic `/extract` calls while COGS was still
treated as an index page — the index (0 credits) and the accordion link target `index.html#` (1 credit) —
both discarded because the accordion content is not in the extract. Fixtures kept under `fixtures/tavily/`
are the three searches; ECE's `/extract` was not run live (raw markdown already on disk) and is covered by a
stub in tests.
