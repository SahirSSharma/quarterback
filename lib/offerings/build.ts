// The shared offerings evidence file: data/offerings/<DEPT>.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { OfferingEvidence, TermCode } from '../types';
import { termOrder } from './normalize';

export interface OfferingsFile {
  dept: string;
  sourceUrl: string;
  fetchedAt: string;
  /** sha256 of the raw source text (CSV, HTML or markdown) the rows were parsed from. */
  contentHash: string;
  /** The page's own caveat, verbatim (e.g. CSE: "This page is tentative and subject to change."). */
  disclaimer?: string;
  terms: TermCode[];
  rows: OfferingEvidence[];
}

export const DEFAULT_DIR = 'data/offerings';

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildOfferingsFile(
  dept: string,
  rows: OfferingEvidence[],
  meta: { sourceUrl: string; fetchedAt: string; contentHash: string; disclaimer?: string },
): OfferingsFile {
  const terms = [...new Set(rows.map((r) => r.term))].sort((a, b) => termOrder(a) - termOrder(b));
  return {
    dept,
    sourceUrl: meta.sourceUrl,
    fetchedAt: meta.fetchedAt,
    contentHash: meta.contentHash,
    ...(meta.disclaimer ? { disclaimer: meta.disclaimer } : {}),
    terms,
    rows,
  };
}

export function offeringsPath(dept: string, dir = DEFAULT_DIR): string {
  return path.resolve(process.cwd(), dir, `${dept}.json`);
}

export function writeOfferingsFile(file: OfferingsFile, dir = DEFAULT_DIR): string {
  const p = offeringsPath(file.dept, dir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(file, null, 2) + '\n');
  return p;
}

export function readOfferingsFile(dept: string, dir = DEFAULT_DIR): OfferingsFile | null {
  const p = offeringsPath(dept, dir);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as OfferingsFile) : null;
}
