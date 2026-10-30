import { postgrestDedupingFetch } from './postgrestDedupingFetch';
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Only authoritative, read-only reporting RPCs belong here. Operational writes
// and live dashboards deliberately use the normal transport.
const reportRpcs = new Set([
  'get_operational_stock_source', 'get_operational_report_metrics', 'get_operational_report_dataset', 'get_operational_report_page',
  'get_trial_balance', 'get_trial_balance_summary', 'get_general_ledger', 'get_income_statement', 'get_balance_sheet',
  'get_ar_aging', 'get_ap_aging', 'get_aging_summary', 'get_cash_flow', 'get_party_statement',
  'get_treasury_account_statement', 'get_inventory_item_statement', 'get_sales_by_payment_report',
  'get_financial_reconciliation_report', 'get_day_closing_range_report', 'get_raw_material_consumption_report',
  'get_current_raw_material_valuation', 'get_raw_material_financial_report', 'get_sales_component_reconciliation_report',
  'get_costing_overview', 'get_product_costing_detail', 'get_cost_history', 'get_supplier_price_impact',
  'get_order_margin', 'get_costing_sales_summary', 'get_historical_sale_cost_estimates',
  'get_raw_material_cost_valuation_overview', 'get_raw_material_cost_history', 'get_raw_consumption_cost_breakdown',
  'get_raw_material_current_prices', 'get_raw_material_latest_valuation', 'get_raw_consumption_latest_cost', 'get_consumption_latest_report', 'get_sold_recipe_consumption_report',
]);
interface Snapshot { body: ArrayBuffer; status: number; statusText: string; headers: [string, string][]; }
const responseFrom = (snapshot: Snapshot) => new Response(snapshot.body.slice(0), snapshot);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function waitForRead(pending: Promise<Snapshot>, signal: AbortSignal, release = () => {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true; signal.removeEventListener('abort', abort); release(); return true;
    };
    const abort = () => { if (finish()) reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    // Always observe the shared promise, including when this caller already left.
    pending.then(value => { if (finish()) resolve(responseFrom(value)); }, error => { if (finish()) reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
interface Flight { pending: Promise<Snapshot>; consumers: number; }

/** Bounded, in-memory sharing of identical reports for at most one minute.
 * JWT, all headers and every parameter are part of the key. A write invalidates
 * both completed reuse and attachment to reads started before that write.
 * Each caller can cancel independently of another screen using the same read.
 * Distinct reads run one at a time per cache; operational requests bypass this queue.
 */
export function createReportRequestCache(baseFetch: FetchLike, { ttl = 60_000, maxEntries = 16, maxBytes = 2 * 1024 * 1024, now = Date.now } = {}) {
  const completed = new Map<string, { value: Snapshot; expires: number }>();
  const inFlight = new Map<string, Flight>();
  // Keep the slot until the response body drains. Aborting HTTP alone does not
  // prove PostgreSQL stopped, so dispatched reads are never canceled here.
  let readTail: Promise<void> = Promise.resolve();
  let generation = 0;
  const clear = () => { generation += 1; completed.clear(); inFlight.clear(); };
  const fetch: FetchLike = async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); } catch { return baseFetch(input, init); }
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : request.signal);
    const path = new URL(request.url).pathname;
    const name = path.startsWith('/rest/v1/rpc/') ? path.slice('/rest/v1/rpc/'.length) : '';
    if (!reportRpcs.has(name) || !['GET', 'POST'].includes(request.method)) {
      if (path.startsWith('/rest/v1/') && !['GET', 'HEAD'].includes(request.method) && name !== 'record_user_issue') {
        clear();
        try { return await baseFetch(input, init); } finally { clear(); }
      }
      return baseFetch(input, init);
    }
    const body = await request.clone().text();
    callerSignal.throwIfAborted();
    let params = body;
    try { if (body) params = JSON.stringify(stable(JSON.parse(body))); } catch { /* Preserve exact non-JSON body. */ }
    const key = JSON.stringify([request.method, request.url, [...request.headers.entries()].sort(), params]);
    const cached = completed.get(key);
    if (cached && cached.expires > now()) return waitForRead(Promise.resolve(cached.value), callerSignal);
    completed.delete(key);
    const readGeneration = generation;
    let flight = inFlight.get(key);
    if (!flight) {
      // One screen leaving must not abort a read another screen is awaiting.
      const sharedRequest = new Request(request, { signal: new AbortController().signal });
      const entry: Flight = { pending: undefined!, consumers: 0 };
      entry.pending = readTail.then(async () => {
        // A queued report abandoned by every caller needs no database read.
        if (!entry.consumers) throw new DOMException('Aborted', 'AbortError');
        const response = await baseFetch(sharedRequest);
        const bytes = await response.arrayBuffer();
        const snapshot: Snapshot = { body: bytes, status: response.status, statusText: response.statusText, headers: [...response.headers.entries()] };
        let valid = response.ok && bytes.byteLength <= maxBytes && (response.headers.get('content-type') || '').includes('json');
        try { const data = JSON.parse(new TextDecoder().decode(bytes)); valid = valid && !(data && (data.success === false || data.error)); } catch { valid = false; }
        if (valid && generation === readGeneration) {
          completed.set(key, { value: snapshot, expires: now() + ttl });
          while (completed.size > maxEntries) completed.delete(completed.keys().next().value!);
        }
        return snapshot;
      }).finally(() => { if (inFlight.get(key) === entry) inFlight.delete(key); });
      readTail = entry.pending.then(() => undefined, () => undefined);
      flight = entry;
      inFlight.set(key, entry);
    }
    flight.consumers += 1;
    const subscribed = flight;
    return waitForRead(subscribed.pending, callerSignal, () => { subscribed.consumers -= 1; });
  };
  return { fetch, clear };
}
const shared = createReportRequestCache(postgrestDedupingFetch);
export const reportCachingFetch = shared.fetch;
export const clearReportRequestCache = shared.clear;

let permissionVersion = 0;
const listeners = new Set<() => void>();
export const getReportPermissionVersion = () => permissionVersion;
export const subscribeReportPermissions = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function invalidateReportPermissions() {
  shared.clear(); permissionVersion += 1; listeners.forEach(listener => listener());
}
