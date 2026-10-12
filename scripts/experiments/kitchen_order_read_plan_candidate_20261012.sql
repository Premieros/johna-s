-- EXPERIMENT ONLY. Read-only order plan, never a canonical migration.
-- Unwired: dispatch must lock/authorize the order and bind this plan to its delta.
-- No cross-request stock cache; no stock, ledger, order, trigger or print writes.
CREATE OR REPLACE FUNCTION public._kitchen_order_read_plan_candidate(
  p_order_id uuid, p_branch_id uuid, p_as_of timestamptz
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $plan$
WITH scoped_order AS MATERIALIZED (
  SELECT id FROM public.orders
  WHERE id=p_order_id AND branch_id=p_branch_id AND status IN ('open','held')
),
deltas AS MATERIALIZED (
  SELECT oi.id AS order_item_id, oi.product_id,
    COALESCE(oi.modifier_option_ids,'{}'::uuid[]) AS modifier_ids,
    oi.quantity-COALESCE(s.sent_quantity,0) AS delta_quantity
  FROM scoped_order o
  JOIN public.order_items oi ON oi.order_id=o.id
  LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
  WHERE oi.quantity>COALESCE(s.sent_quantity,0)
),
configurations AS MATERIALIZED (
  SELECT DISTINCT product_id,modifier_ids FROM deltas
),
components AS MATERIALIZED (
  SELECT c.product_id,c.modifier_ids,r.raw_material_id,r.raw_name,r.quantity_per_sale
  FROM configurations c
  CROSS JOIN LATERAL public.resolve_kitchen_item_raw_components(
    c.product_id,p_branch_id,to_jsonb(c.modifier_ids)
  ) r
),
raw_ids AS MATERIALIZED (
  SELECT COALESCE(array_agg(DISTINCT raw_material_id),'{}'::uuid[]) ids
  FROM components
),
prices AS MATERIALIZED (
  SELECT p.* FROM raw_ids i
  CROSS JOIN LATERAL public._kitchen_approved_price_candidate(p_branch_id,i.ids,p_as_of) p
  WHERE p.unit_cost>0
    AND p.price_source IN ('purchase','pricing','stock_count')
    AND p.priced_at IS NOT NULL AND p.priced_at<=p_as_of
),
planned_items AS (
  SELECT d.order_item_id,d.product_id,d.delta_quantity,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'raw_material_id',c.raw_material_id,'raw_name',c.raw_name,
        'quantity',round(c.quantity_per_sale*d.delta_quantity,6),
        'unit_cost',p.unit_cost,'price_source',p.price_source,'priced_at',p.priced_at
      ) ORDER BY c.raw_material_id)
      FROM components c LEFT JOIN prices p ON p.raw_material_id=c.raw_material_id
      WHERE c.product_id=d.product_id AND c.modifier_ids=d.modifier_ids
    ),'[]'::jsonb) components
  FROM deltas d
)
SELECT CASE
  WHEN p_as_of IS NULL THEN jsonb_build_object('success',false,'error','AS_OF_REQUIRED')
  WHEN NOT EXISTS(SELECT 1 FROM scoped_order) THEN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE_OR_NOT_VISIBLE')
  ELSE jsonb_build_object(
    'success',true,'order_id',p_order_id,'branch_id',p_branch_id,'as_of',p_as_of,
    'configuration_count',(SELECT count(*) FROM configurations),
    'distinct_raw_count',(SELECT cardinality(ids) FROM raw_ids),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'order_item_id',order_item_id,'product_id',product_id,'delta_quantity',delta_quantity,
      'requires_canonical_fallback',jsonb_array_length(components)=0,'components',components
    ) ORDER BY order_item_id) FROM planned_items),'[]'::jsonb)
  )
END;
$plan$;
REVOKE ALL ON FUNCTION public._kitchen_order_read_plan_candidate(uuid,uuid,timestamptz)
FROM PUBLIC,anon,authenticated,service_role;
