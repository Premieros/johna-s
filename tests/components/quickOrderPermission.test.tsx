import { renderHook } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
const granted=vi.hoisted(()=>new Set<string>());
vi.mock('@/lib/permissions',()=>({useCan:()=>(key:string)=>granted.has(key)}));
import { usePosPermissions } from '@/features/pos/hooks/usePosPermissions';
import { expandPermissionDependencies } from '@/lib/permissionContracts';
describe('independent quick order capability',()=>{
 it('enables quick creation without granting general creation, editing, payment or printing',()=>{
  granted.clear();granted.add('pos.order.quick_create');const {result}=renderHook(usePosPermissions);
  expect(result.current.canCreateQuickOrder).toBe(true);expect(result.current.canCreateOrder).toBe(false);
  expect(result.current.canEditOrder).toBe(false);expect(result.current.canPay).toBe(false);expect(result.current.canPrint).toBe(false);
  expect(expandPermissionDependencies(['pos.order.quick_create'])).toEqual(expect.arrayContaining(['pos.view','pos.order.quick_create']));
  expect(expandPermissionDependencies(['pos.order.quick_create'])).not.toContain('pos.order.create');
 });
 it('retains existing general creators quick access and denies an ungranted reader',()=>{
  granted.clear();granted.add('pos.order.create');const {result,rerender}=renderHook(usePosPermissions);expect(result.current.canCreateQuickOrder).toBe(true);
  granted.clear();rerender();expect(result.current.canCreateQuickOrder).toBe(false);
 });
});
