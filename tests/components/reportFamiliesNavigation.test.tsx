import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'reader', role: 'manager' } }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'branch-a' }));
vi.mock('@/hooks/useReportPermissionVersion', () => ({ useReportPermissionVersion: () => 1 }));
const permissions = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => permissions.has(permission) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/features/reporting/pages/ReportsPage', () => ({ ReportsPage: ({ controlledReportType }: { controlledReportType: string }) => <div data-testid="operational-report">{controlledReportType}</div> }));
vi.mock('@/features/accounting/pages/FinancialReportsPage', () => ({ FinancialReportsPage: () => <div data-testid="financial-report" /> }));
import { ReportsCenterPage } from '@/features/reporting/pages/ReportsCenterPage';

const open = (route = '/reports') => render(<MemoryRouter initialEntries={[route]}><ReportsCenterPage /></MemoryRouter>);
const navigation = () => within(screen.getByRole('complementary'));
beforeEach(() => { permissions.clear(); permissions.add('reports.view'); });

describe('basic report navigation', () => {
  it('filters discovery and requested views by permissions', () => {
    open('/reports?type=sales_costs');
    expect(navigation().queryByRole('button', { name: 'Sales Cost & Profit' })).toBeNull();
    expect(navigation().queryByRole('button', { name: 'Accounting Reports' })).toBeNull();
    expect(screen.getByTestId('operational-report').textContent).toBe('sales');
    expect(screen.queryByRole('option', { name: 'Sold-item costs & profit' })).toBeNull();
  });
  it('shows seven primary reports and selects internal views', () => {
    permissions.add('reports.financial'); permissions.add('reports.costing');
    open('/reports?type=sales_by_product');
    expect(navigation().getAllByRole('button')).toHaveLength(7);
    expect(screen.getByTestId('operational-report').textContent).toBe('sales_by_product');
    fireEvent.change(screen.getByRole('combobox', { name: 'Report view' }), { target: { value: 'sales_by_station' } });
    expect(screen.getByTestId('operational-report').textContent).toBe('sales_by_station');
    fireEvent.click(navigation().getByRole('button', { name: 'Collections & Balances' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Report view' }), { target: { value: 'financial:treasury_statement' } });
    expect(screen.getByTestId('financial-report')).toBeTruthy();
  });
  it('searches internal views without querying a different report until selection', () => {
    permissions.add('reports.financial'); open();
    fireEvent.change(navigation().getByRole('searchbox'), { target: { value: 'Trial balance' } });
    expect(navigation().queryByRole('button', { name: 'Sales' })).toBeNull();
    expect(screen.getByTestId('operational-report').textContent).toBe('sales');
    fireEvent.click(navigation().getByRole('button', { name: 'Trial balance as of date' }));
    expect(screen.getByTestId('financial-report')).toBeTruthy();
  });
  it('resolves a financial-only fallback before mounting its report', () => {
    permissions.clear(); permissions.add('reports.financial');
    open('/reports?type=sales_costs');
    expect(screen.getByTestId('financial-report')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Report view' }) as HTMLSelectElement).value).toBe('financial:inventory_movement');
    expect(screen.queryByTestId('operational-report')).toBeNull();
  });
  it.each([['detailed_invoices', 'sales'], ['sales_by_employee', 'cashier_performance'], ['top_consumed_products', 'sales_by_product']])('resolves legacy %s to %s', (legacy, current) => {
    open('/reports?type=' + legacy);
    expect(screen.getByTestId('operational-report').textContent).toBe(current);
  });
  it('expands in-page without remounting the report and closes with Escape', () => {
    open();
    const report = screen.getByTestId('operational-report');
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByTestId('unified-reports-center')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('operational-report')).toBe(report);
    expect(document.body.style.overflow).toBe('hidden');
    const modal = document.createElement('div');
    modal.dataset.testid = 'modal-root';
    document.body.append(modal);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('unified-reports-center')).toHaveAttribute('data-expanded', 'true');
    modal.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('unified-reports-center')).toHaveAttribute('data-expanded', 'false');
    expect(screen.getByTestId('operational-report')).toBe(report);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('opens the same selected month in a review report without claiming completion', () => {
    open('/reports?type=month_review');
    expect(screen.getByTestId('month-close-review')).toBeTruthy();
    expect(screen.getByText(/not confirmation of a completed close/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Review month'), { target: { value: '2026-09' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Open report' })[0]);
    expect(screen.getByTestId('operational-report').textContent).toBe('sales');
  });

});
