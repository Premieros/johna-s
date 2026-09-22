type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

/**
 * Coordinates only identical PostgREST GET requests that are concurrently
 * in flight. Completed responses are never cached or reused.
 *
 * A mutation/RPC advances the generation so a GET started after the write
 * cannot attach to an older pre-mutation read that is still in flight.
 */
export function createPostgrestDedupingFetch(baseFetch: FetchLike): FetchLike {
  const inFlight = new Map<string, Promise<Response>>();
  let generation = 0;

  return async (input, init) => {
    const request = postgrestRequest(input, init);
    if (!request) return baseFetch(input, init);

    const method = request.method.toUpperCase();
    if (method !== 'GET') {
      generation += 1;
      return baseFetch(input, init);
    }

    const key = requestKey(request);
    if (!key) return baseFetch(input, init);

    const flightKey = `${generation}\n${key}`;
    let pending = inFlight.get(flightKey);
    if (!pending) {
      pending = baseFetch(input, init).finally(() => {
        inFlight.delete(flightKey);
      });
      inFlight.set(flightKey, pending);
    }

    const response = await pending;
    return response.clone();
  };
}

export const postgrestDedupingFetch = createPostgrestDedupingFetch((input, init) =>
  globalThis.fetch(input, init)
);
