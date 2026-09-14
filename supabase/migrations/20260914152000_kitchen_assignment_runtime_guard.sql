-- Runtime-only hardening for station assignments. No schema or print-agent changes.

CREATE OR REPLACE FUNCTION public.save_kitchen_station_assignments(
  p_branch_id uuid,
  p_station_id uuid,
  p_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_category_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.can_permission('settings.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.kitchen_stations s
    WHERE s.id = p_station_id
      AND s.is_active = true
      AND lower(btrim(s.code)) <> 'cashier'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_NOT_AVAILABLE');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) x(id)
    LEFT JOIN public.users u ON u.id = x.id AND u.is_active = true
    WHERE u.id IS NULL
       OR NOT (
         u.branch_id = p_branch_id
         OR EXISTS (
           SELECT 1 FROM public.user_branch_access uba
           WHERE uba.user_id = x.id AND uba.branch_id = p_branch_id
         )
       )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_category_ids, '{}'::uuid[])) x(id)
    LEFT JOIN public.categories c ON c.id = x.id
    WHERE c.id IS NULL OR c.branch_id <> p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_BRANCH_MISMATCH');
  END IF;

  DELETE FROM public.user_kitchen_station_assignments
  WHERE branch_id = p_branch_id AND station_id = p_station_id;

  INSERT INTO public.user_kitchen_station_assignments(user_id, branch_id, station_id, created_by)
  SELECT DISTINCT x.id, p_branch_id, p_station_id, auth.uid()
  FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) x(id)
  ON CONFLICT DO NOTHING;

  UPDATE public.categories
  SET kitchen_station_id = NULL
  WHERE branch_id = p_branch_id
    AND kitchen_station_id = p_station_id
    AND NOT (id = ANY(COALESCE(p_category_ids, '{}'::uuid[])));

  UPDATE public.categories
  SET kitchen_station_id = p_station_id
  WHERE branch_id = p_branch_id
    AND id = ANY(COALESCE(p_category_ids, '{}'::uuid[]));

  RETURN jsonb_build_object('success', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_kitchen_station_editor_context(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch jsonb;
  v_users jsonb;
  v_categories jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR p_branch_id IS NULL
     OR NOT public.can_permission('settings.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT jsonb_build_object('id', b.id, 'name', b.name)
  INTO v_branch
  FROM public.branches b
  WHERE b.id = p_branch_id;

  IF v_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'full_name', u.full_name,
    'email', u.email,
    'role', u.role
  ) ORDER BY COALESCE(NULLIF(u.full_name, ''), u.email), u.id), '[]'::jsonb)
  INTO v_users
  FROM public.users u
  WHERE u.is_active = true
    AND (
      u.branch_id = p_branch_id
      OR EXISTS (
        SELECT 1 FROM public.user_branch_access uba
        WHERE uba.user_id = u.id AND uba.branch_id = p_branch_id
      )
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'name_en', c.name_en,
    'kitchen_station_id', c.kitchen_station_id
  ) ORDER BY c.name, c.id), '[]'::jsonb)
  INTO v_categories
  FROM public.categories c
  WHERE c.branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch', v_branch,
    'users', v_users,
    'categories', v_categories
  );
END
$function$;
