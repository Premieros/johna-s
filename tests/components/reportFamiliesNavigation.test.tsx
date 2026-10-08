import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const permissions = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => permissions.has(permission) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/features/reporting/pages/ReportsPage', () => ({ ReportsPage: ({ controlledReportType }: { controlledReportType: string }) => <div data-testid="operational-report">{controlledReportType}</div> }));
vi.mock('@/features/accounting/pages/FinancialReportsPage', () => ({ FinancialReportsPage: () => <div data-testid="financial-report" /> }));
import { ReportsCenterPage } from '@/features/reporting/pages/ReportsCenterPage';

const open = (route = '/reports') => render(<MemoryRouter initialEntries={[route]}><ReportsCenterPage /></MemoryRouter>);
// Both responsive copies intentionally share the same permission-filtered catalog.
const navigation = () => within(screen.getByRole('complementary'));
beforeEach(() => { permissions.clear(); permissions.add('reports.view'); });

describe('report family navigation', () => {
  it('keeps reports outside the user permissions out of discovery', () => {
    open();
    expect(navigation().queryByText('Trial Balance')).toBeNull();
    expect(navigation().queryByText('Profit Report')).toBeNull();
    expect(navigation().getByRole('heading', { name: 'Sales & Returns' })).toBeTruthy();
    expect(navigation().queryByText('Top Consumed Products')).toBeNull();
  });
  it('searches across both catalogs and removes empty families', () => {
    permissions.add('reports.financial');
    open();
    fireEvent.change(navigation().getByRole('searchbox'), { target: { value: 'Trial Balance' } });
    expect(navigation().getByRole('button', { name: 'Trial Balance' })).toBeTruthy();
    expect(navigation().getAllByRole('heading')).toHaveLength(1);
    expect(navigation().queryByText('Sales Report')).toBeNull();
  });
  it('preserves operational and financial deep links and selections', () => {
    permissions.add('reports.financial');
    open('/reports?type=sales_by_product');
    expect(screen.getByTestId('operational-report').textContent).toBe('sales_by_product');
    fireEvent.click(navigation().getByRole('button', { name: 'Sales by Station & Category' }));
    expect(screen.getByTestId('operational-report').textContent).toBe('sales_by_station');
    fireEvent.click(navigation().getByRole('button', { name: 'Bank / Treasury Statement' }));
    expect(screen.getByTestId('financial-report')).toBeTruthy();
    expect(navigation().getByRole('button', { name: 'Bank / Treasury Statement' }).getAttribute('aria-current')).toBe('page');
  });
});
