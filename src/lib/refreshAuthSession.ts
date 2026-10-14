import type { Session } from '@supabase/supabase-js';
import { isAuthSessionError } from './authSessionError';

type Refresh = () => Promise<{ data: { session: Session | null }; error: unknown }>;
export type SessionRecovery =
  | { status: 'refreshed'; session: Session }
  | { status: 'expired' }
  | { status: 'unavailable' };

// A failed network/server request does not prove that the session was revoked.
// RLS continues to authorize requests while the application retries verification.
export async function refreshAuthSession(refresh: Refresh): Promise<SessionRecovery> {
  try {
    const { data, error } = await refresh();
    if (error) return { status: isAuthSessionError(error) ? 'expired' : 'unavailable' };
    return data.session ? { status: 'refreshed', session: data.session } : { status: 'expired' };
  } catch (error) {
    return { status: isAuthSessionError(error) ? 'expired' : 'unavailable' };
  }
}
