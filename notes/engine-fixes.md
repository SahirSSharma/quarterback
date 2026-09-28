# Engine fixes — follow-up pass on lib/engine and data/ (2026-09-27)

What changed, what was deliberately left alone, and the defect description for the upstream TritonPlan
catalog parser. `notes/engine.md` is the engine owner's original request list; the items below resolve it.

## 1. Catalog prerequisite parse defects (class, not case)

`data/catalog/*.json` and `data/catalog/prereqs-structured.json` carry `prereqs` (AND of OR-groups) derived
from `prereqText` by TritonPlan's catalog parser (built 2026-07-25). `scripts/audit-prereqs.ts` scans every
course (15,249 records; 5,616 with `prereqText`; 2,253 with groups) for two classes and prints each hit with
its full text and whether `data/catalog-overrides.json` covers it:

    node --import ./scripts/node-ts.ts scripts/audit-prereqs.ts

**(a) Groups from a non-prerequisite clause** — 3 hits. The parser keeps extracting course codes past the
`;` or `(` that ends the prerequisite list, into clauses such as "two units of credit offered for X if Y
taken previously", "students may not receive credit for …", "renumbered from …", "(formerly …)", and emits
each stray code as its own AND-group. Effect: the prerequisite becomes stricter than the catalog says. In the
demo, retaking CSE 29 after dropping it was `prereq-unsatisfied` (CSE 15L "required") and
`chainQuarters('CSE 29')` was 2 instead of 1.

**(b) Non-standard course mentions the groups omit** — 8 hits. The code matcher is case- and
space-sensitive: `Math 20C`, `Phil 209A`, `JWSP103`, `CoSE 230A`, `MATH 31 AH`, `MATH 20 C` are dropped.
Effect: an OR-group is silently narrowed (MATH 180A became MATH 31BH-only; DSC 123A requires a nonexistent
"MATH 31"; ECON 109 requires a nonexistent "MATH 20", so nobody can satisfy it), or the prerequisite vanishes
(ERC 89 has none).

### Overrides applied (`data/catalog-overrides.json`, read by `catalogByCode()`; override wins)

Each one hand-checked against the row's `prereqText`:

| Course | Snapshot | Override | Why |
|---|---|---|---|
| CSE 29 | `[[CSE 11,CSE 8B,ECE 15],[CSE 15L]]` | `[[CSE 11,CSE 8B,ECE 15]]` | "two units of credit offered … if CSE 15L taken previously" is a credit note |
| MATH 180A | `[[MATH 31BH]]` | `[[MATH 20C,MATH 31BH]]` | "Math 20C or MATH 31BH" |
| MATH 174 | `[[MATH 21D],[MATH 20F,MATH 31AH]]` | `[[MATH 20D,MATH 21D],[MATH 20F,MATH 31AH]]` | "Math 20D or MATH 21D, and either MATH 20F or MATH 31AH" |
| COGR 225D | `[[COGR 225A,HIGR 238,SOCG 255A]]` | `[[COGR 225A,HIGR 238,PHIL 209A,SOCG 255A]]` | "COGR 225A, HIGR 238, Phil 209A, or SOCG 255A" — one OR list |
| ERC 89 | none | `[[MATH 10A,MATH 20A]]` | "Math 10A or 20A." |
| MUS 177 | `[[MUS 172],[MUS 161]]` | `[[MUS 172,MUS 161]]` | "MUS 172 (formerly MUS 161)": the same course under its old number, not a second requirement |
| DSC 123A | `[[MATH 20C,MATH 31BH],[MATH 18,MATH 31]]` | `[[MATH 20C,MATH 31BH],[MATH 18,MATH 31AH]]` | "MATH 31 AH" is MATH 31AH; there is no MATH 31 |
| ECON 109 | `[[ECON 100C,MATH 31CH,MATH 109,CSE 20],[MATH 20]]` | `[[ECON 100C,MATH 31CH,MATH 109,CSE 20],[ECON 100C,MATH 31CH,MATH 109,MATH 20C]]` | "A or B or C or (CSE 20 and MATH 20 C)" distributed into AND-of-OR; "MATH 20 C" is MATH 20C |

### Flagged but left out (not unambiguous from the text)

- **EDS 22S** `[[EDS 22]]` — the audit trips on "students who have completed", but the sentence is a real
  enrollment restriction ("enrollment will be limited to students who have completed EDS 22"), so the group
  is right. Kept as is.
- **JWSP 196A** — "JWSP 100, JWSP103, HITO 104, HITO 105;" — the parser dropped `JWSP103`, but whether the
  semicolon list is AND or OR is not stated. Left as the snapshot has it.
- **COSE 230B** — "three instances of CoSE 230A successfully completed" — a repeat count the AND-of-OR shape
  cannot express. Left with no groups.

The raw files are untouched: `catalogEntries()` still returns the snapshot as scraped (the audit reads it),
`catalogByCode()` swaps in the override. Tests: `data.test.ts` asserts CSE 29 and MATH 180A and that every
override names a catalog course; `prereqs.test.ts` has `chainQuarters('CSE 29') === 1`; `verifier.test.ts`
checks that demo (a) can retake CSE 29 in WI27 without `prereq-unsatisfied`.

### For the upstream TritonPlan parser (`prereqs-structured.json`, built 2026-07-25)

1. Stop extracting codes at the first clause boundary (`;`, `.`, or an opening parenthesis) that is followed
   by a non-prerequisite phrase: `credit (offered|given)`, `no credit`, `taken previously`, `previously or
   concurrently`, `may not receive credit`, `renumbered from`, `formerly`. Codes after it are notes, not
   groups.
2. Match course codes case-insensitively and tolerate a missing or extra space between subject and number
   and between number and suffix (`Math 20C`, `JWSP103`, `MATH 31 AH`), then normalize to `SUBJ NUM`.
3. `(formerly X)` after a code means the same course under an old number: add X to that code's OR-group.
4. A parenthesised `and` inside an `or` list needs distribution into AND-of-OR (ECON 109), or a flag that the
   row could not be represented, rather than a stray single-member group.

## 2. `PlanTerm.partTime` — resolved

`lib/types.ts` now has `partTime?: boolean`. `verifier.ts` reads `t.partTime` directly; the structural
`PlanTermExt` cast is gone. `verifier.test.ts` builds plans as `PlanTerm[]` (a compile-time check) and asserts
`partTime: true` waives `unit-floor`, `partTime: false` does not.

## 3. `OfferingEvidence.source` for "no evidence at all" — resolved by documentation, type unchanged

`offeringStatus()` returns `{ status: 'unknown', source: 'cape-history', quote: '<code>: no source found — no
department page row, no <term> section, no CAPE history', url: <CAPE URL> }` for a course with no department
row, no section for the term and no CAPE row. `source` has no legal value for "nothing", so `'cape-history'`
(the last source consulted, with its URL) stands in and the quote is the discriminator: it starts with
`no source found`. Consumers that need to tell the two apart read the quote; the type is unchanged.

## 4. Golden `lib/engine/fixtures/impact-demo-a.golden.json` — unchanged

The CSE 29 fix does not move demo (a)'s impact card: after the drop, CSE 30's earliest term is bounded by
CSE 15L (WI27 → CSE 30 in SP27), not by CSE 29's chain, so `delayQuarters` stays 1; the longest remaining
chain (2 → 2) runs through other courses. The golden test passes against the recorded file without `-u`.
