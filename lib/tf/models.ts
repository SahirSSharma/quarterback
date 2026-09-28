// Token Factory model registry — the ONLY place model ids live (verified with our key on 2026-09-27).
//
//   resolveModel(role)       → ModelEntry for a role, honouring QB_MODEL_EXTRACT|PLAN|CRITIC env overrides
//   fallbackOf(modelId)      → the next model in the fallback order, or null
//   price(modelId, usage)    → USD for one call from the registry prices
//   MODELS / ROLE_PRIMARY    → the registry itself, for the README table and eval ablations
//
// Pricing assumptions: `completion_tokens` already includes reasoning tokens on OpenAI-compatible APIs, so
// reasoning is never billed twice here; prompt-cache hits are charged the full input rate because the
// platform publishes no verified cache discount (an over-estimate is the safe direction for a spend cap).
import type { ModelRole } from '../types';
import type { Usage } from './ledger';

export interface ModelEntry {
  id: string;
  roles: ModelRole[];
  /** Context window in tokens. */
  ctx: number;
  /** USD per 1M tokens. */
  pricing: { inputPerM: number; outputPerM: number };
  /** Requests / tokens per minute on our key. */
  limits: { rpm: number; tpm: number };
  /** Next model to try when this one is removed or keeps rate-limiting; null = no fallback. */
  fallback: string | null;
}

export const LIGHTNING = 'nvidia/Nemotron-3_5-Lightning';
export const NANO = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
export const SUPER = 'nvidia/nemotron-3-super-120b-a12b';
export const ULTRA = 'nvidia/Nemotron-3-Ultra-550b-a55b';
export const EMBEDDING = 'Qwen/Qwen3-Embedding-8B';

export const MODELS: Record<string, ModelEntry> = {
  [LIGHTNING]: {
    id: LIGHTNING,
    roles: ['extract'],
    ctx: 1_048_576,
    pricing: { inputPerM: 0.06, outputPerM: 0.24 },
    limits: { rpm: 600, tpm: 400_000 },
    fallback: NANO,
  },
  [NANO]: {
    id: NANO,
    roles: [],
    ctx: 262_144,
    pricing: { inputPerM: 0.06, outputPerM: 0.24 },
    limits: { rpm: 100, tpm: 800_000 },
    fallback: null,
  },
  [SUPER]: {
    id: SUPER,
    roles: ['plan'],
    ctx: 262_144,
    pricing: { inputPerM: 0.3, outputPerM: 0.9 },
    limits: { rpm: 300, tpm: 200_000 },
    fallback: ULTRA,
  },
  [ULTRA]: {
    id: ULTRA,
    roles: ['critic'],
    ctx: 1_048_576,
    pricing: { inputPerM: 1.0, outputPerM: 3.0 },
    limits: { rpm: 300, tpm: 200_000 },
    fallback: SUPER,
  },
  [EMBEDDING]: {
    id: EMBEDDING,
    roles: [],
    ctx: 40_960,
    pricing: { inputPerM: 0.01, outputPerM: 0 },
    limits: { rpm: 600, tpm: 400_000 },
    fallback: null,
  },
};

export const ROLE_PRIMARY: Record<ModelRole, string> = {
  extract: LIGHTNING,
  plan: SUPER,
  critic: ULTRA,
};

export function modelEntry(id: string): ModelEntry {
  const entry = MODELS[id];
  if (!entry) throw new Error(`Unknown Token Factory model '${id}'; add it to lib/tf/models.ts`);
  return entry;
}

/** Primary model for a role. `QB_MODEL_<ROLE>` (e.g. QB_MODEL_PLAN) overrides, but must name a registry id. */
export function resolveModel(role: ModelRole): ModelEntry {
  const override = process.env[`QB_MODEL_${role.toUpperCase()}`];
  return modelEntry(override || ROLE_PRIMARY[role]);
}

export function fallbackOf(modelId: string): ModelEntry | null {
  const next = modelEntry(modelId).fallback;
  return next ? modelEntry(next) : null;
}

export function price(modelId: string, usage: Pick<Usage, 'prompt_tokens' | 'completion_tokens'>): number {
  const { inputPerM, outputPerM } = modelEntry(modelId).pricing;
  return (usage.prompt_tokens * inputPerM + usage.completion_tokens * outputPerM) / 1_000_000;
}
