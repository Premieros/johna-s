import { type ChangeEvent, type ReactNode, isValidElement, useMemo, useRef, useState } from 'react';
import { downloadTemplate, exportToExcel } from '@/lib/excel';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  filterable?: boolean;
  filterValue?: (row: T) => unknown;
  exportValue?: (row: T) => unknown;
  hiddenByDefault?: boolean;
  /** Keep this column in the compact phone card summary. */
  mobilePriority?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  error?: ReactNode | null;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  showCheckbox?: boolean;
  tableId?: string;
  enableColumnFilters?: boolean;
  enableColumnVisibility?: boolean;
  enableExport?: boolean;
  enableTemplate?: boolean;
  exportFilename?: string;
  templateFilename?: string;
  onImportFile?: (file: File) => void | Promise<void>;
  importAccept?: string;
}

type ColumnFilterState = {
  query: string;
  selectedValues: string[] | null;
};

type SortState = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

function textFromUnknown(value: unknown): string {
  if (value == null || typeof value === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join(' ');
  if (isValidElement(value)) {
    const props = value.props as Record<string, unknown>;
    const candidates = [props.children, props.label, props.name, props.title, props.value];
    return candidates.map(textFromUnknown).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((v) => v == null || ['string', 'number', 'bigint', 'boolean'].includes(typeof v))
      .map(textFromUnknown)
      .filter(Boolean)
      .join(' ');
  }
  return String(value);
}

function normalizeFilterText(value: unknown): string {
  return textFromUnknown(value).trim().toLocaleLowerCase();
}

function filterValueForRow<T>(row: T, column: Column<T>): string {
  const explicit = column.filterValue?.(row);
  const direct = (row as Record<string, unknown>)[column.key];
  const rendered = column.render?.(row);
  return textFromUnknown(explicit ?? direct ?? rendered).trim();
}

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  loading,
  error,
  emptyMessage,
  onRowClick,
  selectedIds,
  onSelectionChange,
  showCheckbox,
  tableId,
  enableColumnFilters = true,
  enableColumnVisibility = true,
  enableExport = false,
  enableTemplate = false,
  exportFilename,
  templateFilename,
  onImportFile,
  importAccept = '.xlsx,.xls,.csv',
}: DataTableProps<T>) {
  const storageKey = tableId ? `datatable:${tableId}:hidden-columns` : null;
  const [filters, setFilters] = useState<Record<string, ColumnFilterState>>({});
  const [filterSearches, setFilterSearches] = useState<Record<string, string>>({});
  const [sortState, setSortState] = useState<SortState>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const defaults = new Set(columns.filter((col) => col.hiddenByDefault).map((col) => col.key));
    if (!storageKey || typeof window === 'undefined') return defaults;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '[]') as string[];
      return new Set([...defaults, ...saved]);
    } catch {
      return defaults;
    }
  });

  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const labels = isRtl
    ? {
        filter: 'فلتر', columns: 'الأعمدة', clear: 'مسح كل الفلاتر', clearColumn: 'مسح فلتر العمود',
        noData: 'لا توجد بيانات مطابقة', import: 'استيراد', export: 'تصدير', template: 'القالب',
        search: 'بحث', selectAll: 'تحديد الكل', blanks: '(فارغ)', sortAsc: 'فرز تصاعدي',
        sortDesc: 'فرز تنازلي', values: 'القيم', contains: 'يحتوي على', details: 'التفاصيل',
      }
    : {
        filter: 'Filter', columns: 'Columns', clear: 'Clear all filters', clearColumn: 'Clear column filter',
        noData: 'No matching data', import: 'Import', export: 'Export', template: 'Template',
        search: 'Search', selectAll: 'Select all', blanks: '(Blanks)', sortAsc: 'Sort ascending',
        sortDesc: 'Sort descending', values: 'Values', contains: 'Contains', details: 'Details',
      };

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.key)),
    [columns, hiddenColumns],
  );

  const uniqueValuesByColumn = useMemo(() => {
    const result: Record<string, string[]> = {};
    columns.forEach((column) => {
      if (column.filterable === false || column.key === 'actions') return;
      const values = new Set<string>();
      data.forEach((row) => values.add(filterValueForRow(row, column)));
      result[column.key] = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    });
    return result;
  }, [columns, data]);

  const filteredData = useMemo(() => {
    if (!enableColumnFilters) return data;
    const activeFilters = Object.entries(filters).filter(([, state]) => state.query.trim() || state.selectedValues !== null);
    if (activeFilters.length === 0) return data;

    return data.filter((row) => activeFilters.every(([key, state]) => {
      const column = columns.find((col) => col.key === key);
      if (!column || column.filterable === false || column.key === 'actions') return true;
      const value = filterValueForRow(row, column);
      const normalizedValue = normalizeFilterText(value);
      const matchesQuery = !state.query.trim() || normalizedValue.includes(normalizeFilterText(state.query));
      const matchesSelected = state.selectedValues === null || state.selectedValues.includes(value);
      return matchesQuery && matchesSelected;
    }));
  }, [columns, data, enableColumnFilters, filters]);

  const displayData = useMemo(() => {
    if (!sortState) return filteredData;
    const column = columns.find((col) => col.key === sortState.key);
    if (!column) return filteredData;
    return [...filteredData].sort((a, b) => {
      const left = filterValueForRow(a, column);
      const right = filterValueForRow(b, column);
      const comparison = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
      return sortState.direction === 'asc' ? comparison : -comparison;
    });
  }, [columns, filteredData, sortState]);

  const exportColumns = useMemo(
    () => visibleColumns.filter((col) => col.key !== 'actions'),
    [visibleColumns],
  );

  const buildExportRows = () => displayData.map((row) => {
    const out: Record<string, unknown> = {};
    exportColumns.forEach((col) => {
      const explicit = col.exportValue?.(row) ?? col.filterValue?.(row);
      const direct = (row as Record<string, unknown>)[col.key];
      const rendered = col.render?.(row);
      const raw = explicit ?? direct ?? rendered;
      out[col.header] = typeof raw === 'number' || typeof raw === 'boolean' ? raw : textFromUnknown(raw);
    });
    return out;
  });

  const handleExport = async () => {
    const fallback = tableId || 'table-export';
    await exportToExcel(buildExportRows(), exportFilename || fallback);
  };

  const handleTemplate = async () => {
    const fallback = tableId || 'table-template';
    await downloadTemplate(exportColumns.map((col) => col.header), templateFilename || `${fallback}-template`);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onImportFile) return;
    try {
      await onImportFile(file);
    } finally {
      event.target.value = '';
    }
  };

  const updateHiddenColumns = (next: Set<string>) => {
    setHiddenColumns(next);
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    }
  };

  const setColumnQuery = (key: string, query: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: { query, selectedValues: prev[key]?.selectedValues ?? null },
    }));
  };

  const toggleColumnValue = (key: string, value: string, allValues: string[]) => {
    setFilters((prev) => {
      const current = prev[key] ?? { query: '', selectedValues: null };
      const selected = current.selectedValues === null ? [...allValues] : [...current.selectedValues];
      const nextSelected = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
      return {
        ...prev,
        [key]: {
          ...current,
          selectedValues: nextSelected.length === allValues.length ? null : nextSelected,
        },
      };
    });
  };

  const toggleAllColumnValues = (key: string, checked: boolean) => {
    setFilters((prev) => {
      const current = prev[key] ?? { query: '', selectedValues: null };
      return {
        ...prev,
        [key]: { ...current, selectedValues: checked ? null : [] },
      };
    });
  };

  const clearColumnFilter = (key: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFilterSearches((prev) => ({ ...prev, [key]: '' }));
  };

  const isColumnFiltered = (key: string) => {
    const state = filters[key];
    return !!state && (!!state.query.trim() || state.selectedValues !== null);
  };

  const renderFilterMenu = (col: Column<T>, compact = false) => {
    if (!enableColumnFilters || col.filterable === false || col.key === 'actions') return null;
    const allValues = uniqueValuesByColumn[col.key] ?? [];
    const state = filters[col.key] ?? { query: '', selectedValues: null };
    const valueSearch = filterSearches[col.key] ?? '';
    const shownValues = valueSearch.trim()
      ? allValues.filter((value) => normalizeFilterText(value || labels.blanks).includes(normalizeFilterText(valueSearch)))
      : allValues;
    const selectedValues = state.selectedValues;
    const allChecked = selectedValues === null || selectedValues.length === allValues.length;
    const active = isColumnFiltered(col.key);

    return (
      <details
        data-column-filter="true"
        className="relative"
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          const table = event.currentTarget.closest('[data-testid="data-table"]');
          table?.querySelectorAll('details[data-column-filter="true"][open]').forEach((node) => {
            if (node !== event.currentTarget) (node as HTMLDetailsElement).open = false;
          });
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <summary
          className={`flex cursor-pointer list-none items-center justify-center rounded-md border p-1 transition-colors ${active ? 'border-ui-primary bg-ui-primary-soft text-ui-primary' : 'border-transparent text-ui-muted hover:border-ui-border hover:bg-ui-surface'}`}
          aria-label={isRtl ? 'خيارات فلتر العمود' : 'Column filter options'}
          title={`${labels.filter}: ${col.header}`}
        >
          <svg className={compact ? 'h-4 w-4' : 'h-3.5 w-3.5'} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M3.25 5.5a.75.75 0 01.75-.75h12a.75.75 0 01.53 1.28l-4.78 4.78v3.94a.75.75 0 01-.42.67l-2 1A.75.75 0 018.25 15v-4.19L3.47 6.03a.75.75 0 01-.22-.53z" clipRule="evenodd" />
          </svg>
        </summary>
        <div data-testid="data-table-filter-menu" className="absolute start-0 z-50 mt-1 w-72 rounded-xl border border-ui-border bg-ui-surface p-2 text-start normal-case tracking-normal shadow-xl">
          <div className="grid gap-1 border-b border-ui-border pb-2">
            <button
              type="button"
              onClick={() => setSortState({ key: col.key, direction: 'asc' })}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-ui-page-alt ${sortState?.key === col.key && sortState.direction === 'asc' ? 'text-ui-primary' : 'text-ui-text'}`}
            >
              <span aria-hidden="true">↑</span>{labels.sortAsc}
            </button>
            <button
              type="button"
              onClick={() => setSortState({ key: col.key, direction: 'desc' })}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-ui-page-alt ${sortState?.key === col.key && sortState.direction === 'desc' ? 'text-ui-primary' : 'text-ui-text'}`}
            >
              <span aria-hidden="true">↓</span>{labels.sortDesc}
            </button>
          </div>

          <div className="grid gap-2 py-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-ui-muted">{labels.contains}</span>
              <input
                value={state.query}
                onChange={(event) => setColumnQuery(col.key, event.target.value)}
                placeholder={`${labels.search}…`}
                aria-label={isRtl ? 'بحث نصي داخل العمود' : 'Text filter in column'}
                className="w-full rounded-lg border border-ui-border bg-ui-page px-2.5 py-2 text-sm font-normal text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring/30"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-ui-muted">{labels.values}</span>
              <input
                value={valueSearch}
                onChange={(event) => setFilterSearches((prev) => ({ ...prev, [col.key]: event.target.value }))}
                placeholder={`${labels.search}…`}
                aria-label={isRtl ? 'بحث في قائمة القيم' : 'Search value list'}
                className="w-full rounded-lg border border-ui-border bg-ui-page px-2.5 py-2 text-sm font-normal text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring/30"
              />
            </label>
          </div>

          <div className="max-h-52 overflow-y-auto border-y border-ui-border py-1">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-ui-text hover:bg-ui-page-alt">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(event) => toggleAllColumnValues(col.key, event.target.checked)}
                className="h-4 w-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring"
              />
              <span>{labels.selectAll}</span>
            </label>
            {shownValues.map((value) => (
              <label key={value || '__blank__'} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ui-text hover:bg-ui-page-alt">
                <input
                  type="checkbox"
                  checked={selectedValues === null || selectedValues.includes(value)}
                  onChange={() => toggleColumnValue(col.key, value, allValues)}
                  className="h-4 w-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring"
                />
                <span className="min-w-0 flex-1 truncate" title={value || labels.blanks}>{value || labels.blanks}</span>
              </label>
            ))}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => clearColumnFilter(col.key)}
              disabled={!active}
              className="w-full rounded-lg border border-ui-border px-2.5 py-2 text-sm font-medium text-ui-muted hover:bg-ui-page-alt disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.clearColumn}
            </button>
          </div>
        </div>
      </details>
    );
  };

  if (loading) {
    return (
      <div data-testid="table-loading" className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-3 border-ui-primary border-t-transparent" />
          <p className="text-sm text-ui-subtle">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="table-error" className="flex flex-col items-center justify-center py-16 text-ui-muted">
        <div className="w-16 h-16 rounded-full bg-ui-danger-soft flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-ui-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-ui-text">{error}</p>
      </div>
    );
  }

  const allSelected = showCheckbox && selectedIds && displayData.length > 0 && displayData.every((r) => r.id && selectedIds.has(r.id));

  const mobilePriorityColumns = (() => {
    const explicit = visibleColumns.filter((col) => col.mobilePriority);
    const base = explicit.length > 0
      ? explicit
      : visibleColumns.filter((col) => col.key !== 'actions').slice(0, 4);
    const actions = visibleColumns.filter((col) => col.key === 'actions');
    return [...base, ...actions.filter((col) => !base.some((item) => item.key === col.key))];
  })();

  const mobileSecondaryColumns = visibleColumns.filter(
    (col) => !mobilePriorityColumns.some((primary) => primary.key === col.key),
  );

  const toggleAll = () => {
    if (!onSelectionChange || !selectedIds) return;
    if (allSelected) {
      const next = new Set(selectedIds);
      displayData.forEach((row) => row.id && next.delete(row.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      displayData.forEach((row) => row.id && next.add(row.id));
      onSelectionChange(next);
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  const renderCell = (row: T, col: Column<T>) =>
    col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as ReactNode;

  const hasActiveFilters = Object.keys(filters).some(isColumnFiltered);
  const hasDataTools = !!onImportFile || enableExport || enableTemplate;

  return (
    <div data-testid="data-table" className="min-w-0 max-w-full">
      {(hasDataTools || enableColumnVisibility || hasActiveFilters) && (
        <div data-testid="data-table-toolbar" className="mb-3 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
          {onImportFile && (
            <>
              <input ref={importRef} type="file" accept={importAccept} className="hidden" onChange={handleImport} />
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                className="ui-toolbar-action"
              >
                {labels.import}
              </button>
            </>
          )}
          {enableExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={displayData.length === 0}
              className="ui-toolbar-action"
            >
              {labels.export}
            </button>
          )}
          {enableTemplate && exportColumns.length > 0 && (
            <button
              type="button"
              onClick={handleTemplate}
              className="ui-toolbar-action"
            >
              {labels.template}
            </button>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setFilterSearches({});
              }}
              className="ui-toolbar-action"
            >
              {labels.clear}
            </button>
          )}
          {enableColumnVisibility && (
            <details className="relative">
              <summary className="ui-toolbar-action cursor-pointer list-none">
                {labels.columns}
              </summary>
              <div className="absolute end-0 z-40 mt-2 min-w-52 rounded-xl border border-ui-border bg-ui-surface p-2 shadow-lg">
                {columns.map((col) => (
                  <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ui-text hover:bg-ui-page-alt">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(col.key)}
                      onChange={(event) => {
                        const next = new Set(hiddenColumns);
                        if (event.target.checked) next.delete(col.key); else next.add(col.key);
                        updateHiddenColumns(next);
                      }}
                      className="h-4 w-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring"
                    />
                    <span>{col.header}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="space-y-3 sm:hidden">
        {enableColumnFilters && visibleColumns.some((col) => col.filterable !== false && col.key !== 'actions') && (
          <div data-testid="data-table-mobile-filters" className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain rounded-xl border border-ui-border bg-ui-surface p-2 shadow-ui-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleColumns.filter((col) => col.filterable !== false && col.key !== 'actions').map((col) => (
              <div key={col.key} className="flex items-center gap-1 rounded-lg border border-ui-border bg-ui-page px-2 py-1">
                <span className="max-w-32 truncate text-xs font-semibold text-ui-muted">{col.header}</span>
                {renderFilterMenu(col, true)}
              </div>
            ))}
          </div>
        )}

        {showCheckbox && displayData.length > 0 && (
          <div className="flex items-center rounded-xl border border-ui-border bg-ui-surface px-3 py-2 shadow-ui-sm">
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={!!allSelected}
              onChange={toggleAll}
              className="h-5 w-5 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring"
            />
          </div>
        )}

        {displayData.length === 0 ? (
          <div data-testid="table-empty" className="flex flex-col items-center justify-center py-12 text-ui-muted">
            <p className="text-sm font-medium text-ui-text">{hasActiveFilters ? labels.noData : (emptyMessage || 'No data')}</p>
          </div>
        ) : displayData.map((row, i) => (
          <div
            key={row.id || i}
            onClick={(e) => {
              if (showCheckbox && (e.target as HTMLElement).closest('input[type="checkbox"]')) return;
              onRowClick?.(row);
            }}
            className={`min-w-0 overflow-hidden rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm transition-colors ${onRowClick ? 'cursor-pointer active:bg-ui-page-alt' : ''} ${selectedIds?.has(row.id || '') ? 'border-ui-primary bg-ui-primary-soft/30' : ''}`}
          >
            {showCheckbox && (
              <div className="mb-2 flex items-center" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label="Select row"
                  checked={!!(row.id && selectedIds?.has(row.id))}
                  onChange={() => row.id && toggleRow(row.id)}
                  className="h-5 w-5 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring"
                />
              </div>
            )}

            <dl className="divide-y divide-ui-border">
              {mobilePriorityColumns.map((col) => (
                <div
                  key={col.key}
                  className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <dt className="min-w-0 break-words text-xs font-semibold text-ui-muted">{col.header}</dt>
                  <dd className="min-w-0 break-words text-sm text-ui-text [&>*]:max-w-full">
                    {renderCell(row, col)}
                  </dd>
                </div>
              ))}
            </dl>

            {mobileSecondaryColumns.length > 0 && (
              <details
                className="mt-2 rounded-lg border border-ui-border bg-ui-page-alt/50"
                onClick={(event) => event.stopPropagation()}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center px-3 text-xs font-bold text-ui-primary">
                  {labels.details} · {mobileSecondaryColumns.length}
                </summary>
                <dl className="divide-y divide-ui-border border-t border-ui-border px-3">
                  {mobileSecondaryColumns.map((col) => (
                    <div
                      key={col.key}
                      className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2"
                    >
                      <dt className="min-w-0 break-words text-xs font-semibold text-ui-muted">{col.header}</dt>
                      <dd className="min-w-0 break-words text-sm text-ui-text [&>*]:max-w-full">
                        {renderCell(row, col)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl touch-pan-x [scrollbar-gutter:stable] sm:block">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-ui-border bg-ui-page-alt/70">
              {showCheckbox && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={!!allSelected} onChange={toggleAll}
                    className="h-4 w-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring" />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wider text-ui-muted ${col.className || ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{col.header}</span>
                    {renderFilterMenu(col)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ui-border">
            {displayData.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + (showCheckbox ? 1 : 0)}>
                  <div data-testid="table-empty" className="flex flex-col items-center justify-center py-12 text-ui-muted">
                    <p className="text-sm font-medium text-ui-text">{hasActiveFilters ? labels.noData : (emptyMessage || 'No data')}</p>
                  </div>
                </td>
              </tr>
            ) : displayData.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={(e) => {
                  if (showCheckbox && (e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                  onRowClick?.(row);
                }}
                className={`hover:bg-ui-page-alt/60 transition-colors duration-150 ${onRowClick ? 'cursor-pointer' : ''} ${selectedIds?.has(row.id || '') ? 'bg-ui-primary-soft/50' : ''}`}
              >
                {showCheckbox && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={!!(row.id && selectedIds?.has(row.id))}
                      onChange={() => row.id && toggleRow(row.id)}
                      className="h-4 w-4 rounded border-ui-border-strong text-ui-primary focus:ring-ui-ring" />
                  </td>
                )}
                {visibleColumns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-ui-text ${col.className || ''}`}>
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
