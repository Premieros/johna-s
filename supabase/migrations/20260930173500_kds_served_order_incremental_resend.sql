-- Hotfix: allow safe incremental kitchen sends after an order was already served.
-- Problem: an open/unpaid dine-in order can reach kitchen_status='served'. Later
-- additions are persisted and sent, but the existing send wrapper preserves
-- 'served', while get_kitchen_queue excludes served orders. The new items
-- therefore disappear from KDS.
--
-- Safety: remember the cumulative quantity that has already been served per
-- order item. Reopening a served order exposes only the delta above that
-- baseline, so previously served items never reappear as kitchen work.

CREATE TABLE IF NOT EXISTS public.order_kitchen_served_quantities (
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  served_quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (served_quantity >= 0),
  served_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, order_item_id)
);

ALTER TABLE public.order_kitchen_served_quantities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_kitchen_served_quantities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_kitchen_served_quantities TO service_role;

CREATE OR REPLACE FUNCTION public._record_kitchen_served_baseline(p_order_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.order_kitchen_served_quantities(
    order_id,
    order_item_id,
    served_quantity,
    served_at
  )
  SELECT
    oi.order_id,
    oi.id,
    COALESCE(oks.sent_quantity, 0),
    now()
  FROM public.order_items oi
  LEFT JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
  WHERE oi.order_id = p_order_id
    AND COALESCE(oks.sent_quantity, 0) > 0
  ON CONFLICT (order_id, order_item_id) DO UPDATE
  SET served_quantity = EXCLUDED.served_quantity,
      served_at = EXCLUDED.served_at;
$function$;

REVOKE ALL ON FUNCTION public._record_kitchen_served_baseline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_kitchen_served_baseline(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_kitchen_status(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

  IF p_status = 'served' THEN
    PERFORM public._record_kitchen_served_baseline(p_order_id);
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

CREATE OR REPLACE FUNCTION public.send_to_kitchen(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_is_service_role boolean := COALESCE(current_setting('role',true),'')='service_role';
  v_was_served boolean := false;
  v_result jsonb;
BEGIN
  IF v_is_service_role THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
    END IF;
  ELSE
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('pos.send_kitchen') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED',
        'permission','pos.send_kitchen'
      );
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id=p_order_id;

    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_order.branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
    IF v_order.status NOT IN ('open','held') THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
    END IF;

    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);
    END IF;
  END IF;

  v_was_served := v_order.kitchen_status = 'served';

  IF v_was_served THEN
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kns_served_before (
      order_item_id uuid PRIMARY KEY,
      sent_quantity numeric(14,4) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kns_served_before;

    INSERT INTO pg_temp.kns_served_before(order_item_id, sent_quantity)
    SELECT oi.id, COALESCE(oks.sent_quantity, 0)
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND COALESCE(oks.sent_quantity, 0) > 0;
  END IF;

  v_result := public._send_to_kitchen_core_20260914(p_order_id,p_sent_by);

  IF v_was_served
     AND COALESCE((v_result->>'success')::boolean, false)
     AND COALESCE((v_result->>'items_sent_count')::integer, 0) > 0 THEN
    INSERT INTO public.order_kitchen_served_quantities(
      order_id,
      order_item_id,
      served_quantity,
      served_at
    )
    SELECT p_order_id, b.order_item_id, b.sent_quantity, now()
    FROM pg_temp.kns_served_before b
    ON CONFLICT (order_id, order_item_id) DO UPDATE
    SET served_quantity = EXCLUDED.served_quantity,
        served_at = EXCLUDED.served_at;

    UPDATE public.orders
    SET kitchen_status = 'sent',
        kitchen_sent_at = now(),
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated, service_role;

DO $patch_kds_served_delta$
DECLARE
  v_oid regprocedure := to_regprocedure('public.get_kitchen_queue(text,uuid)');
  v_def text;
  v_next text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'get_kitchen_queue(text,uuid) is missing';
  END IF;

  SELECT pg_get_functiondef(v_oid::oid) INTO v_def;
  v_next := v_def;

  v_next := replace(
    v_next,
    '      oks.sent_quantity AS quantity,',
    '      (oks.sent_quantity - COALESCE(ksb.served_quantity, 0)) AS quantity,'
  );

  v_next := replace(
    v_next,
    '    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id' || E'\n' ||
    '    JOIN public.products p ON p.id = oi.product_id',
    '    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id' || E'\n' ||
    '    LEFT JOIN public.order_kitchen_served_quantities ksb' || E'\n' ||
    '      ON ksb.order_id = o.id' || E'\n' ||
    '     AND ksb.order_item_id = oi.id' || E'\n' ||
    '    JOIN public.products p ON p.id = oi.product_id'
  );

  v_next := replace(
    v_next,
    '      AND COALESCE(oks.sent_quantity, 0) > 0',
    '      AND COALESCE(oks.sent_quantity, 0) > COALESCE(ksb.served_quantity, 0)'
  );

  IF v_next = v_def THEN
    RAISE EXCEPTION 'get_kitchen_queue served-delta patch markers were not found';
  END IF;
  IF position('order_kitchen_served_quantities ksb' IN v_next) = 0
     OR position('ksb.served_quantity' IN v_next) = 0 THEN
    RAISE EXCEPTION 'get_kitchen_queue served-delta patch is incomplete';
  END IF;

  EXECUTE v_next;
END;
$patch_kds_served_delta$;

REVOKE ALL ON FUNCTION public.get_kitchen_queue(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kitchen_queue(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
