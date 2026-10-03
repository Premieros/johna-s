-- Raw FIFO debt health observability.
-- Extends the existing JSONB valuation report only.
-- No stock, debt, settlement, ledger, COGS or journal rows are mutated.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT (
    public.can_permission('reports.costing')
    OR public.can_permission('reports.financial')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  RETURN (
    WITH batches AS (
      SELECT
        b.raw_material_id,
        COALESCE(SUM(b.quantity),0) AS current_qty,
        COALESCE(SUM(b.quantity*COALESCE(b.unit_cost,0)),0) AS current_value,
        COUNT(*) FILTER (WHERE b.quantity<>0) AS open_batches
      FROM public.raw_material_batches b
      WHERE b.branch_id=p_branch_id
      GROUP BY b.raw_material_id
    ),
    debt_by_warehouse AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))::numeric AS outstanding_qty,
        COUNT(*) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        )::bigint AS outstanding_rows,
        MIN(d.source_created_at) FILTER (
          WHERE GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0)>0.0001
        ) AS oldest_debt_at
      FROM public.raw_fifo_debts d
      WHERE d.branch_id=p_branch_id
      GROUP BY d.raw_material_id,d.warehouse_id
      HAVING SUM(GREATEST(d.debt_quantity-COALESCE(d.settled_quantity,0),0))>0.0001
    ),
    purchase_receipts AS (
      SELECT
        il.raw_material_id,
        il.warehouse_id,
        MAX(il.created_at) AS last_purchase_receipt_at
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND il.warehouse_id IS NOT NULL
        AND il.quantity>0
        AND (
          COALESCE(il.entry_type,'') IN ('purchase','purchase_receipt')
          OR COALESCE(il.reference_type,'') IN ('purchase','purchase_receipt')
        )
      GROUP BY il.raw_material_id,il.warehouse_id
    ),
    debt_priced AS (
      SELECT
        d.raw_material_id,
        d.warehouse_id,
        d.outstanding_qty,
        d.outstanding_rows,
        d.oldest_debt_at,
        pr.last_purchase_receipt_at,
        public._raw_last_known_fifo_cost(
          d.raw_material_id,
          p_branch_id,
          d.warehouse_id
        )::numeric AS known_cost
      FROM debt_by_warehouse d
      LEFT JOIN purchase_receipts pr
        ON pr.raw_material_id=d.raw_material_id
       AND pr.warehouse_id=d.warehouse_id
    ),
    debt AS (
      SELECT
        dp.raw_material_id,
        SUM(dp.outstanding_qty)::numeric AS outstanding_qty,
        SUM(dp.outstanding_rows)::bigint AS outstanding_rows,
        MIN(dp.oldest_debt_at) AS oldest_debt_at,
        MAX(dp.last_purchase_receipt_at) AS last_purchase_receipt_at,
        COUNT(*)::bigint AS debt_warehouse_count,
        COUNT(*) FILTER (
          WHERE dp.last_purchase_receipt_at IS NULL
        )::bigint AS warehouses_without_receipt_history,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)>0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS priced_debt_qty,
        SUM(CASE
          WHEN COALESCE(dp.known_cost,0)<=0 THEN dp.outstanding_qty
          ELSE 0
        END)::numeric AS unpriced_debt_qty,
        SUM(
          CASE
            WHEN COALESCE(dp.known_cost,0)>0
              THEN dp.outstanding_qty*dp.known_cost
            ELSE 0
          END
        )::numeric AS estimated_debt_value
      FROM debt_priced dp
      GROUP BY dp.raw_material_id
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'raw_material_id',rm.id,
        'raw_material_name',rm.name,
        'raw_material_code',rm.code,
        'unit_name',COALESCE(u.name,''),
        'current_quantity',round(COALESCE(b.current_qty,0),4),
        'fifo_current_unit_cost',round(
          CASE
            WHEN COALESCE(b.current_qty,0)<>0
              THEN COALESCE(b.current_value,0)/NULLIF(b.current_qty,0)
            ELSE 0
          END,
          6
        ),
        'current_inventory_value',round(COALESCE(b.current_value,0),2),
        'latest_authoritative_cost',round(COALESCE((ctx.context->>'unit_cost')::numeric,0),6),
        'price_source',COALESCE(ctx.context->>'source',''),
        'priced_at',ctx.context->>'priced_at',
        'open_fifo_batches',COALESCE(b.open_batches,0),
        'outstanding_fifo_debt_quantity',round(COALESCE(d.outstanding_qty,0),4),
        'outstanding_fifo_debt_rows',COALESCE(d.outstanding_rows,0),
        'oldest_outstanding_debt_at',d.oldest_debt_at,
        'last_purchase_receipt_at',d.last_purchase_receipt_at,
        'fifo_debt_warehouse_count',COALESCE(d.debt_warehouse_count,0),
        'fifo_debt_warehouses_without_receipt_history',COALESCE(d.warehouses_without_receipt_history,0),
        'unpriced_fifo_debt_quantity',round(COALESCE(d.unpriced_debt_qty,0),4),
        'fifo_debt_estimated_unit_cost',round(
          CASE
            WHEN COALESCE(d.priced_debt_qty,0)>0
              THEN COALESCE(d.estimated_debt_value,0)/NULLIF(d.priced_debt_qty,0)
            ELSE 0
          END,
          6
        ),
        'estimated_fifo_debt_value',round(COALESCE(d.estimated_debt_value,0),2),
        'fifo_debt_pricing_coverage_pct',round(
          CASE
            WHEN COALESCE(d.outstanding_qty,0)>0
              THEN COALESCE(d.priced_debt_qty,0)*100.0/NULLIF(d.outstanding_qty,0)
            ELSE 100
          END,
          2
        ),
        'has_unpriced_fifo_debt',COALESCE(d.unpriced_debt_qty,0)>0.0001,
        'has_missing_purchase_receipt_history',COALESCE(d.warehouses_without_receipt_history,0)>0,
        'fifo_debt_status',
          CASE
            WHEN COALESCE(d.outstanding_qty,0)<=0.0001 THEN 'OK'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001
              AND COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'UNPRICED_NO_RECEIPT'
            WHEN COALESCE(d.unpriced_debt_qty,0)>0.0001 THEN 'UNPRICED'
            WHEN COALESCE(d.warehouses_without_receipt_history,0)>0
              THEN 'NO_RECEIPT_HISTORY'
            ELSE 'OUTSTANDING'
          END
      )
      ORDER BY rm.name
    ),'[]'::jsonb)
    FROM public.raw_materials rm
    LEFT JOIN public.units u ON u.id=rm.unit_id
    LEFT JOIN batches b ON b.raw_material_id=rm.id
    LEFT JOIN debt d ON d.raw_material_id=rm.id
    CROSS JOIN LATERAL (
      SELECT public._raw_cost_context_for_costing(rm.id,p_branch_id) AS context
    ) ctx
    WHERE rm.branch_id=p_branch_id
      AND (
        rm.is_active
        OR COALESCE(b.current_qty,0)<>0
        OR COALESCE(d.outstanding_qty,0)>0.0001
      )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_current_raw_material_valuation(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_raw_material_valuation(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_current_raw_material_valuation(uuid) IS
  'Current raw valuation plus read-only FIFO debt health. Debt health is branch/warehouse scoped, uses estimate-only known cost, and never mutates stock or accounting history.';

NOTIFY pgrst, 'reload schema';

COMMIT;
