-- Critical stability monitor.
-- Read-only by contract: this file must remain SELECT/CTE only.
-- It is safe to run against Production for point-in-time integrity inspection.

WITH
duplicate_open_shifts AS (
  SELECT count(*)::int affected_branches
  FROM (
    SELECT branch_id
    FROM public.shifts
    WHERE status='open'
    GROUP BY branch_id
    HAVING count(*)>1
  ) q
),
stale_empty_open_orders AS (
  SELECT count(*)::int rows
  FROM public.orders o
  WHERE o.status IN ('open','held')
    AND o.created_at < now()-interval '15 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id AND oi.quantity>0
    )
),
vacant_tables_with_effective_orders AS (
  SELECT count(*)::int rows
  FROM public.dining_tables t
  WHERE lower(coalesce(t.status,'')) IN ('vacant','available','free')
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id=t.id
        AND o.status IN ('open','held')
        AND EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id=o.id AND oi.quantity>0
        )
    )
),
occupied_tables_without_effective_orders AS (
  SELECT count(*)::int rows
  FROM public.dining_tables t
  WHERE lower(coalesce(t.status,''))='occupied'
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id=t.id
        AND o.status IN ('open','held')
        AND EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.order_id=o.id AND oi.quantity>0
        )
    )
),
purchase_warehouse_branch_mismatch AS (
  SELECT count(*)::int rows
  FROM public.purchases p
  JOIN public.warehouses w ON w.id=p.warehouse_id
  WHERE p.branch_id IS DISTINCT FROM w.branch_id
),
sale_warehouse_branch_mismatch AS (
  SELECT count(*)::int rows
  FROM public.sales s
  JOIN public.warehouses w ON w.id=s.warehouse_id
  WHERE s.warehouse_id IS NOT NULL
    AND s.branch_id IS DISTINCT FROM w.branch_id
),
order_warehouse_branch_mismatch AS (
  SELECT count(*)::int rows
  FROM public.orders o
  JOIN public.warehouses w ON w.id=o.inventory_warehouse_id
  WHERE o.inventory_warehouse_id IS NOT NULL
    AND o.branch_id IS DISTINCT FROM w.branch_id
),
raw_inventory_warehouse_branch_mismatch AS (
  SELECT count(*)::int rows
  FROM public.raw_material_warehouse_inventory r
  JOIN public.warehouses w ON w.id=r.warehouse_id
  WHERE r.branch_id IS DISTINCT FROM w.branch_id
),
raw_batch_quantity_mismatch AS (
  SELECT count(*)::int rows
  FROM (
    WITH b AS (
      SELECT raw_material_id,branch_id,warehouse_id,sum(quantity)::numeric batch_qty
      FROM public.raw_material_batches
      GROUP BY raw_material_id,branch_id,warehouse_id
    ),
    i AS (
      SELECT raw_material_id,branch_id,warehouse_id,quantity::numeric inventory_qty
      FROM public.raw_material_warehouse_inventory
    )
    SELECT 1
    FROM i
    FULL JOIN b USING(raw_material_id,branch_id,warehouse_id)
    WHERE abs(coalesce(i.inventory_qty,0)-coalesce(b.batch_qty,0))>0.0001
  ) q
),
raw_fifo_pending_adjustments AS (
  SELECT
    count(*) FILTER (WHERE abs(exact_delta-posted_delta)>0.01)::int rows,
    coalesce(round(sum(exact_delta-posted_delta),2),0)::numeric net_delta
  FROM public.raw_fifo_stock_adjustments
),
unbalanced_journal_entries AS (
  SELECT count(*)::int rows
  FROM (
    SELECT je.id
    FROM public.journal_entries je
    LEFT JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id
    GROUP BY je.id
    HAVING abs(coalesce(sum(jel.debit),0)-coalesce(sum(jel.credit),0))>0.01
  ) q
),
sale_payment_detail_mismatch AS (
  SELECT count(*)::int rows
  FROM (
    SELECT s.id
    FROM public.sales s
    JOIN public.sale_payments sp ON sp.sale_id=s.id
    GROUP BY s.id,s.paid_amount,s.refunded_amount
    HAVING abs(coalesce(s.paid_amount,0)-coalesce(sum(sp.amount),0))>0.01
        OR abs(coalesce(s.refunded_amount,0)-coalesce(sum(sp.refunded_amount),0))>0.01
  ) q
),
sale_item_refund_integrity AS (
  SELECT count(*)::int rows
  FROM public.sale_items si
  WHERE si.refunded_quantity<0
     OR si.refunded_amount<0
     OR si.refunded_quantity>si.quantity+0.0001
     OR (si.total>=0 AND si.refunded_amount>si.total+0.01)
),
live_kitchen_inventory_mismatch AS (
  WITH send AS (
    SELECT order_item_id,sum(sent_quantity)::numeric sent_qty
    FROM public.order_kitchen_sends
    GROUP BY order_item_id
  ),
  pending AS (
    SELECT order_item_id,
           coalesce(
             sum(greatest(sent_quantity-voided_quantity,0))
             FILTER (WHERE settled_sale_id IS NULL),
             0
           )::numeric pending_qty
    FROM public.order_kitchen_inventory_events
    GROUP BY order_item_id
  )
  SELECT count(*)::int rows
  FROM public.order_items oi
  JOIN public.orders o ON o.id=oi.order_id AND o.status IN ('open','held')
  LEFT JOIN send s ON s.order_item_id=oi.id
  LEFT JOIN pending p ON p.order_item_id=oi.id
  WHERE abs(coalesce(s.sent_qty,0)-coalesce(p.pending_qty,0))>0.0001
),
stale_active_print_jobs AS (
  SELECT count(*)::int rows
  FROM public.cloud_print_jobs
  WHERE status IN ('pending','claimed','printing')
    AND created_at<now()-interval '10 minutes'
)
SELECT jsonb_build_object(
  'generated_at',now(),
  'duplicate_open_shift_branches',(SELECT affected_branches FROM duplicate_open_shifts),
  'stale_empty_open_orders',(SELECT rows FROM stale_empty_open_orders),
  'vacant_tables_with_effective_orders',(SELECT rows FROM vacant_tables_with_effective_orders),
  'occupied_tables_without_effective_orders',(SELECT rows FROM occupied_tables_without_effective_orders),
  'purchase_warehouse_branch_mismatch',(SELECT rows FROM purchase_warehouse_branch_mismatch),
  'sale_warehouse_branch_mismatch',(SELECT rows FROM sale_warehouse_branch_mismatch),
  'order_warehouse_branch_mismatch',(SELECT rows FROM order_warehouse_branch_mismatch),
  'raw_inventory_warehouse_branch_mismatch',(SELECT rows FROM raw_inventory_warehouse_branch_mismatch),
  'raw_batch_quantity_mismatch',(SELECT rows FROM raw_batch_quantity_mismatch),
  'raw_fifo_unreconciled_rows',(SELECT rows FROM raw_fifo_pending_adjustments),
  'raw_fifo_pending_net_delta',(SELECT net_delta FROM raw_fifo_pending_adjustments),
  'unbalanced_journal_entries',(SELECT rows FROM unbalanced_journal_entries),
  'sale_payment_detail_mismatch',(SELECT rows FROM sale_payment_detail_mismatch),
  'sale_item_refund_integrity_violations',(SELECT rows FROM sale_item_refund_integrity),
  'live_kitchen_inventory_mismatch',(SELECT rows FROM live_kitchen_inventory_mismatch),
  'stale_active_print_jobs',(SELECT rows FROM stale_active_print_jobs)
) AS audit;
