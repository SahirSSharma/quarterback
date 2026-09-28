// Small JSON object store with two backends behind one interface.
//
//   createStore({ dir })     → disk backend rooted at `dir`; never consults the environment (tests)
//   store() / setStore(s)    → lazy process-wide instance: Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
//                              else <QB_DATA_DIR | ./.data> on disk (git-ignored)
//   ObjectStore              → { put(key, obj), get(key), list(prefix), del(key) }
//
// Keys carry no extension: `runs/<runId>` is stored as the Blob pathname `runs/<runId>.json`, or the file
// `<dir>/runs/<runId>.json`. Key families: runs/<runId>, saved/<id>, approvals/<approvalId>,
// ledger/<YYYY-MM-DD>/<ulid>, critic-cache/<hash>.
//
// Blob objects are PRIVATE (access 'private' on put, read back through the SDK's get() with the token),
// keys are stable (addRandomSuffix false) and overwritable (allowOverwrite true). get() bypasses the CDN
// cache so a key overwritten by updateRun() reads back fresh on the next request.
//
// A 200-entry LRU of serialized JSON sits in front of get/put/del so a warm function does not re-read Blob
// per request; list() always goes to the backend. Caching the text, not the object, means a caller mutating
// what it got or what it put cannot corrupt the cache.
import { del as blobDel, get as blobGet, list as blobList, put as blobPut } from '@vercel/blob';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../env';

export interface ObjectStore {
  put(key: string, obj: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  /** Keys (without extension) that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
  del(key: string): Promise<void>;
}

interface Backend {
  write(key: string, text: string): Promise<void>;
  read(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

const LRU_SIZE = 200;

function withLru(backend: Backend): ObjectStore {
  const cache = new Map<string, string>();
  const remember = (key: string, text: string) => {
    cache.delete(key);
    cache.set(key, text);
    if (cache.size > LRU_SIZE) cache.delete(cache.keys().next().value as string);
  };
  return {
    async put(key, obj) {
      const text = JSON.stringify(obj);
      await backend.write(key, text);
      remember(key, text);
    },
    async get<T>(key: string): Promise<T | null> {
      const hit = cache.get(key);
      if (hit !== undefined) {
        remember(key, hit);
        return JSON.parse(hit) as T;
      }
      const text = await backend.read(key);
      if (text === null) return null;
      remember(key, text);
      return JSON.parse(text) as T;
    },
    list: (prefix) => backend.list(prefix),
    async del(key) {
      cache.delete(key);
      await backend.remove(key);
    },
  };
}

function diskBackend(dir: string): Backend {
  const file = (key: string) => path.join(dir, `${key}.json`);
  return {
    async write(key, text) {
      mkdirSync(path.dirname(file(key)), { recursive: true });
      writeFileSync(file(key), text);
    },
    async read(key) {
      return existsSync(file(key)) ? readFileSync(file(key), 'utf8') : null;
    },
    async list(prefix) {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((rel) => rel.endsWith('.json'))
        .map((rel) => rel.split(path.sep).join('/').slice(0, -'.json'.length))
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    async remove(key) {
      rmSync(file(key), { force: true });
    },
  };
}

function vercelBlobBackend(): Backend {
  const pathname = (key: string) => `${key}.json`;
  return {
    async write(key, text) {
      await blobPut(pathname(key), text, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
    },
    async read(key) {
      const res = await blobGet(pathname(key), { access: 'private', useCache: false });
      if (!res || res.statusCode !== 200) return null;
      return new Response(res.stream).text();
    },
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await blobList({ prefix, cursor });
        for (const b of page.blobs) if (b.pathname.endsWith('.json')) keys.push(b.pathname.slice(0, -'.json'.length));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys.sort();
    },
    async remove(key) {
      await blobDel(pathname(key));
    },
  };
}

/** A disk-backed store rooted at `dir`. Reads nothing from the environment. */
export function createStore(opts: { dir: string }): ObjectStore {
  return withLru(diskBackend(opts.dir));
}

let active: ObjectStore | null = null;

/** The process-wide store: Vercel Blob with BLOB_READ_WRITE_TOKEN, otherwise QB_DATA_DIR or ./.data on disk. */
export function store(): ObjectStore {
  if (active) return active;
  loadEnv();
  active = process.env.BLOB_READ_WRITE_TOKEN
    ? withLru(vercelBlobBackend())
    : createStore({ dir: path.resolve(process.cwd(), process.env.QB_DATA_DIR || '.data') });
  return active;
}

/** Swap the process-wide store (tests point it at a temp directory). */
export function setStore(next: ObjectStore | null): void {
  active = next;
}
