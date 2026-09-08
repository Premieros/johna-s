import { describe, expect, it } from 'vitest';
import { validateActionPrerequisites } from '@/core/guard/prerequisitesRegistry';

describe('guided workflow permission-first contract', () => {
  it('does not give owner an implicit permission bypass', () => {
    const result = validateActionPrerequisites('purchase_create', {
      userRole: 'owner',
      branchId: 'branch-1',
      hasPermission: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.missingStep?.key).toBe('need_permission');
  });

  it('keeps super admin as the only implicit permission bypass', () => {
    const result = validateActionPrerequisites('purchase_create', {
      userRole: 'super_admin',
      hasPermission: false,
    });

    expect(result.allowed).toBe(true);
  });

  it('requires an active shift for POS regardless of role label', () => {
    const result = validateActionPrerequisites('pos_checkout', {
      userRole: 'owner',
      branchId: 'branch-1',
      hasPermission: true,
      warehousesCount: 1,
      productsCount: 1,
      activeShiftId: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.missingStep?.key).toBe('open_shift');
  });
});
