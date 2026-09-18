-- Financial-day hardening:
-- 1) shift_span uses configured business_day_start as the cutoff, but actual
--    accounting starts at the first shift opened after that cutoff and ends
--    at the final close of shifts opened before the next cutoff.
-- 2) day report uses sale_payments as tender truth and excludes activity before
--    the first actual shift.
-- 3) expose per-sale tender allocations for Z-report detail.
-- 4) route Z-report jobs through the durable cashier print station.

CREATE OR REPLACE FUNCTION public._resolve_business_day_window(
  p_branch_id uuid,
  p_business_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_mode text := 'fixed_time';
  v_start_time time := '00:00';
  v_end_time time := '00:00';
  v_nominal_start timestamptz;
  v_nominal_next timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_shift_count integer := 0;
  v_open_shift_count integer := 0;
BEGIN
  SELECT
    COALESCE(bs.business_day_mode,'fixed_time'),
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_mode,v_start_time,v_end_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  v_nominal_start := ((p_business_date::timestamp + v_start_time) AT TIME ZONE 'Africa/Cairo');
  v_nominal_next := (((p_business_date+1)::timestamp + v_start_time) AT TIME ZONE 'Africa/Cairo');

  IF v_mode='shift_span' THEN
    SELECT
      min(s.opened_at),
      max(COALESCE(s.closed_at,now())),
      count(*)::int,
      count(*) FILTER (WHERE s.status='open')::int
    INTO v_start,v_end,v_shift_count,v_open_shift_count
    FROM public.shifts s
    WHERE s.branch_id=p_branch_id
      AND s.opened_at>=v_nominal_start
      AND s.opened_at<v_nominal_next;

    IF v_shift_count=0 OR v_start IS NULL THEN
      v_start := v_nominal_start;
      v_end := v_nominal_start;
    END IF;
  ELSE
    v_start := v_nominal_start;
    v_end := (
      ((p_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp + v_end_time)
      AT TIME ZONE 'Africa/Cairo'
    );
  END IF;

  RETURN jsonb_build_object(
    'mode',v_mode,
    'start_at',v_start,
    'end_at',v_end,
    'nominal_start_at',v_nominal_start,
    'next_cutoff_at',v_nominal_next,
    'shift_count',v_shift_count,
    'open_shift_count',v_open_shift_count,
    'has_shifts',v_shift_count>0,
    'configured_start',v_start_time::text,
    'configured_end',v_end_time::text
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_business_day_window(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_business_day_window(uuid,date) TO service_role,postgres;

CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid,p_business_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_window jsonb:=public._resolve_business_day_window(p_branch_id,p_business_date);
  v_start timestamptz:=(v_window->>'start_at')::timestamptz;
  v_end timestamptz:=(v_window->>'end_at')::timestamptz;
  v_mode text:=COALESCE(v_window->>'mode','fixed_time');
  v_branch_name text;
  v_sales jsonb:='[]'::jsonb;
  v_expenses jsonb:='[]'::jsonb;
  v_purchases jsonb:='[]'::jsonb;
  v_shifts jsonb:='[]'::jsonb;
  v_users jsonb:='[]'::jsonb;
  v_payments jsonb:='[]'::jsonb;
  v_gross numeric:=0; v_discounts numeric:=0; v_taxes numeric:=0; v_returns numeric:=0;
  v_net_sales numeric:=0; v_expense_total numeric:=0; v_cash_purchases numeric:=0;
  v_cash_sales numeric:=0; v_cash_expenses numeric:=0;
BEGIN
  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name
  FROM public.branches b WHERE b.id=p_branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',s.cashier_id,
    'user_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',s.subtotal,'discount_amount',s.discount_amount,'tax_amount',s.tax_amount,'total',s.total,
    'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),
    'payment_method',s.payment_method,
    'payments',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method',sp.payment_method,
        'amount',round(GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0),2)
      ) ORDER BY sp.created_at,sp.id)
      FROM public.sale_payments sp
      WHERE sp.sale_id=s.id
        AND GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0)>0
    ),jsonb_build_array(jsonb_build_object(
      'method',COALESCE(s.payment_method,'cash'),
      'amount',round(GREATEST(COALESCE(s.paid_amount,0)-COALESCE(s.refunded_amount,0),0),2)
    ))),
    'order_type',s.order_type,'status',s.status,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND s.created_at>=v_start
    AND s.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'subtotal')::numeric),0),
    COALESCE(sum((x->>'discount_amount')::numeric),0),
    COALESCE(sum((x->>'tax_amount')::numeric),0),
    COALESCE(sum((x->>'refunded_amount')::numeric),0),
    COALESCE(sum((x->>'total')::numeric-(x->>'refunded_amount')::numeric),0)
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales
  FROM jsonb_array_elements(v_sales) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'category',e.category,'description',e.description,'amount',e.amount,
    'payment_method',COALESCE(e.payment_method,'cash'),'expense_date',e.expense_date,'notes',e.notes,
    'created_at',e.created_at,'created_by',e.created_by,'created_by_name',COALESCE(u.full_name,u.email,'-'),
    'shift_id',e.shift_id
  ) ORDER BY e.created_at,e.id),'[]'::jsonb)
  INTO v_expenses
  FROM public.expenses e
  LEFT JOIN public.users u ON u.id=e.created_by
  WHERE e.branch_id=p_branch_id
    AND e.status='posted'
    AND e.created_at>=v_start
    AND e.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'amount')::numeric),0),
    COALESCE(sum(CASE WHEN COALESCE(x->>'payment_method','cash')='cash' THEN (x->>'amount')::numeric ELSE 0 END),0)
  INTO v_expense_total,v_cash_expenses
  FROM jsonb_array_elements(v_expenses) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'purchase_id',p.id,'invoice_number',p.invoice_number,'supplier_id',p.supplier_id,
    'supplier_name',COALESCE(sup.name,'-'),'buyer_id',p.buyer_id,'buyer_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',p.subtotal,'discount_amount',p.discount_amount,'tax_amount',p.tax_amount,'total',p.total,
    'paid_amount',p.paid_amount,'returned_amount',COALESCE(p.returned_amount,0),
    'cash_outflow',GREATEST(COALESCE(p.paid_amount,0)-COALESCE(p.returned_amount,0),0),
    'payment_method',p.payment_method,'status',p.status,'created_at',p.created_at
  ) ORDER BY p.created_at,p.invoice_number),'[]'::jsonb)
  INTO v_purchases
  FROM public.purchases p
  LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id
  LEFT JOIN public.users u ON u.id=p.buyer_id
  WHERE p.branch_id=p_branch_id
    AND COALESCE(p.payment_method,'cash')='cash'
    AND p.created_at>=v_start
    AND p.created_at<=v_end
    AND COALESCE(p.status,'completed') IN ('completed','returned');

  SELECT COALESCE(sum((x->>'cash_outflow')::numeric),0)
  INTO v_cash_purchases
  FROM jsonb_array_elements(v_purchases) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'cashier_id',s.cashier_id,'cashier_name',COALESCE(u.full_name,u.email,'-'),
    'opened_at',s.opened_at,'closed_at',s.closed_at,'opening_amount',s.opening_amount,
    'expected_amount',s.expected_amount,'actual_amount',s.actual_amount,'difference',s.difference,'status',s.status
  ) ORDER BY s.opened_at,s.id),'[]'::jsonb)
  INTO v_shifts
  FROM public.shifts s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND s.opened_at>=v_start
    AND s.opened_at<=v_end;

  WITH sale_rows AS (
    SELECT s.id,s.payment_method,s.paid_amount,COALESCE(s.refunded_amount,0) refunded_amount
    FROM public.sales s
    WHERE s.branch_id=p_branch_id AND s.created_at>=v_start AND s.created_at<=v_end
  ),
  tenders AS (
    SELECT sr.id sale_id,sp.payment_method method,
           GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0) amount
    FROM sale_rows sr
    JOIN public.sale_payments sp ON sp.sale_id=sr.id
    WHERE GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0)>0
    UNION ALL
    SELECT sr.id,COALESCE(sr.payment_method,'cash'),
           GREATEST(COALESCE(sr.paid_amount,0)-sr.refunded_amount,0)
    FROM sale_rows sr
    WHERE NOT EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id=sr.id)
      AND GREATEST(COALESCE(sr.paid_amount,0)-sr.refunded_amount,0)>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,'invoice_count',q.invoice_count,'sales_total',q.sales_total
  ) ORDER BY q.method),'[]'::jsonb),
  COALESCE(sum(CASE WHEN q.method='cash' THEN q.sales_total ELSE 0 END),0)
  INTO v_payments,v_cash_sales
  FROM (
    SELECT method,count(DISTINCT sale_id)::int invoice_count,round(sum(amount),2) sales_total
    FROM tenders
    GROUP BY method
  ) q;

  WITH ids AS (
    SELECT DISTINCT id FROM (
      SELECT NULLIF(x->>'user_id','')::uuid id FROM jsonb_array_elements(v_sales) x
      UNION ALL SELECT NULLIF(x->>'created_by','')::uuid FROM jsonb_array_elements(v_expenses) x
      UNION ALL SELECT NULLIF(x->>'buyer_id','')::uuid FROM jsonb_array_elements(v_purchases) x
      UNION ALL SELECT NULLIF(x->>'cashier_id','')::uuid FROM jsonb_array_elements(v_shifts) x
    ) z WHERE id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',u.id,'display_name',COALESCE(u.full_name,u.email,'-'),
    'invoice_count',(SELECT count(*) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'sales_total',COALESCE((SELECT sum((x->>'total')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'discounts',COALESCE((SELECT sum((x->>'discount_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'returns',COALESCE((SELECT sum((x->>'refunded_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'expenses',COALESCE((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),0),
    'cash_purchases',COALESCE((SELECT sum((x->>'cash_outflow')::numeric) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text),0),
    'sales',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'expenses_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),
    'cash_purchases_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text)
  ) ORDER BY COALESCE(u.full_name,u.email)),'[]'::jsonb)
  INTO v_users
  FROM ids JOIN public.users u ON u.id=ids.id;

  RETURN jsonb_build_object(
    'success',true,
    'branch_id',p_branch_id,'branch_name',v_branch_name,'business_date',p_business_date,
    'business_day_mode',v_mode,'window_start',v_start,'window_end',v_end,
    'gross_sales',round(v_gross,2),'discounts',round(v_discounts,2),'taxes',round(v_taxes,2),'returns',round(v_returns,2),
    'net_sales',round(v_net_sales,2),'expenses',round(v_expense_total,2),'cash_purchases',round(v_cash_purchases,2),
    'net_after_expenses',round(v_net_sales-v_expense_total,2),
    'net_after_expenses_and_cash_purchases',round(v_net_sales-v_expense_total-v_cash_purchases,2),
    'cash_sales',round(v_cash_sales,2),'cash_expenses',round(v_cash_expenses,2),
    'cash_after_outflows',round(v_cash_sales-v_cash_expenses-v_cash_purchases,2),
    'invoice_count',jsonb_array_length(v_sales),'shift_count',jsonb_array_length(v_shifts),
    'payment_methods',v_payments,'shifts',v_shifts,'sales_details',v_sales,'expense_details',v_expenses,
    'cash_purchase_details',v_purchases,'users',v_users
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shift_sale_tenders(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_sales jsonb:='[]'::jsonb;
  v_methods jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id;
  IF v_shift.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND'); END IF;
  IF auth.uid() IS NULL OR (NOT public.is_pos_admin() AND NOT public.user_may_access_branch(v_shift.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id
      AND op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  tender_rows AS (
    SELECT s.id sale_id,s.invoice_number,sp.payment_method method,
           round(GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0),2) amount
    FROM sale_ids x
    JOIN public.sales s ON s.id=x.sale_id
    JOIN public.sale_payments sp ON sp.sale_id=s.id
    WHERE GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0)>0
    UNION ALL
    SELECT s.id,s.invoice_number,COALESCE(s.payment_method,'cash'),
           round(GREATEST(COALESCE(s.paid_amount,0)-COALESCE(s.refunded_amount,0),0),2)
    FROM sale_ids x
    JOIN public.sales s ON s.id=x.sale_id
    WHERE NOT EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id=s.id)
      AND GREATEST(COALESCE(s.paid_amount,0)-COALESCE(s.refunded_amount,0),0)>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',q.sale_id,'invoice_number',q.invoice_number,'payments',q.payments
  ) ORDER BY q.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM (
    SELECT sale_id,invoice_number,
           jsonb_agg(jsonb_build_object('method',method,'amount',amount) ORDER BY method) payments
    FROM tender_rows
    GROUP BY sale_id,invoice_number
  ) q;

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id
      AND op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  tender_rows AS (
    SELECT s.id sale_id,sp.payment_method method,
           GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0) amount
    FROM sale_ids x JOIN public.sales s ON s.id=x.sale_id
    JOIN public.sale_payments sp ON sp.sale_id=s.id
    WHERE GREATEST(sp.amount-COALESCE(sp.refunded_amount,0),0)>0
    UNION ALL
    SELECT s.id,COALESCE(s.payment_method,'cash'),
           GREATEST(COALESCE(s.paid_amount,0)-COALESCE(s.refunded_amount,0),0)
    FROM sale_ids x JOIN public.sales s ON s.id=x.sale_id
    WHERE NOT EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id=s.id)
      AND GREATEST(COALESCE(s.paid_amount,0)-COALESCE(s.refunded_amount,0),0)>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,'count',q.invoice_count,'total',q.total
  ) ORDER BY q.method),'[]'::jsonb)
  INTO v_methods
  FROM (
    SELECT method,count(DISTINCT sale_id)::int invoice_count,round(sum(amount),2) total
    FROM tender_rows
    GROUP BY method
  ) q;

  RETURN jsonb_build_object('success',true,'sales',v_sales,'payment_methods',v_methods);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_sale_tenders(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shift_sale_tenders(uuid) TO authenticated,service_role;

ALTER TABLE public.cloud_print_jobs
  DROP CONSTRAINT IF EXISTS cloud_print_jobs_kind_check;
ALTER TABLE public.cloud_print_jobs
  ADD CONSTRAINT cloud_print_jobs_kind_check
  CHECK (kind IN ('kitchen','receipt','test','report'));

CREATE OR REPLACE FUNCTION public.enqueue_cloud_report_print(
  p_branch_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    p_branch_id,auth.uid(),'report','cashier',p_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,'job_id',v_job.id,'status',v_job.status,'station_code','cashier'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) TO authenticated;

NOTIFY pgrst,'reload schema';
