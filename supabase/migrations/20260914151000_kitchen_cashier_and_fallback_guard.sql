-- Runtime guard only. Keeps the installed print-agent contract unchanged.
-- Receipt jobs still use station_code='cashier'; kitchen jobs may never use it.

CREATE OR REPLACE FUNCTION public.enqueue_cloud_kitchen_print(
  p_branch_id uuid,
  p_station_code text,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_station_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('pos.send_kitchen') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.send_kitchen');
  END IF;

  v_station_code := lower(btrim(COALESCE(p_station_code, '')));
  IF v_station_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_REQUIRED');
  END IF;
  IF v_station_code = 'cashier' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CASHIER_RESERVED_FOR_RECEIPTS');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kitchen_stations s
    WHERE s.code = v_station_code AND s.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_NOT_FOUND');
  END IF;
  IF COALESCE(btrim(p_idempotency_key), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id, requested_by, kind, station_code, payload, idempotency_key
  ) VALUES (
    p_branch_id, auth.uid(), 'kitchen', v_station_code, p_payload, btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id, idempotency_key) DO UPDATE
  SET updated_at = public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text) TO authenticated, service_role;

DO $patch_send_to_kitchen$
DECLARE
  v_oid oid;
  v_def text;
  v_guard text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'send_to_kitchen(uuid,uuid)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'send_to_kitchen(uuid,uuid) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position(E'    FOR v_row IN\n' in v_def) = 0 THEN
    RAISE EXCEPTION 'SEND_TO_KITCHEN_PATCH_MARKER_MISSING';
  END IF;

  v_guard := E'    IF EXISTS (\n      SELECT 1\n      FROM pg_temp.kns_delta d\n      JOIN public.order_items oi ON oi.id = d.order_item_id\n      JOIN public.products p ON p.id = oi.product_id\n      LEFT JOIN public.categories c ON c.id = p.category_id AND c.branch_id = v_branch_id\n      LEFT JOIN public.kitchen_stations ks ON ks.id = c.kitchen_station_id AND ks.is_active = true\n      WHERE c.id IS NULL OR ks.id IS NULL OR lower(btrim(ks.code)) = ''cashier''\n    ) THEN\n      RETURN jsonb_build_object(''success'', false, ''error'', ''KITCHEN_STATION_NOT_CONFIGURED'');\n    END IF;\n\n';

  v_def := replace(v_def, E'    FOR v_row IN\n', v_guard || E'    FOR v_row IN\n');
  v_def := replace(v_def, '''station_code'', COALESCE(ks.code, ''main'')', '''station_code'', ks.code');

  IF position('COALESCE(ks.code, ''main'')' in v_def) > 0 THEN
    RAISE EXCEPTION 'SEND_TO_KITCHEN_FALLBACK_STILL_PRESENT';
  END IF;

  EXECUTE v_def;
END
$patch_send_to_kitchen$;
