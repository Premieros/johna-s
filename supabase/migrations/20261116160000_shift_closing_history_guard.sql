-- Read-only historic shift summary contains full shift cash/journal operations,
-- which cannot safely be sampled from its already aggregated fields.
-- Deny historical full-shift snapshots to users without history.unlimited;
-- leave close_shift, post_shift, payment settlement and cash truth untouched.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_sig regprocedure := to_regprocedure('public.get_shift_closing_report(uuid)');
  v_def text;
  v_anchor text := '  SELECT COALESCE(b.name,b.name_en,''-'') INTO v_branch_name FROM public.branches b WHERE b.id=v_shift.branch_id;';
  v_guard text := $guard_body$
  IF NOT public.can_permission('history.unlimited')
     AND COALESCE(v_shift.opened_at,v_shift.created_at) <
       public.history_date_start(public.history_business_date() - (
         GREATEST(COALESCE((
           SELECT l.recent_days FROM private.get_financial_visibility_limits() l LIMIT 1
         ),7),1)-1
       ))
  THEN
    RETURN jsonb_build_object('success',false,'error','HISTORY_PERMISSION_DENIED');
  END IF;
$guard_body$;
  v_count integer;
BEGIN
  IF v_sig IS NULL OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_sig)
  THEN RAISE EXCEPTION 'SHIFT_CLOSING_REPORT_MISSING_OR_MODE_DRIFT'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>1 OR position('HISTORY_PERMISSION_DENIED' in v_def)>0
  THEN RAISE EXCEPTION 'SHIFT_CLOSING_REPORT_SOURCE_DRIFT'; END IF;
  EXECUTE replace(v_def,v_anchor,v_guard||E'\n'||v_anchor);
END;
$guard$;
COMMIT;
