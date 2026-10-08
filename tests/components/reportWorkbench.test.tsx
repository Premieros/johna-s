import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/reportExport', () => ({ downloadCSV: vi.fn(), openPrintWindow: vi.fn() }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: vi.fn() }));
import { downloadCSV } from '@/lib/reportExport';
import { ReportWorkbench } from '@/features/reporting/ReportWorkbench';
const base = { type: 'sales' as const, lang: 'en' as const, scope: 'scope', userId: 'reader', complete: false, unavailable: false, currency: 'EGP', moneyKeys: ['Net Sales'], canExport: true, canPrint: true, onOpen: vi.fn() };

describe('full reporting workspace', () => {
  it('stores a function scope as an identity without executing it as a state updater', async () => {
    const scope = vi.fn();
    const loadRows = vi.fn().mockResolvedValue([{ Invoice: 'FUNCTION-SCOPE', 'Net Sales': 10 }]);
    render(<ReportWorkbench {...base} scope={scope} rows={[]} loadRows={loadRows} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    await screen.findByText('1 rows / 1 source rows');
    expect(screen.getByRole('button', { name: 'FUNCTION-SCOPE' })).toBeTruthy();
    expect(scope).not.toHaveBeenCalled();
    expect(loadRows).toHaveBeenCalledTimes(1);
  });
  it('loads full data only on request, caches it, and filters/exports all permitted rows', async () => {
    const full = Array.from({ length: 205 }, (_, index) => ({ Branch: 'A', Invoice: `INV-${index}`, 'Net Sales': index }));
    const loadRows = vi.fn().mockResolvedValue(full);
    render(<ReportWorkbench {...base} rows={full.slice(0, 100)} loadRows={loadRows} />);
    expect(loadRows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    await screen.findByText('205 rows / 205 source rows');
    fireEvent.change(screen.getByRole('textbox', { name: 'Invoice filter' }), { target: { value: 'INV-204' } });
    await screen.findByText('1 rows / 205 source rows');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(vi.mocked(downloadCSV).mock.calls[vi.mocked(downloadCSV).mock.calls.length - 1]?.[0]).toEqual([full[204]]);
    fireEvent.click(screen.getByRole('button', { name: 'Close table tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    expect(loadRows).toHaveBeenCalledTimes(1);
  });
  it('discards stale scope results and aborts outstanding reads', async () => {
    let resolve!: (rows: Record<string, unknown>[]) => void;
    const loadRows = vi.fn().mockImplementation(() => new Promise(value => { resolve = value; }));
    const view = render(<ReportWorkbench {...base} rows={[]} loadRows={loadRows} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    const signal = loadRows.mock.calls[0][0] as AbortSignal;
    view.rerender(<ReportWorkbench {...base} scope="different-branch" rows={[]} loadRows={loadRows} />);
    resolve([{ Invoice: 'private-old-branch' }]);
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(screen.queryByText('private-old-branch')).toBeNull();
  });
  it('groups permitted rows and drills back into the matching source rows', async () => {
    const rows = [{ Branch: 'A', Invoice: 'I1', 'Net Sales': 10 }, { Branch: 'A', Invoice: 'I2', 'Net Sales': 20 }, { Branch: 'B', Invoice: 'I3', 'Net Sales': 50 }];
    render(<ReportWorkbench {...base} complete rows={rows} loadRows={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Group 1' }), { target: { value: 'Branch' } });
    await screen.findByText('2 rows / 3 source rows');
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    await screen.findByText('2 rows / 3 source rows');
    expect(screen.getByRole('button', { name: 'I1' })).toBeTruthy();
    expect(screen.queryByText('I3')).toBeNull();
  });
  it('clears previous comparison when a requested period is outside permitted history', async () => {
    const rows = [{ Branch: 'A', Invoice: 'I1', 'Net Sales': 20 }];
    const loadComparison = vi.fn().mockResolvedValueOnce([{ Branch: 'A', Invoice: 'P1', 'Net Sales': 10 }]).mockRejectedValueOnce(new Error('COMPARISON_HISTORY_UNAVAILABLE'));
    render(<ReportWorkbench {...base} complete rows={rows} loadRows={vi.fn()} period={{ from: '2026-10-01', to: '2026-10-07' }} loadComparison={loadComparison} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare previous period' }));
    await screen.findByText('Comparison period: 2026-09-24 — 2026-09-30');
    fireEvent.click(screen.getByRole('button', { name: 'Compare prior year' }));
    await screen.findByText('The full comparison period is outside your permitted history.');
    expect(screen.queryByText('Comparison period: 2026-09-24 — 2026-09-30')).toBeNull();
  });
  it('persists a filtered layout privately and hides export controls without permission', async () => {
    localStorage.clear();
    const rows = [{ Branch: 'A', Invoice: 'I1', 'Net Sales': 10 }, { Branch: 'B', Invoice: 'I2', 'Net Sales': 20 }];
    const props = { ...base, complete: true, rows, loadRows: vi.fn(), canExport: false, canPrint: false };
    const view = render(<ReportWorkbench {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print / PDF' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Branch filter' }), { target: { value: 'A' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Branch A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    view.unmount();
    const restored = render(<ReportWorkbench {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Branch A' }));
    await screen.findByText('1 rows / 2 source rows');
    restored.unmount();
    render(<ReportWorkbench {...props} userId="different-user" />);
    fireEvent.click(screen.getByRole('button', { name: 'Table tools & full analysis' }));
    expect(screen.queryByRole('button', { name: 'Branch A' })).toBeNull();
  });

  it('reads only server metrics for an unfiltered comparison and invalidates it on row filtering', async () => {
    const loadComparison=vi.fn(); const loadComparisonMetrics=vi.fn().mockResolvedValue({'Net Sales':10});
    render(<ReportWorkbench {...base} complete rows={[{Branch:'A',Invoice:'I1','Net Sales':20}]} loadRows={vi.fn()}
      period={{from:'2026-10-01',to:'2026-10-07'}} loadComparison={loadComparison} loadComparisonMetrics={loadComparisonMetrics} />);
    fireEvent.click(screen.getByRole('button',{name:'Table tools & full analysis'}));
    fireEvent.click(screen.getByRole('button',{name:'Compare previous period'}));
    await screen.findByText('Comparison period: 2026-09-24 — 2026-09-30');
    expect(loadComparison).not.toHaveBeenCalled(); expect(loadComparisonMetrics).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox',{name:'Branch filter'}),{target:{value:'A'}});
    expect(screen.queryByText('Comparison period: 2026-09-24 — 2026-09-30')).toBeNull();
  });

});
