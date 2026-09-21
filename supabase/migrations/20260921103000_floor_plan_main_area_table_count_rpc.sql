-- Expose Main Area active-table count through the canonical floor-plan permission boundary.
-- The underlying branch setting and synchronization trigger were introduced in
-- 20260921090000_branch_main_area_table_limit.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.floor_plan_set_main_area_table_count(
  p_branch_id uuid,
  p_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_current integer;
  v_detail text;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF p_count IS NULL OR p_count < 1 OR p_count > 50 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MAIN_AREA_TABLE_COUNT',
      'detail', 'Main Area table count must be between 1 and 50.'
    );
  END IF;

  SELECT COALESCE(bs.main_area_table_count, 50)
    INTO v_current
  FROM public.branch_settings bs
  WHERE bs.branch_id = p_branch_id;

  INSERT INTO public.branch_settings(branch_id, main_area_table_count)
  VALUES (p_branch_id, p_count)
  ON CONFLICT (branch_id)
  DO UPDATE
  SET main_area_table_count = EXCLUDED.main_area_table_count,
      updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'previous_count', COALESCE(v_current, 50),
    'main_area_table_count', p_count
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    IF SQLERRM = 'MAIN_AREA_TABLE_LIMIT_BUSY' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MAIN_AREA_TABLE_LIMIT_BUSY',
        'detail', COALESCE(NULLIF(v_detail, ''), 'A table above the requested limit is occupied or has a non-final order.')
      );
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.floor_plan_set_main_area_table_count(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_set_main_area_table_count(uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.floor_plan_set_main_area_table_count(uuid, integer) IS
  'Permission-first branch-scoped setter for the active canonical Main Area table count (1..50).';

COMMIT;
