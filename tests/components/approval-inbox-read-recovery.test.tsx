import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalInbox } from '@/components/ApprovalInbox';
const m = vi.hoisted(() => ({
  user: { id: 'operator', branch_id: 'A' }, print: vi.fn(), or: vi.fn(), rpc: vi.fn(), callbacks: [] as Array<() => void>,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/api', () => ({ supabase: {
  rpc: m.rpc,
  from: () => { const q = { select: () => q, eq: () => q, in: () => q, or: (x: string) => { m.or(x); return q; }, gte: () => q, order: () => q, limit: m.print }; return q; },
  channel: () => { const c = { on: (_kind: string, _filter: unknown, cb: () => void) => { m.callbacks.push(cb); return c; }, subscribe: vi.fn() }; return c; },
  removeChannel: vi.fn().mockResolvedValue(undefined),
} }));
const alert = { id: 'job', kind: 'receipt', station_code: 'cashier', status: 'failed', attempts: 5, last_error: 'route', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
beforeEach(() => { vi.clearAllMocks(); m.callbacks.length = 0; m.user = { id: 'operator', branch_id: 'A' }; m.rpc.mockResolvedValue({ data: [], error: null }); m.print.mockResolvedValue({ data: [], error: null }); localStorage.clear(); });
afterEach(cleanup);
describe('approval inbox read recovery', () => {
  it('filters ordinary successes before the server limit and serializes realtime bursts', async () => {
    let finish!: (x: unknown) => void;
    m.print.mockReturnValueOnce(new Promise(done => { finish = done; }));
    render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    expect(m.or).toHaveBeenCalledWith('status.eq.failed,and(status.eq.submitted,attempts.gt.1)');
    await act(async () => { for (let i = 0; i < 25; i++) m.callbacks[1](); });
    expect(m.print).toHaveBeenCalledOnce();
    await act(async () => { finish({ data: [], error: null }); });
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
  });
  it('does not erase an existing alert when its next read fails', async () => {
    m.print.mockResolvedValueOnce({ data: [alert], error: null }).mockResolvedValue({ data: null, error: { code: '57014' } });
    const screen = render(<ApprovalInbox ar={false} />);
    await waitFor(() => expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1'));
    await act(async () => { m.callbacks[1](); });
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('system-alerts-count')).toHaveTextContent('1');
  });
  it('discards results from the previous branch and works in StrictMode', async () => {
    let finish!: (x: unknown) => void;
    m.print.mockReturnValueOnce(new Promise(done => { finish = done; }));
    const screen = render(<StrictMode><ApprovalInbox ar={false} /></StrictMode>);
    await waitFor(() => expect(m.print).toHaveBeenCalledOnce());
    m.user = { id: 'operator', branch_id: 'B' };
    screen.rerender(<StrictMode><ApprovalInbox ar={false} /></StrictMode>);
    await waitFor(() => expect(m.print).toHaveBeenCalledTimes(2));
    await act(async () => { finish({ data: [alert], error: null }); });
    expect(screen.queryByTestId('system-alerts-count')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-alerts-button'));
    expect(screen.getByText('No important notifications')).toBeInTheDocument();
  });
});
