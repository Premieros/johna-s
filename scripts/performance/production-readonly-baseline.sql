-- Stability Closure / Architecture Containment
-- Repeatable Production READ-ONLY performance baseline.
-- This script must never mutate Production and must not be used as a CI dependency.
-- Run against the target Postgres database and record the result in the active stability log.

WITH classified AS (
  SELECT
    CASE
      WHEN query ILIKE '%get_dashboard_sales_snapshot%' THEN 'dashboard.sales_snapshot'
      WHEN query ILIKE '%get_costing_sales_summary%' THEN 'costing.sales_summary'
      WHEN query ILIKE '%get_raw_material_cost_overview%' THEN 'costing.raw_material_overview'
      WHEN query ILIKE '%get_active_shift%' THEN 'pos.active_shift'
      WHEN query ILIKE '%send_to_kitchen%' THEN 'pos.send_to_kitchen'
      WHEN query ILIKE '%get_pos_cart_product_availability%' THEN 'pos.cart_availability'
      WHEN query ILIKE '%"order_items"%order_id%ANY%' THEN 'pos.active_orders_snapshot.order_items'
      WHEN query ILIKE '%"order_kitchen_sends"%order_id%ANY%' THEN 'pos.active_orders_snapshot.kitchen_sends'
      WHEN query ILIKE '%"orders"%branch_id%status%' THEN 'pos.active_orders_snapshot.orders'
      WHEN query ILIKE '%get_pos_order_operator_labels%' THEN 'pos.active_orders_snapshot.operator_labels'
      WHEN query ILIKE '%inventory_ledger%' THEN 'inventory.ledger'
      ELSE NULL
    END AS path,
    calls,
    mean_exec_time,
    total_exec_time,
    rows,
    query
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
)
SELECT
  path,
  sum(calls)::bigint AS calls,
  round((sum(total_exec_time) / NULLIF(sum(calls), 0))::numeric, 2) AS weighted_mean_ms,
  round(sum(total_exec_time)::numeric, 2) AS total_ms,
  sum(rows)::bigint AS rows
FROM classified
WHERE path IS NOT NULL
GROUP BY path
ORDER BY total_ms DESC, path;

-- Optional detail for the highest-cost shapes. Still read-only.
SELECT
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  rows,
  left(regexp_replace(query, '\\s+', ' ', 'g'), 320) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND (
    query ILIKE '%get_dashboard_sales_snapshot%'
    OR query ILIKE '%get_costing_sales_summary%'
    OR query ILIKE '%get_raw_material_cost_overview%'
    OR query ILIKE '%get_active_shift%'
    OR query ILIKE '%send_to_kitchen%'
    OR query ILIKE '%get_pos_cart_product_availability%'
    OR query ILIKE '%"order_items"%order_id%ANY%'
    OR query ILIKE '%"order_kitchen_sends"%order_id%ANY%'
    OR query ILIKE '%get_pos_order_operator_labels%'
    OR query ILIKE '%inventory_ledger%'
  )
ORDER BY total_exec_time DESC
LIMIT 50;
