-- Remove a duplicate per-movement authorization read. Existing restrictive RLS
-- remains mandatory, unchanged, and checked once per report invocation.
SET lock_timeout='2s';
SET statement_timeout='15s';
DO $patch$
DECLARE v_def text;v_old text;v_guard text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)'::regprocedure AND NOT prosecdef AND md5(prosrc)='701383f18b6239276843f33448bf7b5a') THEN RAISE EXCEPTION 'CONSUMPTION_READ_BASELINE_CHANGED'; END IF;
 v_def:=pg_get_functiondef('public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)'::regprocedure);
 v_old:=$old$   AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)
$old$;
 v_guard:=$guard$ IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_policy pol ON pol.polrelid=c.oid
  WHERE c.oid='public.inventory_ledger'::regclass AND c.relrowsecurity
   AND pol.polname='financial_visibility_inventory_ledger' AND NOT pol.polpermissive
   AND md5(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid))='7b10db0c9436fe509d27e52b95455fb9'
   AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')=ANY(pol.polroles)
 ) THEN RAISE EXCEPTION 'CONSUMPTION_RLS_BASELINE_CHANGED'; END IF;
$guard$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'CONSUMPTION_DUPLICATE_GUARD_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,'');
 v_def:=replace(v_def,' WITH movements AS MATERIALIZED (',v_guard||' WITH movements AS MATERIALIZED (');
 EXECUTE v_def;
END $patch$;
NOTIFY pgrst,'reload schema';
