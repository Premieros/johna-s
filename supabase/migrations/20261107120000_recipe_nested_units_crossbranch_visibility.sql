-- Restore the components of manufactured recipes to full-history costing
-- readers in *explicitly accessible* secondary branches. Previously the
-- owner saw all sold invoice lines after the sale_items policy fix, but
-- product_unit_links / inventory_units / nested recipe tables still required
-- get_branch_id(), yielding an incomplete, understated period-close COGS.
--
-- SELECT only, additive: existing policies, history guards, all write
-- permissions, recipe definitions, stocks, financial journals stay unchanged.
-- This does NOT grant branch access; user_may_access_branch is required.
-- Production deployment needs separate explicit owner authorization.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $guard$
DECLARE
  v_expected integer;
BEGIN
  SELECT count(*) INTO v_expected
  FROM pg_policies
  WHERE schemaname='public' AND cmd='SELECT' AND permissive='PERMISSIVE'
    AND roles='{public}'::name[]
    AND (
      (tablename='product_unit_links' AND policyname='pul_branch_read'
        AND md5(qual)='6930a5105152e561ad62994465e9888e') OR
      (tablename='inventory_units' AND policyname='inventory_units_branch_read'
        AND md5(qual)='4e101d673411e28734642e352bc34573') OR
      (tablename='inventory_unit_recipes' AND policyname='iur_branch_read'
        AND md5(qual)='e92e0232bcafcdd5adb3185f45459499') OR
      (tablename='inventory_unit_recipe_units' AND policyname='iuru_branch_read'
        AND md5(qual)='1e6caf987f00db7362c0440785a74558')
    );
  IF v_expected <> 4 THEN RAISE EXCEPTION 'NESTED_RECIPE_RLS_POLICY_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND policyname='report_costing_secondary_branch_select'
      AND tablename IN ('product_unit_links','inventory_units','inventory_unit_recipes','inventory_unit_recipe_units')
  ) THEN RAISE EXCEPTION 'NESTED_RECIPE_RLS_ALREADY_INSTALLED'; END IF;
END
$guard$;

CREATE POLICY report_costing_secondary_branch_select ON public.inventory_units
  FOR SELECT TO authenticated
  USING (
    branch_id IS NOT NULL
    AND (SELECT public.can_permission('reports.view'))
    AND (SELECT public.can_permission('reports.costing'))
    AND (SELECT public.can_permission('sales.view'))
    AND (SELECT public.can_permission('history.unlimited'))
    AND public.user_may_access_branch(branch_id)
  );

CREATE POLICY report_costing_secondary_branch_select ON public.product_unit_links
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_permission('reports.view'))
    AND (SELECT public.can_permission('reports.costing'))
    AND (SELECT public.can_permission('sales.view'))
    AND (SELECT public.can_permission('history.unlimited'))
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id=product_unit_links.product_id
        AND p.branch_id IS NOT NULL
        AND public.user_may_access_branch(p.branch_id)
    )
  );

CREATE POLICY report_costing_secondary_branch_select ON public.inventory_unit_recipes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_permission('reports.view'))
    AND (SELECT public.can_permission('reports.costing'))
    AND (SELECT public.can_permission('sales.view'))
    AND (SELECT public.can_permission('history.unlimited'))
    AND EXISTS (
      SELECT 1 FROM public.inventory_units u
      WHERE u.id=inventory_unit_recipes.unit_id
        AND u.branch_id IS NOT NULL
        AND public.user_may_access_branch(u.branch_id)
    )
  );

CREATE POLICY report_costing_secondary_branch_select ON public.inventory_unit_recipe_units
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_permission('reports.view'))
    AND (SELECT public.can_permission('reports.costing'))
    AND (SELECT public.can_permission('sales.view'))
    AND (SELECT public.can_permission('history.unlimited'))
    AND EXISTS (
      SELECT 1 FROM public.inventory_units parent
      JOIN public.inventory_units child ON child.id=inventory_unit_recipe_units.component_unit_id
        AND child.branch_id=parent.branch_id
      WHERE parent.id=inventory_unit_recipe_units.unit_id
        AND parent.branch_id IS NOT NULL
        AND public.user_may_access_branch(parent.branch_id)
    )
  );
