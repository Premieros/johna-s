import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostingCenterPage } from '@/features/costing/pages/CostingCenterPage';
const mocks = vi.hoisted(() => ({ summary: vi.fn(), consumption: vi.fn(), orders: vi.fn(), branches: [{ id: 'a', name: 'A' }], show: vi.fn(), t: (key: string) => key }));
vi.mock('@/api', () => ({ costing: {
  getOverview: async () => ({ data: [] }), getRawMaterialCostOverview: async () => ({ data: [] }),
  getSalesSummary: mocks.summary, getRawConsumptionCostBreakdown: mocks.consumption, getOrderMargin: mocks.orders,
} }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: mocks.t }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'a' }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ minDate: undefined, unlimited: false, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/features/costing/services/costingSelectors', () => ({ loadCostingBranches: async () => mocks.branches, loadCostingSuppliers: async () => [], loadRawMaterialUnitDisplayMap: async () => ({}) }));
vi.mock('@/features/costing/components/CostBreakdownButton', () => ({ CostBreakdownButton: () => null }));
beforeEach(() => {
  mocks.summary.mockReset().mockResolvedValue({ data: { cogs: 12, net_sales: 100, sales_count: 1, ratio: 12 } });
  mocks.orders.mockReset().mockResolvedValue({ data: [] });
  mocks.consumption.mockReset().mockResolvedValue({ data: [{ raw_material_id: 'r', raw_material_name: 'Sugar', unit_name: 'kg', consumed_quantity: 2, actual_quantity: 1, estimated_quantity: 1, actual_cost: 10, estimated_cost: 12, displayed_cost: 22 }] });
});
describe('costing selected-period reports', () => {
  it('uses applied dates for COGS summary, order margins and raw consumption cost with an inclusive end day', async () => {
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.summary).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('costing-from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('costing-to'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply period' }));
    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-09-01', p_to: '2026-09-30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Period cost' }));
    await waitFor(() => expect(mocks.consumption).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-08-31T21:00:00.000Z', p_to: '2026-09-30T20:59:59.999Z' }));
    expect((await screen.findAllByText('Sugar')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Actual cost').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Estimated cost').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'orderMargin' }));
    await waitFor(() => expect(mocks.orders).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-09-01', p_to: '2026-09-30' }));
  });
});
