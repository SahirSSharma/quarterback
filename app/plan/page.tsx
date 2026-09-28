import type { Metadata } from 'next';
import type { Action } from '@/lib/types';
import type { DemoId } from '@/app/lib/contracts';
import { PlanFlow } from '../components/PlanFlow';

export const metadata: Metadata = { title: 'Plan' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /plan?demo=a&course=CSE%2029&action=drop — every state is reachable by URL. */
export default async function PlanPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const demoRaw = one(sp.demo);
  const demo: DemoId | undefined = demoRaw === 'a' || demoRaw === 'b' || demoRaw === 'c' ? demoRaw : undefined;
  const course = one(sp.course)?.trim().toUpperCase().replace(/\s+/g, ' ') ?? null;
  const actionRaw = one(sp.action);
  const kind: Action['kind'] = actionRaw === 'pnp' || actionRaw === 'keep' ? actionRaw : 'drop';
  return <PlanFlow key={`${demo ?? 'paste'}:${course ?? ''}:${kind}`} demo={demo} initialCourse={course} initialKind={kind} />;
}
