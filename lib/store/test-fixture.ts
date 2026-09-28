// Hand-built records for lib/store tests: small, type-complete, and independent of app/_mock so edits to the
// demo data cannot break these tests. Also a temp-directory store the tests point store() at.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunRecord } from '../../app/lib/contracts';
import { deadlinesFor } from '../engine/terms';
import type { Impact, Plan, StudentState, Verdict, VerifierReport } from '../types';
import { createStore, setStore } from './blob';

export function tempStore(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qb-store-'));
  setStore(createStore({ dir }));
  return {
    dir,
    cleanup() {
      setStore(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const NOW = '2026-09-27T20:00:00.000Z';

export const state: StudentState = {
  college: 'Revelle College',
  collegeFile: 'revelle.json',
  major: 'Artificial Intelligence',
  majors: ['Artificial Intelligence'],
  majorFile: 'cse-ai.json',
  courses: [
    { code: 'CSE 11', term: 'FA25', units: 4, grade: 'A-', status: 'earned' },
    { code: 'CSE 12', term: 'WI26', units: 4, grade: 'B', status: 'earned' },
    { code: 'CSE 29', term: 'FA26', units: 4, grade: null, status: 'wip' },
    { code: 'CSE 101', term: 'FA26', units: 4, grade: null, status: 'wip' },
    { code: 'MATH 18', term: 'FA26', units: 4, grade: null, status: 'wip' },
    { code: 'HUM 4', term: 'FA26', units: 4, grade: null, status: 'wip' },
  ],
  transfer: [],
  gpa: 3.4,
  currentTerm: 'FA26',
  source: 'demo',
  confidence: 'high',
  warnings: [],
};

export const impact: Impact = {
  action: { kind: 'drop', course: 'CSE 29' },
  course: { code: 'CSE 29', title: 'Systems Programming and Software Tools', units: 4 },
  blocks: [
    { code: 'CSE 30', buckets: ['Lower-division core'], nextOffered: 'WI27', evidence: null, delayQuarters: 1 },
    { code: 'CSE 100', buckets: ['Lower-division core'], nextOffered: 'WI27', evidence: null, delayQuarters: 1 },
    { code: 'CSE 150B', buckets: ['AI core'], nextOffered: null, evidence: null, delayQuarters: 3 },
  ],
  unitsAfter: 12,
  fullTimeFloor: 12,
  belowFullTime: false,
  pnpAllowed: 'no',
  pnpNote: 'Major courses must be taken for a letter grade.',
  deadlines: deadlinesFor('FA26', NOW),
  progressDelta: [],
  chainQuartersBefore: 4,
  chainQuartersAfter: 5,
  graduationRisk: 'possible',
  notes: [],
};

export const plans: Plan[] = [
  {
    id: 'p-fastest',
    label: 'fastest',
    terms: [
      { term: 'WI27', courses: ['CSE 29', 'CSE 105', 'CSE 194', 'MATH 183'], units: 16 },
      { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'CSE 151A', 'HUM 5'], units: 16 },
      { term: 'FA27', courses: ['CSE 150B', 'CSE 110'], units: 8 },
    ],
    rationale: 'Front-loads Ethics.',
    graduationTerm: 'WI29',
  },
  {
    id: 'p-balanced',
    label: 'balanced',
    terms: [
      { term: 'WI27', courses: ['CSE 29', 'CSE 105', 'MATH 183', 'HUM 5'], units: 16 },
      { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'CSE 151A', 'COGS 1'], units: 16 },
    ],
    rationale: 'Ethics waits for Fall 2027.',
    graduationTerm: 'SP29',
  },
  {
    id: 'p-broken',
    label: 'lightest',
    terms: [{ term: 'WI27', courses: ['CSE 29'], units: 4 }],
    rationale: 'Below the unit floor.',
    graduationTerm: null,
  },
];

export const reports: VerifierReport[] = [
  {
    planId: 'p-fastest',
    ok: true,
    violations: [{
      rule: 'assumed-offered', severity: 'warning', course: 'CSE 194', term: 'WI27',
      message: 'CSE 194 in Winter 2027 has no instructor on the CSE tentative offerings sheet. The plan assumes it runs.',
    }],
  },
  { planId: 'p-balanced', ok: true, violations: [] },
  { planId: 'p-broken', ok: false, violations: [{ rule: 'unit-floor', severity: 'error', term: 'WI27', message: '4 units is below the 12-unit floor.' }] },
];

export const verdict: Verdict = {
  recommend: 'p-balanced',
  refused: [{
    planId: 'p-fastest',
    reason: 'The fastest plan only saves a quarter if CSE 194 runs in Winter 2027, and the sheet lists no instructor.',
    evidence: [{
      course: 'CSE 194', term: 'WI27', status: 'not_offered',
      quote: 'CSE-194,"Race, Gender, and Computing",Imani Munyaka,,',
      url: 'https://cse.ucsd.edu/undergraduate/tentative-course-offerings',
      fetchedAt: '2026-09-27T17:42:00Z',
      source: 'department-page',
    }],
  }],
  risks: [],
  summary: 'Balanced is the plan whose every course sits in a quarter its department lists it.',
};

export function sampleRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-fixture',
    state,
    action: impact.action,
    impact,
    plans,
    reports,
    rejectedDrafts: 1,
    verdict,
    ledger: [{
      at: NOW, step: 'plan', model: 'nvidia/nemotron-3-super-120b-a12b', ms: 1200,
      promptTokens: 8000, completionTokens: 600, reasoningTokens: 300, cacheHitTokens: 4000, usd: 0.003, replayed: true,
    }],
    approval: null,
    ...overrides,
  };
}
