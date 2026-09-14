-- Compatibility closure for KDS station authorization after kitchen stations became branch-owned.
-- Preserve Permission-First semantics while resolving every station inside the order branch.
-- This migration does not modify send_to_kitchen, inventory deduction, or printing contracts.

CREATE OR REPLACE FUNCTION public.kds_order_in_user_station_scope(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_order_station text;
  v_has_assignments boolean := false;
  v_fallback_station_id uuid;
  v_main_station_id uuid;
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT o.branch_id, COALESCE(o.station, 'main')
    INTO v_branch_id, v_order_station
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL
     OR NOT public.user_may_access_branch(v_branch_id)
     OR NOT public.can_permission('pos.kds_update') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_kitchen_station_assignments a
    WHERE a.user_id = auth.uid()
      AND a.branch_id = v_branch_id
  ) INTO v_has_assignments;

  -- Preserve the established contract: without explicit assignments, an already
  -- authorized user can update KDS stations in the branch they may access.
  IF NOT v_has_assignments THEN
    RETURN true;
  END IF;

  -- `main` is now branch-owned. Never resolve a same-code station from another branch.
  SELECT ks.id INTO v_main_station_id
  FROM public.kitchen_stations ks
  WHERE ks.branch_id = v_branch_id
    AND lower(btrim(ks.code)) = 'main'
    AND ks.is_active = true
  ORDER BY ks.sort_order, ks.id
  LIMIT 1;

  -- Sent-item routing is authoritative for normal KDS cards. Every station represented
  -- by a sent item must be active, belong to the order branch, and be assigned to the user.
  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c
        ON c.id = p.category_id
       AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks
        ON ks.id = c.kitchen_station_id
       AND ks.branch_id = v_branch_id
       AND ks.is_active = true
      WHERE oi.order_id = p_order_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.user_kitchen_station_assignments a
          WHERE a.user_id = auth.uid()
            AND a.branch_id = v_branch_id
            AND a.station_id = COALESCE(ks.id, v_main_station_id)
        )
    );
  END IF;

  -- Legacy empty KDS cards fall back to orders.station, but only to the same-code
  -- active station owned by the order branch.
  SELECT ks.id INTO v_fallback_station_id
  FROM public.kitchen_stations ks
  WHERE ks.branch_id = v_branch_id
    AND lower(btrim(ks.code)) = lower(btrim(v_order_station))
    AND ks.is_active = true
  ORDER BY ks.sort_order, ks.id
  LIMIT 1;

  RETURN v_fallback_station_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_kitchen_station_assignments a
      WHERE a.user_id = auth.uid()
        AND a.branch_id = v_branch_id
        AND a.station_id = v_fallback_station_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.kds_order_in_user_station_scope(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kds_order_in_user_station_scope(uuid) TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
