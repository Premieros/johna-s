import type { AnalysisColumn } from './reportDataContracts';
export type ReportRow = Record<string, unknown>;
export interface TableFilter { operator: 'contains' | 'equals' | 'min' | 'max'; value: string; }
export interface AnalysisLayout {
  filters: Record<string, TableFilter>;
  sort: { column: string; descending: boolean } | null;
  groups: string[];
  widths: Record<string, number>;
  pinned: string[];
  visible: string[] | null;
  order: string[];
}
export const emptyAnalysisLayout = (): AnalysisLayout => ({ filters: {}, sort: null, groups: [], widths: {}, pinned: [], visible: null, order: [] });

export function normalizeAnalysisLayout(value: unknown): AnalysisLayout {
  const result = emptyAnalysisLayout();
  if (!value || typeof value !== 'object') return result;
  const raw = value as Record<string, unknown>;
  const strings = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((item): item is string => typeof item === 'string'))] : [];
  result.groups = strings(raw.groups).slice(0, 3); result.order = strings(raw.order); result.pinned = strings(raw.pinned);
  result.visible = raw.visible === null || raw.visible === undefined ? null : strings(raw.visible);
  if (raw.sort && typeof raw.sort === 'object') {
    const sort = raw.sort as Record<string, unknown>;
    if (typeof sort.column === 'string') result.sort = { column: sort.column, descending: sort.descending === true };
  }
  if (raw.widths && typeof raw.widths === 'object') for (const [key, width] of Object.entries(raw.widths)) {
    if (typeof width === 'number' && Number.isFinite(width)) result.widths[key] = Math.min(600, Math.max(80, width));
  }
  if (raw.filters && typeof raw.filters === 'object') for (const [key, input] of Object.entries(raw.filters)) {
    if (!input || typeof input !== 'object') continue;
    const filter = input as Record<string, unknown>;
    if (typeof filter.value === 'string' && ['contains', 'equals', 'min', 'max'].includes(String(filter.operator))) result.filters[key] = { value: filter.value, operator: filter.operator as TableFilter['operator'] };
  }
  return result;
}

export function filterReportRows(rows: ReportRow[], columns: AnalysisColumn[], filters: AnalysisLayout['filters']): ReportRow[] {
  const known = new Map(columns.map(column => [column.id, column]));
  return rows.filter(row => Object.entries(filters).every(([id, filter]) => {
    const column = known.get(id);
    if (!column || !filter.value.trim()) return true;
    const value = row[column.key];
    if (filter.operator === 'min' || filter.operator === 'max') {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Number(filter.value))) return false;
      return filter.operator === 'min' ? value >= Number(filter.value) : value <= Number(filter.value);
    }
    const actual = String(value ?? '').toLocaleLowerCase();
    const target = filter.value.toLocaleLowerCase();
    return filter.operator === 'equals' ? actual === target : actual.includes(target);
  }));
}

export function groupReportRows(rows: ReportRow[], columns: AnalysisColumn[], groups: string[]): ReportRow[] {
  if (!groups.length) return rows;
  const dimensions = groups.slice(0, 3).map(id => columns.find(column => column.id === id)).filter((column): column is AnalysisColumn => !!column && !column.numeric);
  if (!dimensions.length) return rows;
  const buckets = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(dimensions.map(column => row[column.key] ?? null));
    const bucket = buckets.get(key) || []; bucket.push(row); buckets.set(key, bucket);
  }
  return [...buckets.values()].map(bucket => {
    const result: ReportRow = {};
    for (const column of columns) {
      const values = bucket.map(row => row[column.key]);
      if (dimensions.includes(column)) result[column.key] = values[0];
      else if (column.aggregation === 'sum') result[column.key] = values.every(value => typeof value === 'number' && Number.isFinite(value)) ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
      else result[column.key] = (!column.numeric || bucket.length === 1) && values.every(value => value === values[0]) ? values[0] : null;
    }
    // Weighted invoice average comes from additive revenue/count, never average-of-averages.
    const average = columns.find(column => column.id === 'Avg Invoice');
    const revenue = columns.find(column => column.id === 'Net Sales' || column.id === 'Net Revenue');
    const count = columns.find(column => column.id === 'Invoices');
    if (average && revenue && count) {
      const denominator = result[count.key]; const numerator = result[revenue.key];
      result[average.key] = typeof denominator === 'number' && denominator > 0 && typeof numerator === 'number' ? numerator / denominator : null;
    }
    return result;
  });
}

export function sortReportRows(rows: ReportRow[], columns: AnalysisColumn[], sort: AnalysisLayout['sort']): ReportRow[] {
  const column = sort && columns.find(value => value.id === sort.column);
  if (!column || !sort) return rows;
  return [...rows].sort((a, b) => {
    const left = a[column.key]; const right = b[column.key];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return sort.descending ? -comparison : comparison;
  });
}

export function analyseReportRows(rows: ReportRow[], columns: AnalysisColumn[], layout: AnalysisLayout): ReportRow[] {
  return sortReportRows(groupReportRows(filterReportRows(rows, columns, layout.filters), columns, layout.groups), columns, layout.sort);
}
