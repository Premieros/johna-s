-- Harden dining-table occupancy against empty open/held orders.
-- Empty orders are non-operational: they do not occupy a table, expose an
-- operator label, or resolve as resumable table orders.

CREATE OR REPLACE FUNCTION private.enforce_dining_table_occupancy_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_has_effective_order boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = NEW.id
      AND o.status IN ('open','held')
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id=o.id
          AND oi.quantity>0
      )
  ) INTO v_has_effective_order;

  IF v_has_effective_order THEN
    NEW.status := 'occupied';
  ELSIF NEW.status = 'occupied' THEN
    NEW.status := 'vacant';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pos_order_operator_labels(p_branch_id uuid)
RETURNS TABLE(order_id uuid, cashier_id uuid, operator_name text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '')='service_role';
BEGIN
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN RETURN; END IF;
    IF NOT public.user_may_access_branch(p_branch_id)
       OR NOT public.can_permission('pos.view') THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.cashier_id,
    COALESCE(NULLIF(trim(u.full_name),''),NULLIF(trim(u.username),''),u.email,'—')
  FROM public.orders o
  LEFT JOIN public.users u ON u.id=o.cashier_id
  WHERE o.branch_id=p_branch_id
    AND o.status IN ('open','held')
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id
        AND oi.quantity>0
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_order_operator_labels(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_order_operator_labels(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_operator_labels(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.resolve_my_active_table_order(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_branch_id uuid;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED:pos.view');
  END IF;

  SELECT t.branch_id INTO v_branch_id
  FROM public.dining_tables t
  WHERE t.id=p_table_id AND t.is_active=true;

  IF v_branch_id IS NULL OR NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','TABLE_NOT_FOUND');
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id=p_table_id
    AND o.branch_id=v_branch_id
    AND o.status IN ('open','held')
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id
        AND oi.quantity>0
    )
    AND (
      o.cashier_id=v_uid
      OR public.can_manage_other_pos_orders()
    )
  ORDER BY (o.cashier_id=v_uid) DESC,o.created_at DESC,o.id DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','TABLE_BUSY','resumable',false);
  END IF;

  RETURN jsonb_build_object('success',true,'resumable',true,'order_id',v_order_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_my_active_table_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_my_active_table_order(uuid) TO authenticated;

-- Repair stale occupied tables left behind by empty active-order shells.
UPDATE public.dining_tables t
SET status='vacant',
    updated_at=now()
WHERE t.status='occupied'
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id=t.id
      AND o.status IN ('open','held')
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id=o.id
          AND oi.quantity>0
      )
  );

COMMENT ON FUNCTION private.enforce_dining_table_occupancy_status() IS
  'Derives occupied state only from open/held orders that contain positive-quantity items.';
