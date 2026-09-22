type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const READ_REUSE_WINDOW_MS = 1_500;

function postgrestRequest(input: RequestInfo | URL, init?: RequestInit): Request | null {
  try {
    const request = new Request(input, init);
    const url = new URL(request.url);
    return url.pathname.startsWith('/rest/v1/') ? request : null;
  } catch {
    return null;
  }
}

function requestKey(request: Request): string | null {
  if (request.method.toUpperCase() !== 'GET') return null;

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
}

interface CachedRead {
  response: Response;
  expiresAt: number;
  generation: number;
}

/**
 * Coordinates identical PostgREST reads across the whole application.
 *
 * - Concurrent identical GETs share one network call.
 * - A completed successful GET may be reused for only 1.5s, which collapses
 *   StrictMode/remount/effect bursts without becoming an application data cache.
 * - Any PostgREST mutation/RPC request invalidates the completed-read microcache
 *   and advances the generation so a following read never waits on an older
 *   pre-mutation request.
 * - The key includes the auth identity and response-affecting headers, preserving
 *   RLS/user isolation.
 */
export function createPostgrestDedupingFetch(baseFetch: FetchLike): FetchLike {
  const inFlight = new Map<string, Promise<Response>>();
  const recentReads = new Map<string, CachedRead>();
  let generation = 0;

  return async (input, init) => {
    const request = postgrestRequest(input, init);
    if (!request) return baseFetch(input, init);

    const method = request.method.toUpperCase();
    if (method !== 'GET') {
      generation += 1;
      recentReads.clear();
      return baseFetch(input, init);
    }

    const key = requestKey(request);
    if (!key) return baseFetch(input, init);

    const now = Date.now();
    const cached = recentReads.get(key);
    if (cached) {
      if (cached.generation === generation && cached.expiresAt > now) {
        return cached.response.clone();
      }
      recentReads.delete(key);
    }

    const requestGeneration = generation;
    const flightKey = `${requestGeneration}\n${key}`;
    let pending = inFlight.get(flightKey);
    if (!pending) {
      pending = baseFetch(input, init)
        .then((response) => {
          if (response.ok && generation === requestGeneration) {
            recentReads.set(key, {
              response,
              expiresAt: Date.now() + READ_REUSE_WINDOW_MS,
              generation: requestGeneration,
            });
          }
          return response;
        })
        .finally(() => {
          inFlight.delete(flightKey);
        });
      inFlight.set(flightKey, pending);
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
