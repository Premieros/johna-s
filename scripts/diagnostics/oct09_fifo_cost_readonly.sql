-- Read-only kitchen FIFO cost profiling for #487.
-- No production writes or EXPLAIN ANALYZE.
SELECT indexname,indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='inventory_ledger'
ORDER BY indexname;

SELECT calls, round(mean_exec_time::numeric,1) AS mean_ms,
       round(max_exec_time::numeric,1) AS max_ms,
       shared_blks_hit,shared_blks_read
FROM pg_stat_statements
WHERE query LIKE '%_raw_last_known_fifo_cost%'
ORDER BY calls DESC LIMIT 10;


-- F. Safe aggregate of FIFO lookup distribution across material, branch,
-- warehouse. Returns aggregate figures only; no material/branch identifiers.
SELECT count(*) AS scope_count,
       sum(n)::bigint AS matching_issues,
       max(n) AS max_issues_per_scope,
       round(avg(n),1) AS average_issues_per_scope,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY n) AS p95_issues_per_scope
FROM (
  SELECT count(*) AS n
  FROM public.inventory_ledger
  WHERE quantity < 0
    AND COALESCE(unit_cost, 0) > 0
    AND COALESCE(batch_number, '') NOT LIKE 'OV-%'
  GROUP BY raw_material_id, branch_id, warehouse_id
) AS scope_counts;

-- G. Before choosing a physical index, compare representative scoped EXPLAIN
-- on an isolated replica or fixture using existing data-derived identifiers.
-- Never infer an improvement from an all-zero UUID plan alone.
