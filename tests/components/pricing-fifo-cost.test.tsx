import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PricingPage } from '@/features/catalog/pages/PricingPage';
const mocks = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => permission === 'raw_materials.view' }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'a' }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: [{ id: 'a', name: 'A' }] }) }));
vi.mock('@/api', () => ({ costing: { setRawMaterialPrice: vi.fn() } }));
vi.mock('@/features/catalog/services/pricingData', () => ({ loadPricingRows: async () => ({
  rawRows: [{ id: 'r', name: 'Sugar', code: 'R', branch_id: 'a', is_active: true, default_cost: 99, fifo_cost: 4 }], manufacturedRows: [], productRows: [],
}) }));
describe('pricing FIFO presentation', () => {
  it('displays actual FIFO cost separately from a different editable reference and prevents unauthorized editing', async () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Sugar')).toBeVisible());
    expect(screen.getByRole('columnheader', { name: 'Current inventory cost (FIFO)' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Manual reference price' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '4' })).toBeVisible();
    expect(screen.getByRole('spinbutton')).toHaveValue(99);
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });
});
