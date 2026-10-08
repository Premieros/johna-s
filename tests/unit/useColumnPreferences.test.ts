import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useColumnPreferences } from '@/features/reporting/useColumnPreferences';

beforeEach(() => localStorage.clear());
describe('report column choices', () => {
  it('hides only the unchecked column from the initial all-columns view', () => {
    const { result } = renderHook(() => useColumnPreferences('sales'));
    act(() => result.current.toggleColumn('Tax', ['Product', 'Tax', 'Net']));
    expect(result.current.visibleColumns).toEqual(['Product', 'Net']);
    act(() => result.current.toggleColumn('Tax', ['Product', 'Tax', 'Net']));
    expect(result.current.visibleColumns).toEqual(['Product', 'Net', 'Tax']);
  });
  it('retains an empty choice and restores all columns only on Show All', () => {
    const { result } = renderHook(() => useColumnPreferences('sales'));
    act(() => result.current.toggleColumn('Product', ['Product']));
    expect(result.current.visibleColumns).toEqual([]);
    act(() => result.current.showAllColumns());
    expect(result.current.visibleColumns).toBeNull();
  });
  it('persists choices independently for each report', () => {
    const first = renderHook(() => useColumnPreferences('sales'));
    act(() => first.result.current.toggleColumn('Tax', ['Product', 'Tax']));
    first.unmount();
    const second = renderHook(() => useColumnPreferences('sales'));
    const other = renderHook(() => useColumnPreferences('purchases'));
    expect(second.result.current.visibleColumns).toEqual(['Product']);
    expect(other.result.current.visibleColumns).toBeNull();
  });
});
