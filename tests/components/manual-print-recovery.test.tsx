import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualPrintRecovery } from '@/features/pos/components/settings/ManualPrintRecovery';
const m = vi.hoisted(() => ({ allowed: true, list: vi.fn(), reserve: vi.fn(), finish: vi.fn(), prepare: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'ar' }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => m.allowed }));
vi.mock('@/features/pos/services/manualPrintRecovery', () => ({
  listDelayedPrintTickets: m.list, reserveManualPrintTicket: m.reserve, finishManualPrintTicket: m.finish,
  prepareManualPrintWindow: m.prepare, manualPrintError: () => 'راجع حالة التذكرة',
}));
const ticket = { id: 'job', station_code: 'بار', kind: 'kitchen', created_at: new Date().toISOString() };
beforeEach(() => { vi.clearAllMocks(); m.allowed = true; m.list.mockResolvedValue([ticket]); m.reserve.mockResolvedValue({ ...ticket, payload: { text: 'fixture' } }); m.finish.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('manager manual print recovery', () => {
  it('does not read or mutate the queue without permission', () => {
    m.allowed = false;
    render(<ManualPrintRecovery branchId="a" onClose={vi.fn()} />);
    expect(m.list).not.toHaveBeenCalled();
    expect(screen.getByText('تحديث القائمة')).toBeDisabled();
  });
  it('does not reserve when the browser blocks its window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ManualPrintRecovery branchId="a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('طباعة يدوية'));
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it('prints only after successful reservation and requires explicit confirmation', async () => {
    vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn(), opener: null } as unknown as Window);
    render(<ManualPrintRecovery branchId="a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('طباعة يدوية'));
    await screen.findByText('تمت الطباعة');
    expect(m.prepare).toHaveBeenCalledOnce();
    expect(m.finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('ألغيت أو لم أتأكد'));
    await waitFor(() => expect(m.finish).toHaveBeenCalledWith('job', expect.any(String), false));
  });
  it('never prints or blindly reclaims after an ambiguous reserve failure', async () => {
    vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn(), opener: null } as unknown as Window);
    m.reserve.mockRejectedValue(new Error('network'));
    render(<ManualPrintRecovery branchId="a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('طباعة يدوية'));
    await screen.findByRole('alert');
    expect(m.reserve).toHaveBeenCalledOnce();
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.finish).not.toHaveBeenCalled();
  });
});
