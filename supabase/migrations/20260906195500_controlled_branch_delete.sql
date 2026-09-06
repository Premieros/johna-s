-- Batch 2: branch hard delete must never erase operational/history data by accident.
-- Keep existing FK behavior intact, but make authenticated direct DELETE fail closed and
-- route permanent deletion through a controlled SECURITY DEFINER RPC.

DROP POLICY IF EXISTS auth_delete_branches ON public.branches;
CREATE POLICY auth_delete_branches
ON public.branches
FOR DELETE
TO authenticated
USING (false);

CREATE OR REPLACE FUNCTION public.delete_branch_cascade(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user_branch uuid;
  v_org uuid;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.can_permission('branches.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT branch_id INTO v_user_branch
  FROM public.users
  WHERE id = v_uid AND is_active = true;

  IF NOT public.is_pos_admin() AND v_user_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT organization_id INTO v_org
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF v_user_branch IS NOT DISTINCT FROM p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_DELETE_CURRENT_BRANCH');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Blocking dependencies are operational/history data. Setup/configuration rows are
  -- intentionally not blockers so a genuinely unused branch can still be removed.
  IF EXISTS (SELECT 1 FROM public.users WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'users');
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'orders');
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'sales');
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_payments WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'sale_payments');
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchases WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'purchases');
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_receipts WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'purchase_receipts');
  END IF;
  IF EXISTS (SELECT 1 FROM public.expenses WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'expenses');
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'shifts');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_batches WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory_batches');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_ledger WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory_ledger');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory_movements');
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_transactions WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'stock_transactions');
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_counts WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'stock_counts');
  END IF;
  IF EXISTS (SELECT 1 FROM public.warehouse_transfers WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'warehouse_transfers');
  END IF;
  IF EXISTS (SELECT 1 FROM public.waste_entries WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'waste_entries');
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'journal_entries');
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_payments WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'customer_payments');
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_payments WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'supplier_payments');
  END IF;
  IF EXISTS (SELECT 1 FROM public.treasury_transactions WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'treasury_transactions');
  END IF;
  IF EXISTS (SELECT 1 FROM public.approval_requests WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'approval_requests');
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_orders WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'production_orders');
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_waste WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'production_waste');
  END IF;
  IF EXISTS (SELECT 1 FROM public.raw_material_movements WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'raw_material_movements');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_unit_entries WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory_unit_entries');
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_unit_productions WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'inventory_unit_productions');
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_inventory_consumptions WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'order_inventory_consumptions');
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_kitchen_sends WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'order_kitchen_sends');
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_kitchen_voids WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'order_kitchen_voids');
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_print_events WHERE branch_id = p_branch_id) THEN
    v_blockers := array_append(v_blockers, 'sale_print_events');
  END IF;

  IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'BRANCH_HAS_OPERATIONAL_HISTORY',
      'action', 'DEACTIVATE_BRANCH',
      'blockers', to_jsonb(v_blockers)
    );
  END IF;

  DELETE FROM public.branches WHERE id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'organization_id', v_org
  );
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'BRANCH_DELETE_BLOCKED',
    'action', 'DEACTIVATE_BRANCH'
  );
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_branch_cascade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_branch_cascade(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_branch_cascade(uuid) TO authenticated;
