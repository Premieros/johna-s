import type { RawMaterial } from '@/lib/types';

export type StockCountExcelLine = {
  item_id: string;
  counted_quantity: string;
  reason: string;
  unit_cost?: string;
};

export type StockCountExcelParseResult = {
  lines: StockCountExcelLine[];
  errors: string[];
  blankCount: number;
};

export function stockCountExcelColumns(isAr: boolean) {
  return {
    branchId: isAr ? 'معرف الفرع (لا تعدله)' : 'Branch ID (do not edit)',
    warehouseId: isAr ? 'معرف المخزن (لا تعدله)' : 'Warehouse ID (do not edit)',
    rawMaterialId: isAr ? 'معرف الخامة (لا تعدله)' : 'Raw Material ID (do not edit)',
    code: isAr ? 'كود الخامة' : 'Raw Material Code',
    name: isAr ? 'اسم الخامة' : 'Raw Material',
    systemQuantity: isAr ? 'رصيد النظام' : 'System Quantity',
    countedQuantity: isAr ? 'الكمية الفعلية' : 'Counted Quantity',
    reason: isAr ? 'سبب الفرق' : 'Variance Reason',
    unitCost: isAr ? 'سعر وحدة التخزين' : 'Stock Unit Cost',
    unitName: isAr ? 'وحدة التخزين' : 'Stock Unit',
  } as const;
}

function readEither(row: Record<string, unknown>, ar: string, en: string): unknown {
  return row[ar] ?? row[en];
}

export function buildStockCountExcelRows(params: {
  materials: RawMaterial[];
  snapshot: Record<string, number>;
  branchId: string;
  warehouseId: string;
  isAr: boolean;
}): Record<string, unknown>[] {
  const { materials, snapshot, branchId, warehouseId, isAr } = params;
  const columns = stockCountExcelColumns(isAr);
  return materials.map((material) => ({
    [columns.branchId]: branchId,
    [columns.warehouseId]: warehouseId,
    [columns.rawMaterialId]: material.id,
    [columns.code]: material.code || '',
    [columns.name]: material.name,
    [columns.systemQuantity]: snapshot[material.id] || 0,
    [columns.countedQuantity]: '',
    [columns.reason]: '',
    [columns.unitCost]: '',
    [columns.unitName]: material.unit?.name || '',
  }));
}

export function parseStockCountExcelRows(params: {
  rows: Record<string, unknown>[];
  materials: RawMaterial[];
  branchId: string;
  warehouseId: string;
  requireComplete: boolean;
  isAr: boolean;
}): StockCountExcelParseResult {
  const { rows, materials, branchId, warehouseId, requireComplete, isAr } = params;
  const byId = new Map(materials.map((material) => [material.id, material]));
  const seen = new Set<string>();
  const lines: StockCountExcelLine[] = [];
  const errors: string[] = [];
  let blankCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNo = index + 2;
    const fileBranchId = String(readEither(row, 'معرف الفرع (لا تعدله)', 'Branch ID (do not edit)') ?? '').trim();
    const fileWarehouseId = String(readEither(row, 'معرف المخزن (لا تعدله)', 'Warehouse ID (do not edit)') ?? '').trim();
    const rawMaterialId = String(readEither(row, 'معرف الخامة (لا تعدله)', 'Raw Material ID (do not edit)') ?? '').trim();

    if (fileBranchId !== branchId) {
      errors.push(isAr ? `الصف ${rowNo}: الملف لا يخص الفرع المحدد.` : `Row ${rowNo}: workbook branch does not match the selected branch.`);
      continue;
    }
    if (fileWarehouseId !== warehouseId) {
      errors.push(isAr ? `الصف ${rowNo}: الملف لا يخص المخزن المحدد.` : `Row ${rowNo}: workbook warehouse does not match the selected warehouse.`);
      continue;
    }
    const material = byId.get(rawMaterialId);
    if (!material) {
      errors.push(isAr ? `الصف ${rowNo}: معرف الخامة غير موجود في الفرع المحدد.` : `Row ${rowNo}: raw material ID is not valid for the selected branch.`);
      continue;
    }
    if (seen.has(material.id)) {
      errors.push(isAr ? `الصف ${rowNo}: الخامة "${material.name}" مكررة في الملف.` : `Row ${rowNo}: raw material "${material.name}" is duplicated in the workbook.`);
      continue;
    }
    seen.add(material.id);

    const rawQuantity = readEither(row, 'الكمية الفعلية', 'Counted Quantity');
    if (rawQuantity == null || String(rawQuantity).trim() === '') {
      if (['سعر وحدة التخزين', 'Stock Unit Cost', 'سعر الوحدة', 'Unit Cost', 'unit_cost', 'السعر', 'Price'].some((key) => row[key] != null && String(row[key]).trim() !== '')) {
        errors.push(isAr ? `الصف ${rowNo}: أدخل الكمية الفعلية مع سعر الخامة.` : `Row ${rowNo}: enter counted quantity with the material price.`);
      }
      blankCount += 1;
      continue;
    }

    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      errors.push(isAr ? `الصف ${rowNo}: كمية فعلية غير صالحة للخامة "${material.name}".` : `Row ${rowNo}: invalid counted quantity for "${material.name}".`);
      continue;
    }

    const priceValues = ['سعر وحدة التخزين', 'Stock Unit Cost', 'سعر الوحدة', 'Unit Cost', 'unit_cost', 'السعر', 'Price']
      .map((key) => row[key]).filter((value) => value != null && String(value).trim() !== '');
    const prices = priceValues.map(Number);
    if (prices.some((value) => !Number.isFinite(value) || value < 0.0001 || value >= 100000000) || new Set(prices).size > 1) {
      errors.push(isAr ? `الصف ${rowNo}: سعر وحدة التخزين غير صالح أو متعارض للخامة "${material.name}".` : `Row ${rowNo}: invalid or conflicting stock-unit cost for "${material.name}".`);
      continue;
    }
    lines.push({
      item_id: material.id,
      ...(prices.length ? { unit_cost: String(prices[0]) } : {}),
      counted_quantity: String(quantity),
      reason: String(readEither(row, 'سبب الفرق', 'Variance Reason') ?? '').trim(),
    });
  }

  if (requireComplete) {
    const countedIds = new Set(lines.map((line) => line.item_id));
    const missing = materials.filter((material) => !countedIds.has(material.id));
    if (missing.length > 0) {
      const preview = missing.slice(0, 5).map((material) => material.name).join('، ');
      errors.push(isAr
        ? `الجرد الكامل يحتاج كمية فعلية لكل الخامات. متبقي ${missing.length}: ${preview}${missing.length > 5 ? '…' : ''}`
        : `Full count requires a counted quantity for every material. Missing ${missing.length}: ${preview}${missing.length > 5 ? '…' : ''}`);
    }
  }

  return { lines, errors, blankCount };
}
