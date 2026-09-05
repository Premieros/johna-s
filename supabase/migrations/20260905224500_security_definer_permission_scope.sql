-- P0-B SECURITY DEFINER follow-up.
-- Close confirmed permission/scope gaps without changing public RPC signatures.

CREATE OR REPLACE FUNCTION public.update_branch(
  p_branch_id uuid,
  p_name text DEFAULT NULL::text,
  p_name_en text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('branches.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE public.branches
  SET name = COALESCE(p_name, name),
      name_en = COALESCE(p_name_en, name_en),
      address = COALESCE(p_address, address),
      phone = COALESCE(p_phone, phone),
      is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_branch_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_UPDATE_FAILED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_branch(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('branches.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE public.branches
  SET is_active = false
  WHERE id = p_branch_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'BRANCH_DEACTIVATE_FAILED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cost_history(
  p_product_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  product_id uuid,
  old_cost numeric,
  new_cost numeric,
  changed_at timestamptz,
  changed_by text,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    ch.id,
    ch.product_id,
    ch.old_cost,
    ch.new_cost,
    ch.changed_at,
    COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    ch.source
  FROM public.product_cost_history ch
  JOIN public.products p ON p.id = ch.product_id
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id
    AND auth.uid() IS NOT NULL
    AND public.can_permission('reports.costing')
    AND (
      public.is_pos_admin()
      OR (p.branch_id IS NOT NULL AND public.user_may_access_branch(p.branch_id))
    )
  ORDER BY ch.changed_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
$function$;

CREATE OR REPLACE FUNCTION public.get_production_variance(
  p_unit_id uuid,
  p_branch_id uuid DEFAULT public.get_branch_id()
)
RETURNS TABLE(
  raw_material_id uuid,
  raw_material_name text,
  theoretical_qty numeric,
  actual_qty numeric,
  variance numeric,
  variance_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.can_permission('reports.costing')
     OR p_branch_id IS NULL
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT
      iur.raw_material_id,
      rm.name AS rm_name,
      iur.quantity AS theoretical_per_unit,
      COALESCE(SUM(iue.quantity) FILTER (WHERE iue.entry_type = 'production'), 0) AS produced_units
    FROM public.inventory_unit_recipes iur
    JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    LEFT JOIN public.inventory_unit_entries iue
      ON iue.unit_id = iur.unit_id
     AND iue.entry_type = 'production'
    WHERE iur.unit_id = p_unit_id
    GROUP BY iur.raw_material_id, rm.name, iur.quantity
  )
  SELECT
    t.raw_material_id,
    t.rm_name::text,
    (t.theoretical_per_unit * ABS(t.produced_units))::numeric AS theoretical_qty,
    COALESCE((
      SELECT ABS(SUM(rm_inv.quantity))
      FROM public.raw_material_batches rm_inv
      WHERE rm_inv.raw_material_id = t.raw_material_id
        AND rm_inv.branch_id = p_branch_id
        AND rm_inv.batch_number LIKE 'PRD-%'
    ), 0)::numeric AS actual_qty,
    (COALESCE((
      SELECT ABS(SUM(rm_inv.quantity))
      FROM public.raw_material_batches rm_inv
      WHERE rm_inv.raw_material_id = t.raw_material_id
        AND rm_inv.branch_id = p_branch_id
        AND rm_inv.batch_number LIKE 'PRD-%'
    ), 0) - (t.theoretical_per_unit * ABS(t.produced_units)))::numeric AS variance,
    CASE
      WHEN (t.theoretical_per_unit * ABS(t.produced_units)) > 0 THEN
        ROUND((
          (COALESCE((
            SELECT ABS(SUM(rm_inv.quantity))
            FROM public.raw_material_batches rm_inv
            WHERE rm_inv.raw_material_id = t.raw_material_id
              AND rm_inv.branch_id = p_branch_id
              AND rm_inv.batch_number LIKE 'PRD-%'
          ), 0) - (t.theoretical_per_unit * ABS(t.produced_units)))
          / (t.theoretical_per_unit * ABS(t.produced_units)) * 100
        ), 2)
      ELSE 0
    END::numeric AS variance_pct
  FROM totals t;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_branch(uuid,text,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cost_history(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_production_variance(uuid,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_branch(uuid,text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_branch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cost_history(uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_production_variance(uuid,uuid) TO authenticated, service_role;
