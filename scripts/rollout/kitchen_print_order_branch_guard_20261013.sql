-- Review package: production application requires owner approval.
-- Only Premieros/johna-s / azzdesuowpdcoflmyezn. No table/ACL/RLS changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.cloud_print_jobs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $patch$
DECLARE
  p record;
  d text;
  guard text := $inject$
  -- Client-selected branches never override the source order's branch.
  IF NULLIF(p_payload->>'order_id','') IS NOT NULL THEN
    IF (p_payload->>'order_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_CONTEXT_INVALID');
    END IF;
    SELECT branch_id INTO v_source_branch FROM public.orders WHERE id=(p_payload->>'order_id')::uuid;
    IF v_source_branch IS NULL THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
  ELSE
    -- Compatibility for already deployed clients: normal tickets include this
    -- order number. Generic non-order print payloads retain their existing API.
    v_source_number := btrim(substring(p_payload->>'text' FROM '(?:الطلب|طلب|Order|ORDER)[[:space:]]*:[[:space:]]*([^\r\n]+)'));
    IF v_source_number IS NOT NULL THEN
      SELECT count(*),min(branch_id::text)::uuid INTO v_source_matches,v_source_branch
      FROM public.orders WHERE order_number=v_source_number;
      IF v_source_matches<>1 THEN RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_CONTEXT_INVALID'); END IF;
    END IF;
  END IF;
  IF v_source_branch IS NOT NULL AND v_source_branch IS DISTINCT FROM p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_BRANCH_MISMATCH');
  END IF;
$inject$;
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid='public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure;
  -- Reviewed equivalent originals: production's compact formatting and the
  -- repository migration's formatting. Security/ACL checks remain exact.
  IF md5(p.prosrc) NOT IN ('0948d1005196a7d316daa8cc001ccbac','fb181c5b88307837089ca402a1eee88c') OR NOT p.prosecdef
     OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_CANONICAL_DRIFT';
  END IF;
  d:=pg_get_functiondef(p.oid);
  IF d !~ 'DECLARE[[:space:]]+v_job[[:space:]]+public[.]cloud_print_jobs%ROWTYPE;' OR position('INSERT INTO public.cloud_print_jobs(' IN d)=0 THEN RAISE EXCEPTION 'KITCHEN_PRINT_MARKER_MISSING'; END IF;
  d:=regexp_replace(d,'DECLARE[[:space:]]+v_job[[:space:]]+public[.]cloud_print_jobs%ROWTYPE;','DECLARE v_source_branch uuid; v_source_number text; v_source_matches bigint; v_job public.cloud_print_jobs%ROWTYPE;');
  d:=replace(d,'INSERT INTO public.cloud_print_jobs(',guard||'INSERT INTO public.cloud_print_jobs(');
  EXECUTE d;
  SELECT * INTO p FROM pg_proc WHERE oid='public.send_to_kitchen(uuid,uuid)'::regprocedure;
  IF md5(p.prosrc)<>'424ac9536ba5b3ea0e68266dccffc426' OR NOT p.prosecdef
     OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'KITCHEN_SEND_CANONICAL_DRIFT';
  END IF;
  d:=pg_get_functiondef(p.oid);
  IF position('  RETURN v_result;' IN d)=0 THEN RAISE EXCEPTION 'KITCHEN_SEND_RETURN_MARKER_MISSING'; END IF;
  EXECUTE replace(d,'  RETURN v_result;', '  RETURN v_result || jsonb_build_object(''branch_id'',v_order.branch_id);');
END;
$patch$;
COMMIT;
