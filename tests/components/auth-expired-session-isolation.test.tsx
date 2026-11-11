import { render, waitFor, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';
const mocks = vi.hoisted(() => ({ profile: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), event: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  auth: { getSession: mocks.getSession, refreshSession: mocks.refresh, signOut: mocks.signOut,
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => { mocks.event.mockImplementation(callback); return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
} }));
vi.mock('@/api', () => ({ admin: { recordLoginSuccess: vi.fn() } }));
vi.mock('@/lib/reportRequestCache', () => ({ invalidateReportPermissions: vi.fn() }));
function State() { const { loading, user, needsOrganizationSetup } = useAuth(); return <span>{loading ? 'loading' : user ? 'operator' : needsOrganizationSetup ? 'pending-organization' : 'signed-out'}</span>; }
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

describe('session recovery during outages', () => {
  it('retries a temporary refresh failure without revoking the account', async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: { status: 401 } })
      .mockResolvedValue({ data: { id: 'operator', is_active: true }, error: null });
    mocks.refresh.mockResolvedValue({ data: { session: null }, error: { status: 503 } });
    const screen = render(<AuthProvider><State /></AuthProvider>);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('operator')).toBeInTheDocument(), { timeout: 2500 });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('does not restore a user from a profile read that completed after sign-out', async () => {
    let finish!: (value: unknown) => void;
    mocks.profile.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<AuthProvider><State /></AuthProvider>);
    await waitFor(() => expect(mocks.profile).toHaveBeenCalledOnce());
    await act(async () => { mocks.event('SIGNED_OUT', null); });
    await act(async () => { finish({ data: { id: 'operator', is_active: true }, error: null }); });
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('ignores initial session retrieval if sign-out happened while it was pending', async () => {
    let finish!: (value: unknown) => void;
    mocks.getSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<AuthProvider><State /></AuthProvider>);
    await act(async () => { mocks.event('SIGNED_OUT', null); });
    await act(async () => { finish({ data: { session: { user: { id: 'operator' } } } }); });
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});

 describe('unprovisioned organization signup sessions',()=>{
  it('retains a verified pending identity without granting an application user',async()=>{
   mocks.getSession.mockResolvedValue({data:{session:{user:{id:'new-owner',email_confirmed_at:'2026-11-11',user_metadata:{organization_signup:true}}}}});
   mocks.profile.mockResolvedValue({data:null,error:null});
   render(<AuthProvider><State/></AuthProvider>);
   await waitFor(()=>expect(document.body.textContent).toContain('pending-organization'));expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('still rejects inactive profiles even when signup metadata is present',async()=>{
   mocks.getSession.mockResolvedValue({data:{session:{user:{id:'new-owner',email_confirmed_at:'2026-11-11',user_metadata:{organization_signup:true}}}}});
   mocks.profile.mockResolvedValue({data:{id:'new-owner',is_active:false},error:null});
   render(<AuthProvider><State/></AuthProvider>);await waitFor(()=>expect(mocks.signOut).toHaveBeenCalledOnce());
  });
  it('still rejects missing ordinary profiles',async()=>{
   mocks.profile.mockResolvedValue({data:null,error:null});render(<AuthProvider><State/></AuthProvider>);await waitFor(()=>expect(mocks.signOut).toHaveBeenCalledOnce());
  });
 });
