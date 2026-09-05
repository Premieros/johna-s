-- P0-B SECURITY DEFINER hardening.
-- These RPCs expose cross-tenant/user information and must be callable only by
-- an authenticated Super Admin. Roles other than super_admin remain labels only.

CREATE OR REPLACE FUNCTION public.get_super_admin_all_users(p_search text DEFAULT NULL::text)
RETURNS TABLE(
  user_id uuid,
  email text,
  username text,
  full_name text,
  role text,
  is_active boolean,
  branch_id uuid,
  branch_name text,
  org_id uuid,
  org_name text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_pos_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:super_admin';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.username,
    u.full_name,
    u.role,
    u.is_active,
    u.branch_id,
    b.name,
    om.organization_id,
    o.name,
    u.created_at
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  LEFT JOIN public.organization_members om
    ON om.user_id = u.id AND om.is_active = true
  LEFT JOIN public.organizations o ON o.id = om.organization_id
  WHERE p_search IS NULL
     OR u.email ILIKE '%' || p_search || '%'
     OR u.username ILIKE '%' || p_search || '%'
     OR u.full_name ILIKE '%' || p_search || '%'
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_all_users(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_super_admin_all_users(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_all_users(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_super_admin_tenant_stats()
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  is_active boolean,
  created_at timestamp with time zone,
  branch_count bigint,
  user_count bigint,
  total_branches bigint,
  active_branches bigint,
  has_active_subscription boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_pos_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:super_admin';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.slug,
    o.is_active,
    o.created_at,
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id),
    (SELECT count(*) FROM public.organization_members om WHERE om.organization_id = o.id AND om.is_active = true),
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id),
    (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id AND b.is_active = true),
    EXISTS (
      SELECT 1
      FROM public.branches b
      JOIN public.branch_subscriptions bs ON bs.branch_id = b.id
      WHERE b.organization_id = o.id
        AND bs.status = 'active'
        AND bs.current_period_ends_at > now()
    )
  FROM public.organizations o
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_tenant_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_super_admin_tenant_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_tenant_stats() TO authenticated, service_role;
