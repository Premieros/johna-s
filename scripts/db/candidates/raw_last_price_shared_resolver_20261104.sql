-- One canonical resolver body, with a closed owner-only operational mode.
-- Report invokers retain invoice visibility and source RLS. Authorized writers
-- resolve the same completed purchase/approved price independently of browsing.
DO $shared_resolver$
DECLARE s text; original text; old text;
BEGIN
 SELECT pg_get_functiondef('private.raw_approved_price_visible(text,text,uuid,uuid,uuid)'::regprocedure) INTO original;
 IF md5(original)<>'35b70047bc97a81c11871a1ca83cb2bc' THEN RAISE EXCEPTION 'RAW_SOURCE_VISIBILITY_DRIFT'; END IF;
 s:=regexp_replace(original,'CREATE OR REPLACE FUNCTION private.raw_approved_price_visible\([^)]*\)',
  'CREATE OR REPLACE FUNCTION private.raw_approved_price_visible_mode(p_kind text,p_source_id text,p_parent_id uuid,p_raw uuid,p_branch uuid,p_operational boolean)');
 s:=replace(s,'SELECT CASE','SELECT (NOT p_operational OR current_user IN (''postgres'',''service_role'')) AND CASE');
 old:='((auth.uid() IS NULL AND current_user IN (''postgres'',''service_role'')) OR private.financial_row_visible(p.id,p.branch_id,p.created_at))';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_SOURCE_FINANCIAL_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'((p_operational AND current_user IN (''postgres'',''service_role'')) OR '||old||')');
 EXECUTE s;
 EXECUTE $wrapper$CREATE OR REPLACE FUNCTION private.raw_approved_price_visible(p_kind text,p_source_id text,p_parent_id uuid,p_raw uuid,p_branch uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT private.raw_approved_price_visible_mode(p_kind,p_source_id,p_parent_id,p_raw,p_branch,false);$f$$wrapper$;

 SELECT pg_get_functiondef('private.latest_approved_raw_prices(uuid,uuid[],timestamptz)'::regprocedure) INTO original;
 IF md5(original)<>'4907c536c382a105a3ca5ed12a1e61c4' THEN RAISE EXCEPTION 'RAW_CANONICAL_RESOLVER_DRIFT'; END IF;
 s:=regexp_replace(original,'CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices\([^)]*\)',
  'CREATE OR REPLACE FUNCTION private.resolve_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz,p_operational boolean)');
 old:='private.raw_approved_price_visible(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_CANONICAL_SOURCE_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'private.raw_approved_price_visible_mode(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id,p_operational)');
 old:='WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_CANONICAL_SCOPE_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'WHERE (NOT p_operational OR current_user IN (''postgres'',''service_role'')) AND (p_branch_id IS NULL OR rm.branch_id=p_branch_id)');
 EXECUTE s;
 EXECUTE $wrapper$CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
 RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT * FROM private.resolve_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of,false);$f$$wrapper$;

 SELECT pg_get_functiondef('private.stock_count_raw_price(uuid,uuid[],timestamptz)'::regprocedure) INTO s;
 old:='private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_INTERNAL_PRICE_ANCHOR_DRIFT'; END IF;
 EXECUTE replace(s,old,'private.resolve_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of,true)');
END $shared_resolver$;
REVOKE ALL ON FUNCTION private.raw_approved_price_visible_mode(text,text,uuid,uuid,uuid,boolean),
 private.resolve_approved_raw_prices(uuid,uuid[],timestamptz,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.raw_approved_price_visible_mode(text,text,uuid,uuid,uuid,boolean),
 private.resolve_approved_raw_prices(uuid,uuid[],timestamptz,boolean) TO authenticated,service_role;
