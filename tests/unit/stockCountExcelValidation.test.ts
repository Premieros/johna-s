import { describe, expect, it } from 'vitest';
import type { RawMaterial } from '@/lib/types';
import { buildStockCountExcelRows, parseStockCountExcelRows, stockCountExcelColumns } from '@/features/inventory/utils/stockCountExcel';

const materials = [
  { id: 'raw-1', code: 'R1', name: 'سكر', branch_id: 'branch-1' },
  { id: 'raw-2', code: 'R2', name: 'لبن', branch_id: 'branch-1' },
] as RawMaterial[];

function baseRows() {
  const c = stockCountExcelColumns(true);
  return [
    {
      [c.branchId]: 'branch-1',
      [c.warehouseId]: 'warehouse-1',
      [c.rawMaterialId]: 'raw-1',
      [c.code]: 'R1',
      [c.name]: 'سكر',
      [c.systemQuantity]: 10,
      [c.countedQuantity]: 0,
      [c.reason]: 'نفاد',
    },
    {
      [c.branchId]: 'branch-1',
      [c.warehouseId]: 'warehouse-1',
      [c.rawMaterialId]: 'raw-2',
      [c.code]: 'R2',
      [c.name]: 'لبن',
      [c.systemQuantity]: 5,
      [c.countedQuantity]: 4.5,
      [c.reason]: '',
    },
  ];
}

describe('stock count Excel validation', () => {
  it('exports immutable branch/warehouse/material identity with the system snapshot', () => {
    const c = stockCountExcelColumns(true);
    const rows = buildStockCountExcelRows({
      materials,
      snapshot: { 'raw-1': 10, 'raw-2': 5 },
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      isAr: true,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0][c.branchId]).toBe('branch-1');
    expect(rows[0][c.warehouseId]).toBe('warehouse-1');
    expect(rows[0][c.rawMaterialId]).toBe('raw-1');
    expect(rows[0][c.systemQuantity]).toBe(10);
    expect(rows[0][c.countedQuantity]).toBe('');
  });

  it('accepts zero as a valid physical quantity', () => {
    const result = parseStockCountExcelRows({
      rows: baseRows(),
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: true,
      isAr: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.lines.find((line) => line.item_id === 'raw-1')?.counted_quantity).toBe('0');
  });

  it('rejects a workbook from another branch or warehouse', () => {
    const rows = baseRows();
    const c = stockCountExcelColumns(true);
    rows[0][c.branchId] = 'branch-other';
    rows[1][c.warehouseId] = 'warehouse-other';
    const result = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: false,
      isAr: true,
    });
    expect(result.errors).toHaveLength(2);
    expect(result.lines).toHaveLength(0);
  });

  it('rejects duplicate raw-material rows instead of silently overwriting a count', () => {
    const rows = baseRows();
    rows.push({ ...rows[0] });
    const result = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: false,
      isAr: true,
    });
    expect(result.errors.some((error) => error.includes('مكررة'))).toBe(true);
  });

  it('rejects negative or non-numeric counted quantities', () => {
    const rows = baseRows();
    const c = stockCountExcelColumns(true);
    rows[0][c.countedQuantity] = -1;
    rows[1][c.countedQuantity] = 'abc';
    const result = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: false,
      isAr: true,
    });
    expect(result.errors).toHaveLength(2);
    expect(result.lines).toHaveLength(0);
  });

  it('blocks an incomplete full count but allows blank rows in a partial count', () => {
    const rows = baseRows();
    const c = stockCountExcelColumns(true);
    rows[1][c.countedQuantity] = '';

    const full = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: true,
      isAr: true,
    });
    expect(full.errors.some((error) => error.includes('الجرد الكامل'))).toBe(true);

    const partial = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: false,
      isAr: true,
    });
    expect(partial.errors).toEqual([]);
    expect(partial.lines).toHaveLength(1);
    expect(partial.blankCount).toBe(1);
  });

  it('does not fall back to code or name when the material id is altered', () => {
    const rows = baseRows();
    const c = stockCountExcelColumns(true);
    rows[0][c.rawMaterialId] = 'raw-foreign';
    const result = parseStockCountExcelRows({
      rows,
      materials,
      branchId: 'branch-1',
      warehouseId: 'warehouse-1',
      requireComplete: false,
      isAr: true,
    });
    expect(result.errors.some((error) => error.includes('معرف الخامة'))).toBe(true);
  });
});
