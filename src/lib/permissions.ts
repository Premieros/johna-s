import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../context/RolesContext';
import { supabase } from './supabase';
import { permissionFeatureKey } from './permissionFeatureKey';
import { type Permission } from './permissionDefs';

export * from './permissionDefs';

const CACHE_WINDOW_MS = 30_000;
type ModulesEntry = { disabled: ReadonlySet<string>; fetchedAt: number };
const moduleCache = new Map<string, ModulesEntry>();
const inFlight = new Map<string, Promise<ReadonlySet<string>>>();

async function fetchDisabledModules(userId: string, force: boolean): Promise<ReadonlySet<string>> {
  const cached = moduleCache.get(userId);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_WINDOW_MS) return cached.disabled;
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const request = (async () => {
    const { data, error } = await supabase.rpc('get_my_disabled_organization_modules');
    if (error) throw error;
    const disabled: ReadonlySet<string> = new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []);
    moduleCache.set(userId, { disabled, fetchedAt: Date.now() });
    return disabled;
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, request);
  return request;
}

/** The role matrix is not enough: organization-level module denial also wins. */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useAuth();
  const { rolePermissionsMap } = useRoles();
  const userId = user?.id || null;
  const role = user?.role;
  const [disabledModules, setDisabledModules] = useState<ReadonlySet<string>>(() =>
    userId ? moduleCache.get(userId)?.disabled ?? new Set() : new Set()
  );

  useEffect(() => {
    if (!userId || role === 'super_admin') {
      setDisabledModules(new Set());
      return;
    }
    let active = true;
    // Do not reuse another organization's or user's module restrictions.
    setDisabledModules(moduleCache.get(userId)?.disabled ?? new Set());
    const refresh = (force: boolean) => {
      void fetchDisabledModules(userId, force).then((disabled) => {
        if (active) setDisabledModules(disabled);
      }).catch(() => {
        // Server-side permission and feature guards remain authoritative.
        // Preserve any last known denial when network access is unavailable.
      });
    };
    refresh(false);
    const onResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - (moduleCache.get(userId)?.fetchedAt ?? 0) > CACHE_WINDOW_MS) refresh(true);
    };
    const onChanged = () => refresh(true);
    window.addEventListener('focus', onResume);
    window.addEventListener('premier:organization-modules-changed', onChanged);
    return () => {
      active = false;
      window.removeEventListener('focus', onResume);
      window.removeEventListener('premier:organization-modules-changed', onChanged);
    };
  }, [userId, role]);

  return useCallback((permission: Permission) => {
    if (!role) return false;
    if (role === 'super_admin') return true;
    const moduleKey = permissionFeatureKey(permission);
    if (moduleKey && disabledModules.has(moduleKey)) return false;
    return (rolePermissionsMap[role] ?? []).includes(permission);
  }, [role, rolePermissionsMap, disabledModules]);
}
