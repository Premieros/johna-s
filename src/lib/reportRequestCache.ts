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
  'get_raw_material_current_prices',
]);
interface Snapshot { body: ArrayBuffer; status: number; statusText: string; headers: [string, string][]; }
const responseFrom = (snapshot: Snapshot) => new Response(snapshot.body.slice(0), snapshot);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function waitForRead(pending: Promise<Snapshot>, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(responseFrom(value)); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Bounded, in-memory sharing of identical reports for at most one minute.
 * JWT, all headers and every parameter are part of the key. A write invalidates
 * both completed reuse and attachment to reads started before that write.
 * Each caller can cancel independently of another screen using the same read.
 */
export function createReportRequestCache(baseFetch: FetchLike, { ttl = 60_000, maxEntries = 16, maxBytes = 2 * 1024 * 1024, now = Date.now } = {}) {
  const completed = new Map<string, { value: Snapshot; expires: number }>();
  const inFlight = new Map<string, Promise<Snapshot>>();
  let generation = 0;
  const clear = () => { generation += 1; completed.clear(); inFlight.clear(); };
  const fetch: FetchLike = async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); } catch { return baseFetch(input, init); }
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : request.signal);
    const path = new URL(request.url).pathname;
    const name = path.startsWith('/rest/v1/rpc/') ? path.slice('/rest/v1/rpc/'.length) : '';
    if (!reportRpcs.has(name) || !['GET', 'POST'].includes(request.method)) {
      if (path.startsWith('/rest/v1/') && !['GET', 'HEAD'].includes(request.method)) clear();
      return baseFetch(input, init);
    }
    const body = await request.clone().text();
    let params = body;
    try { if (body) params = JSON.stringify(stable(JSON.parse(body))); } catch { /* Preserve exact non-JSON body. */ }
    const key = JSON.stringify([request.method, request.url, [...request.headers.entries()].sort(), params]);
    const cached = completed.get(key);
    if (cached && cached.expires > now()) return waitForRead(Promise.resolve(cached.value), callerSignal);
    completed.delete(key);
    const readGeneration = generation;
    let pending = inFlight.get(key);
    if (!pending) {
      // One screen leaving must not abort a read another screen is awaiting.
      const sharedRequest = new Request(request, { signal: new AbortController().signal });
      pending = (async () => {
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
      })().finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    return waitForRead(pending, callerSignal);
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
