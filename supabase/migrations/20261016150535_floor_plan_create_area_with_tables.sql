-- Additive only: no live areas/tables are created by applying this migration.
-- Area INSERT remains under the caller's RLS. Each table uses the existing
-- permission-first table RPC; a failure rolls back the whole area creation.
CREATE OR REPLACE FUNCTION public.floor_plan_create_area_with_tables(
  p_branch_id uuid,
  p_name text,
  p_table_count integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_area_id uuid;
  v_result jsonb;
  v_i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_name = '' OR length(v_name) > 70 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AREA_NAME');
  END IF;
  IF p_table_count IS NULL OR p_table_count < 0 OR p_table_count > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AREA_TABLE_COUNT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;
  -- Serialize this bounded configuration operation without waiting on a busy
  -- configuration writer. This lock does not participate in order/print locks.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('floor-area-create:' || p_branch_id::text, 0)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_CREATE_BUSY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.dining_areas WHERE branch_id = p_branch_id AND lower(btrim(name)) = lower(v_name)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_NAME_EXISTS');
  END IF;

  INSERT INTO public.dining_areas(branch_id, name, is_default)
  VALUES (p_branch_id, v_name, false) RETURNING id INTO v_area_id;

  FOR v_i IN 1..p_table_count LOOP
    v_result := public.floor_plan_add_table(
      p_branch_id, v_name || ' / Table ' || lpad(v_i::text, greatest(2, length(v_i::text)), '0'), 4, v_area_id,
      'rect', jsonb_build_object('x', ((v_i-1)%5)*140, 'y', ((v_i-1)/5)*100, 'w', 120, 'h', 80)
    );
    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      -- Raising rather than returning is essential: no partially-created area.
      RAISE EXCEPTION USING MESSAGE = 'AREA_TABLE_CREATE_FAILED',
        DETAIL = coalesce(v_result->>'error', 'TABLE_CREATE_FAILED');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'area_id', v_area_id, 'table_count', p_table_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.floor_plan_create_area_with_tables(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_create_area_with_tables(uuid,text,integer) TO authenticated;
