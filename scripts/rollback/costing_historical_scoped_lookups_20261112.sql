BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $rollback$
DECLARE definition text; policy_hash text; visibility_guard text := $guard$ -- COSTING_LEDGER_VISIBILITY_GUARD_20261112
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_policy pol ON pol.polrelid=c.oid
  WHERE c.oid='public.inventory_ledger'::regclass AND c.relrowsecurity
   AND pol.polname='financial_visibility_inventory_ledger' AND NOT pol.polpermissive
   AND md5(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid))=__EXPECTED_LEDGER_HASH__
   AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')=ANY(pol.polroles)
 ) THEN RAISE EXCEPTION 'CONSUMPTION_RLS_BASELINE_CHANGED'; END IF;
$guard$;
BEGIN
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT policy_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 visibility_guard:=replace(visibility_guard,'__EXPECTED_LEDGER_HASH__',quote_literal(policy_hash));
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
 definition:=replace(definition,visibility_guard,'');
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
 SELECT pg_get_functiondef('public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,policy_hash,'')))/32<>1 THEN RAISE EXCEPTION 'CONSUMPTION_POLICY_ROLLBACK_SOURCE_DRIFT'; END IF;
 EXECUTE replace(definition,policy_hash,'7b10db0c9436fe509d27e52b95455fb9');
END;
$rollback$;
ALTER POLICY financial_visibility_inventory_ledger ON public.inventory_ledger USING
 (private.financial_reference_visible(reference_type,reference_id,(md5(id::text))::uuid,branch_id,created_at));
NOTIFY pgrst,'reload schema';
COMMIT;
