/** Prefer a visible row description over a date, quantity or monetary value. */
export function primaryReportColumn(columns: string[]): string | undefined {
  const names = ['البيان', 'الخامة', 'اسم الخامة', 'المنتج', 'الصنف', 'اسم المنتج', 'المورد', 'نوع الخامة', 'اسم الحساب', 'الفاتورة', 'رقم الفاتورة', 'Description', 'Material', 'Raw Material', 'Product', 'Item', 'Supplier', 'Material Category', 'Account Name', 'Invoice'];
  return names.find(name => columns.includes(name)) || columns[0];
}

/** Sum only declared additive measures over complete results, never a visible page. */
export function additiveReportTotals(
  columns: Array<{ id: string; key: string; aggregation: 'sum' | 'none' }>,
  rows: Record<string, unknown>[],
  complete: boolean,
  metrics: Record<string, number> = {},
): Record<string, number | null> {
  return Object.fromEntries(columns.filter(column => column.aggregation === 'sum').map(column => {
    const value = metrics[column.id];
    if (typeof value === 'number' && Number.isFinite(value)) return [column.key, value];
    if (!complete || !rows.every(row => typeof row[column.key] === 'number' && Number.isFinite(row[column.key]))) return [column.key, null];
    return [column.key, rows.reduce((total, row) => total + Number(row[column.key]), 0)];
  }));
}
