-- ERP-05 Waste Center completion.
-- Forward-only migration. Do not rewrite historical waste migrations.
-- Production apply remains gated by exact-head CI + explicit approval.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Repair/seed operational waste categories idempotently.
-- ---------------------------------------------------------------------
DO $erp05$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.waste_categories
    WHERE name = 'هالك مraw'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.waste_categories
    WHERE name = 'هالك خامات'
  ) THEN
    UPDATE public.waste_categories
    SET name = 'هالك خامات',
        name_en = 'Raw Material Waste',
        is_active = true
    WHERE name = 'هالك مraw';
  ELSIF EXISTS (
    SELECT 1 FROM public.waste_categories
    WHERE name = 'هالك مraw'
  ) THEN
    UPDATE public.waste_categories
    SET is_active = false
    WHERE name = 'هالك مraw';
  END IF;
END;
$erp05$;

INSERT INTO public.waste_categories (name, name_en, is_active)
VALUES
  ('هالك خامات', 'Raw Material Waste', true),
  ('هالك منتج', 'Finished Goods Waste', true),
  ('هالك مطبخ', 'Kitchen Waste', true),
  ('منتهي الصلاحية', 'Expired', true),
  ('تالف', 'Damaged', true)
ON CONFLICT (name) DO UPDATE
SET name_en = EXCLUDED.name_en,
    is_active = true;

UPDATE public.waste_categories
SET is_active = false
WHERE name = 'هالك إنتاج'
  AND COALESCE(name_en, 'Production Waste') = 'Production Waste';

-- ---------------------------------------------------------------------
-- 2. Creation contract:
--    - legacy production waste is read-only;
--    - employee attribution defaults to authenticated actor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_waste_entry(
  p_branch_id uuid,
  p_waste_category_id uuid,
  p_waste_type text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reason text DEFAULT NULL,
  p_raw_material_id uuid DEFAULT NULL,
  p_inventory_unit_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid := gen_random_uuid();
  v_target_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('waste.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED:waste.create'; END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;

  IF p_waste_type = 'production' THEN
    RAISE EXCEPTION 'LEGACY_PRODUCTION_WASTE_READ_ONLY';
  END IF;
  IF p_waste_type NOT IN ('raw_material','finished_good','expired','damaged') THEN
    RAISE EXCEPTION 'INVALID_WASTE_TYPE';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_WASTE_QUANTITY'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  IF p_raw_material_id IS NOT NULL THEN RAISE EXCEPTION 'RAW_MATERIAL_TARGET_DEPRECATED:use_inventory_unit'; END IF;
  IF (p_product_id IS NULL) = (p_inventory_unit_id IS NULL) THEN RAISE EXCEPTION 'EXACTLY_ONE_WASTE_TARGET_REQUIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_BRANCH_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.waste_categories c
    WHERE c.id = p_waste_category_id
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'WASTE_CATEGORY_NOT_FOUND';
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT branch_id
    INTO v_target_branch
    FROM public.products
    WHERE id = p_product_id
      AND is_active = true;
  ELSE
    SELECT branch_id
    INTO v_target_branch
    FROM public.inventory_units
    WHERE id = p_inventory_unit_id
      AND is_active = true;
  END IF;

  IF NOT FOUND OR (v_target_branch IS NOT NULL AND v_target_branch <> p_branch_id) THEN
    RAISE EXCEPTION 'WASTE_TARGET_BRANCH_MISMATCH';
  END IF;

  INSERT INTO public.waste_entries(
    id,
    branch_id,
    waste_category_id,
    waste_type,
    inventory_unit_id,
    product_id,
    quantity,
    unit_cost,
    reason,
    warehouse_id,
    employee_id,
    created_by,
    status
  )
  VALUES (
    v_id,
    p_branch_id,
    p_waste_category_id,
    p_waste_type,
    p_inventory_unit_id,
    p_product_id,
    p_quantity,
    GREATEST(COALESCE(p_unit_cost, 0), 0),
    NULLIF(trim(p_reason), ''),
    p_warehouse_id,
    COALESCE(p_employee_id, auth.uid()),
    auth.uid(),
    'pending'
  );

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'create',
    'waste_entry',
    v_id,
    jsonb_build_object(
      'waste_type', p_waste_type,
      'quantity', p_quantity,
      'warehouse_id', p_warehouse_id,
      'product_id', p_product_id,
      'inventory_unit_id', p_inventory_unit_id,
      'employee_id', COALESCE(p_employee_id, auth.uid())
    ),
    p_branch_id
  );

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Approval contract:
--    - actual FIFO layer cost is authoritative;
--    - batch coverage mismatch fails closed;
--    - inventory-unit waste writes one movement row per consumed FIFO layer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_waste(
  p_waste_id uuid,
  p_approve boolean,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entry public.waste_entries%ROWTYPE;
  v_inventory public.inventory%ROWTYPE;
  v_available numeric(14,4);
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_batch record;
  v_actual_cost numeric(18,6) := 0;
  v_weighted_unit_cost numeric(18,6) := 0;
  v_display_unit_cost numeric(12,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('waste.approve') THEN RAISE EXCEPTION 'PERMISSION_DENIED:waste.approve'; END IF;

  SELECT *
  INTO v_entry
  FROM public.waste_entries
  WHERE id = p_waste_id
  FOR UPDATE;

  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'WASTE_NOT_FOUND'; END IF;
  IF NOT public.user_may_access_branch(v_entry.branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  IF v_entry.status <> 'pending' THEN RAISE EXCEPTION 'WASTE_NOT_PENDING'; END IF;
  IF v_entry.warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  IF (v_entry.product_id IS NULL) = (v_entry.inventory_unit_id IS NULL) THEN RAISE EXCEPTION 'INVALID_WASTE_TARGET'; END IF;

  IF NOT p_approve THEN
    UPDATE public.waste_entries
    SET status = 'rejected',
        rejection_reason = p_rejection_reason,
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_waste_id;

    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
    VALUES (
      auth.uid(),
      'reject',
      'waste_entry',
      p_waste_id,
      jsonb_build_object('status', 'rejected', 'reason', p_rejection_reason),
      v_entry.branch_id
    );
    RETURN;
  END IF;

  IF v_entry.product_id IS NOT NULL THEN
    SELECT *
    INTO v_inventory
    FROM public.inventory
    WHERE product_id = v_entry.product_id
      AND warehouse_id = v_entry.warehouse_id
      AND branch_id = v_entry.branch_id
    FOR UPDATE;

    IF v_inventory.id IS NULL OR v_inventory.quantity < v_entry.quantity THEN
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK:product:%:available:%:required:%',
        v_entry.product_id,
        COALESCE(v_inventory.quantity, 0),
        v_entry.quantity;
    END IF;

    v_available := v_inventory.quantity;

    UPDATE public.inventory
    SET quantity = quantity - v_entry.quantity,
        updated_at = now()
    WHERE id = v_inventory.id;

    v_remaining := v_entry.quantity;

    FOR v_batch IN
      SELECT id, quantity, unit_cost
      FROM public.inventory_batches
      WHERE product_id = v_entry.product_id
        AND warehouse_id = v_entry.warehouse_id
        AND branch_id = v_entry.branch_id
        AND quantity > 0
      ORDER BY expiry_date NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(v_remaining, v_batch.quantity);

      UPDATE public.inventory_batches
      SET quantity = quantity - v_take
      WHERE id = v_batch.id;

      v_actual_cost := v_actual_cost + (v_take * v_batch.unit_cost);
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'FIFO_BATCH_COVERAGE_MISMATCH:product:%:remaining:%',
        v_entry.product_id,
        v_remaining;
    END IF;

    v_weighted_unit_cost := CASE
      WHEN v_entry.quantity > 0 THEN round(v_actual_cost / v_entry.quantity, 6)
      ELSE 0
    END;
    v_display_unit_cost := round(v_weighted_unit_cost, 2);

    INSERT INTO public.inventory_ledger(
      product_id,
      branch_id,
      warehouse_id,
      quantity,
      unit_cost,
      total_cost,
      before_qty,
      after_qty,
      entry_type,
      reference_type,
      reference_id,
      reference_number,
      created_by
    )
    VALUES (
      v_entry.product_id,
      v_entry.branch_id,
      v_entry.warehouse_id,
      -v_entry.quantity,
      v_weighted_unit_cost,
      -round(v_actual_cost, 2),
      v_available,
      v_available - v_entry.quantity,
      'waste',
      'waste',
      p_waste_id,
      'WASTE-' || left(p_waste_id::text, 8),
      auth.uid()
    );

    INSERT INTO public.inventory_movements(
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      reference_id,
      notes,
      branch_id
    )
    VALUES (
      v_entry.product_id,
      v_entry.warehouse_id,
      'waste',
      -v_entry.quantity,
      p_waste_id,
      v_entry.reason,
      v_entry.branch_id
    );
  ELSE
    PERFORM 1
    FROM public.inventory_unit_batches
    WHERE unit_id = v_entry.inventory_unit_id
      AND warehouse_id = v_entry.warehouse_id
      AND branch_id = v_entry.branch_id
    FOR UPDATE;

    SELECT COALESCE(sum(quantity), 0)
    INTO v_available
    FROM public.inventory_unit_batches
    WHERE unit_id = v_entry.inventory_unit_id
      AND warehouse_id = v_entry.warehouse_id
      AND branch_id = v_entry.branch_id;

    IF v_available < v_entry.quantity THEN
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK:inventory_unit:%:available:%:required:%',
        v_entry.inventory_unit_id,
        v_available,
        v_entry.quantity;
    END IF;

    v_remaining := v_entry.quantity;

    FOR v_batch IN
      SELECT id, quantity, unit_cost, batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id = v_entry.inventory_unit_id
        AND warehouse_id = v_entry.warehouse_id
        AND branch_id = v_entry.branch_id
        AND quantity > 0
      ORDER BY expiry_date NULLS LAST, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(v_remaining, v_batch.quantity);

      UPDATE public.inventory_unit_batches
      SET quantity = quantity - v_take
      WHERE id = v_batch.id;

      v_actual_cost := v_actual_cost + (v_take * v_batch.unit_cost);

      INSERT INTO public.inventory_unit_entries(
        unit_id,
        branch_id,
        warehouse_id,
        quantity,
        unit_cost,
        entry_type,
        reference_type,
        reference_id,
        reference_number,
        batch_number,
        created_by
      )
      VALUES (
        v_entry.inventory_unit_id,
        v_entry.branch_id,
        v_entry.warehouse_id,
        -v_take,
        v_batch.unit_cost,
        'waste',
        'waste',
        p_waste_id,
        'WASTE-' || left(p_waste_id::text, 8),
        v_batch.batch_number,
        auth.uid()
      );

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'FIFO_BATCH_COVERAGE_MISMATCH:inventory_unit:%:remaining:%',
        v_entry.inventory_unit_id,
        v_remaining;
    END IF;

    v_weighted_unit_cost := CASE
      WHEN v_entry.quantity > 0 THEN round(v_actual_cost / v_entry.quantity, 6)
      ELSE 0
    END;
    v_display_unit_cost := round(v_weighted_unit_cost, 2);
  END IF;

  UPDATE public.waste_entries
  SET status = 'approved',
      unit_cost = v_display_unit_cost,
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now(),
      rejection_reason = NULL
  WHERE id = p_waste_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'approve',
    'waste_entry',
    p_waste_id,
    jsonb_build_object(
      'status', 'approved',
      'warehouse_id', v_entry.warehouse_id,
      'quantity_deducted', v_entry.quantity,
      'actual_fifo_cost', round(v_actual_cost, 2),
      'weighted_unit_cost', v_weighted_unit_cost,
      'product_id', v_entry.product_id,
      'inventory_unit_id', v_entry.inventory_unit_id
    ),
    v_entry.branch_id
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. Reporting contract:
--    movement cost is authoritative; waste_entries.total_cost is historical fallback.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_waste_report(
  p_branch_id uuid DEFAULT get_branch_id(),
  p_from_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  waste_category text,
  waste_type text,
  total_quantity numeric,
  total_cost numeric,
  entry_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('waste.report') THEN RAISE EXCEPTION 'PERMISSION_DENIED:waste.report'; END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT
      we.id,
      we.branch_id,
      we.waste_type,
      we.quantity,
      we.total_cost AS fallback_total_cost,
      we.product_id,
      we.inventory_unit_id,
      wc.name AS category_name
    FROM public.waste_entries we
    JOIN public.waste_categories wc ON wc.id = we.waste_category_id
    WHERE we.branch_id = p_branch_id
      AND we.status = 'approved'
      AND (p_from_date IS NULL OR we.created_at >= public.history_date_start(p_from_date))
      AND (p_to_date IS NULL OR we.created_at < public.history_date_start(p_to_date + 1))
      AND private.financial_row_visible(we.id, we.branch_id, we.created_at)
  ),
  costed AS (
    SELECT
      s.*,
      CASE
        WHEN s.product_id IS NOT NULL THEN
          COALESCE(
            (
              SELECT round(sum(abs(il.total_cost)), 2)
              FROM public.inventory_ledger il
              WHERE il.entry_type = 'waste'
                AND il.reference_type = 'waste'
                AND il.reference_id = s.id
            ),
            s.fallback_total_cost
          )
        WHEN s.inventory_unit_id IS NOT NULL THEN
          COALESCE(
            (
              SELECT round(sum(abs(iue.quantity) * iue.unit_cost), 2)
              FROM public.inventory_unit_entries iue
              WHERE iue.entry_type = 'waste'
                AND iue.reference_type = 'waste'
                AND iue.reference_id = s.id
            ),
            s.fallback_total_cost
          )
        ELSE s.fallback_total_cost
      END AS authoritative_cost
    FROM scoped s
  )
  SELECT
    c.category_name,
    c.waste_type,
    sum(c.quantity),
    round(sum(COALESCE(c.authoritative_cost, 0)), 2),
    count(*)::bigint
  FROM costed c
  GROUP BY c.category_name, c.waste_type
  ORDER BY round(sum(COALESCE(c.authoritative_cost, 0)), 2) DESC;
END;
$function$;

-- Keep SECURITY DEFINER RPCs off PUBLIC/anon; preserve intended callers.
REVOKE ALL ON FUNCTION public.create_waste_entry(uuid,uuid,text,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_waste_entry(uuid,uuid,text,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_waste(uuid,boolean,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_waste(uuid,boolean,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_waste_report(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_waste_report(uuid,date,date)
  TO authenticated, service_role;

COMMIT;
