-- Branch-specific financial-history visibility. Only history.unlimited bypasses
-- the per-branch window/sample; branch access is always checked independently.
-- Copy current settings to each existing branch before changing readers.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE private.branch_financial_visibility_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  recent_days integer NOT NULL CHECK (recent_days BETWEEN 1 AND 365),
  historical_percent integer NOT NULL CHECK (historical_percent BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
REVOKE ALL ON private.branch_financial_visibility_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.branch_financial_visibility_settings TO postgres, service_role;

INSERT INTO private.branch_financial_visibility_settings(branch_id,recent_days,historical_percent)
SELECT b.id, s.recent_days, s.historical_percent
FROM public.branches b
CROSS JOIN private.financial_visibility_settings s
WHERE s.singleton = true
ON CONFLICT(branch_id) DO NOTHING;

-- New branches inherit the unchanged global fallback until configured individually.
CREATE FUNCTION private.get_financial_visibility_limits(p_branch_id uuid)
RETURNS TABLE(recent_days integer,historical_percent integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $getter$
  SELECT COALESCE(b.recent_days, g.recent_days),
         COALESCE(b.historical_percent, g.historical_percent)
  FROM private.financial_visibility_settings g
  LEFT JOIN private.branch_financial_visibility_settings b ON b.branch_id=p_branch_id
  WHERE g.singleton=true
  LIMIT 1;
$getter$;
REVOKE ALL ON FUNCTION private.get_financial_visibility_limits(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_financial_visibility_limits(uuid) TO authenticated, service_role;

DO $guard$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('private.financial_row_visible(uuid,uuid,timestamptz)'::regprocedure) INTO v_def;
  IF position('FROM private.get_financial_visibility_limits() l' IN v_def)=0
     OR position('public.can_permission(''history.unlimited'')' IN v_def)=0
     OR position('public.user_may_access_branch(p_branch_id)' IN v_def)=0 THEN
    RAISE EXCEPTION 'FINANCIAL_ROW_VISIBILITY_DRIFT';
  END IF;
  EXECUTE replace(v_def,
    'FROM private.get_financial_visibility_limits() l',
    'FROM private.get_financial_visibility_limits(p_branch_id) l');

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='sales' AND policyname='financial_visibility_sales'
      AND permissive='RESTRICTIVE' AND cmd='SELECT'
      AND qual LIKE '%get_financial_visibility_limits()%')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='inventory_ledger' AND policyname='financial_visibility_inventory_ledger'
      AND permissive='RESTRICTIVE' AND cmd='SELECT'
      AND qual LIKE '%get_financial_visibility_limits()%')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='daily_closes' AND policyname='financial_visibility_daily_closes'
      AND permissive='RESTRICTIVE' AND cmd='SELECT'
      AND qual LIKE '%get_financial_visibility_limits()%') THEN
    RAISE EXCEPTION 'FINANCIAL_VISIBILITY_POLICY_DRIFT';
  END IF;
END;
$guard$;

-- Preserve all canonical pre-existing policy definitions and their strict
-- rollback/drift hashes. They form a superset, while branch-specific restrictive
-- policies below enforce the effective selected branch limits.
--
-- The pre-existing inline policies call the zero-argument getter. Those base
-- policies must no longer reject rows which the selected branch policy allows;
-- they retain all original permission and branch checks.
CREATE OR REPLACE FUNCTION private.get_financial_visibility_limits()
RETURNS TABLE(recent_days integer,historical_percent integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $legacy$
  SELECT 365::integer,100::integer;
$legacy$;

-- The authoritative reader for ordinary financial rows uses the branch-aware
-- predicate directly; only this one historical capability bypasses sampling.
-- For hot sales and ledger RLS, avoid redundant per-row definer calls by keeping
-- the original optimized policies plus a narrow restrictive branch condition.
CREATE POLICY branch_financial_visibility_sales
ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (SELECT public.can_permission('history.unlimited'))
  OR created_at >= public.history_date_start(
    public.history_business_date() -
    (GREATEST(COALESCE(
      (SELECT l.recent_days FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1),7
    ),1)-1)
  )
  OR (('x' || substr(md5(branch_id::text || ':' || id::text),1,8))::bit(32)::bigint % 100)
    < (SELECT LEAST(GREATEST(COALESCE(l.historical_percent,30),0),100)
       FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1)
);

-- Existing ledger references already apply financial_reference_visible, which
-- in turn uses the record's branch. Only unmatched non-reference rows need the
-- additional branch-local sample check.
CREATE POLICY branch_financial_visibility_inventory_ledger
ON public.inventory_ledger AS RESTRICTIVE FOR SELECT TO authenticated USING (
  CASE
    WHEN lower(COALESCE(reference_type,''))=ANY(
      ARRAY['sale','refund','sale_refund','purchase','purchase_return','expense','customer_payment','supplier_payment']
    ) AND reference_id IS NOT NULL THEN true
    ELSE
      (SELECT public.can_permission('history.unlimited'))
      OR created_at >= public.history_date_start(
        public.history_business_date() -
        (GREATEST(COALESCE(
          (SELECT l.recent_days FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1),7
        ),1)-1)
      )
      OR (('x' || substr(md5(branch_id::text || ':' || (md5(id::text))::uuid::text),1,8))::bit(32)::bigint % 100)
        < (SELECT LEAST(GREATEST(COALESCE(l.historical_percent,30),0),100)
           FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1)
  END
);

-- Day-close snapshots remain full or hidden (no sampling). The canonical
-- day-close policy is preserved byte-for-byte for rollback compatibility.
CREATE POLICY branch_financial_visibility_daily_closes
ON public.daily_closes AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (SELECT public.can_permission('history.unlimited'))
  OR business_date >= (
    public.history_business_date() -
    (GREATEST(COALESCE(
      (SELECT l.recent_days FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1),7
    ),1)-1)
  )
);

-- Rebind historical shift/day close reports to their record's branch.
-- Unlike ordinary records, these report snapshots deliberately use the strict
-- recent-days window and do not sample old financial totals.
DO $rebind_reports$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.get_shift_closing_report(uuid)'::regprocedure) INTO v_def;
  IF position('FROM private.get_financial_visibility_limits() l' IN v_def)=0
     OR position('v_shift.branch_id' IN v_def)=0 THEN
    RAISE EXCEPTION 'SHIFT_CLOSING_VISIBILITY_DRIFT';
  END IF;
  EXECUTE replace(v_def,
    'FROM private.get_financial_visibility_limits() l',
    'FROM private.get_financial_visibility_limits(v_shift.branch_id) l');

  SELECT pg_get_functiondef('public.get_day_closing_report(uuid,date)'::regprocedure) INTO v_def;
  IF position('FROM private.get_financial_visibility_limits() l' IN v_def)=0
     OR position('p_branch_id' IN v_def)=0 THEN
    RAISE EXCEPTION 'DAY_CLOSING_VISIBILITY_DRIFT';
  END IF;
  EXECUTE replace(v_def,
    'FROM private.get_financial_visibility_limits() l',
    'FROM private.get_financial_visibility_limits(p_branch_id) l');
END;
$rebind_reports$;

-- High-volume ledger search caches the caller's roles and global fallback.
-- Join the branch overrides by the source record branch instead of evaluating
-- one common cutoff for all branches, retaining its optimized SQL plan.
DO $rebind_ledger$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.search_inventory_ledger(uuid,text,text,timestamptz,timestamptz,bigint,integer)'::regprocedure
  ) INTO v_def;
  IF position('vis.vis_created_at >= v_cutoff' IN v_def)=0
    OR position(') vis' IN v_def)=0
    OR position(') < v_historical_percent' IN v_def)=0 THEN
    RAISE EXCEPTION 'LEDGER_SEARCH_VISIBILITY_DRIFT';
  END IF;
  v_def:=replace(v_def,
    ') vis' || chr(10) || chr(10) || '  WHERE',
    ') vis' || chr(10) || '  LEFT JOIN private.branch_financial_visibility_settings vis_policy' ||
    chr(10) || '    ON vis_policy.branch_id = vis.vis_branch_id' || chr(10) || chr(10) || '  WHERE');
  IF position('LEFT JOIN private.branch_financial_visibility_settings vis_policy' IN v_def)=0 THEN
    RAISE EXCEPTION 'LEDGER_SEARCH_JOIN_DRIFT';
  END IF;
  v_def:=replace(v_def, 'vis.vis_created_at >= v_cutoff',
    'vis.vis_created_at >= public.history_date_start(public.history_business_date() - (GREATEST(COALESCE(vis_policy.recent_days,(SELECT recent_days FROM private.financial_visibility_settings WHERE singleton=true),7),1)-1))');
  v_def:=replace(v_def, ') < v_historical_percent',
    ') < COALESCE(vis_policy.historical_percent,(SELECT historical_percent FROM private.financial_visibility_settings WHERE singleton=true),30)');
  EXECUTE v_def;
END;
$rebind_ledger$;

-- Settings are administered only by settings.manage and only for permitted branches.
-- The single existing history.unlimited permission is unchanged.
CREATE FUNCTION public.get_branch_financial_visibility_settings(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $read$
DECLARE v_days int; v_percent int;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id)
     OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_ACCESS_DENIED');
  END IF;
  SELECT l.recent_days,l.historical_percent INTO v_days,v_percent
  FROM private.get_financial_visibility_limits(p_branch_id) l;
  RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,
    'recent_days',v_days,'historical_percent',v_percent);
END;
$read$;

CREATE FUNCTION public.update_branch_financial_visibility_settings(
  p_branch_id uuid,p_recent_days integer,p_historical_percent integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $write$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id)
      OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_ACCESS_DENIED');
  END IF;
  IF p_recent_days IS NULL OR p_recent_days NOT BETWEEN 1 AND 365 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_RECENT_DAYS');
  END IF;
  IF p_historical_percent IS NULL OR p_historical_percent NOT BETWEEN 0 AND 100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_HISTORICAL_PERCENT');
  END IF;
  INSERT INTO private.branch_financial_visibility_settings
    (branch_id,recent_days,historical_percent,updated_by,updated_at)
  VALUES (p_branch_id,p_recent_days,p_historical_percent,auth.uid(),now())
  ON CONFLICT (branch_id) DO UPDATE
    SET recent_days=excluded.recent_days,
        historical_percent=excluded.historical_percent,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  PERFORM public.log_audit_action(p_branch_id,'update_financial_visibility_settings',
    'branch',p_branch_id,
    jsonb_build_object('recent_days',p_recent_days,'historical_percent',p_historical_percent));
  RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,
    'recent_days',p_recent_days,'historical_percent',p_historical_percent);
END;
$write$;

REVOKE ALL ON FUNCTION public.get_branch_financial_visibility_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_branch_financial_visibility_settings(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_financial_visibility_settings(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_branch_financial_visibility_settings(uuid,integer,integer) TO authenticated,service_role;
