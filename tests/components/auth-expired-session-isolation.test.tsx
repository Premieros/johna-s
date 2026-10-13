import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
const mocks = vi.hoisted(() => ({ profile: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  auth: { getSession: mocks.getSession, refreshSession: mocks.refresh, signOut: mocks.signOut,
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
} }));
vi.mock('@/api', () => ({ admin: { recordLoginSuccess: vi.fn() } }));
vi.mock('@/lib/reportRequestCache', () => ({ invalidateReportPermissions: vi.fn() }));
function State() { const { loading, user } = useAuth(); return <span>{loading ? 'loading' : user ? 'operator' : 'signed-out'}</span>; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'operator' } } } });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.refresh.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found' } });
});
afterEach(cleanup);
describe('expired session isolation', () => {
  it('cleans only this session when its refresh token is missing', async () => {
    mocks.profile.mockResolvedValue({ data: null, error: { status: 401 } });
    const screen = render(<AuthProvider><State /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });
  it('retains account revocation when the profile is inactive', async () => {
    mocks.profile.mockResolvedValue({ data: { id: 'operator', is_active: false }, error: null });
    render(<AuthProvider><State /></AuthProvider>);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
