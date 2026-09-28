// The fixtures are the contract the UI is built against; these checks keep them honest.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { demo, demoIds } from '@/app/api/_lib/mock';
import type { OfferingEvidence } from '@/lib/types';

const root = path.resolve(__dirname, '../..');
const sources: Record<string, string> = {
  'cse.ucsd.edu': readFileSync(path.join(root, 'data/offerings/raw-cse-2026-27.csv'), 'utf8').replace(/\r\n/g, '\n'),
  'math.ucsd.edu': readFileSync(path.join(root, 'data/offerings/raw-math-2026-27.md'), 'utf8'),
};

const pageMap = JSON.parse(readFileSync(path.join(root, 'data/catalog/_page-map.json'), 'utf8')).map as Record<string, { page: string }>;

function catalogUnits(code: string): number | null {
  const subject = code.split(' ')[0];
  const file = path.join(root, 'data/catalog', `${pageMap[subject]?.page ?? subject}.json`);
  const { courses } = JSON.parse(readFileSync(file, 'utf8')) as { courses: { code: string; units: string }[] };
  const hit = courses.find((c) => c.code === code);
  if (!hit || !/^\d+(\.\d+)?$/.test(hit.units)) return null;
  return Number(hit.units);
}

function everyEvidence(id: 'a' | 'b' | 'c'): OfferingEvidence[] {
  const f = demo(id);
  const out: OfferingEvidence[] = [];
  for (const impact of Object.values(f.impacts)) for (const b of impact.blocks) if (b.evidence) out.push(b.evidence);
  for (const r of f.verdict.refused) out.push(...r.evidence);
  return out;
}

describe.each(demoIds)('demo %s', (id) => {
  const f = demo(id);

  it('has a current-term situation to choose from and a headline impact for it', () => {
    const wip = f.state.courses.filter((c) => c.term === f.state.currentTerm && c.status === 'wip');
    expect(wip.length).toBeGreaterThanOrEqual(3);
    expect(wip.map((c) => c.code)).toContain(f.card.headline.course);
    const impact = f.impacts[`${f.card.headline.kind}:${f.card.headline.course}`];
    expect(impact).toBeDefined();
    expect(impact.unitsAfter).toBe(wip.reduce((s, c) => s + c.units, 0) - (f.card.headline.kind === 'drop' ? impact.course.units : 0));
    expect(impact.belowFullTime).toBe(impact.unitsAfter < 12);
    for (const code of wip.map((c) => c.code)) expect(f.pnp[code], `pnp rule for ${code}`).toBeDefined();
  });

  it('shows only plans the verifier passed, each with a report, and recommends one of them', () => {
    const ids = f.plans.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of f.plans) {
      const report = f.reports.find((r) => r.planId === p.id);
      expect(report, `report for ${p.id}`).toBeDefined();
      expect(report!.ok).toBe(true);
      expect(report!.violations.every((v) => v.severity === 'warning')).toBe(true);
    }
    expect(ids).toContain(f.verdict.recommend);
    for (const r of f.verdict.refused) expect(ids).toContain(r.planId);
    expect(f.verdict.refused.map((r) => r.planId)).not.toContain(f.verdict.recommend);
    expect(f.rejectedDrafts).toBeGreaterThan(0);
  });

  it('sums term units from the catalog and never plans a course already earned', () => {
    const earned = new Set(f.state.courses.filter((c) => c.status === 'earned').map((c) => c.code));
    for (const p of f.plans) {
      for (const t of p.terms) {
        const units = t.courses.map(catalogUnits);
        expect(units, `${p.id} ${t.term} ${t.courses.join(',')}`).not.toContain(null);
        expect(units.reduce((s, u) => s! + u!, 0)).toBe(t.units);
        for (const c of t.courses) expect(earned.has(c), `${c} already earned`).toBe(false);
      }
    }
  });

  it('quotes department pages verbatim', () => {
    const evidence = everyEvidence(id);
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      const host = Object.keys(sources).find((h) => e.url.includes(h));
      expect(host, `known source for ${e.url}`).toBeDefined();
      expect(sources[host!].includes(e.quote), `verbatim: ${e.quote}`).toBe(true);
      expect(e.fetchedAt.startsWith('2026-09-27')).toBe(true);
    }
  });

  it('scripts a trace of 8–12 events, ~300–1500 ms apart, that ends with done', () => {
    expect(f.trace.length).toBeGreaterThanOrEqual(8);
    expect(f.trace.length).toBeLessThanOrEqual(12);
    for (const { delayMs } of f.trace) {
      expect(delayMs).toBeGreaterThanOrEqual(300);
      expect(delayMs).toBeLessThanOrEqual(1500);
    }
    expect(f.trace.at(-1)!.event.type).toBe('done');
    expect(f.trace.filter((t) => t.event.type === 'done')).toHaveLength(1);
    const models = f.trace.flatMap((t) => (t.event.type === 'model' ? [t.event.entry.model] : []));
    expect(models.some((m) => /super/i.test(m))).toBe(true);
    expect(models.some((m) => /lightning/i.test(m))).toBe(true);
    expect(/ultra/i.test(f.stressLedger.model)).toBe(true);
  });

  it('prices ledger entries from the published Token Factory rates', () => {
    const rates: [RegExp, number, number][] = [[/lightning/i, 0.06, 0.24], [/super/i, 0.3, 0.9], [/ultra/i, 1, 3]];
    const entries = [...f.trace.flatMap((t) => (t.event.type === 'model' ? [t.event.entry] : [])), f.stressLedger];
    for (const e of entries) {
      const [, inRate, outRate] = rates.find(([re]) => re.test(e.model))!;
      const usd = (e.promptTokens * inRate + (e.completionTokens + e.reasoningTokens) * outRate) / 1e6;
      expect(Math.abs(e.usd - usd), `${e.step} usd`).toBeLessThan(0.00002);
    }
  });
});

it('the Revelle AI demo refuses the fastest plan over a blank Winter 2027 row on the CSE sheet', () => {
  const f = demo('a');
  const refused = f.verdict.refused[0];
  expect(refused.planId).toBe('p-fastest');
  const e = refused.evidence[0];
  expect(e.term).toBe('WI27');
  expect(e.status).toBe('not_offered');
  expect(e.url).toBe('https://cse.ucsd.edu/undergraduate/tentative-course-offerings');
  const fastest = f.plans.find((p) => p.id === 'p-fastest')!;
  expect(fastest.terms.find((t) => t.term === 'WI27')!.courses).toContain(e.course);
  const impact = f.impacts['drop:CSE 29'];
  expect(impact.blocks.map((b) => b.code)).toEqual(expect.arrayContaining(['CSE 30', 'CSE 100']));
});
