// TEMPORARY diagnostic: exercises Vercel Blob overwrite/read freshness from inside a deployment.
// Refuses to run in production. Remove once the store semantics are settled.
import { put, get, head, list, del } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (process.env.VERCEL_ENV === 'production') return new Response('not here', { status: 404 });
  const out: Record<string, unknown> = { env: process.env.VERCEL_ENV, hasToken: !!process.env.BLOB_READ_WRITE_TOKEN };
  const key = `diag/overwrite-${Date.now()}.json`;
  const read = async (label: string, target: string, opts: Record<string, unknown> = {}) => {
    try {
      const r = await get(target, { access: 'private', useCache: false, ...opts } as never);
      out[label] = r && r.statusCode === 200 ? await new Response(r.stream).text() : `status ${r?.statusCode}`;
    } catch (e) { out[label] = `ERR ${e instanceof Error ? e.message : String(e)}`; }
  };
  try {
    const p1 = await put(key, JSON.stringify({ v: 1 }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    out.put1 = { url: p1.url, pathname: p1.pathname };
    await read('get1_by_pathname', key);
    await read('get1_by_url', p1.url);
    const p2 = await put(key, JSON.stringify({ v: 2 }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    out.put2 = { url: p2.url, sameUrl: p2.url === p1.url };
    await read('get2_by_pathname', key);
    await read('get2_by_url', p2.url);
    await new Promise((r) => setTimeout(r, 1500));
    await read('get2_by_pathname_after_1500ms', key);
    const h = await head(p2.url).catch((e) => ({ err: String(e) }));
    out.head = h;
    const l = await list({ prefix: 'diag/' });
    out.list = l.blobs.map((b) => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }));
    await del(p2.url);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return Response.json(out);
}
