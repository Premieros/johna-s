-- Restore the exact previously captured product SELECT predicate.
-- Review current policy for intervening changes before using this rollback.
-- Does not change grants, policy roles, branch helpers or write policies.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $source$
BEGIN
  IF (SELECT md5(pg_get_expr(polqual, polrelid)) FROM pg_policy
      WHERE polrelid = 'public.products'::regclass AND polname = 'auth_select_products')
      IS DISTINCT FROM '526770ea209aa0d85ff45bac32efbe7a'
  THEN RAISE EXCEPTION 'PRODUCT_READ_ROLLBACK_SOURCE_DRIFT'; END IF;
END;
$source$;
ALTER POLICY auth_select_products ON public.products USING (
  public.is_platform_admin()
  OR (public.user_may_access_branch(branch_id)
      AND (public.can_permission('products.view')
           OR (is_active = true AND public.can_permission('pos.view'))))
);
DO $guard$
BEGIN
  IF (SELECT md5(pg_get_expr(polqual, polrelid)) FROM pg_policy
      WHERE polrelid = 'public.products'::regclass AND polname = 'auth_select_products')
      IS DISTINCT FROM 'e96c22e7c7f6095be27a0f83f2f22115'
  THEN RAISE EXCEPTION 'PRODUCT_READ_ROLLBACK_DIGEST_MISMATCH'; END IF;
END;
$guard$;
COMMIT;
