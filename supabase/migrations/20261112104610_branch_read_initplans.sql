BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
-- user_may_access_branch begins with is_pos_admin() OR ... . Cache that
-- unchanged zero-argument term per statement; retain the canonical branch
-- predicate for every other caller. No new authorization source or grants.
DO $optimize$
DECLARE target record; definition text; before_hash text; after_hash text; rpc_name text;
BEGIN
 IF md5(pg_get_functiondef('public.user_may_access_branch(uuid)'::regprocedure))<>'ed3fb4c280e062b222a3557046850778'
 THEN RAISE EXCEPTION 'BRANCH_READ_CANONICAL_SOURCE_DRIFT'; END IF;
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT before_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 FOR target IN SELECT * FROM (VALUES
 ('inventory_ledger','auth_select_inventory_ledger','b2574706352e4e182910cb29a93c364a'),
 ('inventory_ledger','financial_visibility_inventory_ledger','76f8c0347b59a9d2b08866756f97de4a'),
 ('order_kitchen_inventory_events','kitchen_inventory_events_select','b2574706352e4e182910cb29a93c364a'),
 ('sales','auth_select_sales','e398f28cc7134c44430e12f15aca7207'),
 ('sales','financial_visibility_sales','be95196f2f649b7a59a352b32fb0f4b4')
 ) AS v(table_name,policy_name,expected_hash)
 LOOP
  SELECT pg_get_expr(polqual,polrelid) INTO STRICT definition FROM pg_policy
  WHERE polrelid=format('public.%I',target.table_name)::regclass AND polname=target.policy_name;
  IF md5(definition)<>target.expected_hash OR
     (length(definition)-length(replace(definition,'user_may_access_branch(branch_id)','')))/length('user_may_access_branch(branch_id)')<>1
  THEN RAISE EXCEPTION 'BRANCH_READ_POLICY_SOURCE_DRIFT: %',target.policy_name; END IF;
  EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',target.policy_name,target.table_name,
    replace(definition,'user_may_access_branch(branch_id)','((SELECT public.is_pos_admin()) OR public.user_may_access_branch(branch_id))'));
 END LOOP;
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT after_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 -- Both public report readers remain INVOKER and fail closed after policy drift.
 FOREACH rpc_name IN ARRAY ARRAY[
  'public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)',
  'public.get_historical_sale_cost_estimates(uuid,date,date)'
 ] LOOP
  SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE oid=rpc_name::regprocedure AND NOT prosecdef;
  IF (length(definition)-length(replace(definition,before_hash,'')))/32<>1
  THEN RAISE EXCEPTION 'BRANCH_READ_REPORT_GUARD_DRIFT'; END IF;
  EXECUTE replace(definition,before_hash,after_hash);
 END LOOP;
END;
$optimize$;
NOTIFY pgrst,'reload schema';
COMMIT;
