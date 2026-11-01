-- Johna's November 2026 count: read-only pre-application finance gate.
-- Execute only with authorized DB read permissions; never writes business records.
WITH counts AS (
 SELECT sc.id,sc.count_number,sc.branch_id,sc.warehouse_id,sc.created_at,sc.status
 FROM public.stock_counts sc
 WHERE sc.count_number IN ('Johna''s-00008','Johna''s-00009')
), lines AS (
 SELECT c.*, i.id item_id,i.raw_material_id,i.counted_quantity,i.unit_cost saved_cost,
        coalesce(w.quantity,0) live_quantity,
        p.unit_cost approved_cost,p.price_source,p.priced_at
 FROM counts c JOIN public.stock_count_items i ON i.stock_count_id=c.id
 LEFT JOIN public.raw_material_warehouse_inventory w
   ON w.raw_material_id=i.raw_material_id
  AND w.branch_id=c.branch_id AND w.warehouse_id=c.warehouse_id
 LEFT JOIN LATERAL (
  SELECT unit_cost,price_source,priced_at
  FROM private.latest_approved_raw_prices(c.branch_id, ARRAY[i.raw_material_id], c.created_at)
  WHERE raw_material_id=i.raw_material_id
 ) p ON true
)
SELECT count_number,status,count(*) lines,
 count(*) FILTER (WHERE counted_quantity <> live_quantity) quantity_differences,
 count(*) FILTER (WHERE counted_quantity < live_quantity) shortages,
 count(*) FILTER (WHERE counted_quantity > live_quantity) surpluses,
 count(*) FILTER (WHERE approved_cost IS NULL) zero_price_by_policy,
 count(*) FILTER (WHERE price_source='stock_count') recursive_count_price_sources,
 count(*) FILTER (WHERE saved_cost IS DISTINCT FROM coalesce(approved_cost,0)) prices_needing_update,
 round(sum((counted_quantity-live_quantity)*coalesce(approved_cost,0)),2) tentative_net_variance_value
FROM lines GROUP BY count_number,status ORDER BY count_number;

-- BLOCK RELEASE until:
-- 1. Finance verifies pricing source eligibility and exact physical counted_at timestamp.
-- 2. Application RPC performs all-line atomic rollback and same-cost journal postings.
-- 3. All stock movements since physical count are reconciled and idempotence proved.
-- 4. Staff with proper permissions submits/approves the two count documents.
