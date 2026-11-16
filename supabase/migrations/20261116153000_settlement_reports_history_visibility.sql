-- Candidate only: enforce financial history visibility before the privileged
-- settlement aggregates are formed. Operational sale/payment writers unchanged.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_name text;
  v_signature regprocedure;
  v_def text;
  v_anchor text := 'AND COALESCE(s.is_archived,false)=false';
  v_visible text := 'AND private.financial_row_visible(s.id,s.branch_id,s.created_at)';
  v_count integer;
  v_expected integer;
BEGIN
  FOR v_name, v_expected IN
    SELECT * FROM (VALUES
      ('public.get_sales_by_payment_report(uuid,timestamptz,timestamptz,text,text,uuid,uuid,text)', 2),
      ('public.get_financial_reconciliation_report(uuid,timestamptz,timestamptz)', 1)
    ) AS v(signature, expected_count)
  LOOP
    v_signature := to_regprocedure(v_name);
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'FINANCIAL_REPORT_MISSING: %', v_name;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_signature) THEN
      RAISE EXCEPTION 'FINANCIAL_REPORT_SECURITY_MODE_DRIFT: %',v_name;
    END IF;
    SELECT pg_get_functiondef(v_signature) INTO v_def;

    v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
    IF v_count<>v_expected
       OR position(v_visible in v_def)>0
       OR position('public.user_may_access_branch(p_branch_id)' in v_def)=0
    THEN
      RAISE EXCEPTION 'FINANCIAL_REPORT_SOURCE_DRIFT: %',v_name;
    END IF;

    -- Match source indentation directly, without changing return fields,
    -- public grants, owner, signature or SECURITY DEFINER.
    EXECUTE replace(v_def,v_anchor,v_visible||E'\n      '||v_anchor);
  END LOOP;
END;
$guard$;
COMMIT;
