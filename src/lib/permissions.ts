import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../context/RolesContext';
import { type Permission } from './permissionDefs';

export * from './permissionDefs';

/**
 * Memoized permission checker for the current user.
 * Access is resolved only from the DB-backed capability set. The internal
 * platform.admin capability is the sole global capability; role labels never bypass checks.
 */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useAuth();
  const { rolePermissionsMap } = useRoles();
  return useCallback(
    (permission: Permission) => {
      const role = user?.role;
      if (!role) return false;
      const assigned = rolePermissionsMap[role] ?? [];
      return assigned.includes(permission) || assigned.includes('platform.admin');
    },
    [user?.role, rolePermissionsMap]
  );
}
