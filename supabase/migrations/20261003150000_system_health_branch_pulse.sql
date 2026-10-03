-- System Health Branch Pulse + bounded user issue telemetry.
-- Repository migration only. Do not apply to Production without separate explicit approval.

BEGIN;

CREATE TABLE IF NOT EXISTS private.user_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  issue_kind text NOT NULL CHECK (issue_kind IN ('expected','technical')),
  screen text NOT NULL,
  action text NOT NULL,
  error_code text NOT NULL,
  user_message text NOT NULL,
  app_version text NULL,
  correlation_id text NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.user_issue_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.user_issue_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.user_issue_events TO service_role, postgres;

CREATE INDEX IF NOT EXISTS idx_user_issue_events_branch_created
  ON private.user_issue_events(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_issue_events_code_created
  ON private.user_issue_events(error_code, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_user_issue(
  p_branch_id uuid,
  p_screen text,
  p_action text,
  p_error_code text,
  p_user_message text,
  p_issue_kind text DEFAULT 'technical',
  p_app_version text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid := p_branch_id;
  v_kind text := lower(btrim(coalesce(p_issue_kind, 'technical')));
  v_screen text := left(regexp_replace(btrim(coalesce(p_screen, '')), '[[:cntrl:]]', '', 'g'), 120);
  v_action text := left(regexp_replace(btrim(coalesce(p_action, '')), '[[:cntrl:]]', '', 'g'), 120);
  v_code text := upper(left(regexp_replace(btrim(coalesce(p_error_code, 'CLIENT_ERROR')), '[^A-Za-z0-9_.:-]', '_', 'g'), 80));
  v_message text := left(regexp_replace(btrim(coalesce(p_user_message, '')), '[[:cntrl:]]', ' ', 'g'), 360);
  v_app_version text := nullif(left(btrim(coalesce(p_app_version, '')), 64), '');
  v_correlation_id text := nullif(left(btrim(coalesce(p_correlation_id, '')), 100), '');
  v_entity_type text := nullif(left(regexp_replace(btrim(coalesce(p_entity_type, '')), '[^A-Za-z0-9_.:-]', '_', 'g'), 80), '');
  v_event_id uuid;
  v_recent_count integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF v_kind NOT IN ('expected','technical') THEN
    v_kind := 'technical';
  END IF;

  IF v_branch IS NULL AND NOT public.is_pos_admin() THEN
    v_branch := public.get_branch_id();
  END IF;

  IF v_branch IS NOT NULL
     AND NOT public.is_pos_admin()
     AND NOT public.user_may_access_branch(v_branch) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_screen = '' THEN v_screen := '/unknown'; END IF;
  IF v_action = '' THEN v_action := 'unknown'; END IF;
  IF v_code = '' THEN v_code := 'CLIENT_ERROR'; END IF;
  IF v_message = '' THEN v_message := 'Operation could not be completed.'; END IF;

  -- Reject common secret-bearing shapes. The client must submit only safe,
  -- user-facing text and structured identifiers, never raw request/error data.
  IF lower(v_message) ~ '(authorization[ :=]|bearer[[:space:]]|password[ :=]|access[_ -]?token[ :=]|refresh[_ -]?token[ :=]|secret[ :=]|cvv[ :=])' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SENSITIVE_CONTENT_REJECTED');
  END IF;

  SELECT count(*)::int INTO v_recent_count
  FROM private.user_issue_events e
  WHERE e.user_id = v_user
    AND e.created_at >= now() - interval '1 minute';

  IF v_recent_count >= 30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'RATE_LIMITED');
  END IF;

  INSERT INTO private.user_issue_events(
    branch_id, user_id, issue_kind, screen, action, error_code,
    user_message, app_version, correlation_id, entity_type, entity_id
  )
  VALUES (
    v_branch, v_user, v_kind, v_screen, v_action, v_code,
    v_message, v_app_version, v_correlation_id, v_entity_type, p_entity_id
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_issue_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean := false;
  v_from timestamptz := p_from;
  v_to timestamptz := p_to;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  v_is_admin := public.is_pos_admin();
  IF NOT v_is_admin AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF v_from IS NULL OR v_to IS NULL OR v_from >= v_to OR v_to - v_from > interval '31 days' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TIME_RANGE');
  END IF;

  IF p_branch_id IS NOT NULL
     AND NOT v_is_admin
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'from', v_from,
    'to', v_to,
    'issues', coalesce((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.latest_at DESC, q.occurrences DESC)
      FROM (
        SELECT
          e.branch_id,
          b.name AS branch_name,
          e.issue_kind,
          e.error_code,
          e.screen,
          e.action,
          (array_agg(e.user_message ORDER BY e.created_at DESC))[1] AS user_message,
          count(*)::int AS occurrences,
          count(DISTINCT e.user_id)::int AS affected_users,
          max(e.created_at) AS latest_at
        FROM private.user_issue_events e
        LEFT JOIN public.branches b ON b.id = e.branch_id
        WHERE e.created_at >= v_from
          AND e.created_at < v_to
          AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
          AND (
            v_is_admin
            OR (e.branch_id IS NOT NULL AND public.user_may_access_branch(e.branch_id))
          )
        GROUP BY
          e.branch_id, b.name, e.issue_kind, e.error_code,
          e.screen, e.action
        ORDER BY max(e.created_at) DESC, count(*) DESC
        LIMIT v_limit
      ) q
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_branch_activity_snapshot(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_is_admin boolean := false;
  v_from timestamptz := p_from;
  v_to timestamptz := p_to;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  v_is_admin := public.is_pos_admin();
  IF NOT v_is_admin AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF v_from IS NULL OR v_to IS NULL OR v_from >= v_to OR v_to - v_from > interval '31 days' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TIME_RANGE');
  END IF;

  IF p_branch_id IS NOT NULL
     AND NOT v_is_admin
     AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  RETURN (
    WITH scoped_branches AS (
      SELECT b.id, b.name, b.name_en
      FROM public.branches b
      WHERE b.is_active = true
        AND (p_branch_id IS NULL OR b.id = p_branch_id)
        AND (v_is_admin OR public.user_may_access_branch(b.id))
    ),
    order_stats AS (
      SELECT
        sb.id AS branch_id,
        count(o.id) FILTER (WHERE o.created_at >= v_from AND o.created_at < v_to)::int AS order_count,
        count(o.id) FILTER (
          WHERE o.status IN ('open','held')
            AND o.created_at < now() - interval '15 minutes'
        )::int AS stale_open_orders
      FROM scoped_branches sb
      LEFT JOIN public.orders o ON o.branch_id = sb.id
      GROUP BY sb.id
    ),
    sale_stats AS (
      SELECT
        sb.id AS branch_id,
        count(s.id) FILTER (
          WHERE s.status = 'completed'
            AND s.created_at >= v_from AND s.created_at < v_to
        )::int AS completed_sales_count,
        coalesce(sum(greatest(coalesce(s.total,0) - coalesce(s.refunded_amount,0), 0)) FILTER (
          WHERE s.status = 'completed'
            AND s.created_at >= v_from AND s.created_at < v_to
        ), 0)::numeric AS completed_sales_value,
        count(s.id) FILTER (
          WHERE s.status = 'completed'
            AND s.created_at >= v_from AND s.created_at < v_to
            AND NOT EXISTS (
              SELECT 1
              FROM public.shifts sh
              WHERE sh.branch_id = s.branch_id
                AND sh.cashier_id = s.cashier_id
                AND sh.opened_at <= s.created_at
                AND coalesce(sh.closed_at, now()) >= s.created_at
            )
        )::int AS sales_without_shift_count
      FROM scoped_branches sb
      LEFT JOIN public.sales s ON s.branch_id = sb.id
        AND s.created_at >= v_from AND s.created_at < v_to
      GROUP BY sb.id
    ),
    print_stats AS (
      SELECT
        sb.id AS branch_id,
        count(cpj.id) FILTER (
          WHERE cpj.status = 'submitted'
            AND coalesce(cpj.submitted_at, cpj.updated_at, cpj.created_at) >= v_from
            AND coalesce(cpj.submitted_at, cpj.updated_at, cpj.created_at) < v_to
        )::int AS print_submitted_count,
        count(cpj.id) FILTER (
          WHERE cpj.status = 'printed'
            AND coalesce(cpj.printed_at, cpj.updated_at, cpj.created_at) >= v_from
            AND coalesce(cpj.printed_at, cpj.updated_at, cpj.created_at) < v_to
        )::int AS print_confirmed_count,
        count(cpj.id) FILTER (
          WHERE cpj.status = 'failed'
            AND cpj.updated_at >= v_from AND cpj.updated_at < v_to
        )::int AS print_failed_count,
        count(cpj.id) FILTER (
          WHERE cpj.status IN ('pending','claimed','printing')
        )::int AS print_active_count,
        bool_or(cpj.id IS NOT NULL) AS print_configured
      FROM scoped_branches sb
      LEFT JOIN public.cloud_print_jobs cpj ON cpj.branch_id = sb.id
      GROUP BY sb.id
    ),
    purchase_stats AS (
      SELECT
        sb.id AS branch_id,
        count(p.id) FILTER (
          WHERE p.status = 'completed'
            AND p.created_at >= v_from AND p.created_at < v_to
        )::int AS purchase_count,
        coalesce(sum(p.total) FILTER (
          WHERE p.status = 'completed'
            AND p.created_at >= v_from AND p.created_at < v_to
        ),0)::numeric AS purchase_value
      FROM scoped_branches sb
      LEFT JOIN public.purchases p ON p.branch_id = sb.id
        AND p.created_at >= v_from AND p.created_at < v_to
      GROUP BY sb.id
    ),
    expense_stats AS (
      SELECT
        sb.id AS branch_id,
        count(e.id) FILTER (
          WHERE e.status = 'posted'
            AND e.created_at >= v_from AND e.created_at < v_to
        )::int AS expense_count,
        coalesce(sum(e.amount + coalesce(e.tax_amount,0)) FILTER (
          WHERE e.status = 'posted'
            AND e.created_at >= v_from AND e.created_at < v_to
        ),0)::numeric AS expense_value
      FROM scoped_branches sb
      LEFT JOIN public.expenses e ON e.branch_id = sb.id
        AND e.created_at >= v_from AND e.created_at < v_to
      GROUP BY sb.id
    ),
    shift_stats AS (
      SELECT
        sb.id AS branch_id,
        count(sh.id) FILTER (WHERE sh.status='open')::int AS open_shift_count,
        count(DISTINCT sh.cashier_id) FILTER (WHERE sh.status='open')::int AS open_operator_count
      FROM scoped_branches sb
      LEFT JOIN public.shifts sh ON sh.branch_id = sb.id
      GROUP BY sb.id
    ),
    rows AS (
      SELECT
        sb.id AS branch_id,
        sb.name AS branch_name,
        sb.name_en AS branch_name_en,
        coalesce(os.order_count,0) AS order_count,
        coalesce(ss.completed_sales_count,0) AS completed_sales_count,
        coalesce(ss.completed_sales_value,0) AS completed_sales_value,
        coalesce(ps.print_submitted_count,0) AS print_submitted_count,
        coalesce(ps.print_confirmed_count,0) AS print_confirmed_count,
        coalesce(ps.print_failed_count,0) AS print_failed_count,
        coalesce(ps.print_active_count,0) AS print_active_count,
        coalesce(pus.purchase_count,0) AS purchase_count,
        coalesce(pus.purchase_value,0) AS purchase_value,
        coalesce(es.expense_count,0) AS expense_count,
        coalesce(es.expense_value,0) AS expense_value,
        coalesce(shs.open_shift_count,0) AS open_shift_count,
        coalesce(shs.open_operator_count,0) AS open_operator_count,
        coalesce(os.stale_open_orders,0) AS stale_open_orders,
        coalesce(ss.sales_without_shift_count,0) AS sales_without_shift_count,
        CASE
          WHEN coalesce(ps.print_failed_count,0) > 0
            OR coalesce(os.stale_open_orders,0) > 0
            OR coalesce(ss.sales_without_shift_count,0) > 0
            OR (
              coalesce(ss.completed_sales_count,0) > 0
              AND coalesce(ps.print_submitted_count,0) = 0
              AND coalesce(ps.print_confirmed_count,0) = 0
              AND coalesce(ps.print_failed_count,0) = 0
              AND coalesce(ps.print_configured,false)
            )
          THEN 'warning'
          WHEN coalesce(os.order_count,0)=0
            AND coalesce(ss.completed_sales_count,0)=0
            AND coalesce(pus.purchase_count,0)=0
            AND coalesce(es.expense_count,0)=0
            AND coalesce(ps.print_submitted_count,0)=0
            AND coalesce(ps.print_failed_count,0)=0
          THEN 'quiet'
          ELSE 'ok'
        END AS signal_status,
        (
          CASE WHEN coalesce(ps.print_failed_count,0) > 0
            THEN jsonb_build_array('PRINT_FAILURES') ELSE '[]'::jsonb END
          ||
          CASE WHEN coalesce(os.stale_open_orders,0) > 0
            THEN jsonb_build_array('STALE_OPEN_ORDERS') ELSE '[]'::jsonb END
          ||
          CASE WHEN coalesce(ss.sales_without_shift_count,0) > 0
            THEN jsonb_build_array('SALES_WITHOUT_SHIFT_COVERAGE') ELSE '[]'::jsonb END
          ||
          CASE WHEN coalesce(ss.completed_sales_count,0) > 0
              AND coalesce(ps.print_submitted_count,0)=0
              AND coalesce(ps.print_confirmed_count,0)=0
              AND coalesce(ps.print_failed_count,0)=0
              AND coalesce(ps.print_configured,false)
            THEN jsonb_build_array('SALES_WITHOUT_PRINT_SUBMISSION') ELSE '[]'::jsonb END
        ) AS warnings
      FROM scoped_branches sb
      LEFT JOIN order_stats os ON os.branch_id=sb.id
      LEFT JOIN sale_stats ss ON ss.branch_id=sb.id
      LEFT JOIN print_stats ps ON ps.branch_id=sb.id
      LEFT JOIN purchase_stats pus ON pus.branch_id=sb.id
      LEFT JOIN expense_stats es ON es.branch_id=sb.id
      LEFT JOIN shift_stats shs ON shs.branch_id=sb.id
    )
    SELECT jsonb_build_object(
      'success', true,
      'generated_at', now(),
      'from', v_from,
      'to', v_to,
      'branches', coalesce(jsonb_agg(to_jsonb(rows) ORDER BY branch_name), '[]'::jsonb)
    )
    FROM rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_user_issue(uuid,text,text,text,text,text,text,text,text,uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_issue_summary(timestamptz,timestamptz,uuid,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_branch_activity_snapshot(timestamptz,timestamptz,uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_user_issue(uuid,text,text,text,text,text,text,text,text,uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_issue_summary(timestamptz,timestamptz,uuid,integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_branch_activity_snapshot(timestamptz,timestamptz,uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
