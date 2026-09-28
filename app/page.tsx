import Link from 'next/link';
import { demoCards } from '@/app/api/_lib/mock';
import { currentTermFromCalendar, deadlinesFor } from '@/app/lib/deadlines';
import { formatDate, termName } from '@/app/lib/format';
import { PasteForm } from './components/PasteForm';
import { DeadlineChips } from './components/DeadlineChips';
import { Card } from './components/ui';

// Deadline chips count days from now; never let the build freeze them.
export const dynamic = 'force-dynamic';

export default function Start() {
  const now = new Date();
  const term = currentTermFromCalendar(now);
  const deadlines = deadlinesFor(term, now);
  const noW = deadlines.find((d) => d.key === 'dropWithoutW');

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
      <section className="py-12 sm:py-16 lg:py-20">
        <p className="text-sm font-medium text-accent">{termName(term)} · UC San Diego undergraduates</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-6xl">
          Before you drop a class, know what it costs you.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-ink-2">
          Pick the class. See every course it blocks and when they run next, your units and P/NP options, and a
          re-plan that has been checked against your degree{noW ? ` — before the ${formatDate(noW.date)} deadline` : ''}.
        </p>
        <div className="mt-6">
          <DeadlineChips deadlines={deadlines} now={now} />
        </div>
      </section>

      <section aria-labelledby="start" className="grid gap-6 pb-16 lg:grid-cols-2">
        <h2 id="start" className="sr-only">Start</h2>
        <Card className="flex flex-col">
          <PasteForm />
        </Card>
        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">Or try a demo student</h3>
          <ul className="flex flex-col gap-2">
            {demoCards.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/plan?demo=${c.id}&course=${encodeURIComponent(c.headline.course)}&action=${c.headline.kind}`}
                  className="group block rounded-lg border border-line bg-bg px-4 py-3 transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                >
                  <span className="block text-sm font-medium text-ink group-hover:text-accent-2">{c.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-2">{c.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-2 text-xs text-ink-3">Demo records are synthetic. No real student is shown.</p>
        </Card>
        <p className="text-sm text-ink-2 lg:col-span-2">
          Runs on <span className="font-medium text-ink">Nebius Token Factory</span> with <span className="font-medium text-ink">NVIDIA Nemotron</span> 3.5 Lightning, 3 Super and 3 Ultra. Every model call is shown in the trace with its time, tokens and cost.
        </p>
      </section>

      <section aria-labelledby="how" className="border-t border-line py-14">
        <h2 id="how" className="text-sm font-medium text-ink-2">How it works</h2>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3">
          {[
            ['Impact', 'The courses your class unlocks or blocks, when each runs next according to its department, your units against the 12-unit floor, and whether P/NP counts.'],
            ['Plans the code checks', 'Up to three re-plans for the next three quarters. Each one passes prerequisite, offering, unit and progress checks, or it is not shown.'],
            ['Approve and send', 'You approve. Then send it to TritonPlan, add the dates to your calendar, or draft a note to your advisor.'],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-2 text-sm font-semibold text-ink">
                {i + 1}
              </span>
              <div>
                <h3 className="font-medium text-ink">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
