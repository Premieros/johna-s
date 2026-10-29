-- Read-only costing range optimization; preserve RLS, formulas and date semantics.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $patch_get_costing_sales_summary$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 SELECT pg_get_functiondef('public.get_costing_sales_summary(uuid,date,date)'::regprocedure) INTO v_def;
 v_old:=$old$  FROM public.sales s
  CROSS JOIN history_bounds hb$old$;
 v_new:=$new$  FROM date_candidates s$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_costing_sales_summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$    AND (hb.from_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=hb.from_date)
    AND (hb.to_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=hb.to_date)$old$;
 v_new:=$new$    -- COSTING_DATE_FILTER_MOVED_TO_INDEXED_CANDIDATES$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_costing_sales_summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$scoped_sales AS MATERIALIZED ($old$;
 v_new:=$new$range_bounds AS MATERIALIZED (
  SELECT hb.*,
    COALESCE(hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date)
      AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date,false) fast_range,
    CASE WHEN hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date) AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date
      THEN public.history_date_start(hb.from_date) END start_at,
    CASE WHEN hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date) AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date
      THEN public.history_date_start(hb.to_date+1) END end_at
  FROM history_bounds hb
),
date_candidates AS MATERIALIZED (
  -- COSTING_INDEXED_DATE_RANGE: normal UI periods read only the indexed interval.
  SELECT s.id,s.branch_id,s.refunded_amount,s.total,s.tax_amount,s.created_at,s.is_archived,s.status
  FROM public.sales s CROSS JOIN range_bounds b
  WHERE b.fast_range AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND NOT COALESCE(s.is_archived,false) AND COALESCE(s.status,'') NOT IN ('cancelled','returned')
    AND s.created_at>=b.start_at AND s.created_at<b.end_at
  UNION ALL
  -- Preserve nullable/infinite/unbounded date semantics exactly on the fallback path.
  SELECT s.id,s.branch_id,s.refunded_amount,s.total,s.tax_amount,s.created_at,s.is_archived,s.status
  FROM public.sales s CROSS JOIN range_bounds b
  WHERE NOT b.fast_range AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND NOT COALESCE(s.is_archived,false) AND COALESCE(s.status,'') NOT IN ('cancelled','returned')
    AND (b.from_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=b.from_date)
    AND (b.to_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=b.to_date)
),
scoped_sales AS MATERIALIZED ($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_costing_sales_summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_get_costing_sales_summary$;
DO $patch_get_historical_sale_cost_estimates$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 SELECT pg_get_functiondef('public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure) INTO v_def;
 v_old:=$old$    FROM public.sales s
    WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)$old$;
 v_new:=$new$    FROM date_candidates s
    WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_historical_sale_cost_estimates source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$      AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=public.history_clamp_from(p_from))
      AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=public.history_clamp_to(p_to))$old$;
 v_new:=$new$    -- COSTING_DATE_FILTER_MOVED_TO_INDEXED_CANDIDATES$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_historical_sale_cost_estimates source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  WITH scoped_sales AS MATERIALIZED ($old$;
 v_new:=$new$  WITH history_bounds AS MATERIALIZED (
    SELECT public.history_clamp_from(p_from) from_date,public.history_clamp_to(p_to) to_date
  ),
range_bounds AS MATERIALIZED (
  SELECT hb.*,
    COALESCE(hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date)
      AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date,false) fast_range,
    CASE WHEN hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date) AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date
      THEN public.history_date_start(hb.from_date) END start_at,
    CASE WHEN hb.from_date IS NOT NULL AND hb.to_date IS NOT NULL
      AND isfinite(hb.from_date) AND isfinite(hb.to_date) AND hb.from_date>='0001-01-01'::date AND hb.from_date<'9999-12-31'::date
      AND hb.to_date>='0001-01-01'::date AND hb.to_date<'9999-12-31'::date
      THEN public.history_date_start(hb.to_date+1) END end_at
  FROM history_bounds hb
),
date_candidates AS MATERIALIZED (
  -- COSTING_INDEXED_DATE_RANGE: normal UI periods read only the indexed interval.
  SELECT s.id,s.branch_id,s.refunded_amount,s.total,s.tax_amount,s.created_at,s.is_archived,s.status
  FROM public.sales s CROSS JOIN range_bounds b
  WHERE b.fast_range AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND NOT COALESCE(s.is_archived,false) AND COALESCE(s.status,'') NOT IN ('cancelled','returned')
    AND s.created_at>=b.start_at AND s.created_at<b.end_at
  UNION ALL
  -- Preserve nullable/infinite/unbounded date semantics exactly on the fallback path.
  SELECT s.id,s.branch_id,s.refunded_amount,s.total,s.tax_amount,s.created_at,s.is_archived,s.status
  FROM public.sales s CROSS JOIN range_bounds b
  WHERE NOT b.fast_range AND (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND NOT COALESCE(s.is_archived,false) AND COALESCE(s.status,'') NOT IN ('cancelled','returned')
    AND (b.from_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=b.from_date)
    AND (b.to_date IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=b.to_date)
),
scoped_sales AS MATERIALIZED ($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'get_historical_sale_cost_estimates source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_get_historical_sale_cost_estimates$;
COMMIT;
