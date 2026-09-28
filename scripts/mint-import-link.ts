// Mints a signed TritonPlan import link for a sample plan, using QB_SIGNING_KEY from .env.local, so the
// hand-off page can be checked by hand: node --import ./scripts/node-ts.ts scripts/mint-import-link.ts [--production]
import { loadEnv } from '../lib/env';
import { buildImportUrl } from '../lib/store/approval';

loadEnv();
const production = process.argv.includes('--production');
const payload = {
  v: 1 as const,
  approvalId: `apr_manual_${Date.now().toString(36)}`,
  issuedAt: new Date().toISOString(),
  plan: [
    { term: 'WI27', courses: ['CSE 29', 'CSE 21', 'MATH 18', 'HUM 4'] },
    { term: 'SP27', courses: ['CSE 30', 'CSE 55', 'CSE 100', 'ECE 109'] },
  ],
  label: 'fastest',
};
process.stdout.write(buildImportUrl(payload, { demo: !production }) + '\n');
