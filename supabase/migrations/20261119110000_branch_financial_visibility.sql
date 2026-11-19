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

-- The existing functions for purchases, expenses, journal entries and other
-- rows call private.financial_row_visible and inherit the branch-local policy.
ALTER POLICY financial_visibility_sales ON public.sales USING (
  id IS NOT NULL AND branch_id IS NOT NULL AND created_at IS NOT NULL
  AND (public.is_pos_admin() OR public.user_may_access_branch(branch_id))
  AND private.financial_row_visible(id,branch_id,created_at)
);

-- Keep the reference-linked branch of the inventory visibility policy intact.
ALTER POLICY financial_visibility_inventory_ledger ON public.inventory_ledger USING (
  CASE
    WHEN lower(COALESCE(reference_type,'')) = ANY (
      ARRAY['sale','refund','sale_refund','purchase','purchase_return','expense','customer_payment','supplier_payment']
    ) AND reference_id IS NOT NULL
      THEN private.financial_reference_visible(reference_type,reference_id,(md5(id::text))::uuid,branch_id,created_at)
    ELSE private.financial_row_visible((md5(id::text))::uuid,branch_id,created_at)
  END
);

-- Day close has a strict recent-window rule, not old-record sampling.
ALTER POLICY financial_visibility_daily_closes ON public.daily_closes USING (
  public.user_may_access_branch(branch_id)
  AND (
    public.can_permission('history.unlimited')
    OR business_date >= (
      public.history_business_date() -
      (GREATEST(COALESCE(
        (SELECT l.recent_days FROM private.get_financial_visibility_limits(branch_id) l LIMIT 1),7
      ),1)-1)
    )
  )
);

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
