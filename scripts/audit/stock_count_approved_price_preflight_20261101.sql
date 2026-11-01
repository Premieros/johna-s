-- Read-only stock-count valuation preflight. Never applies, rejects or edits a count.
-- Invoke with psql -v count_id='...' after verifying target environment.
-- Price source: the existing approved price-read model, as-of this run.
-- CAUTION: approved-price read model includes stock_count source events;
-- finance must approve whether to limit to PURCHASE sources before cutover.
WITH candidate AS (
  SELECT sc.id, sc.count_number, sc.branch_id, sc.warehouse_id, sc.status,
         sci.id AS item_id, sci.raw_material_id, sci.product_id,
         sci.counted_quantity, sci.system_quantity, sci.unit_cost AS recorded_cost,
         COALESCE(rmwi.quantity,0) AS live_quantity
  FROM public.stock_counts sc
  JOIN public.stock_count_items sci ON sci.stock_count_id=sc.id
  LEFT JOIN public.raw_material_warehouse_inventory rmwi
    ON rmwi.raw_material_id=sci.raw_material_id
   AND rmwi.branch_id=sc.branch_id AND rmwi.warehouse_id=sc.warehouse_id
  WHERE sc.id=:'count_id'::uuid
), raw_price AS (
  SELECT c.*, p.unit_cost AS approved_unit_cost,p.price_source,p.priced_at
  FROM candidate c
  LEFT JOIN LATERAL (
    SELECT unit_cost,price_source,priced_at
    FROM private.latest_approved_raw_prices(
      c.branch_id,ARRAY[c.raw_material_id],now())
    WHERE raw_material_id=c.raw_material_id
  ) p ON c.raw_material_id IS NOT NULL
)
SELECT count_number,status,count(*) AS all_lines,
  count(*) FILTER (WHERE raw_material_id IS NOT NULL) AS raw_lines,
  count(*) FILTER (WHERE raw_material_id IS NOT NULL AND approved_unit_cost IS NULL) AS raw_missing_approved_price,
  count(*) FILTER (WHERE raw_material_id IS NOT NULL AND price_source<>'purchase') AS raw_nonpurchase_price_source,
  count(*) FILTER (WHERE raw_material_id IS NOT NULL AND recorded_cost IS DISTINCT FROM approved_unit_cost) AS raw_recorded_price_mismatches,
  count(*) FILTER (WHERE raw_material_id IS NOT NULL AND counted_quantity IS DISTINCT FROM live_quantity) AS raw_stock_differences,
  round(sum((counted_quantity-live_quantity)*approved_unit_cost)
    FILTER (WHERE raw_material_id IS NOT NULL AND approved_unit_cost IS NOT NULL),2)
    AS raw_candidate_net_variance_value
FROM raw_price
GROUP BY count_number,status;
