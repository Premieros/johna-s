-- Work authorization backend contract.
-- Branch-only migration. Production apply remains blocked pending exact-head Full Verify + explicit approval.

-- 1) Canonical capability seeding by existing capabilities only; never by role name.
UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["work.authorization.approve"]'::jsonb
WHERE COALESCE(permissions, '[]'::jsonb) ? 'approvals.review'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'work.authorization.approve');

UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["work.authorization.manage"]'::jsonb
WHERE COALESCE(permissions, '[]'::jsonb) ? 'approvals.policy.manage'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'work.authorization.manage');

UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["work.authorization.bypass"]'::jsonb
WHERE COALESCE(permissions, '[]'::jsonb) ? 'approvals.override'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'work.authorization.bypass');

-- 2) Data model.
CREATE TABLE IF NOT EXISTS public.work_authorization_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  requires_authorization boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_authorization_policies_user_branch_key UNIQUE (user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.work_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  decided_at timestamptz NULL,
  decided_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  decision_reason text NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  revocation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_authorizations_status_check
    CHECK (status IN ('pending','approved','rejected','revoked'))
);

CREATE TABLE IF NOT EXISTS public.work_authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES public.work_authorizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_authorization_events_type_check
    CHECK (event_type IN ('requested','approved','rejected','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS work_authorizations_one_pending_per_user_branch
  ON public.work_authorizations(user_id, branch_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS work_authorizations_one_approved_per_user_branch
  ON public.work_authorizations(user_id, branch_id)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS work_authorizations_branch_status_idx
  ON public.work_authorizations(branch_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS work_authorization_events_auth_created_idx
  ON public.work_authorization_events(authorization_id, created_at DESC);

-- 3) Internal helpers.
CREATE OR REPLACE FUNCTION public.work_authorization_user_has_branch_access(
  p_user_id uuid,
  p_branch_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_active = true
      AND (
        u.branch_id = p_branch_id
        OR EXISTS (
          SELECT 1
          FROM public.user_branch_access uba
          WHERE uba.user_id = u.id
            AND uba.branch_id = p_branch_id
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.requires_work_authorization(
  p_user_id uuid,
  p_branch_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_is_super boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_active = true
      AND u.role = 'super_admin'
  ) INTO v_is_super;

  IF v_is_super THEN
    RETURN false;
  END IF;

  IF p_user_id = auth.uid()
     AND public.can_permission('work.authorization.bypass') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.work_authorization_policies p
    WHERE p.user_id = p_user_id
      AND p.branch_id = p_branch_id
      AND p.requires_authorization = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_user_work(
  p_branch_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_user_id AND u.is_active = true
  ) THEN
    RETURN false;
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN false;
  END IF;

  IF public.is_pos_admin() OR public.can_permission('work.authorization.bypass') THEN
    RETURN true;
  END IF;

  IF NOT public.requires_work_authorization(v_user_id, p_branch_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.work_authorizations wa
    WHERE wa.user_id = v_user_id
      AND wa.branch_id = p_branch_id
      AND wa.status = 'approved'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_user_work_authorized(
  p_branch_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF NOT public.can_user_work(p_branch_id) THEN
    RAISE EXCEPTION 'WORK_AUTHORIZATION_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- 4) Caller state / request.
CREATE OR REPLACE FUNCTION public.get_my_work_authorization_state(
  p_branch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_branch_name text;
  v_required boolean;
  v_can_work boolean;
  v_row public.work_authorizations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  SELECT b.name INTO v_branch_name FROM public.branches b WHERE b.id = p_branch_id;
  IF v_branch_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  v_required := public.requires_work_authorization(v_user_id, p_branch_id);
  v_can_work := public.can_user_work(p_branch_id);

  IF NOT v_required THEN
    RETURN jsonb_build_object(
      'branchId', p_branch_id,
      'branchName', v_branch_name,
      'requiresAuthorization', false,
      'canWork', true,
      'status', 'not_required'
    );
  END IF;

  SELECT wa.*
  INTO v_row
  FROM public.work_authorizations wa
  WHERE wa.user_id = v_user_id
    AND wa.branch_id = p_branch_id
  ORDER BY
    CASE wa.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
    wa.updated_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'branchId', p_branch_id,
      'branchName', v_branch_name,
      'requiresAuthorization', true,
      'canWork', false,
      'status', 'not_requested'
    );
  END IF;

  RETURN jsonb_build_object(
    'branchId', p_branch_id,
    'branchName', v_branch_name,
    'requiresAuthorization', true,
    'canWork', v_can_work,
    'status', v_row.status,
    'requestId', CASE WHEN v_row.status = 'pending' THEN v_row.id ELSE NULL END,
    'authorizationId', CASE WHEN v_row.status = 'approved' THEN v_row.id ELSE NULL END,
    'requestedAt', v_row.requested_at,
    'decidedAt', v_row.decided_at,
    'decisionReason', COALESCE(v_row.decision_reason, v_row.revocation_reason)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_work_authorization(
  p_branch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_auth_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  IF NOT public.requires_work_authorization(v_user_id, p_branch_id) THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  IF public.can_user_work(p_branch_id) THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  SELECT wa.id INTO v_auth_id
  FROM public.work_authorizations wa
  WHERE wa.user_id = v_user_id
    AND wa.branch_id = p_branch_id
    AND wa.status = 'pending'
  ORDER BY wa.requested_at DESC
  LIMIT 1;

  IF v_auth_id IS NOT NULL THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  INSERT INTO public.work_authorizations(
    user_id, branch_id, status, requested_by
  )
  VALUES (
    v_user_id, p_branch_id, 'pending', v_user_id
  )
  RETURNING id INTO v_auth_id;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id
  )
  VALUES (
    v_auth_id, v_user_id, p_branch_id, 'requested', v_user_id
  );

  PERFORM public.log_audit_action(
    p_branch_id,
    'work_authorization_requested',
    'work_authorization',
    v_auth_id,
    jsonb_build_object('user_id', v_user_id)
  );

  RETURN public.get_my_work_authorization_state(p_branch_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
END;
$function$;

-- 5) Manager snapshot.
CREATE OR REPLACE FUNCTION public.get_work_authorization_snapshot(
  p_branch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_can_manage boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  v_can_manage := public.can_permission('work.authorization.manage');

  RETURN jsonb_build_object(
    'pending',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wa.id,
        'branchId', wa.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'status', wa.status,
        'requestedAt', wa.requested_at,
        'decidedAt', wa.decided_at,
        'approverName', NULL,
        'decisionReason', wa.decision_reason,
        'startedAt', NULL
      ) ORDER BY wa.requested_at ASC)
      FROM public.work_authorizations wa
      JOIN public.users u ON u.id = wa.user_id
      JOIN public.branches b ON b.id = wa.branch_id
      WHERE wa.status = 'pending'
        AND u.is_active = true
        AND (p_branch_id IS NULL OR wa.branch_id = p_branch_id)
        AND public.user_may_access_branch(wa.branch_id)
    ), '[]'::jsonb),
    'active',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wa.id,
        'branchId', wa.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'status', wa.status,
        'requestedAt', wa.requested_at,
        'decidedAt', wa.decided_at,
        'approverName', COALESCE(du.full_name, du.username, du.email),
        'decisionReason', wa.decision_reason,
        'startedAt', wa.decided_at
      ) ORDER BY wa.decided_at DESC)
      FROM public.work_authorizations wa
      JOIN public.users u ON u.id = wa.user_id
      JOIN public.branches b ON b.id = wa.branch_id
      LEFT JOIN public.users du ON du.id = wa.decided_by
      WHERE wa.status = 'approved'
        AND u.is_active = true
        AND (p_branch_id IS NULL OR wa.branch_id = p_branch_id)
        AND public.user_may_access_branch(wa.branch_id)
    ), '[]'::jsonb),
    'history',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'branchId', e.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'kind', e.event_type,
        'occurredAt', e.created_at,
        'actorName', COALESCE(au.full_name, au.username, au.email),
        'note', e.note
      ) ORDER BY e.created_at DESC)
      FROM (
        SELECT *
        FROM public.work_authorization_events e0
        WHERE (p_branch_id IS NULL OR e0.branch_id = p_branch_id)
          AND public.user_may_access_branch(e0.branch_id)
        ORDER BY e0.created_at DESC
        LIMIT 250
      ) e
      JOIN public.users u ON u.id = e.user_id
      JOIN public.branches b ON b.id = e.branch_id
      LEFT JOIN public.users au ON au.id = e.actor_id
    ), '[]'::jsonb),
    'policies',
    CASE WHEN v_can_manage THEN
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', COALESCE(p.id::text, u.id::text || ':' || b.id::text),
          'branchId', b.id,
          'branchName', b.name,
          'userId', u.id,
          'userName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', '',
          'requiresAuthorization', COALESCE(p.requires_authorization, false)
        ) ORDER BY b.name, COALESCE(u.full_name, u.username, u.email))
        FROM public.users u
        JOIN public.branches b
          ON (
            u.branch_id = b.id
            OR EXISTS (
              SELECT 1 FROM public.user_branch_access uba
              WHERE uba.user_id = u.id AND uba.branch_id = b.id
            )
          )
        LEFT JOIN public.work_authorization_policies p
          ON p.user_id = u.id AND p.branch_id = b.id
        WHERE u.is_active = true
          AND (p_branch_id IS NULL OR b.id = p_branch_id)
          AND public.user_may_access_branch(b.id)
      ), '[]'::jsonb)
    ELSE '[]'::jsonb END
  );
END;
$function$;

-- 6) Manager decisions / policy.
CREATE OR REPLACE FUNCTION public.decide_work_authorization(
  p_request_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row public.work_authorizations%ROWTYPE;
  v_event text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT *
  INTO v_row
  FROM public.work_authorizations
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_PENDING');
  END IF;

  IF NOT public.user_may_access_branch(v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  IF v_row.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_APPROVAL_DENIED');
  END IF;

  IF NOT public.work_authorization_user_has_branch_access(v_row.user_id, v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
  END IF;

  IF NOT p_approve AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  IF p_approve THEN
    UPDATE public.work_authorizations
    SET status = 'approved',
        decided_at = now(),
        decided_by = auth.uid(),
        decision_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
        updated_at = now()
    WHERE id = v_row.id;
    v_event := 'approved';
  ELSE
    UPDATE public.work_authorizations
    SET status = 'rejected',
        decided_at = now(),
        decided_by = auth.uid(),
        decision_reason = btrim(p_reason),
        updated_at = now()
    WHERE id = v_row.id;
    v_event := 'rejected';
  END IF;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id, note
  )
  VALUES (
    v_row.id, v_row.user_id, v_row.branch_id,
    v_event, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), '')
  );

  PERFORM public.log_audit_action(
    v_row.branch_id,
    CASE WHEN p_approve THEN 'work_authorization_approved' ELSE 'work_authorization_rejected' END,
    'work_authorization',
    v_row.id,
    jsonb_build_object('user_id', v_row.user_id)
  );

  RETURN jsonb_build_object('success', true, 'authorization_id', v_row.id, 'status', v_event);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_AUTHORIZATION_EXISTS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_work_authorization(
  p_authorization_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row public.work_authorizations%ROWTYPE;
  v_pending_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT *
  INTO v_row
  FROM public.work_authorizations
  WHERE id = p_authorization_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHORIZATION_NOT_FOUND');
  END IF;

  IF v_row.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTHORIZATION_NOT_ACTIVE');
  END IF;

  IF NOT public.user_may_access_branch(v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  UPDATE public.work_authorizations
  SET status = 'revoked',
      revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id, note
  )
  VALUES (
    v_row.id, v_row.user_id, v_row.branch_id,
    'revoked', auth.uid(), btrim(p_reason)
  );

  PERFORM public.log_audit_action(
    v_row.branch_id,
    'work_authorization_revoked',
    'work_authorization',
    v_row.id,
    jsonb_build_object('user_id', v_row.user_id, 'reason', btrim(p_reason))
  );

  -- A revoked worker immediately returns to the waiting queue. The employee
  -- does not need to submit a new request and cannot re-enter until approved.
  IF EXISTS (
    SELECT 1
    FROM public.work_authorization_policies p
    WHERE p.user_id = v_row.user_id
      AND p.branch_id = v_row.branch_id
      AND p.requires_authorization = true
  ) THEN
    INSERT INTO public.work_authorizations(
      user_id, branch_id, status, requested_by
    )
    VALUES (
      v_row.user_id, v_row.branch_id, 'pending', v_row.user_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_pending_id;

    IF v_pending_id IS NULL THEN
      SELECT wa.id
      INTO v_pending_id
      FROM public.work_authorizations wa
      WHERE wa.user_id = v_row.user_id
        AND wa.branch_id = v_row.branch_id
        AND wa.status = 'pending'
      ORDER BY wa.requested_at DESC
      LIMIT 1;
    ELSE
      INSERT INTO public.work_authorization_events(
        authorization_id, user_id, branch_id, event_type, actor_id, note
      )
      VALUES (
        v_pending_id, v_row.user_id, v_row.branch_id,
        'requested', auth.uid(), 'auto_pending_after_revoke'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'authorization_id', v_row.id,
    'status', 'revoked',
    'pending_request_id', v_pending_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_authorization_requirement(
  p_user_id uuid,
  p_branch_id uuid,
  p_required boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_policy_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_user_id IS NULL OR p_branch_id IS NULL OR p_required IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  IF NOT public.work_authorization_user_has_branch_access(p_user_id, p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
  END IF;

  INSERT INTO public.work_authorization_policies(
    user_id, branch_id, requires_authorization, created_by, updated_by
  )
  VALUES (
    p_user_id, p_branch_id, p_required, auth.uid(), auth.uid()
  )
  ON CONFLICT (user_id, branch_id) DO UPDATE
  SET requires_authorization = EXCLUDED.requires_authorization,
      updated_by = auth.uid(),
      updated_at = now()
  RETURNING id INTO v_policy_id;

  IF NOT p_required THEN
    WITH stopped AS (
      UPDATE public.work_authorizations wa
      SET status = 'revoked',
          revoked_at = now(),
          revoked_by = auth.uid(),
          revocation_reason = 'policy_disabled',
          updated_at = now()
      WHERE wa.user_id = p_user_id
        AND wa.branch_id = p_branch_id
        AND wa.status IN ('approved', 'pending')
      RETURNING wa.id, wa.user_id, wa.branch_id
    )
    INSERT INTO public.work_authorization_events(
      authorization_id, user_id, branch_id, event_type, actor_id, note
    )
    SELECT id, user_id, branch_id, 'revoked', auth.uid(), 'policy_disabled'
    FROM stopped;
  END IF;

  PERFORM public.log_audit_action(
    p_branch_id,
    'work_authorization_policy_changed',
    'work_authorization_policy',
    v_policy_id,
    jsonb_build_object('user_id', p_user_id, 'required', p_required)
  );

  RETURN jsonb_build_object(
    'success', true,
    'policy_id', v_policy_id,
    'user_id', p_user_id,
    'branch_id', p_branch_id,
    'required', p_required
  );
END;
$function$;

-- 7) RLS: direct mutations are blocked; RPCs are authoritative.
ALTER TABLE public.work_authorization_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_authorization_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_authorization_policies_select ON public.work_authorization_policies;
CREATE POLICY work_authorization_policies_select
ON public.work_authorization_policies
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.can_permission('work.authorization.manage')
    AND public.user_may_access_branch(branch_id)
  )
);

DROP POLICY IF EXISTS work_authorizations_select ON public.work_authorizations;
CREATE POLICY work_authorizations_select
ON public.work_authorizations
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.can_permission('work.authorization.approve')
    AND public.user_may_access_branch(branch_id)
  )
);

DROP POLICY IF EXISTS work_authorization_events_select ON public.work_authorization_events;
CREATE POLICY work_authorization_events_select
ON public.work_authorization_events
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.can_permission('work.authorization.approve')
    AND public.user_may_access_branch(branch_id)
  )
);

REVOKE ALL ON public.work_authorization_policies FROM anon, authenticated;
REVOKE ALL ON public.work_authorizations FROM anon, authenticated;
REVOKE ALL ON public.work_authorization_events FROM anon, authenticated;

GRANT SELECT ON public.work_authorization_policies TO authenticated;
GRANT SELECT ON public.work_authorizations TO authenticated;
GRANT SELECT ON public.work_authorization_events TO authenticated;

-- 9) RPC grants.
REVOKE ALL ON FUNCTION public.work_authorization_user_has_branch_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requires_work_authorization(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_user_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_user_work(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.assert_user_work_authorized(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_user_work_authorized(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_work_authorization_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_work_authorization_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.request_work_authorization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_work_authorization(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_work_authorization_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_authorization_snapshot(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.decide_work_authorization(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_work_authorization(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_work_authorization(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_work_authorization(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_work_authorization_requirement(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_work_authorization_requirement(uuid, uuid, boolean) TO authenticated;


COMMENT ON TABLE public.work_authorization_policies IS 'Explicit per-user/per-branch requirement for work-start approval. Absence means not required.';
COMMENT ON TABLE public.work_authorizations IS 'Durable work-entry requests and branch-scoped approvals independent of shifts.';
COMMENT ON TABLE public.work_authorization_events IS 'Append-only work authorization timeline.';
-- Realtime wake-up for approval/revocation/policy changes. Guarded for CI/self-hosted
-- environments where the Supabase publication does not exist.
DO $realtime$
DECLARE
  pub_exists boolean;
  tbl text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO pub_exists;

  IF pub_exists THEN
    FOREACH tbl IN ARRAY ARRAY[
      'public.work_authorizations',
      'public.work_authorization_policies'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.schemaname || '.' || pt.tablename = tbl
      ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || tbl;
      END IF;
    END LOOP;
  END IF;
END $realtime$;

COMMENT ON FUNCTION public.can_user_work(uuid) IS 'Canonical Permission-First branch entry gate for the current authenticated user; independent of shift lifecycle.';
