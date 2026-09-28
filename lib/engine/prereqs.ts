// Prerequisite graph over the catalog: `prereqs` is an AND of OR-groups. Nothing is patched in code — the graph
// reads catalogByCode(), where the hand-checked rows in data/catalog-overrides.json replace mis-parsed groups
// (see notes/engine-fixes.md).
import type { CourseCode } from '../types';
import { catalogByCode, normalizeCode } from './data';

/** AND-of-OR groups for a course; [] when the catalog lists none or the course is unknown. */
export function prereqGroups(code: CourseCode): string[][] {
  return catalogByCode().get(normalizeCode(code))?.prereqs ?? [];
}

const groupMet = (group: string[], earned: Set<CourseCode>) => group.some((m) => earned.has(m));

export function satisfied(code: CourseCode, earned: Set<CourseCode>): boolean {
  return prereqGroups(code).every((g) => groupMet(g, earned));
}

/** The OR-groups with no member in `earned`. */
export function missingGroups(code: CourseCode, earned: Set<CourseCode>): string[][] {
  return prereqGroups(code).filter((g) => !groupMet(g, earned));
}

let reverse: Map<CourseCode, CourseCode[]> | null = null;
function reverseIndex(): Map<CourseCode, CourseCode[]> {
  if (reverse) return reverse;
  reverse = new Map();
  for (const c of catalogByCode().values()) {
    const seen = new Set<string>();
    for (const g of c.prereqs) for (const m of g) {
      if (seen.has(m)) continue;
      seen.add(m);
      const list = reverse.get(m) ?? [];
      list.push(c.code);
      reverse.set(m, list);
    }
  }
  for (const list of reverse.values()) list.sort();
  return reverse;
}

/** Courses whose prerequisites mention `code`, sorted. */
export function dependents(code: CourseCode): CourseCode[] {
  return reverseIndex().get(normalizeCode(code)) ?? [];
}

/**
 * Every course downstream of `code`, breadth-first (direct dependents first). `within` filters the RESULT,
 * not the walk: a course two steps away is still blocked when the middle course is outside the set.
 */
export function transitiveDependents(code: CourseCode, within?: Set<CourseCode>): CourseCode[] {
  const start = normalizeCode(code);
  const seen = new Set<CourseCode>([start]);
  const out: CourseCode[] = [];
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() as CourseCode;
    for (const d of dependents(cur)) {
      if (seen.has(d)) continue;
      seen.add(d);
      queue.push(d);
      if (!within || within.has(d)) out.push(d);
    }
  }
  return out;
}

/** Direct dependents that `code` completes the prerequisites for, given what is already earned. */
export function unlocks(code: CourseCode, earned: Set<CourseCode>): CourseCode[] {
  const withIt = new Set(earned);
  withIt.add(normalizeCode(code));
  return dependents(code).filter((d) => !earned.has(d) && !satisfied(d, earned) && satisfied(d, withIt));
}

/**
 * Quarters needed to reach `code` from `earned`: 0 when earned, otherwise one quarter for the course itself
 * plus the longest of its unmet groups, each group taking its quickest member. Cycles in the data are cut.
 */
export function chainQuarters(code: CourseCode, earned: Set<CourseCode>, visiting = new Set<CourseCode>()): number {
  const c = normalizeCode(code);
  if (earned.has(c)) return 0;
  if (visiting.has(c)) return 0;
  visiting.add(c);
  let deepest = 0;
  for (const g of missingGroups(c, earned)) {
    let best = Infinity;
    for (const m of g) best = Math.min(best, chainQuarters(m, earned, visiting));
    if (best !== Infinity) deepest = Math.max(deepest, best);
  }
  visiting.delete(c);
  return 1 + deepest;
}

/** The longest chainQuarters() over the targets — how many quarters the slowest of them needs. */
export function longestRemainingChain(targets: Iterable<CourseCode>, earned: Set<CourseCode>): number {
  let longest = 0;
  for (const t of targets) longest = Math.max(longest, chainQuarters(t, earned));
  return longest;
}
