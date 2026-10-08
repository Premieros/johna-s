import { loadStationSalesLines, type StationLine } from './stationSalesReport';

export interface ProductSalesSummary {
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
export function summarizeProductSales(lines: StationLine[]): ProductSalesSummary[] {
  const groups = new Map<string, ProductSalesSummary>();
  for (const line of lines) {
    const { sale, item } = line;
    // Names are labels, not identity. Different sale units remain separate rows.
    const key = JSON.stringify([sale.branch_id, item.product_id || item.id, item.unit_name]);
    const group = groups.get(key) || {
      branchId: sale.branch_id, productId: item.product_id,
      name: item.product?.name || '', unit: item.unit_name,
      soldQuantity: 0, returnedQuantity: 0, netQuantity: 0,
      gross: 0, discount: 0, tax: 0, refunded: 0, net: 0, netBeforeTax: 0,
    };
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
  return summarizeProductSales(await loadStationSalesLines({ ...args, includeCost: false }));
}
