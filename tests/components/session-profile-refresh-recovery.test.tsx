import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProfileGuard } from '@/core/security/SessionProfileGuard';
const m = vi.hoisted(() => ({ profile: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'operator' } }, user: { id: 'operator' }, signOut: m.signOut }) }));
vi.mock('@/api', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.profile }) }) }),
  auth: { refreshSession: m.refresh },
} }));
beforeEach(() => { vi.clearAllMocks(); m.signOut.mockResolvedValue(undefined); m.profile.mockResolvedValue({ data: null, error: { status: 401 } }); m.refresh.mockResolvedValue({ data: { session: null }, error: { status: 503 } }); });
afterEach(cleanup);
describe('background profile refresh recovery', () => {
  it('keeps the mounted screen on a temporary refresh error in StrictMode', async () => {
    const screen = render(<StrictMode><SessionProfileGuard><span>POS screen</span></SessionProfileGuard></StrictMode>);
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText('POS screen')).toBeInTheDocument();
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it('does not sign out a new screen after an obsolete refresh resolves', async () => {
    let finish!: (x: unknown) => void;
    m.refresh.mockReturnValue(new Promise(done => { finish = done; }));
    const screen = render(<SessionProfileGuard><span>POS</span></SessionProfileGuard>);
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    screen.unmount();
    await act(async () => { finish({ data: { session: null }, error: { code: 'session_not_found' } }); });
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it('cleans a revoked session locally', async () => {
    m.refresh.mockResolvedValue({ data: { session: null }, error: { code: 'session_not_found' } });
    render(<SessionProfileGuard><span>POS</span></SessionProfileGuard>);
    await waitFor(() => expect(m.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' }));
  });
});
