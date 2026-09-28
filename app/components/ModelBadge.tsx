import { modelTier, type ModelTier } from '@/app/lib/models';

const tones: Record<ModelTier, string> = {
  Lightning: 'bg-bg text-ink-2 ring-line-2',
  Super: 'bg-accent-soft text-accent ring-accent/20',
  Ultra: 'bg-warn-soft text-warn ring-warn/20',
  Other: 'bg-bg text-ink-3 ring-line-2',
};

/**
 * Names the Nemotron tier; the full model id sits in the tooltip and next to it in the ledger. Pass `tier` when
 * only the role is known (a call still in flight).
 */
export function ModelBadge({ model, tier, showId = false }: { model?: string; tier?: ModelTier; showId?: boolean }) {
  const t = tier ?? (model ? modelTier(model) : 'Other');
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={model} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[t]}`}>
        Nemotron {t === 'Other' ? '' : t}
      </span>
      {showId && model && <span className="font-mono text-[11px] text-ink-3">{model}</span>}
    </span>
  );
}
