import type { Deadline } from '@/lib/types';
import { daysUntil, formatDate } from '@/app/lib/format';

export function DeadlineChips({ deadlines, now = new Date() }: { deadlines: Deadline[]; now?: Date }) {
  if (deadlines.length === 0) return <p className="text-sm text-ink-3">No deadlines on file for this term.</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Deadlines this term">
      {deadlines.map((d) => {
        const days = daysUntil(d.date, now);
        const soon = !d.passed && days <= 7;
        const tone = d.passed
          ? 'border-line bg-bg text-ink-3 line-through decoration-ink-3/60'
          : soon
            ? 'border-danger/30 bg-danger-soft text-danger'
            : 'border-line-2 bg-surface text-ink';
        return (
          <li key={d.key} className={`inline-flex items-baseline gap-x-1.5 rounded-full border px-3 py-1 text-sm ${tone}`}>
            <span className="font-medium">{d.label}</span>
            <span className={d.passed ? '' : 'text-ink-2'}>{formatDate(d.date)}</span>
            <span className="text-xs">{d.passed ? '· passed' : days === 0 ? '· today' : `· in ${days} day${days === 1 ? '' : 's'}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
