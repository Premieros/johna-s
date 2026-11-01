-- READ ONLY: quantify ledger-vs-approved-price variance before any stock count posting.
-- Existing price authority, no new pricing engine. Zero is a valid latest price.
-- The query is a preview; there is NO inventory/accounting write.
WITH counts AS (
 SELECT id,count_number,branch_id,warehouse_id,created_at,status
 FROM public.stock_counts
 WHERE count_number IN ('Johna''s-00008','Johna''s-00009')
), rows AS (
 SELECT c.count_number,c.status,c.branch_id,c.warehouse_id,
        i.raw_material_id,i.counted_quantity,
        COALESCE(w.quantity,0) AS current_quantity,
        COALESCE(p.unit_cost,i.unit_cost,0) AS chosen_price,
        p.price_source
 FROM counts c
 JOIN public.stock_count_items i ON i.stock_count_id=c.id
 LEFT JOIN public.raw_material_warehouse_inventory w
   ON w.raw_material_id=i.raw_material_id
  AND w.branch_id=c.branch_id AND w.warehouse_id=c.warehouse_id
 LEFT JOIN LATERAL (
  SELECT unit_cost,price_source
  FROM private.latest_approved_raw_prices(c.branch_id,ARRAY[i.raw_material_id],c.created_at)
  WHERE raw_material_id=i.raw_material_id
 ) p ON TRUE
), valuation AS (
 SELECT *,
   counted_quantity-current_quantity AS variance_qty,
   ROUND((counted_quantity-current_quantity)*chosen_price,2) AS variance_value
 FROM rows
)
SELECT count_number,status,
       count(*) AS lines,
       count(*) FILTER(WHERE chosen_price=0) AS zero_price_lines,
       count(*) FILTER(WHERE variance_qty<0) AS shortage_lines,
       count(*) FILTER(WHERE variance_qty>0) AS surplus_lines,
       COALESCE(SUM(variance_value),0) AS signed_approved_price_adjustment,
       COALESCE(SUM(variance_value) FILTER(WHERE variance_qty<0),0) AS approved_price_shortage_value,
       COALESCE(SUM(variance_value) FILTER(WHERE variance_qty>0),0) AS approved_price_surplus_value
FROM valuation
GROUP BY count_number,status ORDER BY count_number;

-- WARNING: this does NOT reconcile FIFO batch-value ledger movements or authorize a posting.
-- Existing FIFO unit costs and negative balances still require accounting bridge/rollback tests.
