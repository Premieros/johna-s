-- Guarded, read-only-report optimization; no inventory, sales or print writes.
-- Only references for which financial_reference_visible ignores the row identity
-- may share authorization checks. Unrecognized and null references remain per-row.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.get_raw_material_consumption_report(uuid,date,date)'::regprocedure);
  original text := $old$    WITH visible_ledger AS (
      SELECT il.*
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND (v_to IS NULL OR il.created_at < ((v_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo'))
        AND private.financial_reference_visible(
          il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at
        )
    ),$old$;
  optimized text := $new$    WITH candidate_ledger AS MATERIALIZED (
      SELECT il.*,
        CASE
          WHEN lower(coalesce(il.reference_type,'')) IN (
            'sale','refund','sale_refund','purchase','purchase_return',
            'expense','customer_payment','supplier_payment'
          ) AND il.reference_id IS NOT NULL
            THEN 'ref:' || lower(il.reference_type) || ':' || il.reference_id::text
          ELSE 'row:' || il.id::text
        END AS visibility_key
      FROM public.inventory_ledger il
      WHERE il.branch_id=p_branch_id
        AND il.raw_material_id IS NOT NULL
        AND (v_to IS NULL OR il.created_at < ((v_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo'))
    ),
    visibility_representatives AS MATERIALIZED (
      SELECT DISTINCT ON (visibility_key)
        visibility_key, reference_type, reference_id, id, branch_id, created_at
      FROM candidate_ledger
      ORDER BY visibility_key
    ),
    visible_keys AS MATERIALIZED (
      SELECT visibility_key
      FROM visibility_representatives
      WHERE private.financial_reference_visible(
        reference_type, reference_id, (md5(id::text))::uuid, branch_id, created_at
      )
    ),
    visible_ledger AS MATERIALIZED (
      SELECT il.*
      FROM candidate_ledger il
      JOIN visible_keys USING (visibility_key)
    ),$new$;
BEGIN
  IF md5(definition) <> 'a6129db3abf743a3aa2a3ba9cf13e25e' THEN
    RAISE EXCEPTION 'RAW_REPORT_VISIBILITY_BASELINE_CHANGED';
  END IF;
  IF position(original in definition) = 0 THEN
    RAISE EXCEPTION 'RAW_REPORT_VISIBILITY_PATTERN_MISSING';
  END IF;
  definition := replace(definition, original, optimized);
  EXECUTE definition;
END;
$migration$;
