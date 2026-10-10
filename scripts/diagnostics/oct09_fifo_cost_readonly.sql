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
