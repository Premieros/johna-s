-- Full treasury/day-close reconciliation is built from complete historical
-- financial journals and reveals net_sales, cash_sales, credit_sales and
-- original opening/closing balances. These amounts cannot be safely sampled
-- without compromising the operational accounting ledger.
-- Keep the underlying calculations intact; require explicit unlimited history
-- permission to read this whole-history privileged financial statement.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_sig regprocedure := to_regprocedure(
    'public.get_branch_treasury_day_close_reconciliation(uuid,integer)');
  v_def text;
  v_anchor text := E'  SELECT min(\n    CASE\n      WHEN (s.created_at AT TIME ZONE ''Africa/Cairo'')::time < v_start_time';
  v_count integer;
  v_gate text := $gate$
  IF NOT public.can_permission('history.unlimited') THEN
    RETURN jsonb_build_object('success',false,'error','HISTORY_PERMISSION_DENIED');
  END IF;
$gate$;
BEGIN
  IF v_sig IS NULL OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_sig)
  THEN RAISE EXCEPTION 'TREASURY_RECON_REPORT_MISSING_OR_MODE_DRIFT'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>1
     OR position('HISTORY_PERMISSION_DENIED' in v_def)>0
     OR position('public.user_may_access_branch(p_branch_id)' in v_def)=0
  THEN RAISE EXCEPTION 'TREASURY_RECON_REPORT_SOURCE_DRIFT'; END IF;
  EXECUTE replace(v_def,v_anchor,v_gate||E'\n'||v_anchor);
END;
$guard$;
COMMIT;
