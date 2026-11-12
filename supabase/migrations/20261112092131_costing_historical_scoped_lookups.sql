BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
-- Same row visibility, evaluated with statement-level context InitPlans.
-- Root-linked references still use the original helper (including missing roots).
DO $policy$
DECLARE definition text;
BEGIN
 SELECT pg_get_expr(polqual,polrelid) INTO STRICT definition FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger'
 AND NOT polpermissive;
 IF definition <> 'private.financial_reference_visible(reference_type, reference_id, (md5((id)::text))::uuid, branch_id, created_at)'
 THEN RAISE EXCEPTION 'COSTING_LEDGER_POLICY_SOURCE_DRIFT'; END IF;
END;
$policy$;
ALTER POLICY financial_visibility_inventory_ledger ON public.inventory_ledger USING (
CASE
 WHEN lower(COALESCE(reference_type,'')) IN ('sale','refund','sale_refund','purchase','purchase_return','expense','customer_payment','supplier_payment') AND reference_id IS NOT NULL
 THEN private.financial_reference_visible(reference_type,reference_id,(md5(id::text))::uuid,branch_id,created_at)
 ELSE
  id IS NOT NULL AND branch_id IS NOT NULL AND created_at IS NOT NULL
  AND public.user_may_access_branch(branch_id)
  AND (
   (SELECT public.can_permission('history.unlimited'))
   OR created_at >= (SELECT public.history_date_start(public.history_business_date() -
      (GREATEST(COALESCE((SELECT l.recent_days FROM private.get_financial_visibility_limits() l LIMIT 1),7),1)-1)))
   OR (('x'||substr(md5(branch_id::text||':'||((md5(id::text))::uuid)::text),1,8))::bit(32)::bigint % 100)
     < (SELECT LEAST(GREATEST(COALESCE((SELECT l.historical_percent FROM private.get_financial_visibility_limits() l LIMIT 1),30),0),100))
  )
 END
);

-- Preserve the existing report's fail-closed guard, bound to the new exact policy.
DO $report_guard$
DECLARE definition text; policy_hash text;
BEGIN
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT policy_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 SELECT pg_get_functiondef('public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,'7b10db0c9436fe509d27e52b95455fb9','')))/32<>1
 THEN RAISE EXCEPTION 'CONSUMPTION_POLICY_GUARD_SOURCE_DRIFT'; END IF;
 EXECUTE replace(definition,'7b10db0c9436fe509d27e52b95455fb9',policy_hash);
END;
$report_guard$;

-- Keep INVOKER security. Authenticated SELECT is already subject to the same
-- restrictive RLS; privileged invokers retain explicit visibility checks.
DO $repair$
DECLARE
 definition text;
 policy_hash text;
 visibility_guard text := $guard$ -- COSTING_LEDGER_VISIBILITY_GUARD_20261112
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_policy pol ON pol.polrelid=c.oid
  WHERE c.oid='public.inventory_ledger'::regclass AND c.relrowsecurity
   AND pol.polname='financial_visibility_inventory_ledger' AND NOT pol.polpermissive
   AND md5(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid))=__EXPECTED_LEDGER_HASH__
   AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')=ANY(pol.polroles)
 ) THEN RAISE EXCEPTION 'CONSUMPTION_RLS_BASELINE_CHANGED'; END IF;
$guard$;
 original_kitchen text := $old$    JOIN public.order_kitchen_inventory_events e ON e.settled_sale_id=s.id AND e.branch_id=s.branch_id
    JOIN public.inventory_ledger il ON il.reference_type='kitchen_send' AND il.reference_id=e.id
      AND il.entry_type='kitchen_send' AND il.branch_id=s.branch_id$old$;
 scoped_kitchen text := $new$    -- COSTING_SCOPED_REFERENCE_LOOKUPS: fence each indexed lookup before
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
    ) il$new$;
 original_sale text := $old$    FROM scoped_sales s JOIN public.inventory_ledger il ON il.reference_id=s.id
      AND il.reference_type='sale' AND il.entry_type='sale' AND il.branch_id=s.branch_id$old$;
 scoped_sale text := $new$    FROM scoped_sales s
    CROSS JOIN LATERAL (
      SELECT il.* FROM public.inventory_ledger il
      WHERE il.reference_id=s.id AND il.reference_type='sale'
        AND il.entry_type='sale' AND il.branch_id=s.branch_id
        AND il.raw_material_id IS NOT NULL AND il.quantity<0
        AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      OFFSET 0
    ) il$new$;
 original_visibility text := $old$      AND public.user_may_access_branch(s.branch_id)
      AND private.financial_row_visible(s.id,s.branch_id,s.created_at)$old$;
 scoped_visibility text := $new$      -- Authenticated reads already enforce these same restrictive RLS checks.
      -- Keep the explicit checks for privileged/non-RLS invokers.
      AND (current_user='authenticated' OR (
        public.user_may_access_branch(s.branch_id)
        AND private.financial_row_visible(s.id,s.branch_id,s.created_at)
      ))$new$;
 original_reference text := $old$AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)$old$;
 scoped_reference text := $new$AND (current_user='authenticated' OR private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at))$new$;
BEGIN
 SELECT pg_get_functiondef('public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure) INTO STRICT definition;
 IF position(original_kitchen IN definition)=0 OR position(original_sale IN definition)=0 OR position(original_visibility IN definition)=0
 THEN RAISE EXCEPTION 'COSTING_SCOPED_LOOKUP_SOURCE_DRIFT'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure)
 THEN RAISE EXCEPTION 'COSTING_REQUIRES_INVOKER_SECURITY'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.inventory_ledger'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sales'::regclass)
 THEN RAISE EXCEPTION 'COSTING_REQUIRES_ENFORCED_RLS'; END IF;
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT policy_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 visibility_guard:=replace(visibility_guard,'__EXPECTED_LEDGER_HASH__',quote_literal(policy_hash));
 definition:=replace(replace(replace(definition,original_kitchen,scoped_kitchen),original_sale,scoped_sale),original_reference,scoped_reference);
 IF position('  WITH history_bounds AS MATERIALIZED (' IN definition)=0 THEN RAISE EXCEPTION 'COSTING_BODY_SOURCE_DRIFT'; END IF;
 EXECUTE replace(definition,'  WITH history_bounds AS MATERIALIZED (',visibility_guard||'  WITH history_bounds AS MATERIALIZED (');
END;
$repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
