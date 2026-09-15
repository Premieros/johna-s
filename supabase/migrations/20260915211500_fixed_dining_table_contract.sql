-- Fixed dining-table contract
-- - Reuse the canonical private 50-table provisioner already owned by the system.
-- - Normalize legacy numeric table names (1..50) to the canonical Arabic names in place.
-- - Preserve existing table ids, status and layout; only missing canonical tables are backfilled.
-- - New branches continue to use the existing canonical provisioning trigger.
-- - Authenticated clients may read branch tables, but direct INSERT/UPDATE is blocked.
-- - Floor-plan mutations use permission-first SECURITY DEFINER RPCs.
-- - POS structural actions keep changing order/table status through their existing canonical RPCs.

-- Older production branches may contain the pre-canonical numeric names (for example "1").
-- Rename those rows in place before invoking the canonical provisioner so they are not
-- duplicated as "طاولة 01".  A collision is treated as a migration error rather than
-- deleting or merging a live table implicitly.
DO $block$
DECLARE
  v_row record;
  v_canonical_name text;
  v_branch_id uuid;
BEGIN
  FOR v_row IN
    SELECT id, branch_id, name
    FROM public.dining_tables
    WHERE name ~ '^[0-9]+$'
      AND name::integer BETWEEN 1 AND 50
  LOOP
    v_canonical_name := 'طاولة ' || lpad(v_row.name::integer::text, 2, '0');

    IF EXISTS (
      SELECT 1
      FROM public.dining_tables dt
      WHERE dt.branch_id = v_row.branch_id
        AND dt.name = v_canonical_name
        AND dt.id <> v_row.id
    ) THEN
      RAISE EXCEPTION
        'DINING_TABLE_CANONICAL_NAME_COLLISION branch=% legacy_table=% canonical_name=%',
        v_row.branch_id, v_row.id, v_canonical_name;
    END IF;

    UPDATE public.dining_tables
    SET name = v_canonical_name,
        updated_at = now()
    WHERE id = v_row.id;
  END LOOP;

  -- Reuse the existing official provisioner. It creates the main dining area when
  -- needed and fills only missing canonical tables 01..50.
  FOR v_branch_id IN SELECT id FROM public.branches LOOP
    PERFORM private.ensure_default_dining_tables(v_branch_id);
  END LOOP;
END;
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dining_tables_branch_name_unique
  ON public.dining_tables(branch_id, name);

-- The floor-plan editor is the only authenticated path allowed to create tables.
CREATE OR REPLACE FUNCTION public.floor_plan_add_table(
  p_branch_id uuid,
  p_name text,
  p_capacity integer DEFAULT 4,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT 'rect',
  p_layout jsonb DEFAULT '{"x":0,"y":0,"w":120,"h":80}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_shape text := btrim(coalesce(p_shape, 'rect'));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF v_name = '' OR length(v_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
  END IF;

  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  INSERT INTO public.dining_tables (
    branch_id, area_id, name, capacity, status, shape, layout, is_active, is_demo
  ) VALUES (
    p_branch_id, p_area_id, v_name, p_capacity, 'vacant', nullif(v_shape, ''), p_layout, true, false
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'table_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.floor_plan_update_table(
  p_table_id uuid,
  p_name text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT NULL,
  p_layout jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.dining_tables
  WHERE id = p_table_id;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF v_name = '' OR length(v_name) > 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
    END IF;
  END IF;

  IF p_capacity IS NOT NULL AND (p_capacity < 1 OR p_capacity > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NOT NULL AND jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = v_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  UPDATE public.dining_tables
  SET name = COALESCE(v_name, name),
      capacity = COALESCE(p_capacity, capacity),
      area_id = CASE WHEN p_area_id IS NULL THEN area_id ELSE p_area_id END,
      shape = COALESCE(NULLIF(btrim(p_shape), ''), shape),
      layout = COALESCE(p_layout, layout),
      updated_at = now()
  WHERE id = p_table_id
    AND branch_id = v_branch_id;

  RETURN jsonb_build_object('success', true, 'table_id', p_table_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

-- Keep reads branch-scoped. Stop authenticated clients from bypassing the
-- canonical floor-plan functions with direct structural writes.
DROP POLICY IF EXISTS auth_insert_dining_tables ON public.dining_tables;
CREATE POLICY auth_insert_dining_tables
ON public.dining_tables
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS auth_update_dining_tables ON public.dining_tables;
CREATE POLICY auth_update_dining_tables
ON public.dining_tables
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

COMMENT ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) IS
  'Canonical floor-plan path for adding a dining table; permission-first and branch-scoped.';
COMMENT ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) IS
  'Canonical floor-plan path for changing dining-table metadata/layout; never changes operational status.';
