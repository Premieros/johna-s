-- Stability Foundation Phase 6
-- Read-only operational health snapshot for the settings/system-health surface.
-- Reuses existing stability invariants; never mutates printing, KDS, shifts, orders, or accounting.

CREATE OR REPLACE FUNCTION public.get_system_health_snapshot(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid := p_branch_id;
  v_is_admin boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  v_is_admin := public.is_pos_admin();

  IF NOT v_is_admin AND NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF v_branch IS NULL AND NOT v_is_admin THEN
    v_branch := public.get_branch_id();
  END IF;

  IF v_branch IS NOT NULL
     AND NOT v_is_admin
     AND NOT public.user_may_access_branch(v_branch) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  RETURN (
    WITH
    scoped_branches AS (
      SELECT b.id
      FROM public.branches b
      WHERE v_branch IS NULL OR b.id = v_branch
    ),
    active_shifts AS (
      SELECT count(*)::int rows
      FROM public.shifts s
      JOIN scoped_branches b ON b.id=s.branch_id
      WHERE s.status='open'
    ),
    duplicate_open_shifts AS (
      SELECT count(*)::int affected_branches
      FROM (
        SELECT s.branch_id
        FROM public.shifts s
        JOIN scoped_branches b ON b.id=s.branch_id
        WHERE s.status='open'
        GROUP BY s.branch_id
        HAVING count(*)>1
      ) q
    ),
    open_orders AS (
      SELECT count(*)::int rows
      FROM public.orders o
      JOIN scoped_branches b ON b.id=o.branch_id
      WHERE o.status IN ('open','held')
    ),
    stale_empty_open_orders AS (
      SELECT count(*)::int rows
      FROM public.orders o
      JOIN scoped_branches b ON b.id=o.branch_id
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
      JOIN scoped_branches b ON b.id=t.branch_id
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
      JOIN scoped_branches b ON b.id=t.branch_id
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
    unbalanced_journal_entries AS (
      SELECT count(*)::int rows
      FROM (
        SELECT je.id
        FROM public.journal_entries je
        JOIN scoped_branches b ON b.id=je.branch_id
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
        JOIN scoped_branches b ON b.id=s.branch_id
        JOIN public.sale_payments sp ON sp.sale_id=s.id
        GROUP BY s.id,s.paid_amount,s.refunded_amount
        HAVING abs(coalesce(s.paid_amount,0)-coalesce(sum(sp.amount),0))>0.01
            OR abs(coalesce(s.refunded_amount,0)-coalesce(sum(sp.refunded_amount),0))>0.01
      ) q
    ),
    sale_item_refund_integrity AS (
      SELECT count(*)::int rows
      FROM public.sale_items si
      JOIN public.sales s ON s.id=si.sale_id
      JOIN scoped_branches b ON b.id=s.branch_id
      WHERE si.refunded_quantity<0
         OR si.refunded_amount<0
         OR si.refunded_quantity>si.quantity+0.0001
         OR (si.total>=0 AND si.refunded_amount>si.total+0.01)
    ),
    live_kitchen_inventory_mismatch AS (
      WITH send AS (
        SELECT oks.order_item_id,sum(oks.sent_quantity)::numeric sent_qty
        FROM public.order_kitchen_sends oks
        GROUP BY oks.order_item_id
      ),
      pending AS (
        SELECT okie.order_item_id,
               coalesce(
                 sum(greatest(okie.sent_quantity-okie.voided_quantity,0))
                 FILTER (WHERE okie.settled_sale_id IS NULL),
                 0
               )::numeric pending_qty
        FROM public.order_kitchen_inventory_events okie
        GROUP BY okie.order_item_id
      )
      SELECT count(*)::int rows
      FROM public.order_items oi
      JOIN public.orders o ON o.id=oi.order_id AND o.status IN ('open','held')
      JOIN scoped_branches b ON b.id=o.branch_id
      LEFT JOIN send s ON s.order_item_id=oi.id
      LEFT JOIN pending p ON p.order_item_id=oi.id
      WHERE abs(coalesce(s.sent_qty,0)-coalesce(p.pending_qty,0))>0.0001
    ),
    print_queue AS (
      SELECT
        count(*) FILTER (WHERE cpj.status IN ('pending','claimed','printing'))::int active_rows,
        count(*) FILTER (
          WHERE cpj.status IN ('pending','claimed','printing')
            AND cpj.created_at<now()-interval '10 minutes'
        )::int stale_rows
      FROM public.cloud_print_jobs cpj
      JOIN scoped_branches b ON b.id=cpj.branch_id
    ),
    work_auth AS (
      SELECT count(*) FILTER (WHERE wa.status='pending')::int pending_rows
      FROM public.work_authorizations wa
      JOIN scoped_branches b ON b.id=wa.branch_id
    ),
    latest_close AS (
      SELECT max(dc.closed_at) AS closed_at
      FROM public.daily_closes dc
      JOIN scoped_branches b ON b.id=dc.branch_id
      WHERE dc.status='closed'
    )
    SELECT jsonb_build_object(
      'success', true,
      'generated_at', now(),
      'branch_id', v_branch,
      'database_ok', true,
      'active_shifts', (SELECT rows FROM active_shifts),
      'duplicate_open_shift_branches', (SELECT affected_branches FROM duplicate_open_shifts),
      'open_orders', (SELECT rows FROM open_orders),
      'stale_empty_open_orders', (SELECT rows FROM stale_empty_open_orders),
      'vacant_tables_with_effective_orders', (SELECT rows FROM vacant_tables_with_effective_orders),
      'occupied_tables_without_effective_orders', (SELECT rows FROM occupied_tables_without_effective_orders),
      'unbalanced_journal_entries', (SELECT rows FROM unbalanced_journal_entries),
      'sale_payment_detail_mismatch', (SELECT rows FROM sale_payment_detail_mismatch),
      'sale_item_refund_integrity_violations', (SELECT rows FROM sale_item_refund_integrity),
      'live_kitchen_inventory_mismatch', (SELECT rows FROM live_kitchen_inventory_mismatch),
      'active_print_jobs', (SELECT active_rows FROM print_queue),
      'stale_active_print_jobs', (SELECT stale_rows FROM print_queue),
      'pending_work_authorizations', (SELECT pending_rows FROM work_auth),
      'latest_daily_close_at', (SELECT closed_at FROM latest_close)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_system_health_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_health_snapshot(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
