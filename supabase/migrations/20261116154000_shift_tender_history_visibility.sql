-- Candidate: shift tender details and totals must not expose an older
-- sale excluded by the caller's financial visibility policy.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_signature regprocedure := to_regprocedure('public.get_shift_sale_tenders(uuid)');
  v_def text;
  v_anchor text := '    WHERE st.amount>0';
  v_count int;
BEGIN
  IF v_signature IS NULL
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_signature)
  THEN RAISE EXCEPTION 'SHIFT_TENDER_REPORT_MISSING_OR_MODE_DRIFT'; END IF;
  SELECT pg_get_functiondef(v_signature) INTO v_def;
  v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>2
     OR position('private.financial_row_visible(s.id,s.branch_id,s.created_at)' in v_def)>0
     OR position('public.user_may_access_branch(v_shift.branch_id)' in v_def)=0
  THEN RAISE EXCEPTION 'SHIFT_TENDER_REPORT_SOURCE_DRIFT'; END IF;
  EXECUTE replace(v_def,v_anchor,
    '    WHERE private.financial_row_visible(s.id,s.branch_id,s.created_at)'
      ||E'\n      AND st.amount>0');
END;
$guard$;
COMMIT;
