-- Compatibility closure for branch-scoped kitchen stations.
-- Keeps final state branch-owned and Permission-First without restoring the old
-- send-time station fallback or changing the installed print-agent contract.

-- Existing categories that relied on the historical implicit `main` route get an
-- explicit persisted branch-owned station. send_to_kitchen remains strict: it only
-- consumes the category -> station relation and never falls back at send time.
UPDATE public.categories c
SET kitchen_station_id = s.id
FROM public.kitchen_stations s
WHERE c.kitchen_station_id IS NULL
  AND s.branch_id = c.branch_id
  AND lower(btrim(s.code)) = 'main'
  AND s.is_active = true;

CREATE OR REPLACE FUNCTION public._guard_category_kitchen_station_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_station_branch uuid;
  v_station_code text;
  v_station_active boolean;
BEGIN
  -- Preserve legacy category creation while making the route explicit in data.
  -- This is not a send-time fallback: NEW.kitchen_station_id is persisted.
  IF NEW.kitchen_station_id IS NULL THEN
    SELECT s.id
    INTO NEW.kitchen_station_id
    FROM public.kitchen_stations s
    WHERE s.branch_id = NEW.branch_id
      AND lower(btrim(s.code)) = 'main'
      AND s.is_active = true
    ORDER BY s.sort_order, s.id
    LIMIT 1;

    IF NEW.kitchen_station_id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT s.branch_id, lower(btrim(s.code)), s.is_active
  INTO v_station_branch, v_station_code, v_station_active
  FROM public.kitchen_stations s
  WHERE s.id = NEW.kitchen_station_id;

  -- Preserve the established FK error contract for an unknown UUID.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_station_branch IS NULL OR v_station_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
  END IF;
  IF NOT COALESCE(v_station_active, false) OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'KITCHEN_STATION_NOT_AVAILABLE';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public._guard_category_kitchen_station_branch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_category_kitchen_station_branch() TO service_role, postgres;

-- Legacy fixtures/clients may still submit a template station id. Normalize that
-- id to the same-code station owned by the requested branch before enforcing the
-- final same-branch invariant. A real station from another branch is still rejected.
CREATE OR REPLACE FUNCTION public._guard_kitchen_station_assignment_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_station_branch uuid;
  v_station_code text;
  v_station_active boolean;
  v_branch_station_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = NEW.user_id
      AND u.is_active = true
      AND (
        u.branch_id = NEW.branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = NEW.user_id
            AND uba.branch_id = NEW.branch_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'KITCHEN_USER_BRANCH_MISMATCH';
  END IF;

  SELECT s.branch_id, lower(btrim(s.code)), s.is_active
  INTO v_station_branch, v_station_code, v_station_active
  FROM public.kitchen_stations s
  WHERE s.id = NEW.station_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_station_branch IS NULL AND v_station_code <> 'cashier' THEN
    SELECT s.id
    INTO v_branch_station_id
    FROM public.kitchen_stations s
    WHERE s.branch_id = NEW.branch_id
      AND lower(btrim(s.code)) = v_station_code
      AND s.is_active = true
    ORDER BY s.sort_order, s.id
    LIMIT 1;

    IF v_branch_station_id IS NULL THEN
      RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
    END IF;

    NEW.station_id := v_branch_station_id;
    v_station_branch := NEW.branch_id;
    v_station_active := true;
  END IF;

  IF v_station_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
  END IF;
  IF NOT COALESCE(v_station_active, false) OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'KITCHEN_STATION_NOT_AVAILABLE';
  END IF;

  RETURN NEW;
END
$function$;

-- Keep Permission-First authorization in RLS, but leave station-code validation to
-- the table CHECK/branch guards. This avoids encoding an operational label in an
-- authorization policy while `cashier` remains structurally forbidden.
DROP POLICY IF EXISTS ks_branch_insert ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_branch_update ON public.kitchen_stations;

CREATE POLICY ks_branch_insert ON public.kitchen_stations
FOR INSERT TO authenticated
WITH CHECK (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
);

CREATE POLICY ks_branch_update ON public.kitchen_stations
FOR UPDATE TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
)
WITH CHECK (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
);

-- Preserve the legacy service-role maintenance path while ordinary callers remain
-- Permission-First and branch-gated. Station existence is still branch-specific.
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
  v_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  SELECT o.branch_id
  INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF NOT v_service_role AND (
       auth.uid() IS NULL
       OR NOT public.user_may_access_branch(v_branch_id)
       OR NOT public.can_permission('pos.kds_update')
     ) THEN
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
