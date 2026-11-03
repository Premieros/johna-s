import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/lib/permissionDefs';
import type { Role } from '@/lib/types';

describe('permission-first authorization', () => {
  it('uses the assigned capability set for arbitrary role labels', () => {
    const customRole = 'custom-label-that-has-no-special-meaning' as Role;
    const permissions = {
      [customRole]: ['inventory.view'],
    };
    expect(hasPermission(customRole, permissions, 'inventory.view')).toBe(true);
    expect(hasPermission(customRole, permissions, 'inventory.count.apply')).toBe(false);
  });

  it('does not grant access because a role label is named super_admin', () => {
    const role = 'super_admin' as Role;
    expect(hasPermission(role, { super_admin: [] }, 'inventory.view')).toBe(false);
  });

  it('uses the internal platform.admin capability as the only global bypass', () => {
    const role = 'renamed-platform-operator' as Role;
    expect(hasPermission(role, { [role]: ['platform.admin'] }, 'inventory.count.apply')).toBe(true);
  });

  it('keeps frontend and database authorization free of role-name bypasses', () => {
    const frontend = readFileSync('src/lib/permissions.ts', 'utf8');
    const migration = readFileSync(
      'supabase/migrations/20261103163000_stock_count_capability_and_safe_cancel.sql',
      'utf8',
    );
    expect(frontend).not.toContain("role === 'super_admin'");
    for (const helper of ['is_pos_admin', 'is_super_admin']) {
      const start = migration.indexOf(`FUNCTION public.${helper}()`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = migration.indexOf('$function$;', start);
      expect(end).toBeGreaterThan(start);
      const definition = migration.slice(start, end);
      expect(definition).toContain("? 'platform.admin'");
      expect(definition).not.toMatch(/u\\.role\\s*=\\s*'super_admin'/);
    }
  });
});
