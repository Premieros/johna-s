import { loadStationSalesLines, type StationLine } from './stationSalesReport';

export interface ProductSalesSummary {
  bonusQuantity: number;
  invoiceCount: number;
  options: string;
  category: string;
  station: string;
  branchId: string;
  productId: string | null;
  name: string;
  unit: string;
  soldQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  gross: number;
  discount: number;
  tax: number;
  refunded: number;
  net: number;
  netBeforeTax: number;
}

/** Aggregate already allocated invoice lines; never allocate after product filtering. */
export function summarizeProductSales(lines: StationLine[], byOptions = false, lang: 'ar'|'en' = 'ar'): ProductSalesSummary[] {
  const invoices = new Map<string, Set<string>>();
  const groups = new Map<string, ProductSalesSummary>();
  for (const line of lines) {
    const { sale, item } = line;
    // Names are labels, not identity. Different sale units remain separate rows.
    if (byOptions && !Object.prototype.hasOwnProperty.call(item, 'modifiers_snapshot')) throw new Error('SALES_OPTIONS_SOURCE_UNAVAILABLE');
    if (byOptions && (!Array.isArray(item.modifiers_snapshot) || (item.modifier_option_ids || []).some(id=>!item.modifiers_snapshot!.some(option=>option.option_id===id)))) throw new Error('SALES_OPTIONS_SOURCE_UNAVAILABLE');
    const options = [...(item.modifiers_snapshot || [])].sort((a,b) => a.option_id.localeCompare(b.option_id));
    const signature = options.map(option => [option.group_id,option.option_id,Number(option.price_delta)]);
    const key = JSON.stringify([sale.branch_id, item.product_id || item.id, item.unit_name, ...(byOptions ? [signature] : [])]);
    const invoiceIds = invoices.get(key) || new Set<string>(); invoiceIds.add(sale.id); invoices.set(key,invoiceIds);
    const group = groups.get(key) || {
      bonusQuantity: 0, invoiceCount: 0, category: line.category, station: line.station,
      options: options.map(option => `${lang==='en' ? option.group_name_en || option.group_name : option.group_name}: ${lang==='en' ? option.option_name_en || option.option_name : option.option_name}`).join('، '),
      branchId: sale.branch_id, productId: item.product_id,
      name: item.product?.name || '', unit: item.unit_name,
      soldQuantity: 0, returnedQuantity: 0, netQuantity: 0,
      gross: 0, discount: 0, tax: 0, refunded: 0, net: 0, netBeforeTax: 0,
    };
    group.bonusQuantity += Number(item.bonus_quantity || 0);
    group.invoiceCount = invoiceIds.size;
    group.soldQuantity += Number(item.quantity || 0);
    group.returnedQuantity += Number(item.refunded_quantity || 0);
    group.netQuantity += line.netQuantity;
    group.gross += line.gross;
    group.discount += line.discount;
    group.tax += line.tax;
    group.refunded += line.refunded;
    group.net += line.net;
    group.netBeforeTax += line.netBeforeTax;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.net - a.net);
}

export async function loadProductSalesSummary(args: Parameters<typeof loadStationSalesLines>[0]): Promise<ProductSalesSummary[]> {
  return summarizeProductSales(await loadStationSalesLines({ ...args, includeCost: false }), args.filters.sales_view === 'options', args.lang);
}
