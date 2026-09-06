-- Batch 2: warehouse lifecycle safety + transfer rejection branch isolation.
-- Do not rewrite historical FK contracts. Warehouse deletion is allowed only
-- when the caller is authorized for the branch and the warehouse has no FK references.

CREATE OR REPLACE FUNCTION public.warehouse_delete_allowed(
  p_warehouse_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_rows boolean;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('warehouses.manage')
       OR NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN false;
    END IF;
  END IF;

  FOR r IN
    SELECT DISTINCT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'warehouses'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      r.table_schema,
      r.table_name,
      r.column_name
    )
    INTO v_has_rows
    USING p_warehouse_id;

    IF v_has_rows THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.warehouse_delete_allowed(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.warehouse_delete_allowed(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.warehouse_delete_allowed(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS auth_delete_warehouses ON public.warehouses;
CREATE POLICY auth_delete_warehouses
ON public.warehouses
FOR DELETE
TO authenticated
USING (public.warehouse_delete_allowed(id, branch_id));

CREATE OR REPLACE FUNCTION public.guard_warehouse_branch_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'WAREHOUSE_BRANCH_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_warehouse_branch_change ON public.warehouses;
CREATE TRIGGER trg_guard_warehouse_branch_change
BEFORE UPDATE OF branch_id ON public.warehouses
FOR EACH ROW
EXECUTE FUNCTION public.guard_warehouse_branch_change();

CREATE OR REPLACE FUNCTION public.delete_warehouse_safe(p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_blockers text[] := ARRAY[]::text[];
  v_has_rows boolean;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.can_permission('warehouses.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT w.branch_id
    INTO v_branch_id
  FROM public.warehouses w
  WHERE w.id = p_warehouse_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(w.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
  END IF;

  -- Any FK reference means the warehouse is not truly empty. This is intentionally
  -- conservative: operational/history rows, stock rows, transfer rows and setup
  -- references must be explicitly cleared/reassigned instead of being cascaded away.
  FOR r IN
    SELECT DISTINCT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'warehouses'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      r.table_schema,
      r.table_name,
      r.column_name
    )
    INTO v_has_rows
    USING p_warehouse_id;

    IF v_has_rows THEN
      v_blockers := array_append(v_blockers, r.table_name || '.' || r.column_name);
    END IF;
  END LOOP;

  IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'WAREHOUSE_HAS_OPERATIONAL_HISTORY',
      'action', 'DEACTIVATE_WAREHOUSE',
      'blockers', to_jsonb(v_blockers)
    );
  END IF;

  DELETE FROM public.warehouses WHERE id = p_warehouse_id;

  RETURN jsonb_build_object(
    'success', true,
    'warehouse_id', p_warehouse_id,
    'branch_id', v_branch_id
  );
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'WAREHOUSE_DELETE_BLOCKED',
    'action', 'DEACTIVATE_WAREHOUSE'
  );
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_warehouse_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_warehouse_safe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_warehouse_safe(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_warehouse_transfer(
  p_transfer_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- Preserve the established rejection authority contract; only harden its
  -- authentication, branch scoping and lookup behavior.
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  SELECT wt.status, wt.branch_id
    INTO v_status, v_branch_id
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(wt.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_status);
  END IF;

  UPDATE public.warehouse_transfers
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      rejection_reason = p_reason
  WHERE id = p_transfer_id
    AND branch_id = v_branch_id;

  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_warehouse_transfer(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_warehouse_transfer(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_warehouse_transfer(uuid, text) TO authenticated;
