import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('stock count Excel workflow contract', () => {
  it('exports the selected warehouse raw materials and imports counted quantities into a draft', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain('handleCountExcelExport');
    expect(page).toContain('handleCountExcelImport');
    expect(page).toContain('exportToExcelAdvanced');
    expect(page).toContain('importFromExcel');
    expect(page).toContain("accept=\".xlsx,.xls\"");
    expect(page).toContain("'الكمية الفعلية'");
    expect(page).toContain('Stock has not been changed yet');
  });

  it('uses warehouse FIFO batches for the reference system quantity', () => {
    const service = read('src/features/inventory/services/stockCountData.ts');
    expect(service).toContain('loadRawMaterialWarehouseSnapshot');
    expect(service).toContain(".from('raw_material_batches')");
    expect(service).toContain(".eq('branch_id', branchId)");
    expect(service).toContain(".eq('warehouse_id', warehouseId)");
  });

  it('keeps application behind the existing submit, approve, and apply workflow', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain('submitStockCount');
    expect(page).toContain('approveStockCount');
    expect(page).toContain('applyStockCount');
    expect(page).not.toContain(".from('raw_material_inventory').update");
    expect(page).not.toContain(".from('raw_material_batches').update");
  });
});
