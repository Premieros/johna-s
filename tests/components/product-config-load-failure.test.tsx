import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductConfigModal } from '@/features/pos/components/catalog/ProductConfigModal';
import type { Product } from '@/lib/types';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/api', () => ({ catalog: { getProductModifiers: mocks.load } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (s: string) => s }) }));
const product = { id: 'p', name: 'Chicken', sale_price: 100 } as Product;
const renderModal = (confirm = vi.fn()) => {
  render(<ProductConfigModal isOpen product={product} currency="EGP" onConfirm={confirm} onClose={vi.fn()} />);
  return confirm;
};
beforeEach(() => { mocks.load.mockReset(); });
describe('product configuration loading', () => {
  it('blocks addition after a failed options read', async () => {
    mocks.load.mockResolvedValue({ data: null, error: { message: 'Options unavailable' } });
    const confirm = renderModal();
    await screen.findByText('Options unavailable');
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('handles a rejected read without adding an unconfigured product', async () => {
    let reject!: (error: Error) => void;
    mocks.load.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const confirm = renderModal();
    await act(async () => { reject(new Error('network')); });
    await screen.findByText('Could not load options. Close and reopen to retry.');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('allows products with no groups only after a successful read', async () => {
    mocks.load.mockResolvedValue({ data: { success: true, groups: [] }, error: null });
    const confirm = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('requires both choices before confirming a two-choice group', async () => {
    mocks.load.mockResolvedValue({ data: { success: true, groups: [{ id: 'side', name: 'Side', min_selections: 2, max_selections: 2, options: [{ id: 'a', name: 'Rice' }, { id: 'b', name: 'Fries' }] }] }, error: null });
    const confirm = renderModal();
    await screen.findByTestId('modifier-option-a');
    fireEvent.click(screen.getByTestId('modifier-option-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('modifier-option-b'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ modifier_option_ids: ['a', 'b'] }));
  });
});
