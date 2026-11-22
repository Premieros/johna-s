-- Approved product SELECT policy optimization; source and rollback rehearsed.
-- Only statement-invariant authorization calls are cached. Branch checks stay per row.
-- Source verified against Johna's production on 2026-11-13.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.products'::regclass
      AND polname = 'auth_select_products' AND polcmd = 'r' AND polpermissive
      AND polroles = ARRAY['authenticated'::regrole::oid]
      AND polwithcheck IS NULL
      AND md5(pg_get_expr(polqual, polrelid)) = 'e96c22e7c7f6095be27a0f83f2f22115'
  ) THEN RAISE EXCEPTION 'PRODUCT_READ_POLICY_SOURCE_DRIFT'; END IF;
END;
$guard$;
ALTER POLICY auth_select_products ON public.products USING (
  (SELECT public.is_platform_admin())
  OR (public.user_may_access_branch(branch_id)
      AND ((SELECT public.can_permission('products.view'))
           OR (is_active = true AND (SELECT public.can_permission('pos.view')))))
);
COMMIT;
