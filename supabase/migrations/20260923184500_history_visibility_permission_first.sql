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
DROP POLICY IF EXISTS sale_payments_parent_select ON public.sale_payments;
DROP POLICY IF EXISTS sale_payments_financial_visibility_select ON public.sale_payments;

CREATE POLICY sale_payments_parent_select
ON public.sale_payments
FOR SELECT
TO authenticated
USING (
  public.can_permission('sales.view')
  AND EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_payments.sale_id
      AND public.user_may_access_branch(s.branch_id)
  )
);

CREATE POLICY sale_payments_financial_visibility_select
ON public.sale_payments
AS RESTRICTIVE
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


-- Seven days is the 100%-visible recent window, not a maximum selectable range.
-- Older requested ranges remain selectable and are filtered by row-level sampling.
CREATE OR REPLACE FUNCTION public.history_min_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
  SELECT NULL::date;
$;

CREATE OR REPLACE FUNCTION public.history_clamp_from(p_from date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
  SELECT p_from;
$;

CREATE OR REPLACE FUNCTION public.history_clamp_to(p_to date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
  SELECT p_to;
$;

CREATE OR REPLACE FUNCTION public.history_clamp_as_of(p_as_of date)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
  SELECT COALESCE(p_as_of, public.history_business_date());
$;

CREATE OR REPLACE FUNCTION public.history_min_instant()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
  SELECT NULL::timestamptz;
$;

-- Tables that previously relied on UI-only seven-day filtering now enforce the
-- same permission-first sampling contract at RLS.
DROP POLICY IF EXISTS financial_visibility_audit_log ON public.audit_log;
CREATE POLICY financial_visibility_audit_log
ON public.audit_log
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.financial_row_visible(id, branch_id, created_at));

DROP POLICY IF EXISTS financial_visibility_treasury_transactions ON public.treasury_transactions;
CREATE POLICY financial_visibility_treasury_transactions
ON public.treasury_transactions
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.financial_row_visible(id, branch_id, created_at));

DROP POLICY IF EXISTS financial_visibility_shifts ON public.shifts;
CREATE POLICY financial_visibility_shifts
ON public.shifts
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  status = 'open'
  OR private.financial_row_visible(id, branch_id, COALESCE(opened_at, created_at))
);

DROP POLICY IF EXISTS financial_visibility_waste_entries ON public.waste_entries;
CREATE POLICY financial_visibility_waste_entries
ON public.waste_entries
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.financial_row_visible(id, branch_id, created_at));

DROP POLICY IF EXISTS financial_visibility_production_waste ON public.production_waste;
CREATE POLICY financial_visibility_production_waste
ON public.production_waste
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (private.financial_row_visible(id, branch_id, created_at));

-- SECURITY DEFINER inventory search must explicitly apply the same visibility
-- rule because table RLS does not constrain the function owner.
CREATE OR REPLACE FUNCTION public.search_inventory_ledger(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_entry_type text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_min_created_at timestamptz DEFAULT NULL::timestamptz,
  p_before_created_at timestamptz DEFAULT NULL::timestamptz,
  p_before_id bigint DEFAULT NULL::bigint,
  p_limit integer DEFAULT 51
)
RETURNS TABLE(
  id bigint,
  branch_id uuid,
  warehouse_id uuid,
  product_id uuid,
  raw_material_id uuid,
  batch_number text,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric,
  before_qty numeric,
  after_qty numeric,
  entry_type text,
  reference_type text,
  reference_id uuid,
  reference_number text,
  created_at timestamptz,
  product_name text,
  raw_material_name text,
  warehouse_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,51),1),51);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT public.can_permission('inventory.ledger.view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:inventory.ledger.view';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT
    il.id,
    il.branch_id,
    il.warehouse_id,
    il.product_id,
    il.raw_material_id,
    il.batch_number::text,
    il.quantity,
    il.unit_cost,
    il.total_cost,
    il.before_qty,
    il.after_qty,
    il.entry_type::text,
    il.reference_type::text,
    il.reference_id,
    il.reference_number::text,
    il.created_at,
    p.name::text AS product_name,
    rm.name::text AS raw_material_name,
    w.name::text AS warehouse_name
  FROM public.inventory_ledger il
  LEFT JOIN public.products p ON p.id=il.product_id
  LEFT JOIN public.raw_materials rm ON rm.id=il.raw_material_id
  LEFT JOIN public.warehouses w ON w.id=il.warehouse_id
  WHERE
    public.user_may_access_branch(il.branch_id)
    AND private.financial_reference_visible(
      il.reference_type,
      il.reference_id,
      (md5(il.id::text))::uuid,
      il.branch_id,
      il.created_at
    )
    AND (p_branch_id IS NULL OR il.branch_id=p_branch_id)
    AND (p_entry_type IS NULL OR p_entry_type='' OR p_entry_type='all' OR il.entry_type=p_entry_type)
    AND (p_min_created_at IS NULL OR il.created_at>=p_min_created_at)
    AND (
      p_before_created_at IS NULL
      OR il.created_at < p_before_created_at
      OR (il.created_at=p_before_created_at AND p_before_id IS NOT NULL AND il.id<p_before_id)
    )
    AND (
      v_search IS NULL
      OR COALESCE(il.reference_number,'') ILIKE '%'||v_search||'%'
      OR COALESCE(il.batch_number,'') ILIKE '%'||v_search||'%'
      OR COALESCE(p.name,'') ILIKE '%'||v_search||'%'
      OR COALESCE(rm.name,'') ILIKE '%'||v_search||'%'
      OR COALESCE(w.name,'') ILIKE '%'||v_search||'%'
      OR il.id::text ILIKE '%'||v_search||'%'
    )
  ORDER BY il.created_at DESC, il.id DESC
  LIMIT v_limit;
END;
$;

-- SECURITY DEFINER historical/reporting RPCs apply deterministic sampling
-- explicitly so widening the selectable date range never leaks full history.
CREATE OR REPLACE FUNCTION public.get_waste_report(
  p_branch_id uuid DEFAULT get_branch_id(),
  p_from_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  waste_category text,
  waste_type text,
  total_quantity numeric,
  total_cost numeric,
  entry_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('waste.report') THEN RAISE EXCEPTION 'PERMISSION_DENIED:waste.report'; END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;

  RETURN QUERY
  SELECT wc.name, we.waste_type, sum(we.quantity), sum(we.total_cost), count(*)::bigint
  FROM public.waste_entries we
  JOIN public.waste_categories wc ON wc.id=we.waste_category_id
  WHERE we.branch_id=p_branch_id
    AND we.status='approved'
    AND (p_from_date IS NULL OR we.created_at >= public.history_date_start(p_from_date))
    AND (p_to_date IS NULL OR we.created_at < public.history_date_start(p_to_date + 1))
    AND private.financial_row_visible(we.id, we.branch_id, we.created_at)
  GROUP BY wc.name,we.waste_type
  ORDER BY sum(we.total_cost) DESC;
END;
$;

CREATE OR REPLACE FUNCTION public.get_cost_history(p_product_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  product_id uuid,
  old_cost numeric,
  new_cost numeric,
  changed_at timestamptz,
  changed_by text,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
  SELECT
    ch.id,
    ch.product_id,
    ch.old_cost,
    ch.new_cost,
    ch.changed_at,
    COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    ch.source
  FROM public.product_cost_history ch
  JOIN public.products p ON p.id = ch.product_id
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id
    AND auth.uid() IS NOT NULL
    AND public.can_permission('reports.costing')
    AND p.branch_id IS NOT NULL
    AND public.user_may_access_branch(p.branch_id)
    AND private.financial_row_visible(ch.id, p.branch_id, ch.changed_at)
  ORDER BY ch.changed_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
$;

CREATE OR REPLACE FUNCTION public.get_raw_material_cost_history(
  p_raw_material_id uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  event_id text,
  raw_material_id uuid,
  raw_material_name text,
  branch_id uuid,
  unit_cost numeric,
  previous_cost numeric,
  change_amount numeric,
  change_pct numeric,
  price_source text,
  priced_at timestamptz,
  reference_number text,
  source_detail text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
DECLARE
  v_material_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT rm.branch_id
  INTO v_material_branch
  FROM public.raw_materials rm
  WHERE rm.id = p_raw_material_id;

  IF v_material_branch IS NULL THEN
    RETURN;
  END IF;
  IF p_branch_id IS NOT NULL AND p_branch_id <> v_material_branch THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT public.user_may_access_branch(v_material_branch) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(p_raw_material_id, v_material_branch) e
    WHERE private.financial_row_visible(
      (md5(COALESCE(e.event_id,'')))::uuid,
      v_material_branch,
      e.priced_at
    )
  ),
  sequenced AS (
    SELECT
      e.*,
      LEAD(e.unit_cost) OVER (
        ORDER BY
          e.priced_at DESC NULLS LAST,
          e.source_rank,
          e.reference_number DESC NULLS LAST,
          e.event_id DESC
      ) AS previous_cost
    FROM events e
  )
  SELECT
    e.event_id,
    e.raw_material_id,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material')::text,
    e.branch_id,
    e.unit_cost,
    e.previous_cost::numeric(18,6),
    CASE
      WHEN e.previous_cost IS NULL THEN NULL
      ELSE (e.unit_cost - e.previous_cost)::numeric(18,6)
    END,
    CASE
      WHEN COALESCE(e.previous_cost, 0) <= 0 THEN NULL
      ELSE round((e.unit_cost - e.previous_cost) * 100.0 / e.previous_cost, 4)::numeric(12,4)
    END,
    e.source,
    e.priced_at,
    e.reference_number,
    e.detail
  FROM sequenced e
  JOIN public.raw_materials rm ON rm.id = e.raw_material_id
  ORDER BY
    e.priced_at DESC NULLS LAST,
    e.source_rank,
    e.reference_number DESC NULLS LAST,
    e.event_id DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
END;
$;

CREATE OR REPLACE FUNCTION public.get_supplier_price_impact(p_supplier_id uuid)
RETURNS TABLE(
  item_id uuid,
  item_type text,
  item_name text,
  first_cost numeric,
  last_cost numeric,
  avg_cost numeric,
  change_pct numeric,
  purchase_count bigint,
  last_purchased_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
  SELECT
    p.id,
    'product'::text,
    COALESCE(NULLIF(btrim(p.name), ''), 'Product'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.products p ON p.id = pi.product_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.product_id IS NOT NULL
    AND public.user_may_access_branch(pc.branch_id)
    AND private.financial_row_visible(pc.id, pc.branch_id, pc.created_at)
  GROUP BY p.id

  UNION ALL

  SELECT
    rm.id,
    'raw_material'::text,
    COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]::numeric(12,2),
    (array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1]::numeric(12,2),
    round(AVG(pi.unit_cost), 2)::numeric(12,2),
    round(CASE
      WHEN (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1] > 0
      THEN ((array_agg(pi.unit_cost ORDER BY pc.created_at DESC))[1] - (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]) * 100.0
        / (array_agg(pi.unit_cost ORDER BY pc.created_at ASC))[1]
      ELSE 0 END, 2)::numeric(10,2),
    COUNT(*)::bigint,
    MAX(pc.created_at)::timestamptz
  FROM public.purchase_items pi
  JOIN public.purchases pc ON pc.id = pi.purchase_id
  JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
  WHERE pc.supplier_id = p_supplier_id
    AND pc.status = 'completed'
    AND pi.raw_material_id IS NOT NULL
    AND public.user_may_access_branch(pc.branch_id)
    AND private.financial_row_visible(pc.id, pc.branch_id, pc.created_at)
  GROUP BY rm.id
  ORDER BY 2, 3
$;

REVOKE ALL ON FUNCTION public.history_min_date() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_from(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_to(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_clamp_as_of(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.history_min_instant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.history_min_date() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_from(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_to(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_clamp_as_of(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.history_min_instant() TO authenticated, service_role;

COMMIT;
