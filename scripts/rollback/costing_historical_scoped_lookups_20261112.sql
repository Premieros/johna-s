BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
ALTER POLICY financial_visibility_inventory_ledger ON public.inventory_ledger USING
 (private.financial_reference_visible(reference_type,reference_id,(md5(id::text))::uuid,branch_id,created_at));
DO $rollback$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure) INTO STRICT definition;
 IF position($new$    -- COSTING_SCOPED_REFERENCE_LOOKUPS: fence each indexed lookup before
    -- evaluating row visibility; never scan all zero-price history first.
    CROSS JOIN LATERAL (
      SELECT e.* FROM public.order_kitchen_inventory_events e
      WHERE e.settled_sale_id=s.id AND e.branch_id=s.branch_id OFFSET 0
    ) e
    CROSS JOIN LATERAL (
      SELECT il.* FROM public.inventory_ledger il
      WHERE il.reference_type='kitchen_send' AND il.reference_id=e.id
        AND il.entry_type='kitchen_send' AND il.branch_id=s.branch_id
        AND il.raw_material_id IS NOT NULL AND il.quantity<0
        AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      OFFSET 0
    ) il$new$ IN definition)=0 OR position($new$    FROM scoped_sales s
    CROSS JOIN LATERAL (
      SELECT il.* FROM public.inventory_ledger il
      WHERE il.reference_id=s.id AND il.reference_type='sale'
        AND il.entry_type='sale' AND il.branch_id=s.branch_id
        AND il.raw_material_id IS NOT NULL AND il.quantity<0
        AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      OFFSET 0
    ) il$new$ IN definition)=0 THEN RAISE EXCEPTION 'COSTING_SCOPED_ROLLBACK_SOURCE_DRIFT'; END IF;
 EXECUTE replace(replace(replace(replace(definition,$new$    -- COSTING_SCOPED_REFERENCE_LOOKUPS: fence each indexed lookup before
    -- evaluating row visibility; never scan all zero-price history first.
    CROSS JOIN LATERAL (
      SELECT e.* FROM public.order_kitchen_inventory_events e
      WHERE e.settled_sale_id=s.id AND e.branch_id=s.branch_id OFFSET 0
    ) e
    CROSS JOIN LATERAL (
      SELECT il.* FROM public.inventory_ledger il
      WHERE il.reference_type='kitchen_send' AND il.reference_id=e.id
        AND il.entry_type='kitchen_send' AND il.branch_id=s.branch_id
        AND il.raw_material_id IS NOT NULL AND il.quantity<0
        AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      OFFSET 0
    ) il$new$,$old$    JOIN public.order_kitchen_inventory_events e ON e.settled_sale_id=s.id AND e.branch_id=s.branch_id
    JOIN public.inventory_ledger il ON il.reference_type='kitchen_send' AND il.reference_id=e.id
      AND il.entry_type='kitchen_send' AND il.branch_id=s.branch_id$old$),$new$    FROM scoped_sales s
    CROSS JOIN LATERAL (
      SELECT il.* FROM public.inventory_ledger il
      WHERE il.reference_id=s.id AND il.reference_type='sale'
        AND il.entry_type='sale' AND il.branch_id=s.branch_id
        AND il.raw_material_id IS NOT NULL AND il.quantity<0
        AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      OFFSET 0
    ) il$new$,$old$    FROM scoped_sales s JOIN public.inventory_ledger il ON il.reference_id=s.id
      AND il.reference_type='sale' AND il.entry_type='sale' AND il.branch_id=s.branch_id$old$),$new$      -- Authenticated reads already enforce these same restrictive RLS checks.
      -- Keep the explicit checks for privileged/non-RLS invokers.
      AND (current_user='authenticated' OR (
        public.user_may_access_branch(s.branch_id)
        AND private.financial_row_visible(s.id,s.branch_id,s.created_at)
      ))$new$,$old$      AND public.user_may_access_branch(s.branch_id)
      AND private.financial_row_visible(s.id,s.branch_id,s.created_at)$old$),$new$AND (current_user='authenticated' OR private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at))$new$,$old$AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)$old$);
END;
$rollback$;
NOTIFY pgrst,'reload schema';
COMMIT;
