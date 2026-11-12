import { useCallback } from 'react';
import { useLatestRead } from '@/hooks/useLatestRead';
import { REPORT_FILTER_DIMS, type ReportType } from './reportFilters';
import { loadExpenseCategoryOptions, loadReportFilterOptions, type ReportFilterOptions } from './services/reportFilterOptions';

type PageFilterOptions = ReportFilterOptions & { expenseCategories: string[] };
export const EMPTY_REPORT_FILTER_OPTIONS: PageFilterOptions = {
  rawMaterials: [], stations: [], warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [], expenseCategories: [],
};

/** Filter options share one scoped snapshot; partial failures and old categories never publish. */
export function useReportFilterOptions(reportType: ReportType, branchId: string | null, userId: string | undefined, permittedBranches: string[] = []) {
  const branchKey = JSON.stringify(permittedBranches);
  const read = useCallback(async (): Promise<PageFilterOptions> => {
    const scope: string | string[] = branchId || JSON.parse(branchKey);
    if (!userId || (!branchId && !scope.length)) return EMPTY_REPORT_FILTER_OPTIONS;
    const dims = new Set(REPORT_FILTER_DIMS[reportType]);
    const [options, expenseCategories] = await Promise.all([
      loadReportFilterOptions(scope, {
        raw_material: dims.has('raw_material'), material_category: dims.has('material_category'),
        station: dims.has('station'),
        warehouse: dims.has('warehouse'),
        cashier: dims.has('cashier') || dims.has('buyer'),
        customer: dims.has('customer'),
        supplier: dims.has('supplier'),
        product: dims.has('product'),
        category: dims.has('category') && reportType !== 'expenses',
        table: dims.has('table'),
      }),
      reportType === 'expenses' ? loadExpenseCategoryOptions(scope) : Promise.resolve([] as string[]),
    ]);
    return { ...options, expenseCategories };
  }, [reportType, branchId, userId, branchKey]);
  return useLatestRead(read);
}
