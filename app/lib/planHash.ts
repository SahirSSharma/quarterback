// Short, stable fingerprint of a plan's course placement, shown next to the approval so the student
// can match what TritonPlan imports. Course order inside a term does not change the hash.
import type { PlanTerm } from '@/lib/types';

export function planHash(terms: PlanTerm[]): string {
  const canonical = terms.map((t) => `${t.term}:${[...t.courses].sort().join(',')}`).join('|');
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
