// No recorded draft carries offering evidence yet (notes/app.md), so the evidence rendering is pinned here with
// react-dom/server, which the app already depends on.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OfferingEvidence, VerifierReport, Violation } from '@/lib/types';
import { draftLabel, RejectedDrafts } from './RejectedDrafts';

const evidence: OfferingEvidence = {
  course: 'CSE 100', term: 'WI27', status: 'not_offered', source: 'department-page',
  quote: 'CSE-100,Advanced Data Structures,,,Staff',
  url: 'https://docs.google.com/spreadsheets/d/abc/pub?output=csv',
  fetchedAt: '2026-09-27T18:04:00.000Z',
};
const report = (violations: Violation[]): VerifierReport => ({ planId: 'p-fastest-2', ok: false, violations });
const html = (reports: VerifierReport[]) => renderToStaticMarkup(createElement(RejectedDrafts, { reports }));

describe('RejectedDrafts', () => {
  it('renders nothing when every report passed', () => {
    expect(html([{ planId: 'p-balanced', ok: true, violations: [] }])).toBe('');
  });

  it('quotes the department row with its source and fetch date when a violation carries evidence', () => {
    const v: Violation = { rule: 'not-offered', severity: 'error', course: 'CSE 100', term: 'WI27', message: 'CSE 100 is not offered in WI27: "…" (url, fetched …).', evidence };
    const out = html([report([v])]);
    expect(out).toContain('Fastest draft');
    expect(out).toContain('not-offered');
    expect(out).toContain('CSE-100,Advanced Data Structures,,,Staff');
    expect(out).toContain('href="https://docs.google.com/spreadsheets/d/abc/pub?output=csv"');
    expect(out).toContain('docs.google.com');
    expect(out).toContain('fetched Sep 27, 2026');
    expect(out).not.toContain('is not offered in WI27:'); // the quote is shown once, not as prose and again as a figure
  });

  it('falls back to the verifier message when there is no evidence, and skips warnings', () => {
    const out = html([report([
      { rule: 'already-earned', severity: 'error', course: 'CSE 89', term: 'WI27', message: 'CSE 89 is already earned (A, FA25).' },
      { rule: 'assumed-offered', severity: 'warning', course: 'CSE 30', term: 'SP27', message: 'no evidence' },
    ])]);
    expect(out).toContain('CSE 89 is already earned (A, FA25).');
    expect(out).toContain('1 draft failed a check');
    expect(out).not.toContain('assumed-offered');
    expect(out).not.toContain('<figure');
  });

  it('names the strategy behind a repaired draft id', () => {
    expect(draftLabel('p-fastest-2')).toBe('Fastest');
    expect(draftLabel('p-lightest')).toBe('Lightest');
  });
});
