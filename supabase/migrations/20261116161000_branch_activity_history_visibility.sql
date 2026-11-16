-- The privileged branch activity widget must not disclose complete older
-- sales counts or sales value to users lacking history.unlimited.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_sig regprocedure := to_regprocedure(
    'public.get_branch_activity_snapshot(timestamptz,timestamptz,uuid)');
  v_def text;
  v_anchor text := '      LEFT JOIN public.sales s ON s.branch_id = sb.id';
  v_count integer;
BEGIN
  IF v_sig IS NULL OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_sig)
  THEN RAISE EXCEPTION 'BRANCH_ACTIVITY_REPORT_MISSING_OR_MODE_DRIFT'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>1
     OR position('private.financial_row_visible(s.id,s.branch_id,s.created_at)' in v_def)>0
  THEN RAISE EXCEPTION 'BRANCH_ACTIVITY_REPORT_SOURCE_DRIFT'; END IF;

  -- Keep the LEFT JOIN semantics (branches with no visible sales remain);
  -- filter sale rows before aggregates, with no changes to health/print stats.
  EXECUTE replace(v_def,v_anchor,
    v_anchor||E'\n        AND private.financial_row_visible(s.id,s.branch_id,s.created_at)');
END;
$guard$;
COMMIT;
