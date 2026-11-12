BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $rollback$
DECLARE target record; definition text; before_hash text; after_hash text; rpc_name text;
BEGIN
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT before_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 FOR target IN SELECT * FROM (VALUES
 ('inventory_ledger','auth_select_inventory_ledger','b54ead8b2b3a8ccb08e789d69d3f3f90','b2574706352e4e182910cb29a93c364a'),
 ('inventory_ledger','financial_visibility_inventory_ledger','aec289fbf367dc293c3b245a8a4b876b','76f8c0347b59a9d2b08866756f97de4a'),
 ('order_kitchen_inventory_events','kitchen_inventory_events_select','b54ead8b2b3a8ccb08e789d69d3f3f90','b2574706352e4e182910cb29a93c364a'),
 ('sales','auth_select_sales','33e9e248e8c9fb499efa821df7164dc9','e398f28cc7134c44430e12f15aca7207'),
 ('sales','financial_visibility_sales','a616dcee802b2358cbbe4451e1416b62','be95196f2f649b7a59a352b32fb0f4b4')
 ) AS v(table_name,policy_name,expected_hash,restored_hash)
 LOOP
  SELECT pg_get_expr(polqual,polrelid) INTO STRICT definition FROM pg_policy
  WHERE polrelid=format('public.%I',target.table_name)::regclass AND polname=target.policy_name;
  IF md5(definition)<>target.expected_hash THEN RAISE EXCEPTION 'BRANCH_READ_ROLLBACK_DRIFT'; END IF;
  EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',target.policy_name,target.table_name,
    replace(definition,'(( SELECT is_pos_admin() AS is_pos_admin) OR user_may_access_branch(branch_id))','user_may_access_branch(branch_id)'));
  SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT after_hash FROM pg_policy
  WHERE polrelid=format('public.%I',target.table_name)::regclass AND polname=target.policy_name;
  IF after_hash<>target.restored_hash THEN RAISE EXCEPTION 'BRANCH_READ_ROLLBACK_PARITY'; END IF;
 END LOOP;
 SELECT md5(pg_get_expr(polqual,polrelid)) INTO STRICT after_hash FROM pg_policy
 WHERE polrelid='public.inventory_ledger'::regclass AND polname='financial_visibility_inventory_ledger';
 FOREACH rpc_name IN ARRAY ARRAY[
  'public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)',
  'public.get_historical_sale_cost_estimates(uuid,date,date)'
 ] LOOP
  SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE oid=rpc_name::regprocedure AND NOT prosecdef;
  IF (length(definition)-length(replace(definition,before_hash,'')))/32<>1 THEN RAISE EXCEPTION 'BRANCH_READ_REPORT_ROLLBACK_DRIFT'; END IF;
  EXECUTE replace(definition,before_hash,after_hash);
 END LOOP;
END;
$rollback$;
NOTIFY pgrst,'reload schema';
COMMIT;
