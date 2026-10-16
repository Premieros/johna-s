import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierAreaSettings } from '@/features/pos/components/settings/CashierAreaSettings';
const m = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), show: vi.fn() }));
vi.mock('@/api/domains/catalog', () => ({ catalog: { getCashierAreaSettings: m.read, saveCashierAreaSettings: m.save } }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: m.show }) }));
beforeEach(() => {
  vi.clearAllMocks();
  m.read.mockResolvedValue({ data: { success: true, station: null, areas: [{ id: 'outside', name: 'Outside', secondary: false }, { id: 'inside', name: 'Inside', secondary: false }] } });
  m.save.mockResolvedValue({ data: { success: true } });
});
async function add() {
  render(<CashierAreaSettings branchId="smouha" isAr={false} />);
  fireEvent.click(await screen.findByText('Add second cashier station'));
}
describe('cashier area configuration', () => {
  it('does not activate by default and can save a prepared disabled configuration', async () => {
    await add();
    fireEvent.click(screen.getByLabelText('Outside'));
    fireEvent.click(screen.getByText('Save cashier routing'));
    await waitFor(() => expect(m.save).toHaveBeenCalledExactlyOnceWith({ p_branch_id: 'smouha', p_name: 'Second cashier', p_enabled: false, p_area_ids: ['outside'] }));
  });
  it('requires explicit device readiness to activate and prevents double submission', async () => {
    await add();
    let finish!: (v: unknown) => void;
    m.save.mockReturnValueOnce(new Promise(done => { finish = done; }));
    fireEvent.click(screen.getByLabelText('Enable cashier area routing'));
    expect(screen.getByText('Save cashier routing')).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/V8.2 is installed/));
    fireEvent.click(screen.getByText('Save cashier routing'));
    fireEvent.click(screen.getByText('Save cashier routing'));
    expect(m.save).toHaveBeenCalledOnce();
    await act(async () => finish({ data: { success: true } }));
  });
  it('shows read failure and offers no destructive empty save', async () => {
    m.read.mockResolvedValue({ data: null, error: { message: 'READ_TIMEOUT' } });
    render(<CashierAreaSettings branchId="smouha" isAr={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('READ_TIMEOUT');
    expect(screen.queryByText('Save cashier routing')).not.toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
  });
});
