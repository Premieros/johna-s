-- UNAPPLIED review candidate: caller-RLS purchase reads only.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE definition text; before_body text := $before$  ELSIF p_report_type = 'purchases' THEN
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.invoice_number,t.total,t.returned_amount,t.status,t.created_at,t.supplier_id
      FROM public.purchases t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND (NULLIF(p_filters->>'supplier','') IS NULL OR t.supplier_id=NULLIF(p_filters->>'supplier','')::uuid)
        AND (NULLIF(p_filters->>'buyer','') IS NULL OR t.buyer_id=NULLIF(p_filters->>'buyer','')::uuid)
        AND (NULLIF(p_filters->>'warehouse','') IS NULL OR t.warehouse_id=NULLIF(p_filters->>'warehouse','')::uuid)
        AND (NULLIF(p_filters->>'status','') IS NULL OR t.status=NULLIF(p_filters->>'status',''))
      -- Full export preflight stops scanning after the first disallowed record.
      LIMIT CASE WHEN p_page_size=5001 THEN 5001 ELSE NULL END
    ), page AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY created_at DESC,id DESC
      LIMIT p_page_size OFFSET (p_page::bigint * p_page_size)
    ), details AS (
      SELECT to_jsonb(p) - 'supplier_id' || jsonb_build_object('supplier',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('name',s.name) END) AS row, p.created_at AS sort_date,p.id
      FROM page p
      LEFT JOIN public.suppliers s ON s.id=p.supplier_id
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(row ORDER BY sort_date DESC,id DESC) FROM details),'[]'::jsonb),
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(returned_amount,0),0)),0)) FROM filtered),
      'metrics', (SELECT jsonb_build_object('Original Total',coalesce(sum(coalesce(total,0)),0),'Returned',coalesce(sum(coalesce(returned_amount,0)),0),'Net Purchases',coalesce(sum(greatest(coalesce(total,0)-coalesce(returned_amount,0),0)),0)) FROM filtered)
    ) INTO v_result;
$before$;
after_body text := $after$  ELSIF p_report_type = 'purchases' THEN
    IF COALESCE(NULLIF(p_filters->>'purchase_view',''),'invoice') NOT IN ('invoice','material','category','supplier') THEN
      RAISE EXCEPTION 'REPORT_FILTERS_INVALID';
    END IF;
    IF p_filters->>'purchase_view' IN ('material','category') THEN
      -- Read only the selected period/branch headers, then their caller-visible lines.
      -- Recorded line amounts/returns precede invoice discount/tax; no header duplication.
      WITH headers AS MATERIALIZED (
        SELECT t.id,t.branch_id FROM public.purchases t WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND (NULLIF(p_filters->>'supplier','') IS NULL OR t.supplier_id=NULLIF(p_filters->>'supplier','')::uuid)
        AND (NULLIF(p_filters->>'buyer','') IS NULL OR t.buyer_id=NULLIF(p_filters->>'buyer','')::uuid)
        AND (NULLIF(p_filters->>'warehouse','') IS NULL OR t.warehouse_id=NULLIF(p_filters->>'warehouse','')::uuid)
        AND (NULLIF(p_filters->>'status','') IS NULL OR t.status=NULLIF(p_filters->>'status',''))
      ), lines AS MATERIALIZED (
        SELECT h.id AS purchase_id,h.branch_id,pi.raw_material_id,pi.product_id,
          COALESCE(rm.name,prod.name) AS material_name,rm.category AS material_category,
          pi.unit_name,pi.quantity,COALESCE(pi.returned_quantity,0) AS returned_quantity,
          pi.total,COALESCE(pi.returned_amount,0) AS returned_amount
        FROM headers h JOIN public.purchase_items pi ON pi.purchase_id=h.id
        LEFT JOIN public.raw_materials rm ON rm.id=pi.raw_material_id AND rm.branch_id=h.branch_id
        LEFT JOIN public.products prod ON prod.id=pi.product_id AND prod.branch_id=h.branch_id
        WHERE (NULLIF(p_filters->>'raw_material','') IS NULL OR pi.raw_material_id=NULLIF(p_filters->>'raw_material','')::uuid)
        AND (NULLIF(p_filters->>'material_category','') IS NULL OR rm.category=p_filters->>'material_category')
      ), grouped AS MATERIALIZED (
        SELECT branch_id,
          CASE WHEN p_filters->>'purchase_view'='material' THEN raw_material_id END AS raw_material_id,
          CASE WHEN p_filters->>'purchase_view'='material' THEN product_id END AS product_id,
          CASE WHEN p_filters->>'purchase_view'='material' THEN material_name END AS material_name,
          material_category,
          CASE WHEN p_filters->>'purchase_view'='material' THEN unit_name END AS unit_name,
          CASE WHEN p_filters->>'purchase_view'='material' THEN SUM(quantity) END AS quantity,
          CASE WHEN p_filters->>'purchase_view'='material' THEN SUM(returned_quantity) END AS returned_quantity,
          CASE WHEN p_filters->>'purchase_view'='material' THEN SUM(quantity-returned_quantity) END AS net_quantity,
          SUM(total) AS line_gross,SUM(returned_amount) AS line_returned,
          SUM(GREATEST(total-returned_amount,0)) AS line_net,COUNT(DISTINCT purchase_id) AS invoice_count
        FROM lines GROUP BY branch_id,material_category,
          CASE WHEN p_filters->>'purchase_view'='material' THEN raw_material_id END,
          CASE WHEN p_filters->>'purchase_view'='material' THEN product_id END,
          CASE WHEN p_filters->>'purchase_view'='material' THEN material_name END,
          CASE WHEN p_filters->>'purchase_view'='material' THEN unit_name END
        LIMIT CASE WHEN p_page_size=5001 THEN 5001 ELSE NULL END
      ), page AS (
        SELECT * FROM grouped ORDER BY branch_id,material_category NULLS FIRST,material_name NULLS FIRST,raw_material_id NULLS FIRST,product_id NULLS FIRST,unit_name NULLS FIRST
        LIMIT p_page_size OFFSET (p_page::bigint*p_page_size)
      ) SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY branch_id,material_category NULLS FIRST,material_name NULLS FIRST,raw_material_id NULLS FIRST,product_id NULLS FIRST,unit_name NULLS FIRST) FROM page p),'[]'::jsonb),
        'summary',(SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(line_net),0)) FROM grouped),
        'metrics',(SELECT jsonb_build_object('Line Gross',COALESCE(SUM(line_gross),0),'Line Returned',COALESCE(SUM(line_returned),0),'Line Net',COALESCE(SUM(line_net),0)) FROM grouped)) INTO v_result;
    ELSE
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.invoice_number,t.total,t.returned_amount,t.status,t.created_at,t.supplier_id
      FROM public.purchases t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND (NULLIF(p_filters->>'supplier','') IS NULL OR t.supplier_id=NULLIF(p_filters->>'supplier','')::uuid)
        AND (NULLIF(p_filters->>'buyer','') IS NULL OR t.buyer_id=NULLIF(p_filters->>'buyer','')::uuid)
        AND (NULLIF(p_filters->>'warehouse','') IS NULL OR t.warehouse_id=NULLIF(p_filters->>'warehouse','')::uuid)
        AND (NULLIF(p_filters->>'status','') IS NULL OR t.status=NULLIF(p_filters->>'status',''))
        AND ((NULLIF(p_filters->>'raw_material','') IS NULL AND NULLIF(p_filters->>'material_category','') IS NULL)
          OR EXISTS (SELECT 1 FROM public.purchase_items pi
            LEFT JOIN public.raw_materials rm ON rm.id=pi.raw_material_id AND rm.branch_id=t.branch_id
            WHERE pi.purchase_id=t.id AND (NULLIF(p_filters->>'raw_material','') IS NULL OR pi.raw_material_id=NULLIF(p_filters->>'raw_material','')::uuid)
        AND (NULLIF(p_filters->>'material_category','') IS NULL OR rm.category=p_filters->>'material_category')))
      -- Full export preflight stops scanning after the first disallowed record.
      LIMIT CASE WHEN p_page_size=5001 AND COALESCE(p_filters->>'purchase_view','')<>'supplier' THEN 5001 ELSE NULL END
    ), grouped AS MATERIALIZED (
      SELECT branch_id,supplier_id,SUM(total) AS total,SUM(COALESCE(returned_amount,0)) AS returned_amount,
        SUM(GREATEST(COALESCE(total,0)-COALESCE(returned_amount,0),0)) AS net_total,COUNT(*) AS invoice_count
      FROM filtered WHERE p_filters->>'purchase_view'='supplier' GROUP BY branch_id,supplier_id
      LIMIT CASE WHEN p_page_size=5001 THEN 5001 ELSE NULL END
    ), supplier_page AS (
      SELECT * FROM grouped ORDER BY branch_id,supplier_id NULLS FIRST LIMIT p_page_size OFFSET (p_page::bigint*p_page_size)
    ), page AS MATERIALIZED (
      SELECT * FROM filtered WHERE COALESCE(p_filters->>'purchase_view','')<>'supplier' ORDER BY created_at DESC,id DESC
      LIMIT p_page_size OFFSET (p_page::bigint * p_page_size)
    ), details AS (
      SELECT to_jsonb(p) - 'supplier_id' || jsonb_build_object('supplier',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('name',s.name) END) AS row, p.created_at AS sort_date,p.id
      FROM page p
      LEFT JOIN public.suppliers s ON s.id=p.supplier_id
    )
    SELECT jsonb_build_object(
      'rows', CASE WHEN p_filters->>'purchase_view'='supplier' THEN COALESCE((SELECT jsonb_agg(to_jsonb(g)-'supplier_id'||jsonb_build_object('supplier',jsonb_build_object('name',s.name)) ORDER BY g.branch_id,g.supplier_id NULLS FIRST) FROM supplier_page g LEFT JOIN public.suppliers s ON s.id=g.supplier_id),'[]'::jsonb) ELSE COALESCE((SELECT jsonb_agg(row ORDER BY sort_date DESC,id DESC) FROM details),'[]'::jsonb) END,
      'summary', (SELECT jsonb_build_object('count',CASE WHEN p_filters->>'purchase_view'='supplier' THEN (SELECT COUNT(*) FROM grouped) ELSE COUNT(*) END,'total',COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(returned_amount,0),0)),0)) FROM filtered),
      'metrics', (SELECT jsonb_build_object('Original Total',coalesce(sum(coalesce(total,0)),0),'Returned',coalesce(sum(coalesce(returned_amount,0)),0),'Invoices',COUNT(*),'Net Purchases',coalesce(sum(greatest(coalesce(total,0)-coalesce(returned_amount,0),0)),0)) FROM filtered)
    ) INTO v_result;
    END IF;
$after$;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure AND NOT prosecdef) THEN RAISE EXCEPTION 'REPORT_READER_MODE_CHANGED'; END IF;
 definition:=pg_get_functiondef('public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure);
 IF (length(definition)-length(replace(definition,before_body,'')))/length(before_body)<>1 THEN RAISE EXCEPTION 'PURCHASE_REPORT_BASELINE_CHANGED'; END IF;
 EXECUTE replace(definition,before_body,after_body);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
