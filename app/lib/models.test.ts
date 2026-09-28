import { describe, it, expect } from 'vitest';
import { modelTier } from './models';

describe('modelTier', () => {
  it('recognises the three Nemotron tiers by id substring, case-insensitively', () => {
    expect(modelTier('nvidia/Nemotron-3_5-Lightning')).toBe('Lightning');
    expect(modelTier('nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B')).toBe('Lightning'); // Lightning fallback
    expect(modelTier('nvidia/nemotron-3-super-120b-a12b')).toBe('Super');
    expect(modelTier('nvidia/Nemotron-3-Ultra-550b-a55b')).toBe('Ultra');
  });
  it('falls back to Other for anything else', () => {
    expect(modelTier('Qwen/Qwen3-Embedding-8B')).toBe('Other');
  });
});
