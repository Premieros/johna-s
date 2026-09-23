-- Performance Stabilization: bounded, server-side Inventory Ledger search.
-- Read-only, permission-first, branch-scoped, keyset paginated.
-- No printing, POS mutation, inventory mutation, or kitchen routing changes.

CREATE OR REPLACE FUNCTION public.search_inventory_ledger(
  p_branch_id uuid DEFAULT NULL,
  p_entry_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_created_at timestamptz DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 51
)
RETURNS TABLE(
  id bigint,
  branch_id uuid,
  warehouse_id uuid,
  product_id uuid,
  raw_material_id uuid,
  batch_number text,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric,
  before_qty numeric,
  after_qty numeric,
  entry_type text,
  reference_type text,
  reference_id uuid,
  reference_number text,
  created_at timestamptz,
  product_name text,
  raw_material_name text,
  warehouse_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,51),1),51);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT public.can_permission('inventory.ledger.view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:inventory.ledger.view';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  RETURN QUERY
  SELECT
    il.id,
    il.branch_id,
    il.warehouse_id,
    il.product_id,
    il.raw_material_id,
    il.batch_number::text,
    il.quantity,
    il.unit_cost,
    il.total_cost,
    il.before_qty,
    il.after_qty,
    il.entry_type::text,
    il.reference_type::text,
    il.reference_id,
    il.reference_number::text,
    il.created_at,
    p.name::text AS product_name,
    rm.name::text AS raw_material_name,
    w.name::text AS warehouse_name
  FROM public.inventory_ledger il
  LEFT JOIN public.products p ON p.id=il.product_id
  LEFT JOIN public.raw_materials rm ON rm.id=il.raw_material_id
  LEFT JOIN public.warehouses w ON w.id=il.warehouse_id
  WHERE
    public.user_may_access_branch(il.branch_id)
    AND (p_branch_id IS NULL OR il.branch_id=p_branch_id)
    AND (p_entry_type IS NULL OR p_entry_type='' OR p_entry_type='all' OR il.entry_type=p_entry_type)
    AND (p_min_created_at IS NULL OR il.created_at>=p_min_created_at)
    AND (
      p_before_created_at IS NULL
      OR il.created_at < p_before_created_at
      OR (il.created_at=p_before_created_at AND p_before_id IS NOT NULL AND il.id<p_before_id)
    )
    AND (
      v_search IS NULL
      OR COALESCE(il.reference_number,'') ILIKE '%'||v_search||'%'
      OR COALESCE(il.batch_number,'') ILIKE '%'||v_search||'%'
      OR COALESCE(p.name,'') ILIKE '%'||v_search||'%'
      OR COALESCE(rm.name,'') ILIKE '%'||v_search||'%'
      OR COALESCE(w.name,'') ILIKE '%'||v_search||'%'
      OR il.id::text ILIKE '%'||v_search||'%'
    )
  ORDER BY il.created_at DESC, il.id DESC
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_inventory_ledger(uuid,text,text,timestamptz,timestamptz,bigint,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_inventory_ledger(uuid,text,text,timestamptz,timestamptz,bigint,integer)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.search_inventory_ledger(uuid,text,text,timestamptz,timestamptz,bigint,integer)
IS 'Read-only permission-first Inventory Ledger search with full server-side matching and created_at/id keyset pagination.';
