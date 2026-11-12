import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const granted = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions', () => ({ useCan: () => (key: string) => granted.has(key) }));
import { usePosPermissions } from '@/features/pos/hooks/usePosPermissions';
import { expandPermissionDependencies } from '@/lib/permissionContracts';
import { ORDER_TYPE_PERMISSION, canOperateOrderType } from '@/lib/posOrderPermissions';

describe('one explicit capability per order type', () => {
  for (const [type, permission] of Object.entries(ORDER_TYPE_PERMISSION)) {
    it(`${type} creates and sends only its own type`, () => {
      granted.clear(); granted.add(permission);
      const { result } = renderHook(usePosPermissions);
      for (const candidate of Object.keys(ORDER_TYPE_PERMISSION)) {
        expect(result.current.canOperateType(candidate as keyof typeof ORDER_TYPE_PERMISSION)).toBe(candidate === type);
      }
      expect(result.current.canCreateQuickOrder).toBe(type === 'takeaway');
      expect(result.current.canCreateOrder).toBe(type === 'dine_in');
      expect(result.current.canEditOrder).toBe(false);
      expect(result.current.canPay).toBe(false);
      expect(result.current.canPrint).toBe(false);
      expect(expandPermissionDependencies([permission]).sort()).toEqual([permission, 'pos.view'].sort());
    });
  }
  it('never infers quick access from legacy general creation or dispatch', () => {
    granted.clear(); granted.add('pos.order.create'); granted.add('pos.send_kitchen'); granted.add('pos.order.quick_create');
    const { result } = renderHook(usePosPermissions);
    expect(result.current.canCreateAnyOrder).toBe(false);
    for (const type of Object.keys(ORDER_TYPE_PERMISSION)) expect(canOperateOrderType(key => granted.has(key), type)).toBe(false);
  });
  it('fails closed for unknown types or a takeaway bound to a table', () => {
    granted.clear(); granted.add('pos.order.takeaway');
    expect(canOperateOrderType(key => granted.has(key), 'invalid')).toBe(false);
    expect(canOperateOrderType(key => granted.has(key), 'toString')).toBe(false);
    expect(canOperateOrderType(key => granted.has(key), 'takeaway', 'table-id')).toBe(false);
  });
});
