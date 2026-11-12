import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiningAreaCreateModal } from '@/features/pos/components/floor/DiningAreaCreateModal';
const mocks = vi.hoisted(() => ({ show: vi.fn(), t: (key: string) => key }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: mocks.t }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
beforeEach(() => vi.clearAllMocks());
const props = () => ({ open: true, branchId: 'smouha', createArea: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), onCreated: vi.fn().mockResolvedValue(undefined) });
function fill(name = 'Terrace', count = '12') {
  fireEvent.change(screen.getByLabelText('areaName'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Number of tables'), { target: { value: count } });
}
describe('create area with table count form', () => {
  it('saves the named area and table count in one operation', async () => {
    const p = props(); render(<DiningAreaCreateModal {...p} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'saveSuccess' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledOnce());
    expect(p.createArea).toHaveBeenCalledExactlyOnceWith({ branchId: 'smouha', name: 'Terrace', tableCount: 12 });
    expect(p.onClose).toHaveBeenCalledOnce();
  });
  it.each(['', '-1', '101', '1.5'])('rejects invalid table count %s', async count => {
    const p = props(); render(<DiningAreaCreateModal {...p} />); fill('Terrace', count);
    fireEvent.click(screen.getByRole('button', { name: 'saveSuccess' }));
    expect(p.createArea).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('whole table count'), 'error');
  });
  it('blocks another submission while saving and retains the form if the server rejects it', async () => {
    const p = props(); let reject!: (error: Error) => void;
    p.createArea.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    render(<DiningAreaCreateModal {...p} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'saveSuccess' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => reject(new Error('AREA_NAME_EXISTS')));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('areaName')).toHaveValue('Terrace');
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('already exists'), 'error');
  });
  it('discards the old form and completion when the active branch changes', async () => {
    const p = props(); let finish!: () => void;
    p.createArea.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<DiningAreaCreateModal {...p} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'saveSuccess' }));
    view.rerender(<DiningAreaCreateModal {...p} branchId="cleopatra" />);
    expect(screen.getByLabelText('areaName')).toHaveValue('');
    await act(async () => finish());
    expect(p.onClose).not.toHaveBeenCalled(); expect(p.onCreated).not.toHaveBeenCalled();
  });
});
