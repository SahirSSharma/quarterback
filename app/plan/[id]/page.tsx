import type { Metadata } from 'next';
import { PlanFlow } from '../../components/PlanFlow';

export const metadata: Metadata = { title: 'Saved plan' };

export default async function SavedPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanFlow key={id} savedId={id} />;
}
