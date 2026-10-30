-- Preserve invoker security, RLS, all figures and journal > kitchen > legacy precedence.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DROP INDEX public.idx_inventory_ledger_zero_raw_issue_ref;
DO $costing_monthly_fold$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 SELECT pg_get_functiondef('public.get_costing_sales_summary(uuid,date,date)'::regprocedure) INTO STRICT v_def;
 v_old:=$old$-- COSTING_LINEAR_COST_FOLD: each source is aggregated once; no rejoin of
-- the complete cost result to every sale when the planner estimates one row.
resolved_costs AS MATERIALIZED (
  SELECT sale_id,
    sum(net_sales)::numeric AS net_sales,
    (array_agg(cogs ORDER BY source_priority) FILTER (WHERE source_priority>0))[1] AS cogs
  FROM (
    SELECT ss.id AS sale_id,ss.net_sales,0::numeric AS cogs,0 AS source_priority
    FROM scoped_sales ss
    UNION ALL
    SELECT sale_id,0::numeric,cogs,1 FROM journal_costs
    UNION ALL
    SELECT sale_id,0::numeric,cogs,2 FROM kitchen_costs
    UNION ALL
    SELECT sale_id,0::numeric,cogs,3 FROM legacy_costs
  ) cost_sources
  GROUP BY sale_id
),
totals AS (
  SELECT
    count(*)::integer AS sales_count,
    round(COALESCE(sum(rc.net_sales),0),2) AS net_sales,
    round(COALESCE(sum(rc.cogs),0),2) AS cogs
  FROM resolved_costs rc
)
SELECT jsonb_build_object(
  'sales_count',sales_count,
  'net_sales',net_sales,
  'cogs',cogs,
  'ratio',CASE WHEN net_sales>0 THEN round(cogs*100.0/net_sales,2) ELSE 0 END
)
FROM totals;$old$;
 v_new:=$new$resolved_costs AS (
  SELECT
    ss.id sale_id,
    CASE
      WHEN jc.sale_id IS NOT NULL THEN COALESCE(jc.cogs,0)
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs,0)
      ELSE COALESCE(lc.cogs,0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN journal_costs jc ON jc.sale_id=ss.id
  LEFT JOIN kitchen_costs kc ON kc.sale_id=ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id=ss.id
),
totals AS (
  SELECT
    count(*)::integer AS sales_count,
    round(COALESCE(sum(ss.net_sales),0),2) AS net_sales,
    round(COALESCE(sum(rc.cogs),0),2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id=ss.id
)
SELECT jsonb_build_object(
  'sales_count',sales_count,
  'net_sales',net_sales,
  'cogs',cogs,
  'ratio',CASE WHEN net_sales>0 THEN round(cogs*100.0/net_sales,2) ELSE 0 END
)
FROM totals;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'costing monthly summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$legacy_costs AS MATERIALIZED ($old$;
 v_new:=$new$legacy_costs AS ($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'costing monthly summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$kitchen_costs AS MATERIALIZED ($old$;
 v_new:=$new$kitchen_costs AS ($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'costing monthly summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$journal_costs AS MATERIALIZED ($old$;
 v_new:=$new$journal_costs AS ($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'costing monthly summary source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$costing_monthly_fold$;
COMMIT;
