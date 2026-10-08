/** Retain saved order, discard removed columns, then append newly available columns. */
export function orderReportColumns(available: string[], saved: string[] = []): string[] {
  const known = new Set(available);
  return [...new Set([...saved.filter(column => known.has(column)), ...available])];
}

export function moveReportColumn(available: string[], saved: string[] | undefined, key: string, direction: -1 | 1): string[] {
  const ordered = orderReportColumns(available, saved);
  const index = ordered.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return ordered;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered;
}
