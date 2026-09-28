// Course titles and units from the public catalog snapshot. Plans carry codes only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogTitles } from '@/app/lib/contracts';

const catalogDir = path.join(process.cwd(), 'data/catalog');
const pageMap = JSON.parse(readFileSync(path.join(catalogDir, '_page-map.json'), 'utf8')).map as Record<string, { page: string }>;
const pages = new Map<string, Map<string, { title: string; units: string }>>();

function page(subject: string): Map<string, { title: string; units: string }> {
  const name = pageMap[subject]?.page ?? subject;
  let hit = pages.get(name);
  if (!hit) {
    hit = new Map();
    try {
      const { courses } = JSON.parse(readFileSync(path.join(catalogDir, `${name}.json`), 'utf8')) as { courses: { code: string; title: string; units: string }[] };
      for (const c of courses) hit.set(c.code, { title: c.title, units: c.units });
    } catch {
      // Unknown subject: leave the page empty so lookups miss quietly.
    }
    pages.set(name, hit);
  }
  return hit;
}

export function lookupTitles(codes: string[]): CatalogTitles {
  const out: CatalogTitles = {};
  for (const raw of codes) {
    const code = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    const hit = page(code.split(' ')[0]).get(code);
    if (hit) out[code] = hit;
  }
  return out;
}
