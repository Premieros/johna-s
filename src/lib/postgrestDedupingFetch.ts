type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestKey(input: RequestInfo | URL, init?: RequestInit): string | null {
  try {
    const request = new Request(input, init);
    if (request.method.toUpperCase() !== 'GET') return null;

    const url = new URL(request.url);
    // Only coalesce read-only PostgREST SELECT traffic. Auth, Storage,
    // Realtime and every mutation remain completely untouched.
    if (!url.pathname.startsWith('/rest/v1/')) return null;

    return [
      request.method.toUpperCase(),
      request.url,
      request.headers.get('authorization') || '',
      request.headers.get('apikey') || '',
      request.headers.get('accept') || '',
      request.headers.get('accept-profile') || '',
      request.headers.get('range') || '',
      request.headers.get('range-unit') || '',
      request.headers.get('prefer') || '',
    ].join('\n');
  } catch {
    return null;
  }
}

/**
 * Coalesces only identical, concurrent PostgREST GET requests.
 *
 * This intentionally does not keep a time-based response cache: after a write,
 * the next read must always be able to reach the server immediately. The layer
 * removes duplicate network work created by parallel components/effects while
 * preserving the existing freshness and RLS semantics.
 */
export function createPostgrestDedupingFetch(baseFetch: FetchLike): FetchLike {
  const inFlight = new Map<string, Promise<Response>>();

  return async (input, init) => {
    const key = requestKey(input, init);
    if (!key) return baseFetch(input, init);

    let pending = inFlight.get(key);
    if (!pending) {
      pending = baseFetch(input, init).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }

    // Every Supabase caller consumes its own response body. Keep the shared
    // response untouched and hand a clone to each caller.
    const response = await pending;
    return response.clone();
  };
}

export const postgrestDedupingFetch = createPostgrestDedupingFetch((input, init) =>
  globalThis.fetch(input, init)
);
