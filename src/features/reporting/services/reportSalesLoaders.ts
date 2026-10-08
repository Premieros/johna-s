import { loadSalesReportRows, type DatasetArgs } from './reportCoreLoaders';

/** All invoice-based views share the canonical scope, identities and read limit. */
export async function loadSalesByEmployeeRows(args: DatasetArgs): Promise<Record<string, unknown>[]> {
  return (await loadSalesReportRows(args)).map(sale => ({ ...sale, users: sale.cashier }));
}
export const loadDetailedInvoiceRows = (args: DatasetArgs) => loadSalesReportRows(args);
export const loadCashierPerformanceRows = (args: DatasetArgs) => loadSalesByEmployeeRows(args);
export const loadReturnRows = (args: DatasetArgs) => loadSalesReportRows({ ...args, returnsOnly: true });
