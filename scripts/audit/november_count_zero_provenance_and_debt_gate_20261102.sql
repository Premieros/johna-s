-- READ ONLY. Never changes price, debt, stock, or count status.
-- Returns per-count evidence for the two independent blockers: missing approved
-- price and historical unsettled FIFO debt. Catalog default 0 is NOT by itself
-- an approved event (the column has a default of zero).
WITH count_lines AS (
 SELECT c.id count_id,c.count_number,c.branch_id,c.warehouse_id,c.created_at,
        i.raw_material_id, rm.default_cost,rm.updated_at
 FROM public.stock_counts c
 JOIN public.stock_count_items i ON i.stock_count_id=c.id
 JOIN public.raw_materials rm ON rm.id=i.raw_material_id AND rm.branch_id=c.branch_id
 WHERE c.count_number IN ('Johna''s-00008','Johna''s-00009')
), price_evidence AS (
 SELECT l.*,p.unit_cost,p.price_source,p.priced_at,
        EXISTS (
         SELECT 1 FROM public.raw_material_price_events e
         WHERE e.raw_material_id=l.raw_material_id
           AND e.branch_id=l.branch_id AND e.unit_cost=0
           AND e.priced_at<=l.created_at
        ) AS explicit_zero_price_event,
        EXISTS (
         SELECT 1 FROM public.raw_fifo_debts d
         WHERE d.raw_material_id=l.raw_material_id
           AND d.branch_id=l.branch_id AND d.warehouse_id=l.warehouse_id
           AND d.debt_quantity>d.settled_quantity
        ) AS has_legacy_open_debt
 FROM count_lines l
 LEFT JOIN LATERAL private.latest_approved_raw_prices(
    l.branch_id,ARRAY[l.raw_material_id],l.created_at
 ) p ON p.raw_material_id=l.raw_material_id
)
SELECT count_number,count(*) material_lines,
       count(*) FILTER (WHERE unit_cost>0) positive_approved_price,
       count(*) FILTER (WHERE unit_cost=0) zero_returned_by_canonical_price,
       count(*) FILTER (WHERE unit_cost IS NULL) missing_approved_price,
       count(*) FILTER (WHERE unit_cost IS NULL AND default_cost=0) missing_with_default_zero,
       count(*) FILTER (WHERE unit_cost IS NULL AND default_cost=0 AND updated_at<=created_at) missing_with_zero_catalog_older_than_count,
       count(*) FILTER (WHERE explicit_zero_price_event) explicit_zero_price_event_lines,
       count(*) FILTER (WHERE has_legacy_open_debt) materials_with_legacy_open_debt
FROM price_evidence GROUP BY count_number ORDER BY count_number;
