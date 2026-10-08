import { describe, expect, it, vi } from 'vitest';
import { createPostgrestDedupingFetch } from '@/lib/postgrestDedupingFetch';
import { createReportRequestCache } from '@/lib/reportRequestCache';
const url = 'https://example.test/rest/v1/rpc/get_income_statement';
const options = (branch = 'a', auth = 'Bearer reader', signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ p_branch_id: branch, p_from: '2026-10-08', p_to: '2026-10-08' }), signal });
const response = (value = 12) => Response.json({ revenue: value });
describe('shared authoritative report requests', () => {
  it('preserves the POST body through both transport layers for native fetch consumption', async () => {
    const nativeTransport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return Response.json({ params: await request.json() });
    });
    const cache = createReportRequestCache(createPostgrestDedupingFetch(nativeTransport));
    expect(await (await cache.fetch(url, options())).json()).toEqual({ params: { p_branch_id: 'a', p_from: '2026-10-08', p_to: '2026-10-08' } });
    await cache.fetch(url, options()); expect(nativeTransport).toHaveBeenCalledOnce();
  });
  it('reuses identical results and separates branch, dates and authenticated readers', async () => {
    const base = vi.fn(async () => response()); const cache = createReportRequestCache(base);
    expect(await (await cache.fetch(url, options())).json()).toEqual({ revenue: 12 });
    await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(1);
    await cache.fetch(url, options('b')); await cache.fetch(url, options('a', 'Bearer another'));
    const changed = options(); changed.body = JSON.stringify({ p_branch_id: 'a', p_from: '2026-10-01', p_to: '2026-10-08' });
    await cache.fetch(url, changed); expect(base).toHaveBeenCalledTimes(4);
  });
  it('expires results, supports forced refresh and bounds retained reports', async () => {
    let now = 0; const base = vi.fn(async () => response()); const cache = createReportRequestCache(base, { now: () => now, ttl: 10, maxEntries: 2 });
    await cache.fetch(url, options()); now = 11; await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(2);
    cache.clear(); await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(3);
    await cache.fetch(url, options('b')); await cache.fetch(url, options('c')); await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(6);
  });
  it('does not retain HTTP or business failures', async () => {
    const base = vi.fn().mockResolvedValueOnce(Response.json({ message: 'timeout' }, { status: 500 })).mockResolvedValueOnce(Response.json({ success: false, error: 'forbidden' })).mockImplementation(async () => response());
    const cache = createReportRequestCache(base);
    for (let i = 0; i < 4; i++) await cache.fetch(url, options());
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('isolates cancellation while sharing an in-flight read between screens', async () => {
    let finish!: (value: Response) => void; const network = new Promise<Response>(resolve => { finish = resolve; }); const base = vi.fn(() => network);
    const cache = createReportRequestCache(base); const controller = new AbortController();
    const first = cache.fetch(url, options('a', 'Bearer reader', controller.signal));
    const second = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    finish(response()); expect(await (await second).json()).toEqual({ revenue: 12 });
    await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(1);
  });
  it('invalidates reuse on a table write and never caches operational RPCs', async () => {
    const base = vi.fn(async () => response()); const cache = createReportRequestCache(base);
    await cache.fetch(url, options());
    await cache.fetch('https://example.test/rest/v1/sales', { method: 'PATCH', body: '{}' });
    await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 2; i++) await cache.fetch('https://example.test/rest/v1/rpc/pos_create_order', options());
    expect(base).toHaveBeenCalledTimes(5);
  });
  it('does not publish a read that completed after a mutation', async () => {
    let finish!: (value: Response) => void;
    const base = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response(20));
    const cache = createReportRequestCache(base); const old = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    await cache.fetch('https://example.test/rest/v1/rpc/set_raw_material_price', options());
    await cache.fetch(url, options()); finish(response(12)); await old;
    expect(await (await cache.fetch(url, options())).json()).toEqual({ revenue: 20 }); expect(base).toHaveBeenCalledTimes(3);
  });
});
