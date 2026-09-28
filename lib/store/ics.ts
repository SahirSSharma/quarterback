// icsFor(run, approval) → RFC 5545 text for the approved plan.
//
// Events, all all-day: the current term's registrar deadlines (data/registrar-calendar.json via
// lib/engine/terms), then one event per planned course per term on that term's first day of instruction.
// A term the calendar does not cover yet gets no events; an `X-QB-NOTE` calendar line says so. Verifier
// flags for a course/term and the critic's refusal evidence for the plan appear as DESCRIPTION lines on the
// course's event. DTSTAMP is the approval time, so the same approval always yields the same file.
//
// icsEscape() and foldLine() are reused from app/lib/ics.ts (pure, no React); the all-day event builder is
// re-implemented here because that module's version is private and emits one event per term, not per course.
import { foldLine, icsEscape } from '../../app/lib/ics';
import type { RunRecord } from '../../app/lib/contracts';
import { registrarCalendar } from '../engine/data';
import { deadlinesFor, label } from '../engine/terms';
import type { ApprovalRecord } from '../types';

export function icsFor(run: RunRecord, approval: ApprovalRecord): string {
  const plan = run.plans.find((p) => p.id === approval.planId);
  if (!plan) throw new Error(`Approval ${approval.id} names unknown plan ${approval.planId}`);
  const stamp = approval.at.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const violations = run.reports.find((r) => r.planId === plan.id)?.violations ?? [];
  const refusal = run.verdict?.refused.find((r) => r.planId === plan.id);
  const planName = `${plan.label[0].toUpperCase()}${plan.label.slice(1)} plan`;

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Quarterback//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Quarterback'];
  const notes: string[] = [];

  for (const d of deadlinesFor(run.state.currentTerm, approval.at)) {
    lines.push(...event(`${approval.id}-${d.term}-${d.key}@quarterback`, stamp, d.date, `${d.label} — ${label(d.term)}`, [
      'Deadline is 11:59 p.m. PT. Source: UC San Diego Enrollment Calendar.',
    ]));
  }

  for (const t of plan.terms) {
    const start = registrarCalendar().terms[t.term]?.instructionBegins;
    if (!start) {
      notes.push(`${label(t.term)} is not on the registrar calendar yet; its ${t.courses.length} planned courses have no dates.`);
      continue;
    }
    for (const code of t.courses) {
      const description = [`${planName}: ${t.courses.join(', ')} (${t.units} units). First day of instruction.`];
      for (const v of violations) {
        if (v.course === code && (!v.term || v.term === t.term)) description.push(`Flag (${v.rule}): ${v.message}`);
      }
      for (const e of refusal?.evidence ?? []) {
        if (e.course === code && e.term === t.term) description.push(`Refused: ${refusal!.reason} Source: "${e.quote}" ${e.url}`);
      }
      lines.push(...event(`${approval.id}-${t.term}-${code.replace(/\s+/g, '')}@quarterback`, stamp, start, `${code} — ${label(t.term)}`, description));
    }
  }

  for (const n of notes) lines.push(`X-QB-NOTE:${icsEscape(n)}`);
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function event(uid: string, stamp: string, date: string, summary: string, description: string[]): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${nextDay(date).replace(/-/g, '')}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description.join('\n'))}`,
    'END:VEVENT',
  ];
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
