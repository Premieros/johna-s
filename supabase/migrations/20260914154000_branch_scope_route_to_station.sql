-- Keep the legacy route_to_station RPC compatible while enforcing the same
-- branch-owned station contract as category routing and cloud print jobs.
CREATE OR REPLACE FUNCTION public.route_to_station(
  p_order_id uuid,
  p_station text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_station_code text;
BEGIN
  SELECT o.branch_id
  INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF auth.uid() IS NULL
     OR NOT public.user_may_access_branch(v_branch_id)
     OR NOT public.can_permission('pos.send_kitchen') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  v_station_code := lower(btrim(COALESCE(p_station, '')));
  IF v_station_code = '' OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'INVALID_KITCHEN_STATION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.kitchen_stations s
    WHERE s.branch_id = v_branch_id
      AND lower(btrim(s.code)) = v_station_code
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'INVALID_KITCHEN_STATION_FOR_BRANCH';
  END IF;

  UPDATE public.orders
  SET station = v_station_code,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'route_station',
    'order',
    p_order_id,
    jsonb_build_object('station', v_station_code, 'branch_id', v_branch_id)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.route_to_station(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.route_to_station(uuid,text) TO authenticated, service_role;
