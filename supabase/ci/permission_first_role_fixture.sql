-- CI-only fixture for permission-first authorization tests.
-- This does NOT run on Supabase Production. It grants only the explicit
-- role-management capability; individual tests grant any delegated capability
-- they need inside their rollback-only transaction.
UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb)
  || '["roles.permissions.manage"]'::jsonb
WHERE role = 'branch_manager'
  AND NOT COALESCE(permissions, '[]'::jsonb) ? 'roles.permissions.manage';

-- Owned-localhost business-cycle fixtures exercise each order type. This is
-- never applied to production and is not a role migration/default for users.
UPDATE public.roles SET permissions=permissions || '["pos.order.dine_in","pos.order.takeaway","pos.order.drive_thru","pos.order.delivery"]'::jsonb
WHERE role IN ('cashier','branch_manager');
