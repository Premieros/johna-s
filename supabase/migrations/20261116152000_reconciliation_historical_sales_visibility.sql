-- Candidate-only: protect historical sales inside the privileged component
-- reconciliation report, including its summary.net_sales aggregate.
-- No business records or existing operational writers are changed.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $guard$
DECLARE
  v_def text;
  v_anchor text := '        AND COALESCE(s.is_archived,false)=false';
  v_replacement text := E'        AND private.financial_row_visible(s.id,s.branch_id,s.created_at)\n        AND COALESCE(s.is_archived,false)=false';
  v_count int;
BEGIN
  IF to_regprocedure('public.get_sales_component_reconciliation_report(uuid,date,date)') IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_REPORT_MISSING';
  END IF;

  IF NOT (
    SELECT p.prosecdef
    FROM pg_proc p
    WHERE p.oid='public.get_sales_component_reconciliation_report(uuid,date,date)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'RECONCILIATION_REPORT_SECURITY_MODE_CHANGED';
  END IF;

  SELECT pg_get_functiondef('public.get_sales_component_reconciliation_report(uuid,date,date)'::regprocedure)
    INTO v_def;

  -- Fail closed if another author has already changed this reader. Never
  -- blindly insert the guard into an unexpected or partially patched body.
  IF position('private.financial_row_visible(s.id,s.branch_id,s.created_at)' in v_def)>0 THEN
    RAISE EXCEPTION 'RECONCILIATION_REPORT_ALREADY_PATCHED_REVIEW_REQUIRED';
  END IF;

  v_count := (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>1
     OR position('WITH sales_scope AS MATERIALIZED' in v_def)=0
     OR position('SELECT\n        s.id,\n        s.total' in v_def)=0
     OR position('summary' in v_def)=0
  THEN
    RAISE EXCEPTION 'RECONCILIATION_REPORT_SOURCE_DRIFT';
  END IF;

  -- Preserve the function signature, owner, SECURITY DEFINER attribute,
  -- search path, arguments and grants; change only the source read predicate.
  EXECUTE replace(v_def,v_anchor,v_replacement);
END;
$guard$;

COMMIT;
