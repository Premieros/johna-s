-- Cloud print queue for the Windows Premier Print Agent.
-- Business mutations remain authoritative in their existing RPCs. This queue
-- carries print payloads only; retries must never repeat kitchen/inventory/sale work.

CREATE TABLE IF NOT EXISTS public.cloud_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  kind text NOT NULL CHECK (kind IN ('kitchen', 'receipt', 'test')),
  station_code text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sale_id uuid NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  approval_request_id uuid NULL REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  expected_print_number integer NULL CHECK (expected_print_number IS NULL OR expected_print_number > 0),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'printing', 'printed', 'failed')),
  claimed_agent_id uuid NULL,
  claimed_by_user uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NULL,
  lease_expires_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL,
  printed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cloud_print_jobs_claim
  ON public.cloud_print_jobs(branch_id, status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloud_print_active_receipt_sale
  ON public.cloud_print_jobs(sale_id)
  WHERE kind = 'receipt' AND sale_id IS NOT NULL AND status IN ('pending', 'claimed', 'printing');

ALTER TABLE public.cloud_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_print_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cloud_print_jobs_select ON public.cloud_print_jobs;
CREATE POLICY cloud_print_jobs_select ON public.cloud_print_jobs
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (requested_by = auth.uid() OR public.can_permission('settings.manage'))
);

REVOKE ALL ON TABLE public.cloud_print_jobs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.cloud_print_jobs TO authenticated;
GRANT ALL ON TABLE public.cloud_print_jobs TO service_role;

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
  IF COALESCE(btrim(p_station_code), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_REQUIRED');
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
    p_branch_id, auth.uid(), 'kitchen', btrim(p_station_code), p_payload, btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id, idempotency_key) DO UPDATE
  SET updated_at = public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
END
$function$;

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

  v_key := COALESCE(NULLIF(btrim(p_idempotency_key), ''),
    'receipt:' || p_sale_id::text || ':' || COALESCE(v_auth->>'print_number', '1'));

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
      AND kind = 'receipt'
      AND status IN ('pending', 'claimed', 'printing')
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_existing.id IS NULL THEN RAISE; END IF;
    v_job := v_existing;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', v_job.id,
    'status', v_job.status,
    'print_number', v_job.expected_print_number
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_cloud_print_jobs(
  p_branch_id uuid,
  p_agent_id uuid,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_jobs jsonb := '[]'::jsonb;
  v_limit integer := LEAST(25, GREATEST(1, COALESCE(p_limit, 12)));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_ID_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      next_attempt_at = CASE WHEN attempts >= 5 THEN next_attempt_at ELSE now() END,
      last_error = COALESCE(last_error, 'CLAIM_LEASE_EXPIRED'),
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND status IN ('claimed', 'printing')
    AND lease_expires_at < now();

  WITH picked AS (
    SELECT id
    FROM public.cloud_print_jobs
    WHERE branch_id = p_branch_id
      AND status IN ('pending', 'failed')
      AND attempts < 5
      AND next_attempt_at <= now()
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.cloud_print_jobs j
    SET status = 'claimed',
        claimed_agent_id = p_agent_id,
        claimed_by_user = auth.uid(),
        claimed_at = now(),
        lease_expires_at = now() + interval '45 seconds',
        attempts = j.attempts + 1,
        last_error = NULL,
        updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.id, j.branch_id, j.kind, j.station_code, j.payload,
              j.sale_id, j.expected_print_number, j.attempts, j.created_at
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(claimed) ORDER BY created_at, id), '[]'::jsonb)
    INTO v_jobs
  FROM claimed;

  RETURN jsonb_build_object('success', true, 'jobs', v_jobs);
END
$function$;

CREATE OR REPLACE FUNCTION public.start_cloud_print_job(
  p_job_id uuid,
  p_agent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_print_count integer;
  v_req public.approval_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF v_job.status <> 'claimed' OR v_job.claimed_agent_id IS DISTINCT FROM p_agent_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAIM_MISMATCH');
  END IF;

  IF v_job.kind = 'receipt' THEN
    SELECT count(*)::integer INTO v_print_count FROM public.sale_print_events WHERE sale_id = v_job.sale_id;
    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs
      SET status = 'failed', last_error = 'PRINT_SEQUENCE_CHANGED', updated_at = now()
      WHERE id = v_job.id;
      RETURN jsonb_build_object('success', false, 'error', 'PRINT_SEQUENCE_CHANGED');
    END IF;

    IF v_print_count > 0 THEN
      SELECT * INTO v_req FROM public.approval_requests WHERE id = v_job.approval_request_id;
      IF v_req.id IS NULL
        OR v_req.requester_id <> v_job.requested_by
        OR v_req.branch_id <> v_job.branch_id
        OR v_req.action_type <> 'reprint'
        OR v_req.entity_type <> 'sale'
        OR v_req.entity_id IS DISTINCT FROM v_job.sale_id
        OR v_req.status <> 'approved'
        OR v_req.expires_at <= now()
      THEN
        UPDATE public.cloud_print_jobs
        SET status = 'failed', last_error = 'INVALID_APPROVAL', updated_at = now()
        WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;
    END IF;
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'printing', lease_expires_at = now() + interval '45 seconds', updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object('success', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_cloud_print_job(
  p_job_id uuid,
  p_agent_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_requester public.users%ROWTYPE;
  v_req public.approval_requests%ROWTYPE;
  v_print_count integer;
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF v_job.claimed_agent_id IS DISTINCT FROM p_agent_id OR v_job.status NOT IN ('claimed', 'printing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAIM_MISMATCH');
  END IF;

  IF NOT COALESCE(p_success, false) THEN
    UPDATE public.cloud_print_jobs
    SET status = 'failed',
        last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'PRINT_FAILED'), 1000),
        next_attempt_at = now() + make_interval(secs => LEAST(30, GREATEST(2, attempts * 2))),
        claimed_agent_id = NULL,
        claimed_by_user = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('success', true, 'status', 'failed', 'retryable', v_job.attempts < 5);
  END IF;

  IF v_job.kind = 'receipt' THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_job.sale_id FOR UPDATE;
    IF v_sale.id IS NULL OR v_sale.branch_id <> v_job.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;
    SELECT count(*)::integer INTO v_print_count FROM public.sale_print_events WHERE sale_id = v_job.sale_id;
    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs SET status = 'failed', last_error = 'PRINT_SEQUENCE_CHANGED', updated_at = now() WHERE id = v_job.id;
      RETURN jsonb_build_object('success', false, 'error', 'PRINT_SEQUENCE_CHANGED');
    END IF;

    IF v_print_count > 0 THEN
      SELECT * INTO v_req FROM public.approval_requests WHERE id = v_job.approval_request_id FOR UPDATE;
      IF v_req.id IS NULL
        OR v_req.requester_id <> v_job.requested_by
        OR v_req.branch_id <> v_job.branch_id
        OR v_req.action_type <> 'reprint'
        OR v_req.entity_type <> 'sale'
        OR v_req.entity_id IS DISTINCT FROM v_job.sale_id
        OR v_req.status <> 'approved'
        OR v_req.expires_at <= now()
      THEN
        UPDATE public.cloud_print_jobs SET status = 'failed', last_error = 'INVALID_APPROVAL', updated_at = now() WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;
      UPDATE public.approval_requests SET status = 'consumed', consumed_at = now() WHERE id = v_req.id;
    END IF;

    INSERT INTO public.sale_print_events(sale_id, branch_id, user_id, print_number, approval_request_id)
    VALUES (v_job.sale_id, v_job.branch_id, v_job.requested_by, v_print_count + 1,
      CASE WHEN v_print_count > 0 THEN v_job.approval_request_id ELSE NULL END)
    RETURNING id INTO v_event_id;

    SELECT * INTO v_requester FROM public.users WHERE id = v_job.requested_by;
    INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
    VALUES (
      v_job.requested_by,
      v_requester.email,
      CASE WHEN v_print_count = 0 THEN 'SALE_PRINTED' ELSE 'SALE_REPRINTED' END,
      'sale',
      v_job.sale_id,
      jsonb_build_object(
        'print_number', v_print_count + 1,
        'approval_request_id', v_job.approval_request_id,
        'execution_confirmed_by_cloud_agent', true,
        'cloud_print_job_id', v_job.id
      ),
      v_job.branch_id
    );
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'printed',
      printed_at = now(),
      last_error = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object('success', true, 'status', 'printed', 'event_id', v_event_id);
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_kitchen_print(uuid, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_cloud_print_job(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.enqueue_cloud_kitchen_print(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_cloud_print_job(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) TO authenticated;

COMMENT ON TABLE public.cloud_print_jobs IS
'Print-only cloud queue consumed by the Windows Print Agent. It must never be used to replay order, sale, payment, or inventory business mutations.';

NOTIFY pgrst, 'reload schema';
