-- Proposal: bounded report reads, retaining caller RLS and full-period totals.
-- No table/policy/operational function changes. Do not apply on Production without approval.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE FUNCTION public.get_operational_report_page(
  p_report_type text, p_branch_id uuid, p_from_date date, p_to_date date,
  p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 0, p_page_size integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_from timestamptz := p_from_date::timestamp AT TIME ZONE 'Africa/Cairo';
  v_to timestamptz := (p_to_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_report_type IS NULL OR p_report_type NOT IN ('sales','purchases','expenses') THEN
    RAISE EXCEPTION 'REPORT_TYPE_INVALID';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'REPORT_PERIOD_INVALID';
  END IF;
  IF p_page IS NULL OR p_page < 0 OR p_page > 1000000 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'REPORT_PAGE_INVALID';
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
    ), page AS MATERIALIZED (
      SELECT * FROM filtered ORDER BY created_at DESC,id DESC
      LIMIT p_page_size OFFSET (p_page::bigint * p_page_size)
    ), details AS (
      SELECT to_jsonb(p) - ARRAY['customer_id','cashier_id','warehouse_id'] || jsonb_build_object('customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END, 'cashier', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('full_name',u.full_name,'email',u.email) END, 'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('name',w.name) END) AS row, p.created_at AS sort_date,p.id
      FROM page p
      LEFT JOIN public.customers c ON c.id=p.customer_id
      LEFT JOIN public.users u ON u.id=p.cashier_id
      LEFT JOIN public.warehouses w ON w.id=p.warehouse_id
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(row ORDER BY sort_date DESC,id DESC) FROM details),'[]'::jsonb),
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(refunded_amount,0),0)),0)) FROM filtered)
    ) INTO v_result;
  ELSIF p_report_type = 'purchases' THEN
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.invoice_number,t.total,t.returned_amount,t.status,t.created_at,t.supplier_id
      FROM public.purchases t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.created_at>=v_from AND t.created_at<v_to
        AND (NULLIF(p_filters->>'supplier','') IS NULL OR t.supplier_id=NULLIF(p_filters->>'supplier','')::uuid)
        AND (NULLIF(p_filters->>'buyer','') IS NULL OR t.buyer_id=NULLIF(p_filters->>'buyer','')::uuid)
        AND (NULLIF(p_filters->>'warehouse','') IS NULL OR t.warehouse_id=NULLIF(p_filters->>'warehouse','')::uuid)
        AND (NULLIF(p_filters->>'status','') IS NULL OR t.status=NULLIF(p_filters->>'status',''))
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
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(returned_amount,0),0)),0)) FROM filtered)
    ) INTO v_result;
  ELSIF p_report_type = 'expenses' THEN
    WITH filtered AS MATERIALIZED (
      SELECT t.id,t.branch_id,t.category,t.description,t.amount,t.expense_date,t.account_id
      FROM public.expenses t
      WHERE (p_branch_id IS NULL OR t.branch_id=p_branch_id)
        AND t.status='posted' AND t.expense_date>=p_from_date AND t.expense_date<=p_to_date
        AND (NULLIF(p_filters->>'payment_method','') IS NULL OR t.payment_method=NULLIF(p_filters->>'payment_method',''))
        AND (NULLIF(p_filters->>'category','') IS NULL OR t.category=NULLIF(p_filters->>'category',''))
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
      'summary', (SELECT jsonb_build_object('count',COUNT(*),'total',COALESCE(SUM(COALESCE(amount,0)),0)) FROM filtered)
    ) INTO v_result;
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_operational_report_page(text,uuid,date,date,jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_report_page(text,uuid,date,date,jsonb,integer,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.get_operational_report_page(text,uuid,date,date,jsonb,integer,integer)
IS 'Bounded operational report details and complete filtered totals under existing caller RLS; Cairo calendar dates. No authorization bypass.';
COMMIT;
