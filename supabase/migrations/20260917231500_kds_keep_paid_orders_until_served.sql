-- Keep kitchen work visible independently from payment settlement.
-- A paid order may become orders.status='completed' before the kitchen marks it served.
-- KDS must therefore be driven by kitchen_status + sent quantities, not by payment status.
-- Also resolve the fallback `main` station inside the requested branch only.

CREATE OR REPLACE FUNCTION public.get_kitchen_queue(
  p_station text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT get_branch_id()
)
RETURNS TABLE(
  order_id uuid,
  order_number text,
  table_number integer,
  station text,
  kitchen_status text,
  guest_count integer,
  notes text,
  created_at timestamptz,
  items jsonb,
  elapsed_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_has_assignments boolean;
  v_main_station_id uuid;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF p_branch_id IS NULL
     OR (NOT v_is_service_role AND NOT public.user_may_access_branch(p_branch_id))
     OR (NOT v_is_service_role AND NOT public.can_permission('pos.kds_view')) THEN
    RETURN;
  END IF;

  SELECT role
    INTO v_role
  FROM public.users
  WHERE id = auth.uid()
    AND is_active = true;

  -- `main` is branch-owned. Never pick another branch's same-code station.
  SELECT ks.id
    INTO v_main_station_id
  FROM public.kitchen_stations ks
  WHERE ks.branch_id = p_branch_id
    AND lower(btrim(ks.code)) = 'main'
    AND ks.is_active = true
  ORDER BY ks.sort_order, ks.id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_kitchen_station_assignments a
    WHERE a.user_id = auth.uid()
      AND a.branch_id = p_branch_id
  ) INTO v_has_assignments;

  RETURN QUERY
  WITH sent_items AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, MIN(oks.sent_at) OVER (PARTITION BY o.id), o.created_at) AS queue_at,
      oi.id AS item_id,
      oks.sent_quantity AS quantity,
      oi.notes AS item_notes,
      oi.modifiers_snapshot,
      p.name AS product_name,
      COALESCE(ks.id, v_main_station_id) AS station_id,
      COALESCE(ks.code, 'main') AS station_code
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.categories c
      ON c.id = p.category_id
     AND c.branch_id = o.branch_id
    LEFT JOIN public.kitchen_stations ks
      ON ks.id = c.kitchen_station_id
     AND ks.branch_id = o.branch_id
     AND ks.is_active = true
    WHERE o.branch_id = p_branch_id
      -- Payment completion must not remove unfinished kitchen work from KDS.
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND COALESCE(oks.sent_quantity, 0) > 0
  ),
  legacy_empty_orders AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, o.created_at) AS queue_at,
      NULL::uuid AS item_id,
      NULL::numeric AS quantity,
      NULL::text AS item_notes,
      NULL::jsonb AS modifiers_snapshot,
      NULL::text AS product_name,
      COALESCE(
        legacy_station.id,
        CASE WHEN NULLIF(o.station, '') IS NULL THEN v_main_station_id ELSE NULL END
      ) AS station_id,
      COALESCE(NULLIF(o.station, ''), legacy_station.code, 'main') AS station_code
    FROM public.orders o
    LEFT JOIN public.kitchen_stations legacy_station
      ON legacy_station.branch_id = o.branch_id
     AND lower(btrim(legacy_station.code)) = lower(btrim(COALESCE(NULLIF(o.station, ''), 'main')))
     AND legacy_station.is_active = true
    WHERE o.branch_id = p_branch_id
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_kitchen_sends oks WHERE oks.order_id = o.id
      )
  ),
  queue_items AS (
    SELECT * FROM sent_items
    UNION ALL
    SELECT * FROM legacy_empty_orders
  ),
  allowed_items AS (
    SELECT qi.*
    FROM queue_items qi
    WHERE (p_station IS NULL OR qi.station_code = p_station)
      AND (
        v_is_service_role
        OR public.can_permission('settings.manage')
        OR NOT v_has_assignments
        OR EXISTS (
          SELECT 1
          FROM public.user_kitchen_station_assignments a
          WHERE a.user_id = auth.uid()
            AND a.branch_id = p_branch_id
            AND a.station_id = qi.station_id
        )
      )
  )
  SELECT
    ai.oid,
    ai.onumber,
    NULL::integer,
    ai.station_code,
    ai.kstatus,
    ai.guests,
    ai.onotes,
    MIN(ai.queue_at),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', ai.item_id,
          'product_name', ai.product_name,
          'quantity', ai.quantity,
          'notes', ai.item_notes,
          'modifiers', COALESCE(ai.modifiers_snapshot, '[]'::jsonb)
        )
        ORDER BY ai.item_id
      ) FILTER (WHERE ai.item_id IS NOT NULL),
      '[]'::jsonb
    ),
    GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ai.queue_at)))::integer, 0)
  FROM allowed_items ai
  GROUP BY ai.oid, ai.onumber, ai.station_code, ai.kstatus, ai.guests, ai.onotes
  ORDER BY MIN(ai.queue_at), ai.onumber, ai.station_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_kitchen_queue(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kitchen_queue(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
