-- Rollback for reviewed raw price read-reuse change. Run only with approved production change.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.get_raw_material_current_prices(p_branch_id uuid DEFAULT NULL::uuid, p_raw_material_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(raw_material_id uuid, branch_id uuid, unit_cost numeric, price_source text, priced_at timestamp with time zone, reference_number text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scoped AS MATERIALIZED (
    SELECT rm.* FROM public.raw_materials rm
    WHERE (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
      AND (p_raw_material_ids IS NULL OR rm.id = ANY(p_raw_material_ids))
  ), events(event_id,raw_material_id,branch_id,unit_cost,source,priced_at,reference_number,detail,source_rank) AS (
  SELECT
    il.id::text AS event_id,
    il.raw_material_id,
    il.branch_id,
    il.unit_cost::numeric(18,6),
    'purchase'::text AS source,
    il.created_at AS priced_at,
    COALESCE(NULLIF(il.reference_number, ''), p.invoice_number)::text,
    s.name::text,
    3
  FROM public.inventory_ledger il
  JOIN public.purchases p
    ON p.id = il.reference_id
   AND il.reference_type = 'purchase'
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE il.raw_material_id IS NOT NULL
    AND il.entry_type = 'purchase'
    AND p.status = 'completed'
    AND ((auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
      OR private.financial_row_visible(p.id,p.branch_id,p.created_at))
    AND COALESCE(il.unit_cost, 0) > 0
    AND (p_raw_material_ids IS NULL OR il.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR il.branch_id = p_branch_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'legacy-purchase:' || pi.id::text,
    pi.raw_material_id,
    p.branch_id,
    (norm.value->>'stock_unit_cost')::numeric(18,6),
    'purchase'::text,
    COALESCE(p.approved_at, pi.created_at, p.created_at),
    p.invoice_number::text,
    s.name::text,
    3
  FROM public.purchase_items pi
  JOIN public.purchases p ON p.id = pi.purchase_id
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  CROSS JOIN LATERAL (
    SELECT public._normalize_raw_purchase_uom(
      pi.raw_material_id,
      pi.quantity,
      pi.unit_cost,
      pi.unit_name
    ) AS value
  ) norm
  WHERE pi.raw_material_id IS NOT NULL
    AND p.status = 'completed'
    AND ((auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
      OR private.financial_row_visible(p.id,p.branch_id,p.created_at))
    AND COALESCE(pi.unit_cost, 0) > 0
    AND COALESCE((norm.value->>'success')::boolean, false)
    AND COALESCE((norm.value->>'stock_unit_cost')::numeric, 0) > 0
    AND (p_raw_material_ids IS NULL OR pi.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_ledger il
      WHERE il.reference_id = p.id
        AND il.reference_type = 'purchase'
        AND il.entry_type = 'purchase'
        AND il.raw_material_id = pi.raw_material_id
    )

  UNION ALL

  SELECT
    sci.id::text,
    sci.raw_material_id,
    sc.branch_id,
    sci.unit_cost::numeric(18,6),
    'stock_count'::text,
    COALESCE(sc.applied_at, sc.approved_at, sc.created_at),
    sc.count_number::text,
    sci.reason::text,
    2
  FROM public.stock_count_items sci
  JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
  WHERE sci.raw_material_id IS NOT NULL
    AND sc.status = 'applied'
    AND COALESCE(sci.unit_cost, 0) > 0
    AND (p_raw_material_ids IS NULL OR sci.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)

  UNION ALL

  SELECT
    'pricing:' || pe.id::text,
    pe.raw_material_id,
    pe.branch_id,
    pe.unit_cost::numeric(18,6),
    'pricing'::text,
    pe.priced_at,
    pe.reference_number::text,
    pe.detail::text,
    1
  FROM public.raw_material_price_events pe
  WHERE pe.unit_cost > 0
    AND (p_raw_material_ids IS NULL OR pe.raw_material_id = ANY(p_raw_material_ids))
    AND (p_branch_id IS NULL OR pe.branch_id = p_branch_id)
  ), latest AS MATERIALIZED (
    SELECT DISTINCT ON (e.raw_material_id, e.branch_id) e.*
    FROM events e JOIN scoped s ON s.id=e.raw_material_id AND s.branch_id=e.branch_id
    WHERE e.unit_cost > 0
    ORDER BY e.raw_material_id,e.branch_id,e.priced_at DESC NULLS LAST,
      e.source_rank,e.reference_number DESC NULLS LAST,e.event_id DESC
  )
  SELECT s.id,s.branch_id,
    COALESCE(e.unit_cost,b.unit_cost,i.unit_cost,NULLIF(GREATEST(s.default_cost,0),0)),
    CASE WHEN e.unit_cost IS NOT NULL THEN e.source
      WHEN b.unit_cost IS NOT NULL THEN 'last_batch'
      WHEN i.unit_cost IS NOT NULL THEN 'inventory_average'
      WHEN s.default_cost > 0 THEN 'default_cost' ELSE 'unpriced' END,
    COALESCE(e.priced_at,b.priced_at,i.priced_at),e.reference_number
  FROM scoped s
  LEFT JOIN latest e ON e.raw_material_id=s.id AND e.branch_id=s.branch_id
  LEFT JOIN LATERAL (
    SELECT rmi.avg_cost AS unit_cost,rmi.updated_at AS priced_at
    FROM public.raw_material_inventory rmi
    WHERE rmi.raw_material_id=s.id AND rmi.branch_id=s.branch_id AND rmi.avg_cost>0
    ORDER BY rmi.updated_at DESC NULLS LAST,rmi.id DESC LIMIT 1
  ) i ON e.unit_cost IS NULL
  LEFT JOIN LATERAL (
    SELECT rb.unit_cost,rb.created_at AS priced_at
    FROM public.raw_material_batches rb
    WHERE rb.raw_material_id=s.id AND rb.branch_id=s.branch_id AND rb.unit_cost>0
      AND COALESCE(rb.source_type,'') NOT LIKE '%oversold%'
    ORDER BY rb.created_at DESC NULLS LAST,rb.id DESC LIMIT 1
  ) b ON e.unit_cost IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_raw_material_valuation(p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
        COALESCE(cp.unit_cost,0)::numeric AS known_cost
      FROM debt_by_warehouse d
      LEFT JOIN public.get_raw_material_current_prices(p_branch_id) cp
        ON cp.raw_material_id=d.raw_material_id AND cp.branch_id=p_branch_id
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

NOTIFY pgrst, 'reload schema';

