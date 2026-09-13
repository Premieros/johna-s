import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as api from '../api';
import type { AppUser } from '../lib/types';

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

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', activeSession.user.id)
      .maybeSingle();

    // A Supabase Auth identity is not an application account by itself.
    // Never synthesize a role, auto-create a profile, or trust auth metadata.
    if (error || !data || data.is_active === false) {
      clearAuthState();
      await supabase.auth.signOut().catch(() => {});
      return null;
    }

    const profile = data as AppUser;
    setSession(activeSession);
    setUser(profile);
    return profile;
  }, [clearAuthState]);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession()
      .then(async ({ data: { session: activeSession } }) => {
        if (!mounted) return;
        if (!activeSession) {
          clearAuthState();
          return;
        }
        await loadUser(activeSession);
      })
      .catch(() => {
        if (mounted) clearAuthState();
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: subscriptionHandle } = supabase.auth.onAuthStateChange((event, activeSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !activeSession) {
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
      void loadUser(activeSession).finally(() => {
        if (mounted) setLoading(false);
      });
    });

    return () => {
      mounted = false;
      subscriptionHandle.subscription.unsubscribe();
    };
  }, [clearAuthState, loadUser, user?.id]);

  const verifySignedInProfile = useCallback(async (): Promise<{ error: { code: string; message: string } | null }> => {
    const activeSession = (await supabase.auth.getSession()).data.session;
    if (!activeSession) {
      return { error: { code: 'session_missing', message: 'Session was not created.' } };
    }
    const profile = await loadUser(activeSession);
    if (!profile) {
      return { error: { code: 'profile_missing', message: 'This authentication account has no active application profile.' } };
    }
    await api.admin.recordLoginSuccess({ p_user_id: activeSession.user.id }).catch(() => {});
    return { error: null };
  }, [loadUser]);

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
    await loadUser(activeSession);
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
