-- READ ONLY: exact prices displayed by the existing cost-center context.
-- NOTE: source='unpriced' returns 0 for UI display. It is NOT evidence
-- of an explicitly approved zero. No mutation, approval, or posting here.
WITH lines AS (
 SELECT c.count_number,c.branch_id,c.created_at,i.raw_material_id,
        i.counted_quantity,
        COALESCE(w.quantity,0) current_quantity,
        public._raw_cost_context_for_costing(i.raw_material_id,c.branch_id) cost_ctx
 FROM public.stock_counts c
 JOIN public.stock_count_items i ON i.stock_count_id=c.id
 LEFT JOIN public.raw_material_warehouse_inventory w
   ON w.raw_material_id=i.raw_material_id
  AND w.branch_id=c.branch_id AND w.warehouse_id=c.warehouse_id
 WHERE c.count_number IN ('Johna''s-00008','Johna''s-00009')
   AND i.raw_material_id IS NOT NULL
), priced AS (
 SELECT *, (cost_ctx->>'unit_cost')::numeric latest_center_cost,
        (cost_ctx->>'source') source,
        counted_quantity-current_quantity variance_quantity
 FROM lines
)
SELECT count_number, count(*) raw_lines,
       count(*) FILTER (WHERE source='unpriced') no_known_price_center_displays_zero,
       count(*) FILTER (WHERE source<>'unpriced' AND latest_center_cost=0) explicit_zero_source,
       count(*) FILTER (WHERE latest_center_cost>0) positive_price,
       sum(ROUND(variance_quantity*latest_center_cost,2)) center_cost_net_stock_variance,
       sum(ROUND(variance_quantity*latest_center_cost,2))
           FILTER (WHERE source<>'unpriced') evidenced_net_stock_variance
FROM priced GROUP BY count_number ORDER BY count_number;
