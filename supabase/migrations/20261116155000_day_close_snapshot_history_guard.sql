-- Historical closing snapshots contain COMPLETE operational totals, not
-- sampled sales. Fail closed for limited readers on older business dates.
-- Do not modify snapshots or the operational day-close/shift-close writers.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE
  v_sig regprocedure := to_regprocedure('public.get_day_closing_report(uuid,date)');
  v_def text;
  v_anchor text := '  v_state:=public._ensure_business_day_state(p_branch_id);';
  v_condition text := $condition$
  -- A stored day-close snapshot is authoritative full-history accounting and
  -- cannot be safely approximated by removing invoice rows after aggregation.
  IF NOT public.can_permission('history.unlimited')
     AND p_day < public.history_business_date() - (
       GREATEST(COALESCE((
         SELECT l.recent_days FROM private.get_financial_visibility_limits() l LIMIT 1
       ), 7), 1) - 1
     )
  THEN
    RETURN jsonb_build_object('success',false,'error','HISTORY_PERMISSION_DENIED');
  END IF;
$condition$;
  v_count integer;
BEGIN
  IF v_sig IS NULL OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_sig)
  THEN RAISE EXCEPTION 'DAY_CLOSE_REPORT_MISSING_OR_SECURITY_DRIFT'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  v_count:=(length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  IF v_count<>1 OR position('HISTORY_PERMISSION_DENIED' in v_def)>0
  THEN RAISE EXCEPTION 'DAY_CLOSE_REPORT_SOURCE_DRIFT'; END IF;
  EXECUTE replace(v_def,v_anchor,v_condition||E'\n'||v_anchor);
END;
$guard$;

-- The stored JSON snapshot can also be read directly through PostgREST,
-- independently of get_day_closing_report. Restrict that route as well.
ALTER TABLE public.daily_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_visibility_daily_closes ON public.daily_closes;
CREATE POLICY financial_visibility_daily_closes
  ON public.daily_closes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.user_may_access_branch(branch_id)
    AND (
      (SELECT public.can_permission('history.unlimited'))
      OR business_date >= public.history_business_date() - (
        GREATEST(COALESCE((
          SELECT l.recent_days FROM private.get_financial_visibility_limits() l LIMIT 1
        ),7),1)-1
      )
    )
  );
COMMIT;
