-- Split KDS read access from mutation and keep station-scoped writers fail-closed.
-- Existing roles that could mutate through pos.kds_view retain that capability once
-- through the new explicit permission; administrators can then configure View-Only
-- by removing pos.kds_update without losing pos.kds_view.

UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["pos.kds_update"]'::jsonb,
    updated_at = now()
WHERE COALESCE(permissions, '[]'::jsonb) ? 'pos.kds_view'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'pos.kds_update');

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

  -- No explicit station assignment means all stations in the already-authorized
  -- branch, matching get_my_kitchen_stations/get_kitchen_queue semantics.
  IF NOT v_has_assignments THEN
    RETURN true;
  END IF;

  SELECT ks.id INTO v_main_station_id
  FROM public.kitchen_stations ks
  WHERE ks.code = 'main' AND ks.is_active = true
  ORDER BY ks.id
  LIMIT 1;

  -- Sent item routing is authoritative for normal KDS cards. Every station
  -- represented by a sent item on the order must belong to the caller.
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

  -- Legacy empty KDS cards have no sent-item route; fall back to orders.station.
  SELECT ks.id INTO v_fallback_station_id
  FROM public.kitchen_stations ks
  WHERE ks.code = v_order_station
    AND ks.is_active = true
  ORDER BY ks.id
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

CREATE OR REPLACE FUNCTION public.set_kitchen_status(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_user_email text;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_status NOT IN ('pending','sent','cooking','ready','served','cancelled') THEN
    RAISE EXCEPTION 'Invalid kitchen_status: %', p_status;
  END IF;

  SELECT o.branch_id INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF NOT v_is_service_role THEN
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;
    IF NOT public.can_permission('pos.kds_update') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update';
    END IF;
    IF NOT public.kds_order_in_user_station_scope(p_order_id) THEN
      RAISE EXCEPTION 'KDS_STATION_ACCESS_DENIED';
    END IF;
  END IF;

  UPDATE public.orders
  SET kitchen_status = p_status,
      kitchen_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE kitchen_sent_at END,
      kitchen_ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE kitchen_ready_at END,
      updated_at = now()
  WHERE id = p_order_id;

  SELECT u.email INTO v_user_email FROM public.users u WHERE u.id = auth.uid();
  INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), v_user_email, 'kitchen_status', 'order', p_order_id,
    jsonb_build_object('status', p_status), v_branch_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_kitchen_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_kitchen_status(uuid, text) TO authenticated, service_role;

-- Direct table mutation must not preserve the old View=>Write bypass. Keep the
-- special pending->sent send_to_kitchen allowance intact; only replace KDS write
-- authorization inside the canonical mutation trigger.
DO $patch_pos_kds_mutation$
DECLARE
  v_oid oid;
  v_def text;
  v_next text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'enforce_pos_permission_mutation'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'KDS_POS_MUTATION_TRIGGER_MISSING';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('pos.kds_view' in v_def) = 0 THEN
    RAISE EXCEPTION 'KDS_POS_MUTATION_VIEW_GATE_NOT_FOUND';
  END IF;

  v_next := replace(v_def, 'pos.kds_view', 'pos.kds_update');
  EXECUTE v_next;
END;
$patch_pos_kds_mutation$;

ALTER FUNCTION public.enforce_pos_permission_mutation() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.enforce_pos_permission_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_pos_permission_mutation() TO service_role;

-- Routing is also a KDS write. Preserve its branch checks while separating it
-- from the read permission without introducing role-name authorization.
DO $patch_route_to_station$
DECLARE
  v_oid oid;
  v_def text;
  v_next text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'route_to_station(uuid,text)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'KDS_ROUTE_TO_STATION_MISSING';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('pos.kds_view' in v_def) = 0 THEN
    RAISE EXCEPTION 'KDS_ROUTE_VIEW_GATE_NOT_FOUND';
  END IF;

  v_next := replace(v_def, 'pos.kds_view', 'pos.kds_update');
  EXECUTE v_next;
END;
$patch_route_to_station$;

ALTER FUNCTION public.route_to_station(uuid, text) SET search_path = public, pg_temp;

NOTIFY pgrst, 'reload schema';
