// Model badges for the trace and ledger. The id registry lives in lib/tf/models.ts; the UI only needs
// to recognise which Nemotron tier an id belongs to, so it matches by substring and never lists ids.
export type ModelTier = 'Lightning' | 'Super' | 'Ultra' | 'Other';

export function modelTier(modelId: string): ModelTier {
  const id = modelId.toLowerCase();
  if (id.includes('lightning') || id.includes('nano')) return 'Lightning';
  if (id.includes('super')) return 'Super';
  if (id.includes('ultra')) return 'Ultra';
  return 'Other';
}
