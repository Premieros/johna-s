import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useGuidedWorkflow } from './useGuidedWorkflow';
import { PREREQUISITE_STEPS } from './prerequisitesRegistry';
import type { OperationalActionKey, OperationalValidationContext } from './types';

export function useOperationalGuard() {
  const { user } = useAuth();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const location = useLocation();
  const workflow = useGuidedWorkflow();

  // Super Admin is the only implicit bypass. Owner and every other role are
  // permission-first and must pass the same operational checks.
  const isSuper = user?.role === 'super_admin';
  const effectiveBranch = branchFilter || user?.branch_id || null;

  const buildValidationContext = useCallback(
    (customCtx: Partial<OperationalValidationContext> = {}): OperationalValidationContext => ({
      branchId: effectiveBranch,
      userRole: user?.role,
      hasPermission: customCtx.hasPermission ?? true,
      warehousesCount: customCtx.warehousesCount,
      suppliersCount: customCtx.suppliersCount,
      customersCount: customCtx.customersCount,
      productsCount: customCtx.productsCount,
      rawMaterialsCount: customCtx.rawMaterialsCount,
      recipesCount: customCtx.recipesCount,
      unitsCount: customCtx.unitsCount,
      categoriesCount: customCtx.categoriesCount,
      activeShiftId: customCtx.activeShiftId,
      kitchenStationsCount: customCtx.kitchenStationsCount,
      formData: customCtx.formData,
      ...customCtx,
    }),
    [effectiveBranch, user?.role]
  );

  const guardPurchase = useCallback(
    (ctx: { warehousesCount?: number; suppliersCount?: number; productsCount?: number; rawMaterialsCount?: number; formData?: Record<string, unknown> }): boolean => {
      const valCtx = buildValidationContext({ ...ctx, hasPermission: isSuper || can('purchases.manage') });
      return workflow.validateAndProceed('purchase_create', valCtx, location.pathname, 'تسجيل فاتورة مشتريات', 'Create Purchase Invoice', ctx.formData);
    },
    [buildValidationContext, isSuper, can, workflow, location.pathname]
  );

  const guardPos = useCallback(
    (ctx: { warehousesCount?: number; productsCount?: number; activeShiftId?: string | null; formData?: Record<string, unknown> }): boolean => {
      const valCtx = buildValidationContext({ ...ctx, hasPermission: isSuper || can('pos.view') });
      return workflow.validateAndProceed('pos_checkout', valCtx, location.pathname, 'شاشة البيع والكاشير (POS)', 'POS Checkout', ctx.formData);
    },
    [buildValidationContext, isSuper, can, workflow, location.pathname]
  );

  const guardTransfer = useCallback(
    (ctx: { warehousesCount?: number; formData?: Record<string, unknown> }): boolean => {
      const valCtx = buildValidationContext({ ...ctx, hasPermission: isSuper || can('inventory.transfer.create') });
      return workflow.validateAndProceed('transfer_create', valCtx, location.pathname, 'التحويلات المخزنية', 'Warehouse Transfers', ctx.formData);
    },
    [buildValidationContext, isSuper, can, workflow, location.pathname]
  );

  const interceptDbError = useCallback(
    (err: unknown, actionKey: OperationalActionKey, sourceLabelAr: string, sourceLabelEn: string, draftData?: Record<string, unknown>): boolean => {
      const valCtx = buildValidationContext();
      return workflow.handleDbError(err, actionKey, location.pathname, sourceLabelAr, sourceLabelEn, draftData, valCtx);
    },
    [buildValidationContext, workflow, location.pathname]
  );

  return { ...workflow, PREREQUISITE_STEPS, guardPurchase, guardPos, guardTransfer, interceptDbError, effectiveBranch, isSuper };
}
