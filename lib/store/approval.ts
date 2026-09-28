// The approval gate and the signed TritonPlan import token.
//
//   approve({ run, planId, overrides })   → ApprovalRecord, persisted at approvals/<id> (with the runId) and
//                                           written onto the run; throws ApprovalError {status} when the plan is
//                                           unknown / failed verification (400) or was refused by the critic and
//                                           no matching override says 'I understand' (409)
//   getApproval(id)                       → StoredApproval | null
//   importPayload(record, plan)           → ImportPayload for the token
//   signImportToken(payload, key?)        → token; `key` is the PKCS8 base64 private key, default QB_SIGNING_KEY
//   verifyImportToken(token, spkiBase64)  → the payload, or null when the signature or shape is wrong
//   buildImportUrl(payload, {demo, key})  → <base>?plan=<token>; base is IMPORT_BASE, or IMPORT_BASE_STAGING when `demo`
//                                           (a demo student or a replayed run), or QB_IMPORT_BASE when set
//   planHash(plan)                        → sha256 hex of the plan's canonical JSON (sorted keys)
//
// Token format: `base64url(JSON.stringify(payload)) + '.' + base64url(signature)`. The signature is ECDSA
// P-256 over SHA-256 of the UTF-8 bytes of the FIRST SEGMENT exactly as it appears in the token (the JSON is
// not canonicalized; the receiver verifies the bytes it was given, then parses). It is the raw 64-byte r||s
// form (`dsaEncoding: 'ieee-p1363'` in node:crypto), which is what WebCrypto's ECDSA verify consumes, so the
// TritonPlan page can check it with `crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key, sig,
// new TextEncoder().encode(segment))` against the SPKI public key in lib/keys/import-public.json.
// verifyImportToken() here uses that same WebCrypto path so the browser's code path is what the tests cover.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { loadEnv } from '../env';
import { canonicalJson } from '../tavily/client';
import type { ApprovalRecord, ImportPayload, Plan } from '../types';
import type { RunRecord } from '../../app/lib/contracts';
import { store } from './blob';
import { shortId, updateRun } from './runs';

export const IMPORT_BASE = 'https://tritonplan.com/tools/quarterback-import';
/** Production tritonplan.com needs a ucsd.edu sign-in, so a demo or replayed run links to the public mirror of the same page. */
export const IMPORT_BASE_STAGING = 'https://sahirssharma.github.io/tritonplan-staging/tools/quarterback-import';
export const OVERRIDE_PHRASE = 'I understand';

export type StoredApproval = ApprovalRecord & { runId: string };

export class ApprovalError extends Error {
  constructor(public readonly status: 400 | 409, message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export function planHash(plan: Plan): string {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

export async function approve(args: { run: RunRecord; planId: string; overrides?: ApprovalRecord['overrides'] }): Promise<ApprovalRecord> {
  const { run, planId } = args;
  const overrides = args.overrides ?? [];
  const plan = run.plans.find((p) => p.id === planId);
  if (!plan) throw new ApprovalError(400, `Unknown plan ${planId}`);
  const report = run.reports.find((r) => r.planId === planId);
  if (!report?.ok) throw new ApprovalError(400, `Plan ${planId} did not pass verification`);

  const refused = run.verdict?.refused.find((r) => r.planId === planId);
  if (refused) {
    const ok = overrides.some((o) => o.refusalPlanId === planId && o.phrase === OVERRIDE_PHRASE && o.reason.trim().length > 0);
    if (!ok) throw new ApprovalError(409, `This plan was refused. Approving it needs an override with the phrase "${OVERRIDE_PHRASE}" and a reason.`);
  }

  const record: ApprovalRecord = {
    id: shortId('apr'),
    at: new Date().toISOString(),
    planHash: planHash(plan),
    planId,
    ...(run.state.id ? { studentId: run.state.id } : {}),
    overrides,
    ledger: run.ledger,
  };
  await store().put(`approvals/${record.id}`, { ...record, runId: run.runId } satisfies StoredApproval);
  await updateRun(run.runId, { approval: record });
  // Overrides are visible in the record; the log line carries ids only, never the student's reason text.
  if (refused) console.warn(`approval ${record.id}: refusal of plan ${planId} overridden`);
  return record;
}

export async function getApproval(id: string): Promise<StoredApproval | null> {
  return store().get<StoredApproval>(`approvals/${id}`);
}

export function importPayload(record: ApprovalRecord, plan: Plan): ImportPayload {
  return {
    v: 1,
    approvalId: record.id,
    issuedAt: record.at,
    plan: plan.terms.map((t) => ({ term: t.term, courses: t.courses })),
    label: plan.label,
  };
}

const b64url = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64url');

export function signImportToken(payload: ImportPayload, privateKeyPkcs8Base64 = signingKey()): string {
  const segment = b64url(JSON.stringify(payload));
  const key = createPrivateKey({ key: Buffer.from(privateKeyPkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
  const sig = sign('sha256', Buffer.from(segment), { key, dsaEncoding: 'ieee-p1363' });
  return `${segment}.${b64url(sig)}`;
}

export async function verifyImportToken(token: string, spkiBase64: string): Promise<ImportPayload | null> {
  const [segment, sig, extra] = token.split('.');
  if (!segment || !sig || extra !== undefined) return null;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'spki', Buffer.from(spkiBase64, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    const valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(segment),
    );
    if (!valid) return null;
    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as ImportPayload;
    return payload.v === 1 && typeof payload.approvalId === 'string' && Array.isArray(payload.plan) ? payload : null;
  } catch {
    return null;
  }
}

export function buildImportUrl(payload: ImportPayload, opts: { demo?: boolean; key?: string } = {}): string {
  return `${importBase(opts.demo === true)}?plan=${encodeURIComponent(signImportToken(payload, opts.key))}`;
}

/** QB_IMPORT_BASE (a preview of the import page, say) overrides both targets. */
export function importBase(demo: boolean): string {
  loadEnv();
  return process.env.QB_IMPORT_BASE || (demo ? IMPORT_BASE_STAGING : IMPORT_BASE);
}

function signingKey(): string {
  loadEnv();
  const key = process.env.QB_SIGNING_KEY;
  if (!key) throw new Error('QB_SIGNING_KEY is not set (PKCS8 base64 of the ECDSA P-256 private key)');
  return key;
}
