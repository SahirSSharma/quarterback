// Impact stub: deterministic and $0, per DESIGN.md. The engine owner replaces this with lib/engine's
// impact(); the rich fixture covers each demo's headline course, everything else is derived here.
import type { Action, Impact, StudentState } from '@/lib/types';
import { deadlinesFor } from '@/app/lib/deadlines';
import { fixtureFor } from './mock';

export function computeImpact(state: StudentState, action: Action, now = new Date()): Impact | null {
  const current = state.courses.filter((c) => c.term === state.currentTerm && c.status === 'wip');
  const course = current.find((c) => c.code === action.course);
  if (!course) return null;
  const fixture = fixtureFor(state);
  const deadlines = deadlinesFor(state.currentTerm, now);
  const rich = fixture.impacts[`${action.kind}:${action.course}`];
  if (rich) return { ...rich, action, deadlines };

  const unitsNow = current.reduce((s, c) => s + c.units, 0);
  const unitsAfter = action.kind === 'drop' ? unitsNow - course.units : unitsNow;
  const rule = fixture.pnp[course.code] ?? { pnpAllowed: 'unknown' as const, pnpNote: 'Your requirement file does not state a grading rule for this course. Check with your department.' };
  // Without blocks the longest remaining chain is unchanged; the headline impact carries the baseline.
  const chain = Object.values(fixture.impacts)[0]?.chainQuartersBefore ?? 0;
  const base: Impact = {
    action,
    course: { code: course.code, title: course.title, units: course.units },
    blocks: [],
    unitsAfter,
    fullTimeFloor: 12,
    belowFullTime: unitsAfter < 12,
    pnpAllowed: rule.pnpAllowed,
    pnpNote: rule.pnpNote,
    deadlines,
    progressDelta: [],
    chainQuartersBefore: chain,
    chainQuartersAfter: chain,
    graduationRisk: 'none',
    notes: [],
  };
  if (action.kind === 'keep') {
    base.notes.push(`Keeping ${course.code} changes nothing about your plan.`);
  } else if (action.kind === 'pnp') {
    if (rule.pnpAllowed === 'no' && rule.bucket) {
      base.progressDelta.push({ bucket: rule.bucket.name, band: rule.bucket.band, before: 1, after: 0, needed: 1 });
    }
    base.notes.push('A grade of P still satisfies prerequisites, so nothing downstream is blocked.');
    if (rule.pnpAllowed === 'yes') base.notes.push('Units stay the same; your GPA is unaffected either way.');
  } else {
    base.notes.push(`No course in your requirement set lists ${course.code} as a prerequisite.`);
    if (base.belowFullTime) base.notes.push(`${unitsAfter} units is below the 12-unit full-time floor; financial aid, housing and visa status can depend on it.`);
    else if (unitsAfter === 12) base.notes.push('12 units after the drop is exactly the full-time floor.');
  }
  return base;
}
