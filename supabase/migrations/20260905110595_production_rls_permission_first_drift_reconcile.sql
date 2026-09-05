-- Production-only RLS drift reconciliation discovered by the existing
-- fail-closed Permission-First audit. Keep RLS enabled and replace retired
-- coarse permissions with the canonical granular capabilities.

DROP POLICY IF EXISTS auth_insert_products ON public.products;
DROP POLICY IF EXISTS auth_update_products ON public.products;
DROP POLICY IF EXISTS auth_delete_products ON public.products;

CREATE POLICY auth_insert_products ON public.products
FOR INSERT TO authenticated
WITH CHECK (
  public.is_pos_admin()
  OR (public.can_permission('products.create') AND public.user_may_access_branch(branch_id))
);

CREATE POLICY auth_update_products ON public.products
FOR UPDATE TO authenticated
USING (
  public.is_pos_admin()
  OR (public.can_permission('products.edit') AND public.user_may_access_branch(branch_id))
)
WITH CHECK (
  public.is_pos_admin()
  OR (public.can_permission('products.edit') AND public.user_may_access_branch(branch_id))
);

CREATE POLICY auth_delete_products ON public.products
FOR DELETE TO authenticated
USING (
  public.is_pos_admin()
  OR (public.can_permission('products.delete') AND public.user_may_access_branch(branch_id))
);

DROP POLICY IF EXISTS auth_insert_inventory ON public.inventory;
DROP POLICY IF EXISTS auth_update_inventory ON public.inventory;
DROP POLICY IF EXISTS auth_delete_inventory ON public.inventory;

CREATE POLICY auth_insert_inventory ON public.inventory
FOR INSERT TO authenticated
WITH CHECK (
  public.is_pos_admin()
  OR (public.can_permission('inventory.adjust') AND public.user_may_access_branch(branch_id))
);

CREATE POLICY auth_update_inventory ON public.inventory
FOR UPDATE TO authenticated
USING (
  public.is_pos_admin()
  OR (public.can_permission('inventory.adjust') AND public.user_may_access_branch(branch_id))
)
WITH CHECK (
  public.is_pos_admin()
  OR (public.can_permission('inventory.adjust') AND public.user_may_access_branch(branch_id))
);

CREATE POLICY auth_delete_inventory ON public.inventory
FOR DELETE TO authenticated
USING (
  public.is_pos_admin()
  OR (public.can_permission('inventory.adjust') AND public.user_may_access_branch(branch_id))
);
