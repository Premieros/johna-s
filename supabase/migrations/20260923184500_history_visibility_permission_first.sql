BEGIN;

-- Permission-first historical visibility.
-- history.unlimited is the only capability that bypasses sampling.
-- Limited users see the recent window in full plus a deterministic percentage
-- of older rows. No role-name authorization is used.

CREATE OR REPLACE FUNCTION private.financial_row_visible(
  p_row_id uuid,
  p_branch_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent_days integer := 7;
  v_historical_percent integer := 30;
  v_bucket bigint;
  v_cutoff timestamptz;
BEGIN
  IF p_row_id IS NULL OR p_branch_id IS NULL OR p_created_at IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN false;
  END IF;

  IF public.can_permission('history.unlimited') THEN
    RETURN true;
  END IF;

  SELECT l.recent_days, l.historical_percent
  INTO v_recent_days, v_historical_percent
  FROM private.get_financial_visibility_limits() l;

  v_recent_days := GREATEST(COALESCE(v_recent_days, 7), 1);
  v_historical_percent := LEAST(GREATEST(COALESCE(v_historical_percent, 30), 0), 100);
  v_cutoff := public.history_date_start(public.history_business_date() - (v_recent_days - 1));

  IF p_created_at >= v_cutoff THEN
    RETURN true;
  END IF;

  v_bucket := (('x' || substr(md5(p_branch_id::text || ':' || p_row_id::text), 1, 8))::bit(32)::bigint % 100);
  RETURN v_bucket < v_historical_percent;
END;
$$;

CREATE OR REPLACE FUNCTION private.sale_read_visible(
  p_sale_id uuid,
  p_branch_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT private.financial_row_visible(p_sale_id, p_branch_id, p_created_at);
$$;

CREATE OR REPLACE FUNCTION private.order_read_visible(
  p_order_id uuid,
  p_branch_id uuid,
  p_status text,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_created_at IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN false;
  END IF;

  -- Operationally active orders are always visible inside the caller's branch.
  IF COALESCE(p_status, '') IN ('open', 'held') THEN
    RETURN true;
  END IF;

  RETURN private.financial_row_visible(p_order_id, p_branch_id, p_created_at);
END;
$$;

-- sale_payments must follow the parent sale visibility rather than being
-- globally denied. This fixes split-tender/receipt/report 403s without exposing
-- payments for hidden sales or other branches.
DROP POLICY IF EXISTS sale_payments_api_deny_all ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_financial_visibility_select ON public.sale_payments;
CREATE POLICY sale_payments_financial_visibility_select
ON public.sale_payments
FOR SELECT
TO authenticated
USING (private.sale_read_visible_by_id(sale_id));

REVOKE ALL ON TABLE public.sale_payments FROM anon;
GRANT SELECT ON TABLE public.sale_payments TO authenticated;

-- Visibility-policy administration is capability-based, never role-name based.
CREATE OR REPLACE FUNCTION public.get_financial_visibility_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent_days integer;
  v_historical_percent integer;
BEGIN
  IF COALESCE(current_setting('role', true), '') <> 'service_role'
     AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT recent_days, historical_percent
  INTO v_recent_days, v_historical_percent
  FROM private.financial_visibility_settings
  WHERE singleton = true;

  RETURN jsonb_build_object(
    'success', true,
    'recent_days', COALESCE(v_recent_days, 7),
    'historical_percent', COALESCE(v_historical_percent, 30)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_financial_visibility_settings(
  p_recent_days integer,
  p_historical_percent integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('role', true), '') <> 'service_role'
     AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_recent_days IS NULL OR p_recent_days < 1 OR p_recent_days > 365 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RECENT_DAYS');
  END IF;
  IF p_historical_percent IS NULL OR p_historical_percent < 0 OR p_historical_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_HISTORICAL_PERCENT');
  END IF;

  INSERT INTO private.financial_visibility_settings(
    singleton, recent_days, historical_percent, updated_at, updated_by
  )
  VALUES (
    true, p_recent_days, p_historical_percent, now(),
    CASE WHEN COALESCE(current_setting('role', true), '') = 'service_role' THEN NULL ELSE auth.uid() END
  )
  ON CONFLICT (singleton) DO UPDATE SET
    recent_days = EXCLUDED.recent_days,
    historical_percent = EXCLUDED.historical_percent,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object(
    'success', true,
    'recent_days', p_recent_days,
    'historical_percent', p_historical_percent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_visibility_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_financial_visibility_settings(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_visibility_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_financial_visibility_settings(integer, integer) TO authenticated, service_role;

COMMIT;
