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
  it.each(['get_consumption_latest_report','get_sold_recipe_consumption_report'])('shares %s reads without evicting unrelated read-only report snapshots', async (rpc) => {
    const base=vi.fn(async()=>Response.json({rows:[],summary:{count:0,total:0}}));
    const cache=createReportRequestCache(base);
    const consumption='https://example.test/rest/v1/rpc/'+rpc;
    await cache.fetch(url,options());
    await Promise.all([cache.fetch(consumption,options()),cache.fetch(consumption,options())]);
    await cache.fetch(consumption,options()); await cache.fetch(url,options());
    expect(base).toHaveBeenCalledTimes(2);
    await cache.fetch(consumption,options('other-branch'));expect(base).toHaveBeenCalledTimes(3);
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
  it('holds the report slot until its body drains while operational requests bypass it', async () => {
    let drain!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      drain = () => { controller.enqueue(new TextEncoder().encode('{"revenue":12}')); controller.close(); };
    } });
    const base = vi.fn().mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } })).mockImplementation(async () => response());
    const cache = createReportRequestCache(base);
    const first = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    const queued = cache.fetch(url, options('b'));
    for (const name of ['process_sale_idempotent', 'send_to_kitchen', 'enqueue_cloud_open_order_print']) {
      await cache.fetch('https://example.test/rest/v1/rpc/' + name, options());
    }
    expect(base).toHaveBeenCalledTimes(4);
    drain(); await first; await queued;
    expect(base).toHaveBeenCalledTimes(5);
  });
  it('drains a dispatched read after its last caller leaves before starting the next report', async () => {
    let finish!: (value: Response) => void;
    let dispatchedSignal: AbortSignal | undefined;
    const base = vi.fn().mockImplementationOnce((input: Request) => {
      dispatchedSignal = input.signal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }).mockImplementation(async () => response());
    const cache = createReportRequestCache(base); const controller = new AbortController();
    const first = cache.fetch(url, options('a', 'Bearer reader', controller.signal));
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    const next = cache.fetch(url, options('b'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dispatchedSignal?.aborted).toBe(false); expect(base).toHaveBeenCalledTimes(1);
    finish(response()); await next; expect(base).toHaveBeenCalledTimes(2);
  });
  it('skips abandoned queued reads and advances after failures', async () => {
    let finish!: (value: Response) => void;
    const base = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('network')).mockImplementation(async () => response());
    const cache = createReportRequestCache(base);
    const first = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const abandoned = cache.fetch(url, options('b', 'Bearer reader', controller.signal));
    const rejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    // Let the body/key processing enqueue before cancellation.
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(); await rejected;
    const failure = cache.fetch(url, options('c'));
    const failureCheck = expect(failure).rejects.toThrow('network');
    const next = cache.fetch(url, options('d'));
    finish(response()); await first; await failureCheck; await next;
    expect(base).toHaveBeenCalledTimes(3);
    // The skipped branch can still be explicitly requested later.
    await cache.fetch(url, options('b')); expect(base).toHaveBeenCalledTimes(4);
  });
  it('keeps a queued shared read when one consumer leaves and serves cached reads without waiting', async () => {
    let finish!: (value: Response) => void;
    const base = vi.fn().mockResolvedValueOnce(response(7)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response());
    const cache = createReportRequestCache(base);
    await cache.fetch(url, options('cached'));
    const first = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(2));
    const controller = new AbortController();
    const leaving = cache.fetch(url, options('b', 'Bearer reader', controller.signal));
    const staying = cache.fetch(url, options('b'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const rejected = expect(leaving).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    expect(await (await cache.fetch(url, options('cached'))).json()).toEqual({ revenue: 7 });
    expect(base).toHaveBeenCalledTimes(2);
    finish(response()); await first; await staying;
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('invalidates reuse on a table write and never caches operational RPCs', async () => {
    const base = vi.fn(async () => response()); const cache = createReportRequestCache(base);
    await cache.fetch(url, options());
    await cache.fetch('https://example.test/rest/v1/sales', { method: 'PATCH', body: '{}' });
    await cache.fetch(url, options()); expect(base).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 2; i++) await cache.fetch('https://example.test/rest/v1/rpc/pos_create_order', options());
    expect(base).toHaveBeenCalledTimes(5);
  });
  it('invalidates reports read while a write was still awaiting completion', async () => {
    let finish!: (value: Response) => void; let reads = 0;
    const writePending = new Promise<Response>(resolve => { finish = resolve; });
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.method === 'PATCH' ? writePending : response(++reads);
    });
    const cache = createReportRequestCache(base);
    await cache.fetch(url, options());
    const writing = cache.fetch('https://example.test/rest/v1/sales', { method: 'PATCH', body: '{}' });
    await cache.fetch(url, options()); expect(reads).toBe(2);
    finish(Response.json({ success: true })); await writing;
    expect(await (await cache.fetch(url, options())).json()).toEqual({ revenue: 3 });
  });
  it('does not publish a read that completed after a mutation', async () => {
    let finish!: (value: Response) => void;
    const base = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response(20));
    const cache = createReportRequestCache(base); const old = cache.fetch(url, options());
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    await cache.fetch('https://example.test/rest/v1/rpc/set_raw_material_price', options());
    const fresh = cache.fetch(url, options());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(base).toHaveBeenCalledTimes(2); // The write bypassed the active report.
    finish(response(12)); await old; await fresh;
    expect(await (await cache.fetch(url, options())).json()).toEqual({ revenue: 20 }); expect(base).toHaveBeenCalledTimes(3);
  });
});

describe('costing read sharing and nonfinancial telemetry',()=>{
 it.each(['get_raw_material_latest_valuation','get_raw_consumption_latest_cost'])('shares the current costing RPC %s',async(name)=>{
  const base=vi.fn(async()=>Response.json([]));const cache=createReportRequestCache(base);
  const target='https://example.test/rest/v1/rpc/'+name;
  await cache.fetch(target,options());await cache.fetch(target,options());expect(base).toHaveBeenCalledTimes(1);
 });
 it('keeps a valid report through issue logging but invalidates it on a financial write',async()=>{
  const base=vi.fn(async()=>Response.json({value:1}));const cache=createReportRequestCache(base);
  await cache.fetch(url,options());
  await cache.fetch('https://example.test/rest/v1/rpc/record_user_issue',options());
  await cache.fetch(url,options());expect(base).toHaveBeenCalledTimes(2);
  await cache.fetch('https://example.test/rest/v1/rpc/set_raw_material_price',options());
  await cache.fetch(url,options());expect(base).toHaveBeenCalledTimes(4);
 });
});
