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
    const baseFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
