-- P0-B SECURITY DEFINER hardening — branch-scoped read RPCs.
-- Prevent SECURITY DEFINER from bypassing branch/RLS boundaries for cost history
-- and user branch-access inspection.

CREATE OR REPLACE FUNCTION public.get_cost_history(
  p_product_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  product_id uuid,
  old_cost numeric,
  new_cost numeric,
  changed_at timestamp with time zone,
  changed_by text,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('products.view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:products.view';
  END IF;

  SELECT p.branch_id
  INTO v_branch_id
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT
    ch.id,
    ch.product_id,
    ch.old_cost,
    ch.new_cost,
    ch.changed_at,
    COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    ch.source
  FROM public.product_cost_history ch
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id
  ORDER BY ch.changed_at DESC
  LIMIT GREATEST(LEAST(p_limit, 500), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_cost_history(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cost_history(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cost_history(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_branch_access(p_user_id uuid)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  branch_name_en text,
  organization_id uuid,
  is_active boolean,
  grant_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_role text;
  v_target_primary uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT u.role, u.branch_id
  INTO v_target_role, v_target_primary
  FROM public.users u
  WHERE u.id = p_user_id AND u.is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_user_id <> auth.uid() AND NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.branches.manage') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:users.branches.manage';
    END IF;

    IF v_target_role = 'super_admin' THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:super_admin';
    END IF;

    IF v_target_primary IS NOT NULL
       AND NOT public.user_may_access_branch(v_target_primary) THEN
      RAISE EXCEPTION 'TARGET_OUT_OF_SCOPE';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT x.branch_id, x.branch_name, x.branch_name_en,
         x.organization_id, x.is_active, x.grant_source
  FROM (
    SELECT b.id AS branch_id, b.name AS branch_name, b.name_en AS branch_name_en,
           b.organization_id, b.is_active, 'explicit'::text AS grant_source
    FROM public.user_branch_access uba
    JOIN public.branches b ON b.id = uba.branch_id
    WHERE uba.user_id = p_user_id

    UNION

    SELECT b.id, b.name, b.name_en, b.organization_id, b.is_active,
           'org_role'::text
    FROM public.branches b
    JOIN public.organization_members om ON om.organization_id = b.organization_id
    WHERE om.user_id = p_user_id
      AND om.membership_role IN ('owner', 'admin')
      AND om.is_active = true
      AND b.is_active = true
  ) x
  WHERE p_user_id = auth.uid()
     OR public.is_pos_admin()
     OR public.user_may_access_branch(x.branch_id)
  ORDER BY x.branch_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_branch_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_branch_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_branch_access(uuid) TO authenticated, service_role;
