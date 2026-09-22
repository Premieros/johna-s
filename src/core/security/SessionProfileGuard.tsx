import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { isAuthSessionError } from '@/lib/authSessionError';

const VERIFIED_PROFILE_KEY = 'premier_verified_profile_id';
const PROFILE_REVALIDATION_RETRY_MS = 5_000;
const LOCAL_CACHE_PREFIXES = [
  'pos_offline_products_cache_v1_',
  'pos_offline_categories_cache_v1_',
];

async function clearOfflineReadCache(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && LOCAL_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be unavailable in hardened/private browser modes.
  }

  if (typeof indexedDB === 'undefined') return;

  try {
    const request = indexedDB.open('premier_pos_offline_db', 2);
    await new Promise<void>((resolve) => {
      request.onerror = () => resolve();
      request.onupgradeneeded = () => undefined;
      request.onsuccess = () => {
        const db = request.result;
        const readableStores = [
          'products', 'categories', 'customers', 'dining_tables',
          'dining_areas', 'stock_map', 'system_settings',
        ].filter((name) => db.objectStoreNames.contains(name));

        if (readableStores.length === 0) {
          db.close();
          resolve();
          return;
        }

        const tx = db.transaction(readableStores, 'readwrite');
        readableStores.forEach((name) => tx.objectStore(name).clear());
        tx.oncomplete = tx.onerror = tx.onabort = () => {
          db.close();
          resolve();
        };
      };
    });
  } catch {
    // Never block the authenticated shell because browser cache cleanup failed.
  }
}

export function SessionProfileGuard({ children }: { children: ReactNode }) {
  const { session, user, signOut } = useAuth();
  const checkedUserIdRef = useRef<string | null>(null);
  const signOutRef = useRef(signOut);

  useEffect(() => { signOutRef.current = signOut; }, [signOut]);

  useEffect(() => {
    const sessionUserId = session?.user?.id ?? null;
    if (!sessionUserId || !user?.id || user.id !== sessionUserId) {
      checkedUserIdRef.current = null;
      return;
    }
    if (checkedUserIdRef.current === sessionUserId) return;
    checkedUserIdRef.current = sessionUserId;

    let cancelled = false;
    let retryTimer: number | null = null;

    const revalidateProfile = async (allowRefresh = true): Promise<void> => {
      const { data, error } = await supabase
        .from('users')
        .select('id, is_active')
        .eq('id', sessionUserId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        if (isAuthSessionError(error)) {
          if (allowRefresh) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session) {
              void revalidateProfile(false);
              return;
            }
          }

          checkedUserIdRef.current = null;
          await signOutRef.current();
          return;
        }

        // This guard is intentionally fail-safe for transport failures:
        // RLS still protects every request, while a temporary network/PostgREST
        // error must not destroy the user's valid Supabase session.
        checkedUserIdRef.current = null;
        retryTimer = window.setTimeout(() => {
          if (cancelled) return;
          checkedUserIdRef.current = sessionUserId;
          void revalidateProfile(true);
        }, PROFILE_REVALIDATION_RETRY_MS);
        return;
      }

      if (!data || data.is_active === false) {
        checkedUserIdRef.current = null;
        await clearOfflineReadCache();
        try { localStorage.removeItem(VERIFIED_PROFILE_KEY); } catch { /* ignore storage errors */ }
        await signOutRef.current();
        return;
      }

      let previousProfileId: string | null = null;
      try { previousProfileId = localStorage.getItem(VERIFIED_PROFILE_KEY); } catch { previousProfileId = null; }
      if (previousProfileId !== sessionUserId) {
        await clearOfflineReadCache();
        try { localStorage.setItem(VERIFIED_PROFILE_KEY, sessionUserId); } catch { /* ignore storage errors */ }
      }
    };

    void revalidateProfile();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [session?.user?.id, user?.id]);

  // AuthContext already validates the application profile before exposing `user`.
  // This guard is a background revalidation/cache-isolation layer only; it must
  // never replace the mounted application with a second full-screen auth loader.
  return <>{children}</>;
}
