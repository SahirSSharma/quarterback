import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { del as blobDel, get as blobGet, list as blobList, put as blobPut } from '@vercel/blob';
import { loadEnv } from '../env';
import { createStore, setStore, store } from './blob';

vi.mock('@vercel/blob', () => ({ put: vi.fn(), get: vi.fn(), list: vi.fn(), del: vi.fn() }));

describe('disk store', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'qb-blob-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips put / get / list / del and writes <dir>/<key>.json', async () => {
    const s = createStore({ dir });
    await s.put('runs/r1', { a: 1 });
    await s.put('runs/r2', { a: 2 });
    await s.put('saved/qb_1', { a: 3 });
    expect(await s.get('runs/r1')).toEqual({ a: 1 });
    expect(JSON.parse(readFileSync(path.join(dir, 'runs/r1.json'), 'utf8'))).toEqual({ a: 1 });
    expect(await s.list('runs/')).toEqual(['runs/r1', 'runs/r2']);
    expect(await s.list('saved/')).toEqual(['saved/qb_1']);
    expect(await s.list('nothing/')).toEqual([]);
    await s.del('runs/r1');
    expect(await s.get('runs/r1')).toBeNull();
    expect(existsSync(path.join(dir, 'runs/r1.json'))).toBe(false);
    expect(await s.list('runs/')).toEqual(['runs/r2']);
    await s.del('runs/never-existed'); // no throw
  });

  it('nests keys as folders and lists across them', async () => {
    const s = createStore({ dir: path.join(dir, 'nested') });
    await s.put('ledger/2026-09-27/01A', { usd: 1 });
    await s.put('ledger/2026-09-28/01B', { usd: 2 });
    expect(await s.list('ledger/')).toEqual(['ledger/2026-09-27/01A', 'ledger/2026-09-28/01B']);
    expect(await s.list('ledger/2026-09-28/')).toEqual(['ledger/2026-09-28/01B']);
    expect(await s.list('ledger/')).not.toContain('ledger/2026-09-27'); // folders are not keys
  });

  it('returns null for a missing key and an empty list for a missing directory', async () => {
    const s = createStore({ dir: path.join(dir, 'empty') });
    expect(await s.get('runs/x')).toBeNull();
    expect(await s.list('runs/')).toEqual([]);
  });
});

describe('LRU in front of the backend', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'qb-lru-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves a warm key without touching the backend, and del evicts it', async () => {
    const s = createStore({ dir });
    await s.put('runs/warm', { v: 1 });
    rmSync(path.join(dir, 'runs/warm.json')); // behind the store's back
    expect(await s.get('runs/warm')).toEqual({ v: 1 }); // still cached
    await s.del('runs/warm');
    expect(await s.get('runs/warm')).toBeNull();
  });

  it('a put replaces the cached value; a get after an external write re-reads only once evicted', async () => {
    const s = createStore({ dir });
    await s.put('runs/k', { v: 1 });
    await s.put('runs/k', { v: 2 });
    expect(await s.get('runs/k')).toEqual({ v: 2 });
    for (let i = 0; i < 200; i++) await s.put(`runs/fill-${i}`, { i }); // 200 newer keys push runs/k out
    writeFileSync(path.join(dir, 'runs/k.json'), JSON.stringify({ v: 3 }));
    expect(await s.get('runs/k')).toEqual({ v: 3 });
    // The most recent filler key is still warm even though its file is gone.
    rmSync(path.join(dir, 'runs/fill-199.json'));
    expect(await s.get('runs/fill-199')).toEqual({ i: 199 });
  });

  it('hands out fresh objects: mutating what you got or what you put does not change the store', async () => {
    const s = createStore({ dir });
    const original = { list: [1] };
    await s.put('runs/alias', original);
    original.list.push(2);
    const got = await s.get<{ list: number[] }>('runs/alias');
    expect(got).toEqual({ list: [1] });
    got!.list.push(3);
    expect(await s.get('runs/alias')).toEqual({ list: [1] });
  });
});

describe('store() backend selection', () => {
  it('without a Blob token, writes under QB_DATA_DIR on disk', async () => {
    loadEnv(); // mark .env.local as loaded first, so store()'s own loadEnv() cannot put a Blob token back
    const hadBlob = process.env.BLOB_READ_WRITE_TOKEN;
    const hadDir = process.env.QB_DATA_DIR;
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'qb-env-'));
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.QB_DATA_DIR = tmp;
    setStore(null);
    try {
      await store().put('runs/env', { ok: true });
      expect(JSON.parse(readFileSync(path.join(tmp, 'runs/env.json'), 'utf8'))).toEqual({ ok: true });
      expect(blobPut).not.toHaveBeenCalled();
    } finally {
      setStore(null);
      if (hadBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = hadBlob;
      if (hadDir === undefined) delete process.env.QB_DATA_DIR;
      else process.env.QB_DATA_DIR = hadDir;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Vercel Blob backend (SDK mocked)', () => {
  const token = 'vercel_blob_rw_TESTSTORE_notasecret';
  const hadToken = process.env.BLOB_READ_WRITE_TOKEN;
  beforeAll(() => {
    setStore(null);
    process.env.BLOB_READ_WRITE_TOKEN = token;
  });
  afterEach(() => vi.clearAllMocks());
  afterAll(() => {
    setStore(null);
    if (hadToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = hadToken;
  });

  it('puts private, stable, overwritable JSON blobs at <key>.json', async () => {
    vi.mocked(blobPut).mockResolvedValue({} as never);
    await store().put('approvals/apr_1', { ok: true });
    expect(blobPut).toHaveBeenCalledWith('approvals/apr_1.json', '{"ok":true}', {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  });

  it('reads back through get() with private access and no CDN cache; 404 → null', async () => {
    setStore(null);
    vi.mocked(blobGet).mockResolvedValueOnce({ statusCode: 200, stream: new Blob(['{"n":7}']).stream() } as never);
    expect(await store().get('runs/x')).toEqual({ n: 7 });
    expect(blobGet).toHaveBeenCalledWith('runs/x.json', { access: 'private', useCache: false });
    vi.mocked(blobGet).mockResolvedValueOnce(null);
    expect(await store().get('runs/missing')).toBeNull();
    expect(await store().get('runs/x')).toEqual({ n: 7 }); // warm: no second SDK call
    expect(blobGet).toHaveBeenCalledTimes(2);
  });

  it('follows list pagination and strips the extension; del removes the pathname', async () => {
    setStore(null);
    vi.mocked(blobList)
      .mockResolvedValueOnce({ blobs: [{ pathname: 'ledger/2026-09-27/B.json' }], hasMore: true, cursor: 'c1' } as never)
      .mockResolvedValueOnce({ blobs: [{ pathname: 'ledger/2026-09-27/A.json' }, { pathname: 'ledger/2026-09-27/stray.txt' }], hasMore: false } as never);
    expect(await store().list('ledger/')).toEqual(['ledger/2026-09-27/A', 'ledger/2026-09-27/B']);
    expect(blobList).toHaveBeenNthCalledWith(1, { prefix: 'ledger/', cursor: undefined });
    expect(blobList).toHaveBeenNthCalledWith(2, { prefix: 'ledger/', cursor: 'c1' });
    vi.mocked(blobDel).mockResolvedValue(undefined);
    await store().del('runs/x');
    expect(blobDel).toHaveBeenCalledWith('runs/x.json');
  });
});
