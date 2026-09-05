-- P0-B handover hardening.
-- Roles remain labels; Super Admin is the only implicit privileged actor.

-- This schema sentinel only inspects PostgreSQL catalogs and does not need
-- owner privileges. Keep it callable for the production-parity gate while
-- removing SECURITY DEFINER/RLS-bypass semantics.
ALTER FUNCTION public._production_schema_contract_kitchen_v1() SECURITY INVOKER;
REVOKE ALL ON FUNCTION public._production_schema_contract_kitchen_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._production_schema_contract_kitchen_v1() TO anon, authenticated, service_role;

-- Cross-user identity/profile data: authenticated callers may reach the RPC,
-- but only the canonical Super Admin predicate may receive rows.
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
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id, u.email, u.username, u.full_name, u.role, u.is_active,
    u.branch_id, b.name, om.organization_id, o.name, u.created_at
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  LEFT JOIN public.organization_members om ON om.user_id = u.id AND om.is_active = true
  LEFT JOIN public.organizations o ON o.id = om.organization_id
  WHERE public.is_pos_admin()
    AND (
      p_search IS NULL
      OR u.email ILIKE '%' || p_search || '%'
      OR u.username ILIKE '%' || p_search || '%'
      OR u.full_name ILIKE '%' || p_search || '%'
    )
  ORDER BY u.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_super_admin_all_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_all_users(text) TO authenticated, service_role;

-- Global tenant statistics: same explicit Super Admin guard.
CREATE OR REPLACE FUNCTION public.get_super_admin_tenant_stats()
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  is_active boolean,
  created_at timestamptz,
  branch_count bigint,
  user_count bigint,
  total_branches bigint,
  active_branches bigint,
  has_active_subscription boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  WHERE public.is_pos_admin()
  ORDER BY o.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_super_admin_tenant_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_tenant_stats() TO authenticated, service_role;

-- Fail closed for functions created after this migration. New API RPCs must
-- opt in explicitly to anon/authenticated EXECUTE in their own migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
