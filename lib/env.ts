// Loads .env.local for scripts and tests (Next.js loads it itself for `next dev`/`next build`).
// No dependency: the file is KEY=VALUE lines. Never log the values.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let loaded = false;
export function loadEnv(root = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export function mode(): 'live' | 'mock' | 'replay' {
  const m = process.env.QB_MODE;
  return m === 'live' || m === 'replay' ? m : 'mock';
}
