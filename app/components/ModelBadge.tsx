import { modelTier } from '@/app/lib/models';

const tones: Record<ReturnType<typeof modelTier>, string> = {
  Lightning: 'bg-bg text-ink-2 ring-line-2',
  Super: 'bg-accent-soft text-accent ring-accent/20',
  Ultra: 'bg-warn-soft text-warn ring-warn/20',
  Other: 'bg-bg text-ink-3 ring-line-2',
};

/** Names the Nemotron tier; the full model id sits in the tooltip and next to it in the ledger. */
export function ModelBadge({ model, showId = false }: { model: string; showId?: boolean }) {
  const tier = modelTier(model);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={model} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tier]}`}>
        Nemotron {tier === 'Other' ? '' : tier}
      </span>
      {showId && <span className="font-mono text-[11px] text-ink-3">{model}</span>}
    </span>
  );
}
