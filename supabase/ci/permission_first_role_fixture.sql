-- CI-only fixture for permission-first authorization tests.
-- This does NOT run on Supabase Production. It grants only the explicit
-- role-management capability; individual tests grant any delegated capability
-- they need inside their rollback-only transaction.
UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb)
  || '["roles.permissions.manage"]'::jsonb
WHERE role = 'branch_manager'
  AND NOT COALESCE(permissions, '[]'::jsonb) ? 'roles.permissions.manage';
