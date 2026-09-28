import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../env';
import type { ImportPayload } from '../types';
import {
  ApprovalError, IMPORT_BASE, approve, buildImportUrl, getApproval, importPayload, planHash, signImportToken, verifyImportToken,
} from './approval';
import { createRun, getRun } from './runs';
import { impact, plans, reports, sampleRun, state, tempStore, verdict } from './test-fixture';

/** A throwaway P-256 pair: PKCS8 private and SPKI public, both base64 like the real ones. */
function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  return { priv: privateKey.toString('base64'), pub: publicKey.toString('base64') };
}

const payload: ImportPayload = {
  v: 1,
  approvalId: 'apr_000000000001',
  issuedAt: '2026-09-27T20:00:00.000Z',
  plan: [{ term: 'WI27', courses: ['CSE 29', 'CSE 105'] }, { term: 'SP27', courses: ['CSE 30'] }],
  label: 'balanced',
};

describe('approve', () => {
  let cleanup: () => void;
  let runId: string;
  beforeAll(async () => {
    ({ cleanup } = tempStore());
    runId = await createRun({ state, action: impact.action, impact, plans, reports, verdict });
  });
  afterAll(() => cleanup());

  const run = async () => (await getRun(runId))!;
  const status = async (p: Promise<unknown>) => p.then(() => 0, (e: ApprovalError) => (e instanceof ApprovalError ? e.status : -1));

  it('approves a verified, recommended plan and writes the record to the store and the run', async () => {
    const record = await approve({ run: await run(), planId: 'p-balanced' });
    expect(record.id).toMatch(/^apr_[0-9a-f]{12}$/);
    expect(record.planId).toBe('p-balanced');
    expect(record.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.planHash).toBe(planHash(plans[1]));
    expect(record.overrides).toEqual([]);
    expect(record.studentId).toBeUndefined(); // not saved yet
    expect(record.ledger).toHaveLength(0);
    expect(await getApproval(record.id)).toEqual({ ...record, runId });
    expect((await run()).approval).toEqual(record);
  });

  it('rejects an unknown plan and a plan that failed verification with 400', async () => {
    expect(await status(approve({ run: await run(), planId: 'p-nope' }))).toBe(400);
    expect(await status(approve({ run: await run(), planId: 'p-broken' }))).toBe(400);
    const noReport = sampleRun({ runId, reports: [] });
    expect(await status(approve({ run: noReport, planId: 'p-balanced' }))).toBe(400);
  });

  it('returns 409 for a refused plan without a matching override, wrong phrase, or empty reason', async () => {
    expect(await status(approve({ run: await run(), planId: 'p-fastest' }))).toBe(409);
    expect(await status(approve({ run: await run(), planId: 'p-fastest', overrides: [
      { refusalPlanId: 'p-fastest', reason: 'I need it', phrase: 'i understand' as 'I understand' },
    ] }))).toBe(409);
    expect(await status(approve({ run: await run(), planId: 'p-fastest', overrides: [
      { refusalPlanId: 'p-fastest', reason: '   ', phrase: 'I understand' },
    ] }))).toBe(409);
    expect(await status(approve({ run: await run(), planId: 'p-fastest', overrides: [
      { refusalPlanId: 'p-balanced', reason: 'wrong plan', phrase: 'I understand' },
    ] }))).toBe(409);
    await expect(approve({ run: await run(), planId: 'p-fastest' })).rejects.toThrow(/refused/);
  });

  it('accepts the exact override, keeps it on the record and logs that a refusal was overridden', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const override = { refusalPlanId: 'p-fastest', reason: 'My department confirmed CSE 194 by email.', phrase: 'I understand' as const };
      const record = await approve({ run: await run(), planId: 'p-fastest', overrides: [override] });
      expect(record.overrides).toEqual([override]);
      expect((await getApproval(record.id))!.overrides).toEqual([override]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(record.id);
      expect(warn.mock.calls[0][0]).not.toContain('email'); // the reason stays off the logs
    } finally {
      warn.mockRestore();
    }
  });

  it('planHash ignores key order and changes with the plan', () => {
    const p = plans[1];
    const reordered = { graduationTerm: p.graduationTerm, rationale: p.rationale, terms: p.terms, label: p.label, id: p.id };
    expect(planHash(reordered)).toBe(planHash(p));
    expect(planHash({ ...p, terms: [...p.terms].reverse() })).not.toBe(planHash(p));
  });

  it('importPayload carries only what TritonPlan needs', () => {
    const record = { id: 'apr_x', at: '2026-09-27T20:00:00.000Z', planHash: 'h', planId: 'p-balanced', overrides: [], ledger: [] };
    expect(importPayload(record, plans[1])).toEqual({
      v: 1, approvalId: 'apr_x', issuedAt: '2026-09-27T20:00:00.000Z', label: 'balanced',
      plan: [{ term: 'WI27', courses: ['CSE 29', 'CSE 105', 'MATH 183', 'HUM 5'] }, { term: 'SP27', courses: ['CSE 30', 'CSE 100', 'CSE 151A', 'COGS 1'] }],
    });
  });
});

describe('import token', () => {
  const keys = testKeys();

  it('signs with raw r||s and verifies through WebCrypto', async () => {
    const token = signImportToken(payload, keys.priv);
    const [segment, sig, extra] = token.split('.');
    expect(extra).toBeUndefined();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // URL-safe: no '+', '/', '=' or '%'
    expect(Buffer.from(sig, 'base64url')).toHaveLength(64); // ieee-p1363, not DER
    expect(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))).toEqual(payload);
    expect(await verifyImportToken(token, keys.pub)).toEqual(payload);
  });

  it('fails on a tampered payload, a tampered signature, the wrong key, or a malformed token', async () => {
    const token = signImportToken(payload, keys.priv);
    const [segment, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, plan: [{ term: 'WI27', courses: ['CSE 999'] }] })).toString('base64url');
    expect(await verifyImportToken(`${forged}.${sig}`, keys.pub)).toBeNull();
    const flipped = Buffer.from(sig, 'base64url');
    flipped[10] ^= 0xff;
    expect(await verifyImportToken(`${segment}.${flipped.toString('base64url')}`, keys.pub)).toBeNull();
    expect(await verifyImportToken(token, testKeys().pub)).toBeNull();
    expect(await verifyImportToken(segment, keys.pub)).toBeNull();
    expect(await verifyImportToken(`${token}.extra`, keys.pub)).toBeNull();
    expect(await verifyImportToken('not base64!.nope', keys.pub)).toBeNull();
    expect(await verifyImportToken(token, 'AAAA')).toBeNull(); // bad SPKI never throws
  });

  it('buildImportUrl points at the TritonPlan import page with the token as the plan parameter', async () => {
    const url = buildImportUrl(payload, keys.priv);
    expect(url.startsWith(`${IMPORT_BASE}?plan=`)).toBe(true);
    const token = new URL(url).searchParams.get('plan')!;
    expect(url.endsWith(token)).toBe(true); // nothing needed percent-encoding
    expect(await verifyImportToken(token, keys.pub)).toEqual(payload);
  });

  it('the shipped public key is a P-256 SPKI WebCrypto can import', async () => {
    const pub = JSON.parse(readFileSync(path.resolve(process.cwd(), 'lib/keys/import-public.json'), 'utf8')) as { spkiBase64: string; curve: string };
    expect(pub.curve).toBe('P-256');
    const key = await globalThis.crypto.subtle.importKey('spki', Buffer.from(pub.spkiBase64, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    expect(key.type).toBe('public');
    expect(await verifyImportToken(signImportToken(payload, keys.priv), pub.spkiBase64)).toBeNull(); // a test key is not the real key
  });

  it('without a key in the environment, signing fails loudly instead of minting an unsigned token', () => {
    const had = process.env.QB_SIGNING_KEY;
    delete process.env.QB_SIGNING_KEY;
    try {
      // loadEnv() may put the key back from .env.local; only assert when it stays absent.
      loadEnv();
      if (!process.env.QB_SIGNING_KEY) expect(() => signImportToken(payload)).toThrow(/QB_SIGNING_KEY/);
    } finally {
      if (had !== undefined) process.env.QB_SIGNING_KEY = had;
    }
  });
});

describe('deployed key pair', () => {
  loadEnv();
  const envKey = process.env.QB_SIGNING_KEY;

  it.skipIf(!envKey)('QB_SIGNING_KEY (PKCS8 base64) signs what lib/keys/import-public.json verifies', async () => {
    const pub = JSON.parse(readFileSync(path.resolve(process.cwd(), 'lib/keys/import-public.json'), 'utf8')) as { spkiBase64: string };
    let token: string;
    try {
      token = signImportToken(payload, envKey);
    } catch (err) {
      throw new Error(`QB_SIGNING_KEY is not a base64 PKCS8 (DER) ECDSA P-256 private key: ${(err as Error).message}`);
    }
    expect(await verifyImportToken(token, pub.spkiBase64), 'QB_SIGNING_KEY does not match lib/keys/import-public.json').toEqual(payload);
  });
});
