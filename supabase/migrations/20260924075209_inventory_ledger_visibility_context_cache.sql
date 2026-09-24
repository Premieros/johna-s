BEGIN;

-- Inventory Ledger root performance repair.
-- Preserve Permission-First and historical visibility semantics while removing
-- repeated authorization helper calls from the hot ledger scan.
-- No printing, POS mutation, inventory mutation, KDS, or kitchen routing changes.

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
  v_user_id uuid := auth.uid();
  v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,51),1),51);
  v_is_admin boolean := false;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_history_unlimited boolean := false;
  v_recent_days integer := 7;
  v_historical_percent integer := 30;
  v_cutoff timestamptz;
  v_accessible_branch_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Permission checks are statement-level, not row-level.
  IF NOT public.can_permission('inventory.ledger.view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:inventory.ledger.view';
  END IF;

  v_is_admin := public.is_pos_admin();

  -- Preserve the existing explicit branch mismatch contract.
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  -- Materialize the caller's branch scope once. This is exactly the non-admin
  -- branch set used by user_may_access_branch(): explicit access rows plus the
  -- active user's primary branch.
  IF NOT v_is_admin THEN
    SELECT COALESCE(array_agg(DISTINCT x.branch_id), ARRAY[]::uuid[])
    INTO v_accessible_branch_ids
    FROM (
      SELECT uba.branch_id
      FROM public.user_branch_access uba
      WHERE uba.user_id = v_user_id

      UNION

      SELECT u.branch_id
      FROM public.users u
      WHERE u.id = v_user_id
        AND u.is_active = true
        AND u.branch_id IS NOT NULL
    ) x;
  END IF;

  -- Materialize history capability/settings once. The row-dependent part below
  -- keeps the exact deterministic bucket formula used by financial_row_visible.
  v_history_unlimited := public.can_permission('history.unlimited');

  SELECT
    GREATEST(COALESCE(l.recent_days, 7), 1),
    LEAST(GREATEST(COALESCE(l.historical_percent, 30), 0), 100)
  INTO v_recent_days, v_historical_percent
  FROM private.get_financial_visibility_limits() l;

  v_recent_days := GREATEST(COALESCE(v_recent_days, 7), 1);
  v_historical_percent := LEAST(GREATEST(COALESCE(v_historical_percent, 30), 0), 100);
  v_cutoff := public.history_date_start(
    public.history_business_date() - (v_recent_days - 1)
  );

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
  LEFT JOIN public.products p ON p.id = il.product_id
  LEFT JOIN public.raw_materials rm ON rm.id = il.raw_material_id
  LEFT JOIN public.warehouses w ON w.id = il.warehouse_id

  -- Reference joins reproduce private.financial_reference_visible semantics
  -- without invoking nested SECURITY DEFINER helpers for every scanned row.
  LEFT JOIN public.sales ref_sale
    ON lower(COALESCE(il.reference_type,'')) IN ('sale','refund','sale_refund')
   AND il.reference_id IS NOT NULL
   AND ref_sale.id = il.reference_id
  LEFT JOIN public.purchases ref_purchase
    ON lower(COALESCE(il.reference_type,'')) IN ('purchase','purchase_return')
   AND il.reference_id IS NOT NULL
   AND ref_purchase.id = il.reference_id
  LEFT JOIN public.expenses ref_expense
    ON lower(COALESCE(il.reference_type,'')) = 'expense'
   AND il.reference_id IS NOT NULL
   AND ref_expense.id = il.reference_id
  LEFT JOIN public.customer_payments ref_customer_payment
    ON lower(COALESCE(il.reference_type,'')) = 'customer_payment'
   AND il.reference_id IS NOT NULL
   AND ref_customer_payment.id = il.reference_id
  LEFT JOIN public.sales ref_customer_sale
    ON ref_customer_payment.sale_id IS NOT NULL
   AND ref_customer_sale.id = ref_customer_payment.sale_id
  LEFT JOIN public.supplier_payments ref_supplier_payment
    ON lower(COALESCE(il.reference_type,'')) = 'supplier_payment'
   AND il.reference_id IS NOT NULL
   AND ref_supplier_payment.id = il.reference_id
  LEFT JOIN public.purchases ref_supplier_purchase
    ON ref_supplier_payment.purchase_id IS NOT NULL
   AND ref_supplier_purchase.id = ref_supplier_payment.purchase_id

  CROSS JOIN LATERAL (
    SELECT lower(COALESCE(il.reference_type,'')) AS ref_type
  ) rt

  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN rt.ref_type IN ('sale','refund','sale_refund') AND il.reference_id IS NOT NULL
          THEN ref_sale.id
        WHEN rt.ref_type IN ('purchase','purchase_return') AND il.reference_id IS NOT NULL
          THEN ref_purchase.id
        WHEN rt.ref_type = 'expense' AND il.reference_id IS NOT NULL
          THEN ref_expense.id
        WHEN rt.ref_type = 'customer_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_customer_payment.id IS NULL THEN NULL
            WHEN ref_customer_payment.sale_id IS NOT NULL THEN ref_customer_sale.id
            ELSE ref_customer_payment.id
          END
        WHEN rt.ref_type = 'supplier_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_supplier_payment.id IS NULL THEN NULL
            WHEN ref_supplier_payment.purchase_id IS NOT NULL THEN ref_supplier_purchase.id
            ELSE ref_supplier_payment.id
          END
        ELSE (md5(il.id::text))::uuid
      END AS vis_row_id,

      CASE
        WHEN rt.ref_type IN ('sale','refund','sale_refund') AND il.reference_id IS NOT NULL
          THEN ref_sale.branch_id
        WHEN rt.ref_type IN ('purchase','purchase_return') AND il.reference_id IS NOT NULL
          THEN ref_purchase.branch_id
        WHEN rt.ref_type = 'expense' AND il.reference_id IS NOT NULL
          THEN ref_expense.branch_id
        WHEN rt.ref_type = 'customer_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_customer_payment.id IS NULL THEN NULL
            WHEN ref_customer_payment.sale_id IS NOT NULL THEN ref_customer_sale.branch_id
            ELSE ref_customer_payment.branch_id
          END
        WHEN rt.ref_type = 'supplier_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_supplier_payment.id IS NULL THEN NULL
            WHEN ref_supplier_payment.purchase_id IS NOT NULL THEN ref_supplier_purchase.branch_id
            ELSE ref_supplier_payment.branch_id
          END
        ELSE il.branch_id
      END AS vis_branch_id,

      CASE
        WHEN rt.ref_type IN ('sale','refund','sale_refund') AND il.reference_id IS NOT NULL
          THEN ref_sale.created_at
        WHEN rt.ref_type IN ('purchase','purchase_return') AND il.reference_id IS NOT NULL
          THEN ref_purchase.created_at
        WHEN rt.ref_type = 'expense' AND il.reference_id IS NOT NULL
          THEN ref_expense.created_at
        WHEN rt.ref_type = 'customer_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_customer_payment.id IS NULL THEN NULL
            WHEN ref_customer_payment.sale_id IS NOT NULL THEN ref_customer_sale.created_at
            ELSE ref_customer_payment.created_at
          END
        WHEN rt.ref_type = 'supplier_payment' AND il.reference_id IS NOT NULL
          THEN CASE
            WHEN ref_supplier_payment.id IS NULL THEN NULL
            WHEN ref_supplier_payment.purchase_id IS NOT NULL THEN ref_supplier_purchase.created_at
            ELSE ref_supplier_payment.created_at
          END
        ELSE il.created_at
      END AS vis_created_at
  ) vis

  WHERE
    -- Apply branch scope without a per-row user_may_access_branch() call.
    (
      v_is_admin
      OR il.branch_id = ANY(v_accessible_branch_ids)
    )
    AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
    AND (p_entry_type IS NULL OR p_entry_type = '' OR p_entry_type = 'all' OR il.entry_type = p_entry_type)
    AND (p_min_created_at IS NULL OR il.created_at >= p_min_created_at)
    AND (
      p_before_created_at IS NULL
      OR il.created_at < p_before_created_at
      OR (il.created_at = p_before_created_at AND p_before_id IS NOT NULL AND il.id < p_before_id)
    )

    -- Exact financial_row_visible semantics, using precomputed caller context.
    AND (
      v_is_service_role
      OR (
        vis.vis_row_id IS NOT NULL
        AND vis.vis_branch_id IS NOT NULL
        AND vis.vis_created_at IS NOT NULL
        AND (
          v_is_admin
          OR vis.vis_branch_id = ANY(v_accessible_branch_ids)
        )
        AND (
          v_history_unlimited
          OR vis.vis_created_at >= v_cutoff
          OR (
            ((
              'x' || substr(
                md5(vis.vis_branch_id::text || ':' || vis.vis_row_id::text),
                1,
                8
              )
            )::bit(32)::bigint % 100) < v_historical_percent
          )
        )
      )
    )

    AND (
      v_search IS NULL
      OR COALESCE(il.reference_number,'') ILIKE '%' || v_search || '%'
      OR COALESCE(il.batch_number,'') ILIKE '%' || v_search || '%'
      OR COALESCE(p.name,'') ILIKE '%' || v_search || '%'
      OR COALESCE(rm.name,'') ILIKE '%' || v_search || '%'
      OR COALESCE(w.name,'') ILIKE '%' || v_search || '%'
      OR il.id::text ILIKE '%' || v_search || '%'
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
IS 'Permission-first Inventory Ledger search with statement-level auth/history context, exact referenced financial visibility, full server-side search, and created_at/id keyset pagination.';

COMMIT;
