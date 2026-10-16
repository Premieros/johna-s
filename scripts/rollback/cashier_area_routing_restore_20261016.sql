-- Review and apply only under a separately approved rollback. No historical jobs changed.
-- First disable second-cashier routing; keep V8.2 serving queued cashier_2 jobs until drained.
BEGIN;
UPDATE public.cashier_print_stations SET enabled=false;
CREATE OR REPLACE FUNCTION public.enqueue_cloud_receipt_print(p_sale_id uuid, p_approval_request_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_auth jsonb;
  v_job public.cloud_print_jobs%ROWTYPE;
  v_existing public.cloud_print_jobs%ROWTYPE;
  v_key text;
  v_effective_approval_id uuid := p_approval_request_id;
  v_direct_reprint boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD');
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT public.authorize_sale_print(p_sale_id, p_approval_request_id) INTO v_auth;
  IF COALESCE((v_auth->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_auth; END IF;

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

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'job_id', v_existing.id, 'status', v_existing.status,
      'print_number', v_existing.expected_print_number, 'deduplicated', true
    );
  END IF;

  IF COALESCE((v_auth->>'is_reprint')::boolean, false)
     AND v_effective_approval_id IS NULL
     AND public.can_permission('pos.reprint')
  THEN
    INSERT INTO public.approval_requests(
      branch_id, requester_id, action_type, entity_type, entity_id,
      payload, reason, status, approver_id, decision_note, decided_at, expires_at
    ) VALUES (
      v_sale.branch_id, auth.uid(), 'reprint', 'sale', p_sale_id,
      jsonb_build_object(
        'source', 'direct_reprint_permission',
        'permission', 'pos.reprint',
        'automatic', true
      ),
      'DIRECT_REPRINT_PERMISSION',
      'approved',
      auth.uid(),
      'pos.reprint direct authorization',
      now(),
      now() + interval '10 minutes'
    )
    RETURNING id INTO v_effective_approval_id;
    v_direct_reprint := true;
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
      v_effective_approval_id, (v_auth->>'print_number')::integer, v_key
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
    'deduplicated', v_job.id IS DISTINCT FROM NULL AND v_job.id = v_existing.id,
    'direct_reprint', v_direct_reprint
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.enqueue_cloud_open_order_print(p_order_id uuid, p_payload jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
  v_job public.cloud_print_jobs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.receipt.print') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.receipt.print');
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id=p_order_id;
  IF v_order.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
  IF v_order.status NOT IN ('open','held') THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE'); END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  IF NOT public.can_permission('pos.reprint') AND EXISTS (
    SELECT 1
    FROM public.cloud_print_jobs cp
    WHERE cp.branch_id=v_order.branch_id
      AND cp.kind='receipt'
      AND cp.idempotency_key LIKE 'open-check:' || p_order_id::text || ':%'
  ) THEN
    RETURN jsonb_build_object(
      'success',false,'error','OPEN_CHECK_ALREADY_PRINTED','permission','pos.reprint'
    );
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    v_order.branch_id,v_uid,'receipt','cashier',
    p_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,
    'job_id',v_job.id,
    'status',v_job.status,
    'station_code','cashier'
  );
END;
$function$

COMMIT;

