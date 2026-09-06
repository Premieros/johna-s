-- P0-B: close cross-tenant subscription status oracle and harden its scope helper.

ALTER FUNCTION public.user_can_access_organization(uuid)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.user_can_access_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_access_organization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_organization(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.subscription_is_active(p_tenant_id uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tid uuid := p_tenant_id;
  v_sub public.subscriptions%ROWTYPE;
  v_org_active boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Super Admin is the only implicit cross-tenant bypass.
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  -- Preserve existing current-tenant inference when the caller omits tenant_id.
  IF v_tid IS NULL THEN
    SELECT b.organization_id INTO v_tid
    FROM public.branches b
    WHERE b.id = public.get_branch_id();

    IF v_tid IS NULL THEN
      SELECT om.organization_id INTO v_tid
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
      LIMIT 1;
    END IF;
  END IF;

  IF v_tid IS NULL THEN
    RETURN false;
  END IF;

  -- Do not reveal another tenant's organization/subscription status.
  IF NOT public.user_can_access_organization(v_tid) THEN
    RETURN false;
  END IF;

  SELECT o.is_active INTO v_org_active
  FROM public.organizations o
  WHERE o.id = v_tid;

  IF v_org_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  SELECT * INTO v_sub
  FROM public.subscriptions s
  WHERE s.tenant_id = v_tid;

  IF v_sub.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_sub.status = 'active' THEN
    IF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
      RETURN false;
    END IF;
    RETURN true;
  ELSIF v_sub.status = 'trialing' THEN
    IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at < now() THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscription_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_is_active(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_is_active(uuid) TO authenticated;
