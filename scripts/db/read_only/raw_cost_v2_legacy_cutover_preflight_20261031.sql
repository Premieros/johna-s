-- READ-ONLY production preflight; no CREATE, INSERT, UPDATE or DELETE.
-- Aggregates existing legacy positions, prints only accounting metadata.
-- This is NOT an automatic conversion plan and does not activate v2.
WITH legacy_debts AS (
  SELECT d.branch_id,d.warehouse_id,d.raw_material_id,
    count(*)::bigint AS debt_rows,
    sum(d.debt_quantity-d.settled_quantity)::numeric(20,4) AS remaining_qty,
    count(*) FILTER (WHERE e.debt_id IS NOT NULL)::bigint AS priced_debts,
    count(*) FILTER (WHERE e.debt_id IS NULL)::bigint AS unpriced_debts,
    COALESCE(sum(e.remaining_estimated_quantity*e.estimated_unit_cost),0)::numeric(20,4)
       AS remaining_estimated_value,
    count(*) FILTER (WHERE il.unit_cost=0)::bigint AS historical_zero_price_ledgers,
    MIN(d.source_created_at) AS oldest_open_debt_at
  FROM public.raw_fifo_debts d
  LEFT JOIN public.raw_fifo_debt_price_estimates e ON e.debt_id=d.id
  JOIN public.inventory_ledger il ON il.id=d.source_ledger_id
  WHERE d.settled_quantity<d.debt_quantity
  GROUP BY d.branch_id,d.warehouse_id,d.raw_material_id
),
negative_lots AS (
  SELECT branch_id,warehouse_id,raw_material_id,
    abs(sum(quantity))::numeric(20,4) AS negative_qty,
    count(*)::bigint AS negative_lot_rows
  FROM public.raw_material_batches
  WHERE quantity<0 GROUP BY 1,2,3
),
approved_prices AS (
  SELECT x.* FROM private.latest_approved_raw_prices(NULL,NULL,statement_timestamp()) x
)
SELECT
  d.branch_id,d.warehouse_id,d.raw_material_id,
  d.debt_rows,d.priced_debts,d.unpriced_debts,d.historical_zero_price_ledgers,
  d.remaining_qty,COALESCE(n.negative_qty,0)::numeric(20,4) negative_qty,
  (d.remaining_qty=COALESCE(n.negative_qty,0)) AS physical_qty_matches,
  d.remaining_estimated_value,
  p.unit_cost AS current_approved_unit_price,
  p.price_source AS current_approved_source,
  d.oldest_open_debt_at,
  past.unit_cost AS approved_price_at_oldest_open_debt,
  past.price_source AS approved_source_at_oldest_open_debt,
  (past.unit_cost>0 AND past.priced_at IS NOT NULL) AS oldest_open_debt_has_approved_price,
  -- An as-of-TODAY price does not establish the historic source price!
  (p.unit_cost>0 AND p.priced_at IS NOT NULL) AS today_approved_price_exists,
  -- Never claim finance conversion ready while ANY historical debts remain.
  false AS can_activate_v2_without_financial_cutover
FROM legacy_debts d
LEFT JOIN negative_lots n
  ON n.branch_id=d.branch_id AND n.warehouse_id=d.warehouse_id
    AND n.raw_material_id=d.raw_material_id
LEFT JOIN approved_prices p
  ON p.branch_id=d.branch_id AND p.raw_material_id=d.raw_material_id
LEFT JOIN LATERAL private.latest_approved_raw_prices(
  d.branch_id,ARRAY[d.raw_material_id],d.oldest_open_debt_at
) past ON true
ORDER BY d.debt_rows DESC,d.branch_id,d.warehouse_id,d.raw_material_id;
