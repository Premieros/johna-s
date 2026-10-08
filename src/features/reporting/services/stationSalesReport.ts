import { loadRawCurrentPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
import { type ReportFilters } from '../reportFilters';
import { loadSalesReportRows } from './reportCoreLoaders';
import { MAX_REPORT_SOURCE_ROWS } from '../reportReadLimits';

export interface StationSaleItem {
  id: string; product_id: string | null; unit_name: string; quantity: number;
  unit_price: number; discount_amount: number; total: number;
  refunded_quantity: number; refunded_amount: number; source_order_item_id: string | null;
  product: { name: string; category_id: string | null; category: { name: string; kitchen_station_id: string | null; station: { id: string; name_ar: string; name_en: string | null } | null } | null } | null;
}
export interface StationSale {
  id: string; branch_id: string; invoice_number: string; created_at: string;
  subtotal: number; total: number; tax_amount: number; refunded_amount: number;
  status: string; payment_method: string; order_type: string;
  cashier: { full_name: string } | null; customer: { name: string } | null;
  items: StationSaleItem[];
}
export interface StationLine {
  sale: StationSale; item: StationSaleItem; stationId: string; station: string; category: string;
  gross: number; discount: number; tax: number; original: number; refunded: number;
  net: number; netBeforeTax: number; netQuantity: number;
  cost: number | null;
  estimatedCost: number | null;
  knownEstimatedCost: number | null;
  unpricedMaterials: string[];
}
export interface CostLedgerLine { reference_id: string; raw_material_id: string; quantity: number; total_cost: number; batch_number?: string | null }
export interface CostEvent {
  id: string; settled_sale_id: string; order_item_id: string;
  sent_quantity: number; voided_quantity: number; total_cost: number;
  component_snapshot: { raw_material_id: string; raw_name?: string; quantity: number }[];
}
const n = (v: unknown) => Number(v || 0);

/** Invoice-level cent allocation with a deterministic residual, BEFORE dimension filters. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return weights.map(() => 0);
  const cents = Math.round(amount * 100);
  const shares = weights.map(value => cents * Math.max(0, value) / total);
  const allocated = shares.map(Math.floor);
  const remaining = cents - allocated.reduce((sum, value) => sum + value, 0);
  const order = shares.map((value, i) => ({ i, fraction: value - allocated[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0; i < remaining; i++) allocated[order[i % order.length].i]++;
  return allocated.map(value => value / 100);
}

export function buildStationSalesLines(sales: StationSale[], filters: ReportFilters, lang: 'ar' | 'en', costs: CostEvent[] = [], currentPrices: Record<string, number | null> = {}, ledger: CostLedgerLine[] = []): StationLine[] {
  const costMap = new Map<string, { quantity: number; cost: number; complete: boolean; estimate: number; estimateAvailable: boolean; missing: Set<string> }>();
  const ledgerMap = new Map<string, CostLedgerLine[]>();
  for (const row of ledger) {
    const rows = ledgerMap.get(row.reference_id) || [];
    rows.push(row); ledgerMap.set(row.reference_id, rows);
  }
  for (const event of costs) {
    const key = `${event.settled_sale_id}:${event.order_item_id}`;
    const previous = costMap.get(key) || { quantity: 0, cost: 0, complete: true, estimate: 0, estimateAvailable: true, missing: new Set<string>() };
    // event total_cost is the original send snapshot; voided units restore that cost proportionally.
    const quantity = Math.max(0, n(event.sent_quantity) - n(event.voided_quantity));
    if (quantity === 0) continue;
    const snapshot = event.component_snapshot || [];
    const movements = (ledgerMap.get(event.id) || []).filter(row => n(row.quantity) < 0);
    const expected = new Map<string, number>();
    for (const component of snapshot) expected.set(component.raw_material_id, (expected.get(component.raw_material_id) || 0) + n(component.quantity));
    const actual = new Map<string, number>();
    let movementCost = 0;
    for (const movement of movements) {
      actual.set(movement.raw_material_id, (actual.get(movement.raw_material_id) || 0) - n(movement.quantity));
      movementCost += Math.abs(n(movement.total_cost));
    }
    // Missing RLS-visible movement coverage and unpriced negative debt are incomplete.
    previous.complete &&= snapshot.length > 0 && expected.size === actual.size
      && [...expected].every(([id, qty]) => qty > 0 && Math.abs(qty - (actual.get(id) || 0)) < 0.000001)
      && movements.every(row => Math.abs(n(row.total_cost)) > 0 && !row.batch_number?.startsWith('OV-'))
      && Math.abs(movementCost - n(event.total_cost)) < 0.0001;
    previous.estimateAvailable &&= snapshot.length > 0 && n(event.sent_quantity) > 0;
    for (const component of snapshot) {
      const price = currentPrices[component.raw_material_id];
      if (price == null || !Number.isFinite(price) || price <= 0 || n(component.quantity) <= 0) {
        previous.missing.add(component.raw_name || component.raw_material_id);
      } else {
        previous.estimate += n(component.quantity) * price * quantity / n(event.sent_quantity);
      }
    }
    previous.quantity += quantity;
    previous.cost += n(event.sent_quantity) > 0 ? n(event.total_cost) * quantity / n(event.sent_quantity) : 0;
    costMap.set(key, previous);
  }
  return sales.flatMap(sale => {
    const items = [...(sale.items || [])].sort((a, b) => a.id.localeCompare(b.id));
    const weights = items.map(item => Math.max(0, n(item.total)));
    const original = allocate(n(sale.total), weights);
    const taxes = allocate(n(sale.tax_amount), weights);
    // Refund RPC stores item refund values without invoice-level discount/tax.
    const refundWeights = items.map(item => Math.max(0, n(item.refunded_amount)));
    const refunds = allocate(n(sale.refunded_amount), refundWeights.some(Boolean) ? refundWeights : weights);
    const sourceCounts = new Map<string, number>();
    items.forEach(item => { if (item.source_order_item_id) sourceCounts.set(item.source_order_item_id, (sourceCounts.get(item.source_order_item_id) || 0) + 1); });
    return items.map((item, i): StationLine => {
      const category = item.product?.category;
      const station = category?.station;
      const gross = n(item.quantity) * n(item.unit_price);
      const refunded = Math.min(original[i], refunds[i]);
      const net = Math.max(0, original[i] - refunded);
      const netQuantity = Math.max(0, n(item.quantity) - n(item.refunded_quantity));
      const costSource = costMap.get(`${sale.id}:${item.source_order_item_id}`);
      const exactCost = costSource && sourceCounts.get(item.source_order_item_id || '') === 1 && Math.abs(costSource.quantity - n(item.quantity)) < 0.000001;
      return {
        sale, item, stationId: station?.id || 'unassigned',
        station: (lang === 'ar' ? station?.name_ar : station?.name_en || station?.name_ar) || (lang === 'ar' ? 'غير محدد' : 'Unassigned'),
        category: category?.name || (lang === 'ar' ? 'غير مصنف' : 'Uncategorized'),
        gross, discount: gross - (original[i] - taxes[i]), tax: taxes[i],
        original: original[i], refunded, net,
        netBeforeTax: original[i] > 0 ? net * (original[i] - taxes[i]) / original[i] : 0,
        netQuantity,
        cost: exactCost && costSource.complete && n(item.quantity) > 0 ? costSource.cost * netQuantity / n(item.quantity) : null,
        estimatedCost: exactCost && costSource.estimateAvailable && !costSource.missing.size && n(item.quantity) > 0 ? costSource.estimate * netQuantity / n(item.quantity) : null,
        knownEstimatedCost: exactCost && costSource.estimateAvailable && n(item.quantity) > 0 ? costSource.estimate * netQuantity / n(item.quantity) : null,
        unpricedMaterials: costSource ? [...costSource.missing].sort() : [],
      };
    });
  }).filter(line => (!filters.station || line.stationId === filters.station)
    && (!filters.category || line.item.product?.category_id === filters.category)
    && (!filters.product || line.item.product_id === filters.product));
}

export async function loadStationSalesLines(args: { branchId: string | null; from: string; to: string; fromTs: string; toExclusiveTs: string; filters: ReportFilters; lang: 'ar' | 'en'; includeCost: boolean; signal?: AbortSignal }): Promise<StationLine[]> {
  // Canonical invoice scope and bounded whole-invoice items; allocation precedes line filters.
  const sales = await loadSalesReportRows({ ...args, includeItems: true, settledOnly: true }) as unknown as StationSale[];
  if (sales.some(sale => !sale.items?.length || sale.items.length > 5000)) throw new Error('STATION_REPORT_INCOMPLETE_ITEMS');
  const events: CostEvent[] = [];
  if (args.includeCost) {
    const ids = sales.filter(sale => sale.items.some(item => item.source_order_item_id)).map(sale => sale.id);
    for (let i = 0; i < ids.length; i += 100) {
      let costQuery = supabase.from('order_kitchen_inventory_events').select('id,settled_sale_id,order_item_id,sent_quantity,voided_quantity,total_cost,component_snapshot').in('settled_sale_id', ids.slice(i, i + 100)).order('id');
      if (args.branchId) costQuery = costQuery.eq('branch_id', args.branchId);
      events.push(...await fetchAllReportRows(costQuery as unknown as RangePageQuery<CostEvent>, 1000, args.signal, MAX_REPORT_SOURCE_ROWS - events.length));
    }
  }
  const ledger: CostLedgerLine[] = [];
  let prices: Record<string, number | null> = {};
  if (args.includeCost && events.length) {
    const rawIds = [...new Set(events.flatMap(event => (event.component_snapshot || []).map(component => component.raw_material_id)))];
    if (rawIds.length > MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT');
    args.signal?.throwIfAborted();
    prices = rawCurrentPriceMap(await loadRawCurrentPrices(args.branchId, rawIds));
    args.signal?.throwIfAborted();
    const eventIds = events.map(event => event.id);
    for (let i = 0; i < eventIds.length; i += 100) {
      let ledgerQuery = supabase.from('inventory_ledger')
        .select('reference_id,raw_material_id,quantity,total_cost,batch_number')
        .eq('reference_type', 'kitchen_send').lt('quantity', 0)
        .in('reference_id', eventIds.slice(i, i + 100)).order('id');
      if (args.branchId) ledgerQuery = ledgerQuery.eq('branch_id', args.branchId);
      ledger.push(...await fetchAllReportRows(ledgerQuery as unknown as RangePageQuery<CostLedgerLine>, 1000, args.signal, MAX_REPORT_SOURCE_ROWS - ledger.length));
    }
  }
  return buildStationSalesLines(sales, args.filters, args.lang, events, prices, ledger);
}
