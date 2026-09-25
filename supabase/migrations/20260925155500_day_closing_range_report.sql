BEGIN;

-- Periodic day-closing summary.
-- Produces one row per business day for any selected date range and reuses
-- the existing day-closing source of truth, including payment-method splits.

CREATE OR REPLACE FUNCTION public.get_day_closing_range_report(
  p_branch_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from date := public.history_clamp_from(p_from_date);
  v_to date := public.history_clamp_to(p_to_date);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.can_permission('reports.financial') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;

  WITH days AS (
    SELECT d::date AS business_date
    FROM generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
  ),
  reports AS (
    SELECT
      d.business_date,
      public.get_day_closing_report(p_branch_id,d.business_date) AS report
    FROM days d
  ),
  normalized AS (
    SELECT
      r.business_date,
      r.report,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method'='cash'
      ),0) AS cash,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method'='card'
      ),0) AS card,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method'='transfer'
      ),0) AS transfer,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method'='credit'
      ),0) AS credit,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method'='legacy_bank'
      ),0) AS legacy_bank,
      COALESCE((
        SELECT SUM((p->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(r.report->'payment_methods','[]'::jsonb)) p
        WHERE p->>'method' NOT IN ('cash','card','transfer','credit','legacy_bank')
      ),0) AS other_payment
    FROM reports r
    WHERE COALESCE((r.report->>'success')::boolean,false)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'business_date',n.business_date,
      'gross_sales',round(COALESCE((n.report->>'gross_sales')::numeric,0),2),
      'discounts',round(COALESCE((n.report->>'discounts')::numeric,0),2),
      'taxes',round(COALESCE((n.report->>'taxes')::numeric,0),2),
      'returns',round(COALESCE((n.report->>'returns')::numeric,0),2),
      'net_sales',round(COALESCE((n.report->>'net_sales')::numeric,0),2),
      'cash',round(n.cash,2),
      'card',round(n.card,2),
      'transfer',round(n.transfer,2),
      'credit',round(n.credit,2),
      'legacy_bank',round(n.legacy_bank,2),
      'other_payment',round(n.other_payment,2),
      'expenses',round(COALESCE((n.report->>'expenses')::numeric,0),2),
      'cash_purchases',round(COALESCE((n.report->>'cash_purchases')::numeric,0),2),
      'cash_after_outflows',round(COALESCE((n.report->>'cash_after_outflows')::numeric,0),2),
      'invoice_count',COALESCE((n.report->>'invoice_count')::int,0),
      'shift_count',COALESCE((n.report->>'shift_count')::int,0),
      'daily_close_status',COALESCE(n.report->>'daily_close_status','open'),
      'snapshot',COALESCE((n.report->>'snapshot')::boolean,false)
    )
    ORDER BY n.business_date
  ),'[]'::jsonb)
  INTO v_rows
  FROM normalized n;

  RETURN jsonb_build_object(
    'branch_id',p_branch_id,
    'from_date',v_from,
    'to_date',v_to,
    'rows',v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_closing_range_report(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_day_closing_range_report(uuid,date,date) TO authenticated,service_role;

COMMIT;
