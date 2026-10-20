/** Prefer a visible row description over a date, quantity or monetary value. */
export function primaryReportColumn(columns: string[]): string | undefined {
  const names = ['البيان', 'الخامة', 'اسم الخامة', 'المنتج', 'الصنف', 'اسم المنتج', 'اسم الحساب', 'الفاتورة', 'رقم الفاتورة', 'Description', 'Material', 'Raw Material', 'Product', 'Item', 'Account Name', 'Invoice'];
  return names.find(name => columns.includes(name)) || columns[0];
}
