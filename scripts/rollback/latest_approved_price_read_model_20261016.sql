BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_raw_material_current_prices(uuid,uuid[])'::regprocedure))<>'d51ef659328749e0d649bbe27637cfb7' OR md5((SELECT prosrc FROM pg_proc WHERE oid='public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)'::regprocedure))<>'390ac9e0b2c230ab1f96528c244524cd' THEN RAISE EXCEPTION 'LATEST_PRICE_ROLLBACK_BASELINE_CHANGED'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public._kitchen_approved_price_candidate(p_branch_id uuid, p_raw_material_ids uuid[], p_as_of timestamp with time zone)
 RETURNS TABLE(raw_material_id uuid, branch_id uuid, unit_cost numeric, price_source text, priced_at timestamp with time zone, reference_number text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    rm.id, rm.branch_id, winning.unit_cost, winning.source,
    winning.priced_at, winning.reference_number
  FROM public.raw_materials rm
  CROSS JOIN LATERAL (
    SELECT
      e.unit_cost,e.source,e.priced_at,e.reference_number
    FROM (
      SELECT * FROM (
        SELECT
          il.unit_cost::numeric(18,6) AS unit_cost,
          'purchase'::text AS source,
          il.created_at AS priced_at,
          COALESCE(NULLIF(il.reference_number,''),p.invoice_number)::text AS reference_number,
          il.id::text AS event_id,
          3 AS source_rank
        FROM public.inventory_ledger il
        JOIN public.purchases p
          ON p.id=il.reference_id
         AND il.reference_type='purchase'
        WHERE il.raw_material_id=rm.id
          AND il.branch_id=rm.branch_id
          AND p.branch_id=rm.branch_id
          AND il.entry_type='purchase'
          AND p.status='completed'
          AND COALESCE(il.unit_cost,0)>0
          AND il.created_at<=p_as_of
          AND (
            (auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
            OR private.financial_row_visible(p.id,p.branch_id,p.created_at)
          )
        ORDER BY
          il.created_at DESC NULLS LAST,
          COALESCE(NULLIF(il.reference_number,''),p.invoice_number) DESC NULLS LAST,
          il.id::text DESC
        LIMIT 1
      ) priced_receipt

      UNION ALL

      SELECT * FROM (
        SELECT
          (norm.value->>'stock_unit_cost')::numeric(18,6) AS unit_cost,
          'purchase'::text AS source,
          COALESCE(p.approved_at,pi.created_at,p.created_at) AS priced_at,
          p.invoice_number::text AS reference_number,
          'legacy-purchase:'||pi.id::text AS event_id,
          3 AS source_rank
        FROM public.purchase_items pi
        JOIN public.purchases p ON p.id=pi.purchase_id
        CROSS JOIN LATERAL (
          SELECT public._normalize_raw_purchase_uom(
            pi.raw_material_id,pi.quantity,pi.unit_cost,pi.unit_name
          ) AS value
        ) norm
        WHERE pi.raw_material_id=rm.id
          AND p.branch_id=rm.branch_id
          AND p.status='completed'
          AND COALESCE(pi.unit_cost,0)>0
          AND COALESCE((norm.value->>'success')::boolean,false)
          AND COALESCE((norm.value->>'stock_unit_cost')::numeric,0)>0
          AND COALESCE(p.approved_at,pi.created_at,p.created_at)<=p_as_of
          AND (
            (auth.uid() IS NULL AND current_user IN ('postgres','service_role'))
            OR private.financial_row_visible(p.id,p.branch_id,p.created_at)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.inventory_ledger il
            WHERE il.reference_id=p.id
              AND il.reference_type='purchase'
              AND il.entry_type='purchase'
              AND il.raw_material_id=pi.raw_material_id
          )
        ORDER BY
          COALESCE(p.approved_at,pi.created_at,p.created_at) DESC NULLS LAST,
          p.invoice_number DESC NULLS LAST,
          ('legacy-purchase:'||pi.id::text) DESC
        LIMIT 1
      ) legacy_receipt

      UNION ALL

      SELECT * FROM (
        SELECT
          sci.unit_cost::numeric(18,6) AS unit_cost,
          'stock_count'::text AS source,
          COALESCE(sc.applied_at,sc.approved_at,sc.created_at) AS priced_at,
          sc.count_number::text AS reference_number,
          sci.id::text AS event_id,
          2 AS source_rank
        FROM public.stock_count_items sci
        JOIN public.stock_counts sc ON sc.id=sci.stock_count_id
        WHERE sci.raw_material_id=rm.id
          AND sc.branch_id=rm.branch_id
          AND sc.status='applied'
          AND COALESCE(sci.unit_cost,0)>0
          AND COALESCE(sc.applied_at,sc.approved_at,sc.created_at)<=p_as_of
        ORDER BY
          COALESCE(sc.applied_at,sc.approved_at,sc.created_at) DESC NULLS LAST,
          sc.count_number DESC NULLS LAST,
          sci.id::text DESC
        LIMIT 1
      ) approved_stock_count

      UNION ALL

      SELECT * FROM (
        SELECT
          pe.unit_cost::numeric(18,6) AS unit_cost,
          'pricing'::text AS source,
          pe.priced_at AS priced_at,
          pe.reference_number::text AS reference_number,
          'pricing:'||pe.id::text AS event_id,
          1 AS source_rank
        FROM public.raw_material_price_events pe
        WHERE pe.raw_material_id=rm.id
          AND pe.branch_id=rm.branch_id
          AND pe.unit_cost>0
          AND pe.priced_at<=p_as_of
        ORDER BY
          pe.priced_at DESC NULLS LAST,
          pe.reference_number DESC NULLS LAST,
          ('pricing:'||pe.id::text) DESC
        LIMIT 1
      ) approved_manual_price
    ) e
    ORDER BY
      e.priced_at DESC NULLS LAST,
      e.source_rank,
      e.reference_number DESC NULLS LAST,
      e.event_id DESC
    LIMIT 1
  ) winning
  WHERE p_branch_id IS NOT NULL
    AND p_as_of IS NOT NULL
    AND p_raw_material_ids IS NOT NULL
    AND rm.branch_id=p_branch_id
    AND rm.id=ANY(p_raw_material_ids);
$function$;


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
    WHERE e.unit_cost IS NULL AND rmi.raw_material_id=s.id AND rmi.branch_id=s.branch_id AND rmi.avg_cost>0
    ORDER BY rmi.updated_at DESC NULLS LAST,rmi.id DESC LIMIT 1
  ) i ON e.unit_cost IS NULL
  LEFT JOIN LATERAL (
    SELECT rb.unit_cost,rb.created_at AS priced_at
    FROM public.raw_material_batches rb
    WHERE e.unit_cost IS NULL AND rb.raw_material_id=s.id AND rb.branch_id=s.branch_id AND rb.unit_cost>0
      AND COALESCE(rb.source_type,'') NOT LIKE '%oversold%'
    ORDER BY rb.created_at DESC NULLS LAST,rb.id DESC LIMIT 1
  ) b ON e.unit_cost IS NULL;
$function$;


DROP TRIGGER raw_price_source_insert ON public.inventory_ledger;
DROP TRIGGER raw_price_source_update ON public.inventory_ledger;
DROP TRIGGER raw_price_source_delete ON public.inventory_ledger;
DROP TRIGGER raw_price_source_sync ON public.purchase_items;
DROP TRIGGER raw_price_source_sync ON public.stock_count_items;
DROP TRIGGER raw_price_source_sync ON public.raw_material_price_events;
DROP TRIGGER raw_price_parent_update ON public.purchases;
DROP TRIGGER raw_price_parent_delete ON public.purchases;
DROP TRIGGER raw_price_parent_update ON public.stock_counts;
DROP TRIGGER raw_price_parent_delete ON public.stock_counts;
DROP FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamptz);
DROP TABLE private.raw_approved_price_read_model;
DROP FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid);
DROP FUNCTION private.sync_raw_approved_price_source();
DROP FUNCTION private.sync_raw_approved_price_parent();
COMMIT;
