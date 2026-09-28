# Changelog

All notable changes to Quarterback are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are dated rather than versioned until the
first tagged release.

## 2026-09-27

### Added

- Scaffold: Next.js 16 App Router, TypeScript strict, Tailwind 4; MIT `LICENSE`; `NOTICE.md` for the
  vendored TritonPlan modules, the UC San Diego data and the model licences.
- `DESIGN.md`, the plan of record: one-sentence pitch, the three-model Nemotron map on Nebius Token Factory
  with settings and reasons, the user flow, the deterministic core, the Token Factory client contract, agents,
  storage, evaluation plan (E1–E5), Stage 1 compliance, what is deliberately not built, and the decisions log.
- `PROGRESS.md`: four-week schedule to the Oct 30 Devpost deadline, open questions for the author, dated log.
- Public data snapshot under `data/`: General Catalog courses with prerequisites (91 subject files plus a page
  map), 142 major requirement files, 8 college GE files, CAPE average grades for 2,750 courses, the Fall 2026
  Schedule of Classes, the 2026–27 Enrollment and Registration Calendar, and department tentative-offering
  sources (CSE, MATH, ECE, COGS) with raw captures for CSE, MATH and ECE.
- `lib/vendor/tritonplan/`: seven pure engine modules copied from TritonPlan (requirements engine and
  progress, academic-history parser, program matching, AP/IB credit, record reconciliation, quarter
  arithmetic).
- Vitest test runner (`npm test`) with data-snapshot smoke tests; `engines.node >= 24`.
- Shared contracts in `lib/types.ts` (student state, action, impact, offering evidence, plans, verifier,
  verdict, approval, import payload, ledger, trace events); `lib/env.ts` (`.env.local` loader, `QB_MODE`);
  `AGENTS.md` conventions for module owners.
- Public repository at github.com/SahirSSharma/quarterback; Vercel project `quarterback` linked, API keys set
  for preview, production and development; deployment protection set to preview-only so the production alias
  is public for judges.
- Documentation pass: `README.md` (problem, what the student gets, model table, deterministic veto, Tavily
  uses, local setup, evaluation placeholders, data sources, Stage 1 mapping), `CHANGELOG.md`,
  `devpost/SUBMISSION.md`, `devpost/feedback.md`, `devpost/VIDEO.md`, `devpost/GALLERY.md`,
  `notes/stage1-checklist.md`, and `devpost/docs.test.ts` (docs consistency checks, run with
  `node --test devpost/docs.test.ts`).

### Fixed

- Smoke test: `data/majors/index.json` and `uncovered.json` are registries, not major files; 142 majors carry
  `buckets`.

### Known issues

- The first deployment of the new Vercel project landed as Production despite `--target=preview` (the flag is
  honoured from the second deploy on). The production alias `quarterback-delta.vercel.app` therefore serves the
  empty Next.js scaffold, and at last check returned a `MIDDLEWARE_INVOCATION_FAILED` 500 while the deployment
  URL itself served 200. Under investigation.
- `npx tsc --noEmit` reports `Cannot find name 'LayoutProps'` in `app/layout.tsx` until a `next build` has
  generated `.next/types`.
