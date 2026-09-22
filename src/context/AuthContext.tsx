import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as api from '../api';
import type { AppUser } from '../lib/types';
import { isAuthSessionError } from '../lib/authSessionError';

interface AuthContextValue {
  session: Session | null;
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { code: string; message: string } | null }>;
  signInWithUsername: (username: string, pin: string) => Promise<{ error: { code: string; message: string } | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const PROFILE_RETRY_INITIAL_MS = 1_000;
const PROFILE_RETRY_MAX_MS = 5_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthState = useCallback(() => {
    setSession(null);
    setUser(null);
  }, []);

  const loadUser = useCallback(async (activeSession: Session | null): Promise<AppUser | null> => {
    if (!activeSession?.user?.id) {
      clearAuthState();
      return null;
    }

    // Keep the authenticated Supabase session mounted while the public profile
    // is being revalidated. A transient database/network failure must never be
    // converted into a real sign-out.
    setSession(activeSession);

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', activeSession.user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // A Supabase Auth identity is not an application account by itself.
    // Never synthesize a role, auto-create a profile, or trust auth metadata.
    // Missing/inactive profiles are definitive failures; transport failures
    // are handled separately above and keep the current session alive.
    if (!data || data.is_active === false) {
      clearAuthState();
      await supabase.auth.signOut().catch(() => {});
      return null;
    }

    const profile = data as AppUser;
    setUser(profile);
    return profile;
  }, [clearAuthState]);

  useEffect(() => {
    let mounted = true;
    let retryTimer: number | null = null;

    const hydrateSession = async (
      activeSession: Session | null,
      retryDelay = PROFILE_RETRY_INITIAL_MS,
      allowRefresh = true
    ): Promise<void> => {
      if (!mounted) return;
      if (!activeSession) {
        clearAuthState();
        setLoading(false);
        return;
      }

      try {
        await loadUser(activeSession);
        if (mounted) setLoading(false);
      } catch (error) {
        if (!mounted) return;

        if (isAuthSessionError(error)) {
          if (allowRefresh) {
            const { data, error: refreshError } = await supabase.auth.refreshSession();
            const refreshedSession = data.session;
            if (!refreshError && refreshedSession) {
              setSession(refreshedSession);
              await hydrateSession(refreshedSession, PROFILE_RETRY_INITIAL_MS, false);
              return;
            }
          }

          if (retryTimer !== null) window.clearTimeout(retryTimer);
          retryTimer = null;
          clearAuthState();
          setLoading(false);
          await supabase.auth.signOut().catch(() => {});
          return;
        }

        // Keep a previously verified operator mounted during transport/
        // PostgREST availability errors. Only cold-start hydration needs the
        // blocking loader while the profile is not yet known.
        setSession(activeSession);
        setLoading(!(user?.id && user.id === activeSession.user.id));
        retryTimer = window.setTimeout(() => {
          void hydrateSession(activeSession, Math.min(retryDelay * 2, PROFILE_RETRY_MAX_MS), true);
        }, retryDelay);
      }
    };

    void supabase.auth.getSession()
      .then(({ data: { session: activeSession } }) => {
        void hydrateSession(activeSession);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data: subscriptionHandle } = supabase.auth.onAuthStateChange((event, activeSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !activeSession) {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = null;
        clearAuthState();
        setLoading(false);
        return;
      }
      // Token refreshes and repeated SIGNED_IN events do not change the
      // application profile or its permissions. Keep the current screen
      // mounted and only replace the fresh session token.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && user?.id === activeSession.user.id)) {
        setSession(activeSession);
        return;
      }
      setLoading(true);
      void hydrateSession(activeSession);
    });

    return () => {
      mounted = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      subscriptionHandle.subscription.unsubscribe();
    };
  }, [clearAuthState, loadUser, user?.id]);

  const verifySignedInProfile = useCallback(async (): Promise<{ error: { code: string; message: string } | null }> => {
    const activeSession = (await supabase.auth.getSession()).data.session;
    if (!activeSession) {
      return { error: { code: 'session_missing', message: 'Session was not created.' } };
    }
    let profile: AppUser | null = null;
    try {
      profile = await loadUser(activeSession);
    } catch (error) {
      if (isAuthSessionError(error)) {
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        const refreshedSession = data.session;
        if (!refreshError && refreshedSession) {
          try {
            profile = await loadUser(refreshedSession);
          } catch {
            profile = null;
          }
        }
        if (!profile) {
          clearAuthState();
          await supabase.auth.signOut().catch(() => {});
          return { error: { code: 'session_expired', message: 'Session expired and could not be refreshed.' } };
        }
      } else {
        return { error: { code: 'profile_check_unavailable', message: 'Could not verify the application profile. Please retry.' } };
      }
    }
    if (!profile) {
      return { error: { code: 'profile_missing', message: 'This authentication account has no active application profile.' } };
    }
    await api.admin.recordLoginSuccess({ p_user_id: activeSession.user.id }).catch(() => {});
    return { error: null };
  }, [clearAuthState, loadUser]);

  const signIn = async (email: string, password: string) => {
    const trimmed = email.trim().toLowerCase();
    const effectiveEmail = trimmed.includes('@') ? trimmed : `${trimmed}@premier.sa`;
    const { error } = await supabase.auth.signInWithPassword({ email: effectiveEmail, password });

    if (error) {
      await api.admin.recordLoginFailure({ p_username: effectiveEmail }).catch(() => {});
      return { error: { code: error.code ?? '', message: error.message } };
    }

    return verifySignedInProfile();
  };

  const signInWithUsername = async (username: string, pin: string) => {
    const normalized = username.trim().toLowerCase();
    let emailToUse: string | null = null;

    try {
      const { data, error } = await api.admin.getLoginEmail({ p_username: normalized });
      if (!error && data?.success && data.email) emailToUse = data.email;
    } catch {
      // Fall through to the explicit email form below.
    }

    if (!emailToUse) {
      emailToUse = normalized.includes('@') ? normalized : `${normalized}@premier.sa`;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: emailToUse, password: pin });
    if (error) {
      await api.admin.recordLoginFailure({ p_username: normalized }).catch(() => {});
      return { error: { code: error.code ?? '', message: error.message } };
    }

    return verifySignedInProfile();
  };

  const signOut = async () => {
    await supabase.auth.signOut().catch(() => {});
    clearAuthState();
  };

  const refreshUser = async () => {
    const activeSession = (await supabase.auth.getSession()).data.session;
    try {
      await loadUser(activeSession);
    } catch (error) {
      if (!isAuthSessionError(error)) return;

      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && data.session) {
        try {
          await loadUser(data.session);
          return;
        } catch {
          // Fall through to a clean sign-out when the refreshed token is still
          // rejected by the profile read.
        }
      }

      clearAuthState();
      await supabase.auth.signOut().catch(() => {});
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signInWithUsername, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
