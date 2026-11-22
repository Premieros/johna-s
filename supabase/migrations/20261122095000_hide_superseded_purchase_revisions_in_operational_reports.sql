-- Match the production-verified purchase operational report behavior.
-- Only status='returned' correction revisions with a corresponding active invoice number
-- are excluded; ordinary purchase returns and all accounting journals remain untouched.
-- Verified on 2026-11-22 against Johna's-00529 (two -> one invoice, 16832.95 -> 7997.96).
CREATE OR REPLACE FUNCTION public._operational_report_source_result(p_report_type text, p_branch_id uuid, p_from_date date, p_to_date date, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 0, p_page_size integer DEFAULT 100, p_from_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_exclusive_ts timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_from timestamptz := COALESCE(p_from_ts, p_from_date::timestamp AT TIME ZONE 'Africa/Cairo');
  v_to timestamptz := COALESCE(p_to_exclusive_ts, (p_to_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_report_type IS NULL OR p_report_type NOT IN ('sales','purchases','expenses') THEN
    RAISE EXCEPTION 'REPORT_TYPE_INVALID';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'REPORT_PERIOD_INVALID';
  END IF;
  IF p_page IS NULL OR p_page < 0 OR p_page > 1000000 OR p_page_size IS NULL OR p_page_size < 0 OR p_page_size > 5001 THEN
    RAISE EXCEPTION 'REPORT_PAGE_INVALID';
  END IF;
  IF (p_from_ts IS NULL) <> (p_to_exclusive_ts IS NULL) OR v_from >= v_to THEN
    RAISE EXCEPTION 'REPORT_TIMESTAMP_BOUNDS_INVALID';
  END IF;
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN RAISE EXCEPTION 'REPORT_FILTERS_INVALID'; END IF;
  IF p_report_type = 'sales' THEN
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.invoice_number,t.subtotal,t.discount_amount,t.tax_amount,t.total,t.paid_amount,t.refunded_amount,t.payment_method,t.order_type,t.status,t.created_at,t.customer_id,t.cashier_id,t.warehouse_id
      FROM public.sales t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND (NULLIF(p_filters->>'warehouse','') IS NULL OR t.warehouse_id=NULLIF(p_filters->>'warehouse','')::uuid)
        AND (NULLIF(p_filters->>'cashier','') IS NULL OR t.cashier_id=NULLIF(p_filters->>'cashier','')::uuid)
        AND (NULLIF(p_filters->>'customer','') IS NULL OR t.customer_id=NULLIF(p_filters->>'customer','')::uuid)
        AND (NULLIF(p_filters->>'order_type','') IS NULL OR t.order_type=NULLIF(p_filters->>'order_type',''))
        AND (NULLIF(p_filters->>'payment_method','') IS NULL OR t.payment_method=NULLIF(p_filters->>'payment_method',''))
        AND (NULLIF(p_filters->>'status','') IS NULL OR t.status=NULLIF(p_filters->>'status',''))
        AND (NULLIF(p_filters->>'table','') IS NULL OR t.table_id=NULLIF(p_filters->>'table','')::uuid)
        AND (COALESCE(p_filters->>'settled_only','') <> 'true' OR t.status IN ('completed','returned','refunded'))
        AND (COALESCE(p_filters->>'returns_only','') <> 'true'
          OR COALESCE(t.refunded_amount,0)>0 OR t.status IN ('returned','refunded','cancelled'))
        AND ((NULLIF(p_filters->>'product','') IS NULL AND NULLIF(p_filters->>'category','') IS NULL)
          OR EXISTS (SELECT 1 FROM public.sale_items si
            LEFT JOIN public.products prod ON prod.id=si.product_id
            WHERE si.sale_id=t.id
              AND (NULLIF(p_filters->>'product','') IS NULL OR si.product_id=NULLIF(p_filters->>'product','')::uuid)
              AND (NULLIF(p_filters->>'category','') IS NULL OR prod.category_id=NULLIF(p_filters->>'category','')::uuid)))
      -- Full export preflight stops scanning after the first disallowed record.
      LIMIT CASE WHEN p_page_size=5001 THEN 5001 ELSE NULL END
    ), page AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY created_at DESC,id DESC
      LIMIT p_page_size OFFSET (p_page::bigint * p_page_size)
    ), line_scope AS MATERIALIZED (
      SELECT si.id,si.sale_id,si.product_id,si.unit_name,si.quantity,si.unit_price,si.discount_amount,
        si.total,si.refunded_quantity,si.refunded_amount,si.source_order_item_id,si.bonus_quantity,si.modifiers_snapshot,si.modifier_option_ids
      FROM public.sale_items si JOIN page p ON p.id=si.sale_id
      WHERE COALESCE(p_filters->>'include_items','')='true'
      LIMIT 5001
    ), line_details AS (
      SELECT si.sale_id,jsonb_agg(to_jsonb(si)-'sale_id' || jsonb_build_object('product',
        CASE WHEN prod.id IS NULL THEN NULL ELSE jsonb_build_object('name',prod.name,'category_id',prod.category_id,
          'category',CASE WHEN cat.id IS NULL THEN NULL ELSE jsonb_build_object('name',cat.name,'kitchen_station_id',cat.kitchen_station_id,
            'station',CASE WHEN ks.id IS NULL THEN NULL ELSE jsonb_build_object('id',ks.id,'name_ar',ks.name_ar,'name_en',ks.name_en) END) END) END)
        ORDER BY si.id) AS items
      FROM line_scope si LEFT JOIN public.products prod ON prod.id=si.product_id
      LEFT JOIN public.categories cat ON cat.id=prod.category_id
      LEFT JOIN public.kitchen_stations ks ON ks.id=cat.kitchen_station_id
      GROUP BY si.sale_id
    ), details AS (
      SELECT to_jsonb(p) - ARRAY['customer_id','warehouse_id'] || jsonb_build_object('customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END, 'cashier', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('full_name',u.full_name,'email',u.email) END, 'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('name',w.name) END)
        || CASE WHEN COALESCE(p_filters->>'include_items','')='true' THEN jsonb_build_object('items',COALESCE(li.items,'[]'::jsonb)) ELSE '{}'::jsonb END AS row, p.created_at AS sort_date,p.id
      FROM page p
      LEFT JOIN public.customers c ON c.id=p.customer_id
      LEFT JOIN public.users u ON u.id=p.cashier_id
      LEFT JOIN public.warehouses w ON w.id=p.warehouse_id
      LEFT JOIN line_details li ON li.sale_id=p.id
    )
    SELECT jsonb_build_object(
      'line_count', (SELECT COUNT(*) FROM line_scope),
      'rows', COALESCE((SELECT jsonb_agg(row ORDER BY sort_date DESC,id DESC) FROM details),'[]'::jsonb),
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(refunded_amount,0),0)),0)) FROM filtered),
      'metrics', (SELECT jsonb_build_object('Subtotal',coalesce(sum(coalesce(subtotal,0)),0),'Discount',coalesce(sum(coalesce(discount_amount,0)),0),'Tax',coalesce(sum(coalesce(tax_amount,0)),0),'Invoice Total',coalesce(sum(coalesce(total,0)),0),'Paid',coalesce(sum(coalesce(paid_amount,0)),0),'Refunded',coalesce(sum(coalesce(refunded_amount,0)),0),'Net Sales',coalesce(sum(greatest(coalesce(total,0)-coalesce(refunded_amount,0),0)),0),'Net Collection',coalesce(sum(greatest(coalesce(paid_amount,0)-coalesce(refunded_amount,0),0)),0)) FROM filtered)
    ) INTO v_result;
  ELSIF p_report_type = 'purchases' THEN
    IF COALESCE(NULLIF(p_filters->>'purchase_view',''),'invoice') NOT IN ('invoice','material','category','supplier') THEN
      RAISE EXCEPTION 'REPORT_FILTERS_INVALID';
    END IF;
    IF p_filters->>'purchase_view' IN ('material','category') THEN
      -- Read only the selected period/branch headers, then their caller-visible lines.
      -- Recorded line amounts/returns precede invoice discount/tax; no header duplication.
      WITH headers AS MATERIALIZED (
        SELECT t.id,t.branch_id FROM public.purchases t WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND NOT (
          t.status='returned' AND t.invoice_number ~ '-REV-[0-9a-fA-F]{8}$'
          AND EXISTS (
            SELECT 1 FROM public.purchases replacement
            WHERE replacement.branch_id=t.branch_id
              AND replacement.id<>t.id
              AND replacement.invoice_number=regexp_replace(t.invoice_number,'-REV-[0-9a-fA-F]{8}$','')
          )
        )
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
        AND NOT (
          t.status='returned' AND t.invoice_number ~ '-REV-[0-9a-fA-F]{8}$'
          AND EXISTS (
            SELECT 1 FROM public.purchases replacement
            WHERE replacement.branch_id=t.branch_id
              AND replacement.id<>t.id
              AND replacement.invoice_number=regexp_replace(t.invoice_number,'-REV-[0-9a-fA-F]{8}$','')
          )
        )
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
  ELSIF p_report_type = 'expenses' THEN
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.category,t.description,t.amount,t.expense_date,t.account_id
      FROM public.expenses t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.status='posted' AND t.expense_date>=p_from_date AND t.expense_date<=p_to_date
        AND (NULLIF(p_filters->>'payment_method','') IS NULL OR t.payment_method=NULLIF(p_filters->>'payment_method',''))
        AND (NULLIF(p_filters->>'category','') IS NULL OR t.category=NULLIF(p_filters->>'category',''))
      -- Full export preflight stops scanning after the first disallowed record.
      LIMIT CASE WHEN p_page_size=5001 THEN 5001 ELSE NULL END
    ), page AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY expense_date DESC,id DESC
      LIMIT p_page_size OFFSET (p_page::bigint * p_page_size)
    ), details AS (
      SELECT to_jsonb(p) || jsonb_build_object('expense_account',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('code',a.code,'name',a.name,'name_en',a.name_en) END) AS row, p.expense_date AS sort_date,p.id
      FROM page p
      LEFT JOIN public.chart_of_accounts a ON a.id=p.account_id
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(row ORDER BY sort_date DESC,id DESC) FROM details),'[]'::jsonb),
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(COALESCE(amount,0)),0)) FROM filtered),
      'metrics', (SELECT jsonb_build_object('Amount',coalesce(sum(coalesce(amount,0)),0)) FROM filtered)
    ) INTO v_result;
  END IF;
  IF COALESCE((v_result->>'line_count')::bigint,0)>5000 THEN RAISE EXCEPTION 'REPORT_SOURCE_LIMIT'; END IF;
  IF p_page_size=5001 AND (v_result->'summary'->>'count')::bigint > 5000 THEN RAISE EXCEPTION 'REPORT_SOURCE_LIMIT'; END IF;
  RETURN v_result;
END;
$function$
;
