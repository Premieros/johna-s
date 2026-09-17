-- Registered Windows print agents + heartbeat + queue visibility.
-- Runtime execution no longer depends on settings.manage after an administrator
-- registers this physical device to a branch once. Printer management remains
-- settings.manage-only. Business mutations stay outside the print queue.

CREATE TABLE IF NOT EXISTS public.cloud_print_agents (
  agent_id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  registered_by uuid NOT NULL REFERENCES public.users(id),
  enabled boolean NOT NULL DEFAULT true,
  label text NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_print_agents_branch
  ON public.cloud_print_agents(branch_id, enabled, last_seen_at DESC);

ALTER TABLE public.cloud_print_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_print_agents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cloud_print_agents_select ON public.cloud_print_agents;
CREATE POLICY cloud_print_agents_select ON public.cloud_print_agents
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND public.can_permission('settings.manage')
);

REVOKE ALL ON TABLE public.cloud_print_agents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cloud_print_agents TO service_role;

CREATE OR REPLACE FUNCTION public.register_cloud_print_agent(
  p_branch_id uuid,
  p_agent_id uuid,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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

  INSERT INTO public.cloud_print_agents(
    agent_id, branch_id, registered_by, enabled, label, registered_at, last_seen_at, updated_at
  ) VALUES (
    p_agent_id,
    p_branch_id,
    auth.uid(),
    true,
    NULLIF(left(btrim(COALESCE(p_label, '')), 120), ''),
    now(),
    now(),
    now()
  )
  ON CONFLICT (agent_id) DO UPDATE
  SET branch_id = EXCLUDED.branch_id,
      registered_by = auth.uid(),
      enabled = true,
      label = COALESCE(EXCLUDED.label, public.cloud_print_agents.label),
      last_seen_at = now(),
      updated_at = now();

  RETURN jsonb_build_object('success', true, 'agent_id', p_agent_id, 'branch_id', p_branch_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_cloud_print_agent(
  p_agent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_agent public.cloud_print_agents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_ID_REQUIRED');
  END IF;

  SELECT * INTO v_agent
  FROM public.cloud_print_agents
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  IF v_agent.agent_id IS NULL OR NOT v_agent.enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_REGISTERED');
  END IF;
  IF NOT public.user_may_access_branch(v_agent.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  UPDATE public.cloud_print_agents
  SET last_seen_at = now(), updated_at = now()
  WHERE agent_id = p_agent_id;

  RETURN jsonb_build_object(
    'success', true,
    'agent_id', p_agent_id,
    'branch_id', v_agent.branch_id,
    'last_seen_at', now()
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_cloud_print_queue(
  p_branch_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := LEAST(250, GREATEST(1, COALESCE(p_limit, 100)));
  v_jobs jsonb;
  v_agents jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
  INTO v_jobs
  FROM (
    SELECT
      j.id,
      j.branch_id,
      j.kind,
      j.station_code,
      j.status,
      j.attempts,
      j.last_error,
      j.claimed_agent_id,
      j.claimed_at,
      j.lease_expires_at,
      j.next_attempt_at,
      j.submitted_at,
      j.printed_at,
      j.created_at,
      j.updated_at,
      j.sale_id,
      j.expected_print_number
    FROM public.cloud_print_jobs j
    WHERE j.branch_id = p_branch_id
      AND j.status IN ('pending', 'claimed', 'printing', 'failed', 'submitted')
    ORDER BY j.created_at DESC
    LIMIT v_limit
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agent_id', a.agent_id,
    'branch_id', a.branch_id,
    'enabled', a.enabled,
    'label', a.label,
    'registered_at', a.registered_at,
    'last_seen_at', a.last_seen_at,
    'is_online', (a.enabled AND a.last_seen_at IS NOT NULL AND a.last_seen_at > now() - interval '20 seconds')
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  INTO v_agents
  FROM public.cloud_print_agents a
  WHERE a.branch_id = p_branch_id;

  RETURN jsonb_build_object('success', true, 'jobs', v_jobs, 'agents', v_agents);
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
  IF NOT EXISTS (
    SELECT 1 FROM public.cloud_print_agents a
    WHERE a.agent_id = p_agent_id
      AND a.branch_id = p_branch_id
      AND a.enabled = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_REGISTERED');
  END IF;

  UPDATE public.cloud_print_agents
  SET last_seen_at = now(), updated_at = now()
  WHERE agent_id = p_agent_id;

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
    AND status = 'claimed'
    AND lease_expires_at < now();

  UPDATE public.cloud_print_jobs
  SET status = 'failed',
      attempts = GREATEST(attempts, 5),
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      last_error = 'PRINT_OUTCOME_UNKNOWN',
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND status = 'printing'
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

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cloud_print_agents a
    WHERE a.agent_id = p_agent_id
      AND a.branch_id = v_job.branch_id
      AND a.enabled = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_REGISTERED');
  END IF;
  IF v_job.status <> 'claimed' OR v_job.claimed_agent_id IS DISTINCT FROM p_agent_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAIM_MISMATCH');
  END IF;

  IF v_job.kind = 'receipt' THEN
    SELECT count(*)::integer INTO v_print_count FROM public.sale_print_events WHERE sale_id = v_job.sale_id;
    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs
      SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'PRINT_SEQUENCE_CHANGED', updated_at = now()
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
        SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'INVALID_APPROVAL', updated_at = now()
        WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;
    END IF;
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'printing', lease_expires_at = now() + interval '45 seconds', updated_at = now()
  WHERE id = v_job.id;

  UPDATE public.cloud_print_agents
  SET last_seen_at = now(), updated_at = now()
  WHERE agent_id = p_agent_id;

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
  v_error text := left(COALESCE(NULLIF(btrim(p_error), ''), 'PRINT_FAILED'), 1000);
  v_ambiguous boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cloud_print_agents a
    WHERE a.agent_id = p_agent_id
      AND a.branch_id = v_job.branch_id
      AND a.enabled = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_REGISTERED');
  END IF;
  IF v_job.claimed_agent_id IS DISTINCT FROM p_agent_id OR v_job.status NOT IN ('claimed', 'printing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAIM_MISMATCH');
  END IF;

  IF NOT COALESCE(p_success, false) THEN
    v_ambiguous := upper(v_error) IN ('PRINT_CALLBACK_TIMEOUT', 'PRINT_OUTCOME_UNKNOWN');
    UPDATE public.cloud_print_jobs
    SET status = 'failed',
        attempts = CASE WHEN v_ambiguous THEN GREATEST(attempts, 5) ELSE attempts END,
        last_error = CASE WHEN v_ambiguous THEN 'PRINT_OUTCOME_UNKNOWN' ELSE v_error END,
        next_attempt_at = CASE
          WHEN v_ambiguous THEN next_attempt_at
          ELSE now() + make_interval(secs => LEAST(30, GREATEST(2, attempts * 2)))
        END,
        claimed_agent_id = NULL,
        claimed_by_user = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'failed',
      'retryable', NOT v_ambiguous AND v_job.attempts < 5,
      'error', CASE WHEN v_ambiguous THEN 'PRINT_OUTCOME_UNKNOWN' ELSE v_error END,
      'physical_print_confirmed', false
    );
  END IF;

  IF v_job.kind = 'receipt' THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_job.sale_id FOR UPDATE;
    IF v_sale.id IS NULL OR v_sale.branch_id <> v_job.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    SELECT count(*)::integer INTO v_print_count
    FROM public.sale_print_events
    WHERE sale_id = v_job.sale_id;

    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs
      SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'PRINT_SEQUENCE_CHANGED', updated_at = now()
      WHERE id = v_job.id;
      RETURN jsonb_build_object('success', false, 'error', 'PRINT_SEQUENCE_CHANGED');
    END IF;

    IF v_print_count > 0 THEN
      SELECT * INTO v_req
      FROM public.approval_requests
      WHERE id = v_job.approval_request_id
      FOR UPDATE;

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
        SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'INVALID_APPROVAL', updated_at = now()
        WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;

      UPDATE public.approval_requests
      SET status = 'consumed', consumed_at = now()
      WHERE id = v_req.id;
    END IF;

    INSERT INTO public.sale_print_events(sale_id, branch_id, user_id, print_number, approval_request_id)
    VALUES (
      v_job.sale_id,
      v_job.branch_id,
      v_job.requested_by,
      v_print_count + 1,
      CASE WHEN v_print_count > 0 THEN v_job.approval_request_id ELSE NULL END
    )
    RETURNING id INTO v_event_id;

    SELECT * INTO v_requester FROM public.users WHERE id = v_job.requested_by;
    INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
    VALUES (
      v_job.requested_by,
      v_requester.email,
      CASE WHEN v_print_count = 0 THEN 'SALE_PRINT_SUBMITTED' ELSE 'SALE_REPRINT_SUBMITTED' END,
      'sale',
      v_job.sale_id,
      jsonb_build_object(
        'print_number', v_print_count + 1,
        'approval_request_id', v_job.approval_request_id,
        'print_call_accepted_by_cloud_agent', true,
        'physical_print_confirmed', false,
        'cloud_print_job_id', v_job.id
      ),
      v_job.branch_id
    );
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'submitted',
      submitted_at = now(),
      printed_at = NULL,
      last_error = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  UPDATE public.cloud_print_agents
  SET last_seen_at = now(), updated_at = now()
  WHERE agent_id = p_agent_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'submitted',
    'event_id', v_event_id,
    'physical_print_confirmed', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.register_cloud_print_agent(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_cloud_print_agent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cloud_print_queue(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_cloud_print_job(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.register_cloud_print_agent(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_cloud_print_agent(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cloud_print_queue(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_cloud_print_job(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
