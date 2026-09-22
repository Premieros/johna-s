BEGIN;

-- Historical integrity repair identified by the 2026-09-22 production audit.
-- Scope is deliberately data-only and forward-only:
-- 1) repair 12 Smouha purchase headers that point at Cleopatra's warehouse,
--    only when nothing from those purchases was received into stock;
-- 2) retire four fully-voided stale order shells that predate the current
--    fully-voided order auto-close guard.
--
-- This migration never edits stock quantities, FIFO batches, ledger values,
-- sale/payment rows, printing, printer routing, or kitchen-send functions.

DO $repair_historical_purchase_warehouse_identity$
DECLARE
  v_smouha uuid := '19c3fd23-d784-455b-8840-f4f2ac619651';
  v_wrong_warehouse uuid := '94d6d447-b910-43d5-b525-87814dd905e1';
  v_target_warehouse uuid := '04348dcc-d24c-4b77-99e5-5c6e29551eec';
  v_ids uuid[] := ARRAY[
    '1096ee43-45f3-4e84-af40-dbebf7c0d7a6',
    '0a1faddc-58ee-4b8e-a0c4-3d44801f5d67',
    '54f0cf03-1ee7-45fd-a6dd-65fc5aa2a3aa',
    '0b92c175-b664-4ddd-a32f-9665864fe6d6',
    'd9270807-e62b-4de2-918f-ad4186e7363d',
    'fecf193f-8e51-4783-8694-bc21b7dc6bd8',
    'f343a01c-60a5-4f17-be19-a8dfef183105',
    '9112217e-a581-400b-9876-07407cdb8fd1',
    'bab71723-3412-4bc3-addd-68985c4fe17a',
    '709ecc72-dc21-4105-8ff2-33d9368154b8',
    '86118940-cd87-4eb8-b305-000d64625f9e',
    '03cd96e2-cfee-4351-a819-0acf21ceb3b3'
  ]::uuid[];
  v_count integer;
  v_updated integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.purchases p
  WHERE p.id = ANY(v_ids)
    AND p.branch_id = v_smouha
    AND p.warehouse_id = v_wrong_warehouse;

  -- Fresh databases and already-repaired databases are intentionally no-op.
  IF v_count = 0 THEN
    RETURN;
  END IF;

  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION
      'HISTORICAL_PURCHASE_REPAIR_PARTIAL_MATCH expected=% actual=%',
      cardinality(v_ids), v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = v_target_warehouse
      AND w.branch_id = v_smouha
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PURCHASE_REPAIR_TARGET_WAREHOUSE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_items pi
    JOIN public.purchases p ON p.id = pi.purchase_id
    WHERE p.id = ANY(v_ids)
      AND (
        COALESCE(pi.received_quantity,0) <> 0
        OR COALESCE(pi.returned_quantity,0) <> 0
      )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PURCHASE_REPAIR_RECEIPT_ACTIVITY_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_items pi
    JOIN public.raw_materials rm ON rm.id = pi.raw_material_id
    WHERE pi.purchase_id = ANY(v_ids)
      AND rm.branch_id IS DISTINCT FROM v_smouha
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PURCHASE_REPAIR_RAW_BRANCH_MISMATCH';
  END IF;

  IF to_regclass('public.purchase_receipts') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.purchase_receipts pr
       WHERE pr.purchase_id = ANY(v_ids)
     ) THEN
    RAISE EXCEPTION 'HISTORICAL_PURCHASE_REPAIR_GRN_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.raw_material_batches x WHERE x.source_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.inventory_unit_entries x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.inventory_ledger x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.raw_material_movements x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.inventory_movements x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.stock_transactions x WHERE x.reference_id = ANY(v_ids)
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PURCHASE_REPAIR_STOCK_EFFECT_FOUND';
  END IF;

  UPDATE public.purchases
  SET warehouse_id = v_target_warehouse
  WHERE id = ANY(v_ids)
    AND branch_id = v_smouha
    AND warehouse_id = v_wrong_warehouse;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION
      'HISTORICAL_PURCHASE_REPAIR_UPDATE_COUNT expected=% actual=%',
      cardinality(v_ids), v_updated;
  END IF;
END;
$repair_historical_purchase_warehouse_identity$;

DO $retire_historical_empty_order_shells$
DECLARE
  v_ids uuid[] := ARRAY[
    'd3c28771-840a-492e-b92d-68b67f5d0813',
    'e3af08f5-3c4e-48d8-8dac-a8c08dc3823b',
    'c94d496a-fb2b-4227-8e17-666a504220e5',
    '700e0fb8-59a0-4ad5-ab21-23af6dfb097b'
  ]::uuid[];
  v_count integer;
  v_updated integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.orders o
  WHERE o.id = ANY(v_ids)
    AND o.status IN ('open','held');

  -- Fresh databases and already-repaired databases are intentionally no-op.
  IF v_count = 0 THEN
    RETURN;
  END IF;

  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION
      'STALE_EMPTY_ORDER_REPAIR_PARTIAL_MATCH expected=% actual=%',
      cardinality(v_ids), v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = ANY(v_ids)
      AND (
        COALESCE(o.payment_status,'unpaid') <> 'unpaid'
        OR o.payment_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'STALE_EMPTY_ORDER_REPAIR_PAYMENT_ACTIVITY_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = ANY(v_ids)
      AND oi.quantity > 0
  ) OR EXISTS (
    SELECT 1
    FROM public.order_kitchen_sends ks
    WHERE ks.order_id = ANY(v_ids)
      AND ks.sent_quantity > 0
  ) THEN
    RAISE EXCEPTION 'STALE_EMPTY_ORDER_REPAIR_EFFECTIVE_ITEM_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT e.order_id,
             COALESCE(sum(e.sent_quantity - e.voided_quantity),0) net_quantity,
             count(*) FILTER (WHERE e.settled_sale_id IS NOT NULL) settled_events
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_id = ANY(v_ids)
      GROUP BY e.order_id
    ) q
    WHERE abs(q.net_quantity) > 0.000001
       OR q.settled_events > 0
  ) THEN
    RAISE EXCEPTION 'STALE_EMPTY_ORDER_REPAIR_NONZERO_OR_SETTLED_KITCHEN_EFFECT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_operations x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.inventory_ledger x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.inventory_movements x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.raw_material_movements x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.stock_transactions x WHERE x.reference_id = ANY(v_ids)
    UNION ALL
    SELECT 1 FROM public.journal_entries x WHERE x.reference_id = ANY(v_ids)
  ) THEN
    RAISE EXCEPTION 'STALE_EMPTY_ORDER_REPAIR_FINANCIAL_OR_STOCK_REFERENCE_FOUND';
  END IF;

  UPDATE public.orders
  SET subtotal = 0,
      total = 0,
      status = 'cancelled',
      kitchen_status = 'cancelled',
      completed_at = COALESCE(completed_at,now()),
      notes = concat_ws(
        E'\n',
        NULLIF(notes,''),
        '[SYSTEM] STALE_EMPTY_ORDER_RETIRED_2026-09-22'
      ),
      updated_at = now()
  WHERE id = ANY(v_ids)
    AND status IN ('open','held');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION
      'STALE_EMPTY_ORDER_REPAIR_UPDATE_COUNT expected=% actual=%',
      cardinality(v_ids), v_updated;
  END IF;

  -- Never free a table solely because a historical shell was retired when a
  -- different live order still owns that table.
  UPDATE public.dining_tables t
  SET status = 'vacant',
      updated_at = now()
  WHERE t.id IN (
      SELECT o.table_id
      FROM public.orders o
      WHERE o.id = ANY(v_ids)
        AND o.table_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders live
      WHERE live.table_id = t.id
        AND live.status IN ('open','held')
        AND live.id <> ALL(v_ids)
    );
END;
$retire_historical_empty_order_shells$;

COMMIT;
