import { useState, useCallback } from 'react';
import { moveReportColumn } from './reportColumnLayout';

const STORAGE_KEY = 'premire_report_columns';
const ORDER_STORAGE_KEY = 'premire_report_column_order';

function readAll(key = STORAGE_KEY): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every(column => typeof column === 'string'),
    ));
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, string[]>, key = STORAGE_KEY) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* Keep the current session usable when storage is unavailable. */ }
}

export function useColumnPreferences(reportType: string) {
  const [stored, setStored] = useState<Record<string, string[]>>(() => readAll());
  const [orders, setOrders] = useState<Record<string, string[]>>(() => readAll(ORDER_STORAGE_KEY));

  const visibleColumns: string[] | null = stored[reportType] ?? null;

  const toggleColumn = useCallback((key: string, allColumns: string[]) => {
    setStored((prev) => {
      const current = prev[reportType] ?? null;
      let next: string[] | null;
      if (current === null) {
        next = allColumns.filter((column) => column !== key);
      } else if (current.includes(key)) {
        next = current.filter((c) => c !== key);
      } else {
        next = [...current, key];
      }
      const updated = next === null ? { ...prev } : { ...prev, [reportType]: next };
      if (next === null) delete updated[reportType];
      writeAll(updated);
      return updated;
    });
  }, [reportType]);

  const showAllColumns = useCallback(() => {
    setStored((prev) => {
      const updated = { ...prev };
      delete updated[reportType];
      writeAll(updated);
      return updated;
    });
  }, [reportType]);

  const moveColumn = useCallback((key: string, direction: -1 | 1, allColumns: string[]) => {
    setOrders(previous => {
      const updated = { ...previous, [reportType]: moveReportColumn(allColumns, previous[reportType], key, direction) };
      writeAll(updated, ORDER_STORAGE_KEY);
      return updated;
    });
  }, [reportType]);

  const resetColumnOrder = useCallback(() => {
    setOrders(previous => {
      const updated = { ...previous };
      delete updated[reportType];
      writeAll(updated, ORDER_STORAGE_KEY);
      return updated;
    });
  }, [reportType]);

  return { visibleColumns, toggleColumn, showAllColumns, columnOrder: orders[reportType], moveColumn, resetColumnOrder };
}
