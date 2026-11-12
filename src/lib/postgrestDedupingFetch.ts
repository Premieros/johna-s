type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Explicitly reviewed read-only RPCs. Never infer safety from a function's name.
// These stay outside the report queue: a display read must not delay operations.
const sharedReadRpcs = new Set([
  'get_dashboard_sales_snapshot',
  'get_open_order_print_state',
  'get_pos_order_operator_labels',
]);

export const isSharedReadRpc = (name: string): boolean => sharedReadRpcs.has(name);

function postgrestRequest(input: RequestInfo | URL, init?: RequestInit): Request | null {
  try {
    // Inspect a Request without transferring/consuming its upload body.
    const request = input instanceof Request && !init
      ? input
      : new Request(input instanceof Request ? input.clone() : input, init);
    return new URL(request.url).pathname.startsWith('/rest/v1/') ? request : null;
  } catch {
    return null;
  }
}

function requestKey(request: Request, body: string): string {
  // Include every header (identity, schema, range and custom request semantics).
  // Keep the authorization header explicit for the permission boundary audit.
  return JSON.stringify([
    request.method, request.url, request.headers.get('authorization'),
    [...request.headers.entries()].sort(([a], [b]) => a.localeCompare(b)), body,
  ]);
}

interface ReadSnapshot {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: [string, string][];
}
interface ReadFlight {
  pending: Promise<ReadSnapshot>;
  controller: AbortController;
  consumers: number;
}

function consume(flight: ReadFlight, signal: AbortSignal, abandon: () => void): Promise<Response> {
  flight.consumers += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener('abort', abort);
      flight.consumers -= 1;
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      if (!flight.consumers) abandon();
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    // Observe completion even when this caller has already left.
    flight.pending.then(snapshot => {
      if (!finish()) return;
      const body = [204, 205, 304].includes(snapshot.status) ? null : snapshot.body.slice(0);
      resolve(new Response(body, snapshot));
    }, error => { if (finish()) reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Shares identical in-flight reads, never a completed or pre-mutation response.
 * Each caller cancels independently; no operational write is queued or merged.
 */
export function createPostgrestDedupingFetch(baseFetch: FetchLike): FetchLike {
  const inFlight = new Map<string, ReadFlight>();
  let generation = 0;

  return async (input, init) => {
    const request = postgrestRequest(input, init);
    if (!request) return baseFetch(input, init);
    const method = request.method.toUpperCase();
    const path = new URL(request.url).pathname;
    const rpcName = path.startsWith('/rest/v1/rpc/') ? path.slice('/rest/v1/rpc/'.length) : '';
    const readOnlyPost = method === 'POST' && isSharedReadRpc(rpcName);
    if (method !== 'GET' && !readOnlyPost) {
      generation += 1;
      try { return await baseFetch(input, init); }
      finally { generation += 1; }
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : request.signal);
    signal.throwIfAborted();
    // Preserve the exact RPC body: different parameters never share a response.
    const body = readOnlyPost ? await request.clone().text() : '';
    signal.throwIfAborted();
    const flightKey = `${generation}\n${requestKey(request, body)}`;
    let flight = inFlight.get(flightKey);
    if (!flight) {
      const controller = new AbortController();
      const entry: ReadFlight = { pending: undefined!, controller, consumers: 0 };
      entry.pending = baseFetch(new Request(request, { signal: controller.signal }))
        .then(async response => ({
          body: await response.arrayBuffer(), status: response.status,
          statusText: response.statusText, headers: [...response.headers.entries()],
        }))
        .finally(() => { if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey); });
      inFlight.set(flightKey, entry);
      flight = entry;
    }
    const subscribed = flight;
    return consume(subscribed, signal, () => {
      if (inFlight.get(flightKey) === subscribed) inFlight.delete(flightKey);
      subscribed.controller.abort();
    });
  };
}

export const postgrestDedupingFetch = createPostgrestDedupingFetch((input, init) =>
  globalThis.fetch(input, init)
);
