-- A retryable failed receipt job is still the authoritative print attempt.
-- Do not allow a second receipt job for the same sale while that failed job can
-- be claimed again, otherwise a user retry and the automatic retry may both
-- reach the printer. Terminal/ambiguous failures (attempts >= 5) remain eligible
-- for an explicit new print attempt under the normal print/reprint permissions.

DROP INDEX IF EXISTS public.uq_cloud_print_active_receipt_sale;

CREATE UNIQUE INDEX uq_cloud_print_active_receipt_sale
  ON public.cloud_print_jobs(sale_id)
  WHERE kind = 'receipt'
    AND sale_id IS NOT NULL
    AND (
      status IN ('pending', 'claimed', 'printing')
      OR (status = 'failed' AND attempts < 5)
    );

CREATE OR REPLACE FUNCTION public.enqueue_cloud_receipt_print(
  p_sale_id uuid,
  p_approval_request_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_auth jsonb;
  v_job public.cloud_print_jobs%ROWTYPE;
  v_existing public.cloud_print_jobs%ROWTYPE;
  v_key text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD');
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT public.authorize_sale_print(p_sale_id, p_approval_request_id) INTO v_auth;
  IF COALESCE((v_auth->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_auth;
  END IF;

  v_key := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    'receipt:' || p_sale_id::text || ':' || COALESCE(v_auth->>'print_number', '1')
  );

  BEGIN
    INSERT INTO public.cloud_print_jobs(
      branch_id, requested_by, kind, station_code, payload, sale_id,
      approval_request_id, expected_print_number, idempotency_key
    ) VALUES (
      v_sale.branch_id, auth.uid(), 'receipt', 'cashier', p_payload, p_sale_id,
      p_approval_request_id, (v_auth->>'print_number')::integer, v_key
    )
    ON CONFLICT (branch_id, idempotency_key) DO UPDATE
    SET updated_at = public.cloud_print_jobs.updated_at
    RETURNING * INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.cloud_print_jobs
    WHERE sale_id = p_sale_id
      AND branch_id = v_sale.branch_id
      AND kind = 'receipt'
      AND (
        status IN ('pending', 'claimed', 'printing')
        OR (status = 'failed' AND attempts < 5)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_existing.id IS NULL THEN RAISE; END IF;
    v_job := v_existing;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', v_job.id,
    'status', v_job.status,
    'print_number', v_job.expected_print_number,
    'deduplicated', v_job.id IS DISTINCT FROM NULL AND v_job.id = v_existing.id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
