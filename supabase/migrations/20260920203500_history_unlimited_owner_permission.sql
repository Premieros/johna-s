BEGIN;

-- Keep the existing Owner contract aligned with the frontend default:
-- Owner has explicit permissions, while Super Admin remains the only implicit bypass.
UPDATE public.roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["history.unlimited"]'::jsonb,
    updated_at = now()
WHERE role = 'owner'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'history.unlimited');

COMMIT;
