import { describe, expect, it } from 'vitest';
import { createPostgrestDedupingFetch } from '@/lib/postgrestDedupingFetch';

describe('PostgREST duplicate read coalescing', () => {
  it('shares one network request for identical concurrent GET reads', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const baseFetch = async () => {
      calls += 1;
      await gate;
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const fetcher = createPostgrestDedupingFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/branches?select=*';

    const first = fetcher(url, { headers: { Authorization: 'Bearer same-user' } });
    const second = fetcher(url, { headers: { Authorization: 'Bearer same-user' } });

    expect(calls).toBe(1);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(await a.json()).toEqual([{ id: 1 }]);
    expect(await b.json()).toEqual([{ id: 1 }]);
    expect(calls).toBe(1);
  });

  it('does not coalesce different RLS identities or mutations', async () => {
    let calls = 0;
    const baseFetch = async () => {
      calls += 1;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const fetcher = createPostgrestDedupingFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/branches?select=*';

    await Promise.all([
      fetcher(url, { headers: { Authorization: 'Bearer user-a' } }),
      fetcher(url, { headers: { Authorization: 'Bearer user-b' } }),
    ]);
    await Promise.all([
      fetcher(url, { method: 'POST', body: '{}' }),
      fetcher(url, { method: 'POST', body: '{}' }),
    ]);

    expect(calls).toBe(4);
  });

  it('never reuses a completed response', async () => {
    let calls = 0;
    const baseFetch = async () => {
      calls += 1;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const fetcher = createPostgrestDedupingFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/products?select=id';

    await fetcher(url);
    await fetcher(url);

    expect(calls).toBe(2);
  });

  it('does not attach a post-mutation read to an older in-flight read', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const baseFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if ((init?.method || 'GET').toUpperCase() === 'GET' && calls === 1) await gate;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const fetcher = createPostgrestDedupingFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/warehouses?select=*';

    const beforeWrite = fetcher(url);
    await fetcher('https://example.supabase.co/rest/v1/rpc/set_table_status', {
      method: 'POST',
      body: '{}',
    });
    const afterWrite = fetcher(url);
    expect(calls).toBe(3);

    release();
    await Promise.all([beforeWrite, afterWrite]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('coalesces a burst of 20 identical dashboard RPCs into one read without caching the result', async () => {
  const gate = deferred<Response>();
  let calls = 0;
  const fetcher = createPostgrestDedupingFetch(async () => { calls++; return gate.promise.then(response => response.clone()); });
  const url = 'https://example.supabase.co/rest/v1/rpc/get_dashboard_sales_snapshot';
  const reads = Array.from({ length: 20 }, () => fetcher(url, { method: 'POST', body: '{"p_branch_id":"a"}' }));
  gate.resolve(new Response('{"sales":100}'));
  const responses = await Promise.all(reads);
  expect(calls).toBe(1);
  expect(await Promise.all(responses.map(r => r.json()))).toEqual(Array(20).fill({ sales: 100 }));
  await fetcher(url, { method: 'POST', body: '{"p_branch_id":"a"}' });
  expect(calls).toBe(2);
});

it('separates RPC parameters, identity, schema and additional headers', async () => {
  let calls = 0;
  const fetcher = createPostgrestDedupingFetch(async () => { calls++; return new Response('{}'); });
  const url = 'https://example.supabase.co/rest/v1/rpc/get_dashboard_sales_snapshot';
  const variants: RequestInit[] = [
    { body: '{"p_branch_id":"a"}', headers: { authorization: 'Bearer a' } },
    { body: '{"p_branch_id":"b"}', headers: { authorization: 'Bearer a' } },
    { body: '{"p_branch_id":"a"}', headers: { authorization: 'Bearer b' } },
    { body: '{"p_branch_id":"a"}', headers: { authorization: 'Bearer a', 'content-profile': 'private' } },
    { body: '{"p_branch_id":"a"}', headers: { authorization: 'Bearer a', 'x-custom-context': 'different' } },
  ];
  await Promise.all(variants.map(init => fetcher(url, { ...init, method: 'POST' })));
  expect(calls).toBe(5);
});

it('lets each caller cancel independently without aborting a shared read needed by another screen', async () => {
  const gate = deferred<Response>();
  let serverSignal!: AbortSignal;
  const fetcher = createPostgrestDedupingFetch(async input => {
    serverSignal = (input as Request).signal;
    return gate.promise.then(response => response.clone());
  });
  const a = new AbortController();
  const b = new AbortController();
  const url = 'https://example.supabase.co/rest/v1/orders?select=*';
  const first = fetcher(url, { signal: a.signal });
  const second = fetcher(url, { signal: b.signal });
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  a.abort();
  await rejected;
  expect(serverSignal.aborted).toBe(false);
  gate.resolve(new Response('[{"id":"current"}]'));
  expect(await (await second).json()).toEqual([{ id: 'current' }]);
});

it('abandons a read when all consumers leave and never attaches a later caller to it', async () => {
  const gate = deferred<Response>();
  const signals: AbortSignal[] = [];
  const fetcher = createPostgrestDedupingFetch(async input => {
    signals.push((input as Request).signal);
    return gate.promise.then(response => response.clone());
  });
  const abort = new AbortController();
  const url = 'https://example.supabase.co/rest/v1/orders?select=id';
  const first = fetcher(url, { signal: abort.signal });
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); await rejected;
  expect(signals[0].aborted).toBe(true);
  const next = fetcher(url);
  expect(signals).toHaveLength(2);
  gate.resolve(new Response('[]'));
  await next;
});

it('does not let a post-commit read attach to one dispatched while a write was in progress', async () => {
  const write = deferred<Response>();
  const read = deferred<Response>();
  let reads = 0;
  const fetcher = createPostgrestDedupingFetch(async input => {
    const request = input as Request;
    if (typeof input === 'string' && input.includes('/rpc/update_order')) return write.promise;
    if (request.url?.includes('/orders?')) { reads++; return read.promise.then(response => response.clone()); }
    return new Response('{}');
  });
  const mutation = fetcher('https://example.supabase.co/rest/v1/rpc/update_order', { method: 'POST', body: '{}' });
  const during = fetcher('https://example.supabase.co/rest/v1/orders?select=*');
  write.resolve(new Response('{}')); await mutation;
  const after = fetcher('https://example.supabase.co/rest/v1/orders?select=*');
  expect(reads).toBe(2);
  read.resolve(new Response('[]')); await Promise.all([during, after]);
});

it('never merges send, payment, print or unreviewed RPC writes', async () => {
  let calls = 0;
  const fetcher = createPostgrestDedupingFetch(async () => { calls++; return new Response('{}'); });
  await Promise.all(['send_to_kitchen', 'process_sale_idempotent', 'enqueue_cloud_receipt_print', 'get_unknown'].flatMap(name =>
    [1, 2].map(() => fetcher(`https://example.supabase.co/rest/v1/rpc/${name}`, { method: 'POST', body: '{}' })),
  ));
  expect(calls).toBe(8);
});
