import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeReceivablesPeriodReport } from '@/features/accounting/components/EmployeeReceivablesPeriodReport';

const mocks = vi.hoisted(() => ({ load: vi.fn(), exportExcel: vi.fn() }));
vi.mock('@/api', () => ({ accounting: { getEmployeeReceivablesPeriodSummary: mocks.load } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: mocks.exportExcel }));

afterEach(() => vi.useRealTimers());

it('runs one branch-scoped period report after a month is selected and applied', async () => {
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  mocks.load.mockResolvedValue({ data: [{
    customer_id: 'employee-1', employee_name: 'Employee fixture', phone: null,
    period_opening_balance: 125, period_debit: 95, period_credit: 10, period_closing_balance: 210,
  }], error: null });
  render(<EmployeeReceivablesPeriodReport branchId="branch-fixture" />);
  await screen.findByTestId('employee-report-total-closing');
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith({
    p_branch_id: 'branch-fixture', p_from_date: '2026-11-01', p_to_date: '2026-11-18',
  });
  fireEvent.change(screen.getByLabelText('Choose Month'), { target: { value: '2026-10' } });
  expect(mocks.load).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Run Report' }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.load).toHaveBeenLastCalledWith({
    p_branch_id: 'branch-fixture', p_from_date: '2026-10-01', p_to_date: '2026-10-31',
  });
  await screen.findByTestId('employee-report-total-closing');
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(mocks.exportExcel).toHaveBeenCalledWith(expect.objectContaining({
    subtitle: '2026-10-01 — 2026-10-31',
    totalRow: { 'Opening Balance': 125, 'Period Debit': 95, 'Paid in Period': 10, 'Closing Balance': 210 },
  }));
});
