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
  const [filters, setFilters] = useState<Record<string, string>>({});
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
    ? { filter: 'فلتر', columns: 'الأعمدة', clear: 'مسح الفلاتر', noData: 'لا توجد بيانات مطابقة', import: 'استيراد', export: 'تصدير', template: 'القالب' }
    : { filter: 'Filter', columns: 'Columns', clear: 'Clear filters', noData: 'No matching data', import: 'Import', export: 'Export', template: 'Template' };

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns.has(col.key)),
    [columns, hiddenColumns],
  );

  const filteredData = useMemo(() => {
    if (!enableColumnFilters) return data;
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim());
    if (activeFilters.length === 0) return data;

    return data.filter((row) => activeFilters.every(([key, query]) => {
      const column = columns.find((col) => col.key === key);
      if (!column || column.filterable === false || column.key === 'actions') return true;
      const explicit = column.filterValue?.(row);
      const direct = (row as Record<string, unknown>)[column.key];
      const rendered = column.render?.(row);
      const value = explicit ?? direct ?? rendered;
      return normalizeFilterText(value).includes(normalizeFilterText(query));
    }));
  }, [columns, data, enableColumnFilters, filters]);

  const exportColumns = useMemo(
    () => visibleColumns.filter((col) => col.key !== 'actions'),
    [visibleColumns],
  );

  const buildExportRows = () => filteredData.map((row) => {
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

  const allSelected = showCheckbox && selectedIds && filteredData.length > 0 && filteredData.every((r) => r.id && selectedIds.has(r.id));

  const toggleAll = () => {
    if (!onSelectionChange || !selectedIds) return;
    if (allSelected) {
      const next = new Set(selectedIds);
      filteredData.forEach((row) => row.id && next.delete(row.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      filteredData.forEach((row) => row.id && next.add(row.id));
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

  const hasActiveFilters = Object.values(filters).some((value) => value.trim());
  const hasDataTools = !!onImportFile || enableExport || enableTemplate;

  return (
    <div data-testid="data-table" className="min-w-0 max-w-full">
      {(hasDataTools || enableColumnVisibility || hasActiveFilters) && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {onImportFile && (
            <>
              <input ref={importRef} type="file" accept={importAccept} className="hidden" onChange={handleImport} />
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                className="rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-medium text-ui-muted hover:bg-ui-page-alt"
              >
                {labels.import}
              </button>
            </>
          )}
          {enableExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={filteredData.length === 0}
              className="rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-medium text-ui-muted hover:bg-ui-page-alt disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.export}
            </button>
          )}
          {enableTemplate && exportColumns.length > 0 && (
            <button
              type="button"
              onClick={handleTemplate}
              className="rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-medium text-ui-muted hover:bg-ui-page-alt"
            >
              {labels.template}
            </button>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-medium text-ui-muted hover:bg-ui-page-alt"
            >
              {labels.clear}
            </button>
          )}
          {enableColumnVisibility && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs font-medium text-ui-muted hover:bg-ui-page-alt">
                {labels.columns}
              </summary>
              <div className="absolute end-0 z-30 mt-2 min-w-52 rounded-xl border border-ui-border bg-ui-surface p-2 shadow-lg">
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
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm">
            {visibleColumns.filter((col) => col.filterable !== false && col.key !== 'actions').map((col) => (
              <label key={col.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-2">
                <span className="text-xs font-semibold text-ui-muted">{col.header}</span>
                <input
                  value={filters[col.key] || ''}
                  onChange={(event) => setFilters((prev) => ({ ...prev, [col.key]: event.target.value }))}
                  placeholder={`${labels.filter}…`}
                  aria-label={`${labels.filter}: ${col.header}`}
                  className="min-w-0 rounded-lg border border-ui-border bg-ui-page px-2.5 py-2 text-sm text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring/30"
                />
              </label>
            ))}
          </div>
        )}

        {showCheckbox && filteredData.length > 0 && (
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

        {filteredData.length === 0 ? (
          <div data-testid="table-empty" className="flex flex-col items-center justify-center py-12 text-ui-muted">
            <p className="text-sm font-medium text-ui-text">{hasActiveFilters ? labels.noData : (emptyMessage || 'No data')}</p>
          </div>
        ) : filteredData.map((row, i) => (
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
              {visibleColumns.map((col) => (
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
                  {col.header}
                </th>
              ))}
            </tr>
            {enableColumnFilters && (
              <tr className="border-b border-ui-border bg-ui-surface">
                {showCheckbox && <th className="w-10 px-2 py-2" />}
                {visibleColumns.map((col) => (
                  <th key={col.key} className="px-2 py-2 align-top">
                    {col.filterable === false || col.key === 'actions' ? null : (
                      <input
                        value={filters[col.key] || ''}
                        onChange={(event) => setFilters((prev) => ({ ...prev, [col.key]: event.target.value }))}
                        placeholder={`${labels.filter}…`}
                        aria-label={`${labels.filter}: ${col.header}`}
                        className="w-full min-w-24 rounded-lg border border-ui-border bg-ui-page px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring/30"
                      />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-ui-border">
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + (showCheckbox ? 1 : 0)}>
                  <div data-testid="table-empty" className="flex flex-col items-center justify-center py-12 text-ui-muted">
                    <p className="text-sm font-medium text-ui-text">{hasActiveFilters ? labels.noData : (emptyMessage || 'No data')}</p>
                  </div>
                </td>
              </tr>
            ) : filteredData.map((row, i) => (
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
