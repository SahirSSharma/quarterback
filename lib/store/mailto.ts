// advisorMailto({ state, plan, impact }) → a mailto: URL the student opens to draft a note to their advisor.
//
// Plain text the student can edit before sending: what they intend to do and by which registrar deadline,
// the planned courses by term, and two questions for the advisor. The body stays under 1,500 characters
// (mail clients truncate long mailto bodies) and uses CRLF line breaks as RFC 6068 asks. No recipient is
// prefilled: the student picks the advisor. Nothing here says how the plan was produced.
import { formatDate } from '../../app/lib/format';
import { label } from '../engine/terms';
import type { Deadline, Impact, Plan, StudentState } from '../types';

export const BODY_LIMIT = 1500;

export function advisorMailto(args: { state: StudentState; plan: Plan; impact: Impact }): string {
  const { state, plan, impact } = args;
  const course = impact.course;
  const courseName = `${course.code}${course.title ? ` (${course.title})` : ''}`;
  const deadline = relevantDeadline(impact);
  const intent =
    impact.action.kind === 'drop' ? `drop ${courseName}`
    : impact.action.kind === 'pnp' ? `switch ${courseName} to P/NP`
    : `keep ${courseName}`;

  const lines = [
    'Hi,',
    '',
    `I am a ${state.college} ${state.major} student. This quarter (${label(state.currentTerm)}) I am planning to ${intent}.`
      + (deadline ? ` The "${deadline.label}" deadline is ${formatDate(deadline.date)}, so I would like to check the plan below with you before then.` : ''),
    '',
    ...(impact.action.kind === 'keep' ? [] : [`After the change I would be at ${impact.unitsAfter} units this quarter${impact.belowFullTime ? ', below the 12-unit full-time floor' : ''}.`]),
    ...(impact.blocks.length ? [`It affects ${impact.blocks.map((b) => `${b.code} (${b.delayQuarters} quarter${b.delayQuarters === 1 ? '' : 's'} later)`).join(', ')}.`] : []),
    '',
    'Planned courses:',
    ...plan.terms.map((t) => `${label(t.term)}: ${t.courses.join(', ')} (${t.units} units)`),
    ...(plan.graduationTerm ? [`Expected graduation: ${label(plan.graduationTerm)}.`] : []),
    '',
    'Two questions:',
    `1. Does this keep me on track to graduate${plan.graduationTerm ? ` in ${label(plan.graduationTerm)}` : ''}, or is there a requirement I am missing?`,
    `2. ${secondQuestion(impact)}`,
    '',
    'Thank you,',
  ];
  const subject = `Checking my plan before the ${deadline ? formatDate(deadline.date) : label(state.currentTerm)} deadline (${course.code})`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(capped(lines))}`;
}

/** The deadline the action hinges on: drop → no-W drop (or W drop once that has passed), P/NP → grading option. */
function relevantDeadline(impact: Impact): Deadline | undefined {
  const by = (key: Deadline['key']) => impact.deadlines.find((d) => d.key === key);
  if (impact.action.kind === 'pnp') return by('changeGradingOption');
  const noW = by('dropWithoutW');
  return noW && !noW.passed ? noW : by('dropWithW') ?? noW;
}

function secondQuestion(impact: Impact): string {
  const code = impact.course.code;
  if (impact.action.kind === 'pnp') {
    return impact.pnpAllowed === 'yes'
      ? `Will a P in ${code} count toward my requirements the same way a letter grade would?`
      : `Will a P in ${code} still count toward my requirements? ${impact.pnpNote}`.trim();
  }
  if (impact.action.kind === 'drop') {
    const first = impact.blocks[0];
    return first
      ? `Is retaking ${code} next quarter the right move, or is there a better sequence for ${impact.blocks.slice(0, 3).map((b) => b.code).join(', ')}?`
      : `Is there anything about dropping ${code} that you would want me to know before the deadline?`;
  }
  return `Is there anything about keeping ${code} at my current load that concerns you?`;
}

/** CRLF-joined body, cut at a line boundary when it would exceed BODY_LIMIT. */
function capped(lines: string[]): string {
  const out: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 2 > BODY_LIMIT - 3) {
      out.push('...');
      break;
    }
    out.push(line);
    length += line.length + 2;
  }
  return out.join('\r\n');
}
