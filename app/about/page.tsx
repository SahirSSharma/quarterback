import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveFigures } from '../components/LiveFigures';

export const metadata: Metadata = { title: 'About' };

const sources: [string, string, string][] = [
  ['Enrollment and Registration Calendar 2026–27', 'https://blink.ucsd.edu/instructors/courses/enrollment/calendars/2026.html', 'Drop, W and grading-option deadlines for every quarter.'],
  ['CSE tentative course offerings', 'https://cse.ucsd.edu/undergraduate/tentative-course-offerings', 'Which CSE courses run in Fall, Winter and Spring, by instructor.'],
  ['Mathematics planned course offerings', 'https://math.ucsd.edu/students/planned-course-offerings?year=2026-2027', 'Same for MATH.'],
  ['ECE tentative course list', 'https://ece.ucsd.edu/ece-tentative-course-list', 'Same for ECE.'],
  ['Cognitive Science course offerings', 'https://cogsci.ucsd.edu/undergraduates/courses/index.html', 'Same for COGS and DSGN.'],
  ['UC San Diego General Catalog', 'https://catalog.ucsd.edu/', 'Prerequisites, titles, units, major and college requirements.'],
  ['TritonPlan', 'https://tritonplan.com', 'The degree planner an approved plan is sent to.'],
];

export default function About() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">About Quarterback</h1>
      <p className="mt-4 text-lg leading-8 text-ink-2">
        A few days before the drop deadline, students guess. Quarterback replaces the guess with the actual consequences of
        dropping, switching to P/NP or keeping a class, and with a re-plan that has been checked before you see it.
      </p>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 leading-7 text-ink-2">
          <li>Your Academic History is parsed into courses, terms, units and grades, then matched to your major and college requirement files.</li>
          <li>The <strong className="text-ink">impact</strong> is computed from the prerequisite graph, department offering pages, the registrar calendar and your requirement progress. No model is involved and it costs nothing.</li>
          <li>A planner proposes up to three re-plans. A deterministic <strong className="text-ink">verifier</strong> checks every one: prerequisites by the term they are needed, offering status, unit floor and cap, duplicates, courses already earned, double counting and whether graduation is still feasible. A plan that fails is never shown; the rejected drafts are listed with the rule that failed and, for an offering rule, the department page’s own row.</li>
          <li>A <strong className="text-ink">stress-test</strong> reads the surviving plans against the offering evidence and either recommends one or refuses one, quoting the department page line, its URL and when it was fetched. Overriding a refusal means typing “I understand” and a reason, and it is recorded.</li>
          <li>You <strong className="text-ink">approve</strong>. Only then can a plan be sent to TritonPlan, downloaded as a calendar file, or drafted into an advisor email.</li>
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Which model does what, and why</h2>
        <p className="mt-3 leading-7 text-ink-2">
          Three NVIDIA Nemotron models run on Nebius Token Factory. The trace panel and ledger name each call with its time, tokens, cost and
          cache hits; cache hits were measured only on Lightning, whose shared prompt prefix is served from the cache. Measured live, a re-plan
          costs about 2.5 cents per student and takes 27 seconds at the median.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wide text-ink-3">
              <tr><th className="px-4 py-2 font-medium">Role</th><th className="px-4 py-2 font-medium">Model</th><th className="px-4 py-2 font-medium">Why</th></tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-2">
              <tr><td className="px-4 py-3 font-medium text-ink">Draft, read and explain</td><td className="px-4 py-3 font-mono text-xs">nvidia/Nemotron-3_5-Lightning</td><td className="px-4 py-3">Drafts the three plans in parallel with reasoning off, so its tool calls are always valid and the shared prompt prefix is served from the cache; answers “why not this course?” in about a second; reads a pasted record the parser could not.</td></tr>
              <tr><td className="px-4 py-3 font-medium text-ink">Repair</td><td className="px-4 py-3 font-mono text-xs">nvidia/nemotron-3-super-120b-a12b</td><td className="px-4 py-3">Repairs a draft the verifier rejected, with reasoning off, choosing replacements from a menu the code computed under the verifier’s own rules.</td></tr>
              <tr><td className="px-4 py-3 font-medium text-ink">Stress-test</td><td className="px-4 py-3 font-mono text-xs">nvidia/Nemotron-3-Ultra-550b-a55b</td><td className="px-4 py-3">Judges cross-quarter feasibility under uncertainty with reasoning effort set high. It is the only expensive call, so it runs once, on your click.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="spend">
        <h2 id="spend" className="text-xl font-semibold tracking-tight">What it has spent</h2>
        <p className="mt-3 leading-7 text-ink-2">
          Live figures: every model call this deployment has made, priced from the registry, against its daily and total caps.
          When a cap is reached, demo students show their recorded run instead.
        </p>
        <div className="mt-4"><LiveFigures /></div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">What it does not do</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-ink-2">
          <li>No chatbot. You pick a class and an action; the answers are cards, not a conversation.</li>
          <li>No retrieval index. Your record and the relevant requirement files fit in context, so nothing is summarised or searched approximately.</li>
          <li>No guessing about facts the engine knows. Prerequisites, units, deadlines and requirement progress come from code and data, never from a model.</li>
          <li>No grade prediction and no advice about whether you should drop. It shows consequences; the decision stays yours.</li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Data sources</h2>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {sources.map(([name, url, note]) => (
            <li key={url} className="px-4 py-3">
              <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">{name}</a>
              <p className="text-sm text-ink-2">{note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Privacy</h2>
        <p className="mt-3 leading-7 text-ink-2">
          Your record is kept only as part of this plan and only until you delete it; Save adds a share link. The plan’s run
          record, with your parsed record inside it, is written when Re-plan starts; “Delete my data” removes it along with its
          trace, its approvals and any saved copy. No accounts, no tracking of individuals, and the public repository contains
          only public data.
        </p>
      </section>

      <p className="mt-12 text-sm text-ink-3">
        <Link href="/" className="text-accent underline-offset-2 hover:underline">Back to start</Link>
      </p>
    </article>
  );
}
