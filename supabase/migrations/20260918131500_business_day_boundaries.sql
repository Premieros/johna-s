-- Business-day boundaries per branch.
-- Modes:
--   fixed_time  -> use configured local start/end times (Africa/Cairo).
--   shift_span  -> first shift opened on the business date through the last shift close.
-- Existing shared branch-shift uniqueness remains authoritative: one open shift per branch.

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS business_day_mode text NOT NULL DEFAULT 'fixed_time',
  ADD COLUMN IF NOT EXISTS business_day_start time without time zone NOT NULL DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS business_day_end time without time zone NOT NULL DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS auto_close_shift_at_day_end boolean NOT NULL DEFAULT false;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.branch_settings'::regclass
      AND conname='branch_settings_business_day_mode_check'
  ) THEN
    ALTER TABLE public.branch_settings
      ADD CONSTRAINT branch_settings_business_day_mode_check
      CHECK (business_day_mode IN ('fixed_time','shift_span'));
  END IF;
END;
$do$;

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
  v_start timestamptz;
  v_end timestamptz;
  v_shift_count integer := 0;
BEGIN
  SELECT
    COALESCE(bs.business_day_mode,'fixed_time'),
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_mode,v_start_time,v_end_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  IF v_mode='shift_span' THEN
    SELECT
      min(s.opened_at),
      max(COALESCE(s.closed_at,now())),
      count(*)::int
    INTO v_start,v_end,v_shift_count
    FROM public.shifts s
    WHERE s.branch_id=p_branch_id
      AND (s.opened_at AT TIME ZONE 'Africa/Cairo')::date=p_business_date;

    IF v_shift_count=0 OR v_start IS NULL THEN
      v_start := (p_business_date::timestamp AT TIME ZONE 'Africa/Cairo');
      v_end := ((p_business_date+1)::timestamp AT TIME ZONE 'Africa/Cairo');
    END IF;
  ELSE
    v_start := ((p_business_date::timestamp + v_start_time) AT TIME ZONE 'Africa/Cairo');
    v_end := (
      ((p_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp + v_end_time)
      AT TIME ZONE 'Africa/Cairo'
    );
  END IF;

  RETURN jsonb_build_object(
    'mode',v_mode,
    'start_at',v_start,
    'end_at',v_end,
    'shift_count',v_shift_count,
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
    'payment_method',s.payment_method,'order_type',s.order_type,'status',s.status,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id AND s.created_at>=v_start AND s.created_at<v_end;

  SELECT
    COALESCE(sum((x->>'subtotal')::numeric),0),
    COALESCE(sum((x->>'discount_amount')::numeric),0),
    COALESCE(sum((x->>'tax_amount')::numeric),0),
    COALESCE(sum((x->>'refunded_amount')::numeric),0),
    COALESCE(sum((x->>'total')::numeric-(x->>'refunded_amount')::numeric),0),
    COALESCE(sum(CASE WHEN COALESCE(x->>'payment_method','')='cash'
      THEN GREATEST((x->>'paid_amount')::numeric-(x->>'refunded_amount')::numeric,0) ELSE 0 END),0)
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales,v_cash_sales
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
    AND e.created_at>=v_start AND e.created_at<v_end;

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
    AND p.created_at>=v_start AND p.created_at<v_end
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
    AND s.opened_at<v_end
    AND COALESCE(s.closed_at,v_end)>=v_start;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,'invoice_count',q.invoice_count,'sales_total',q.sales_total
  ) ORDER BY q.method),'[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT COALESCE(x->>'payment_method','cash') method,count(*)::int invoice_count,
           round(sum((x->>'paid_amount')::numeric),2) sales_total
    FROM jsonb_array_elements(v_sales) x
    GROUP BY COALESCE(x->>'payment_method','cash')
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

CREATE OR REPLACE FUNCTION public._finalize_day_close(
  p_branch_id uuid,p_business_date date,p_closed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_report jsonb;
  v_existing jsonb;
  v_window jsonb;
  v_mode text;
  v_end timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shifts
    WHERE branch_id=p_branch_id AND status='open'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','OPEN_SHIFTS_REMAIN');
  END IF;

  SELECT id,report_snapshot INTO v_id,v_existing
  FROM public.daily_closes
  WHERE branch_id=p_branch_id AND business_date=p_business_date;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'already_closed',true,'daily_close_id',v_id,'report',v_existing);
  END IF;

  v_window:=public._resolve_business_day_window(p_branch_id,p_business_date);
  v_mode:=COALESCE(v_window->>'mode','fixed_time');
  v_end:=(v_window->>'end_at')::timestamptz;

  IF v_mode='shift_span' AND COALESCE((v_window->>'has_shifts')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','NO_SHIFTS_FOR_DAY');
  END IF;

  v_report:=public._build_day_closing_report(p_branch_id,p_business_date);

  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,p_business_date,p_closed_by,v_report)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success',true,'already_closed',false,'daily_close_id',v_id,'report',v_report
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._finalize_day_close(uuid,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._finalize_day_close(uuid,date,uuid) TO service_role,postgres;


-- Strict close policy: a branch shift cannot be closed while any open/held
-- operational order remains. The former override RPC is retained only as a
-- fail-closed compatibility surface so old clients cannot bypass this rule.
CREATE OR REPLACE FUNCTION public.close_shift_with_open_orders(
  p_shift_id uuid,
  p_actual_amount numeric,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_open_order_count integer:=0;
  v_open_table_count integer:=0;
BEGIN
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id=p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(branch_id));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND');
  END IF;

  SELECT
    count(*)::int,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=v_shift.branch_id
    AND o.status IN ('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id=o.id AND oi.quantity>0
    );

  RETURN jsonb_build_object(
    'success',false,
    'error','OPEN_ORDERS_BLOCK_SHIFT_CLOSE',
    'detail','All open or held orders must be resolved before the shift can close.',
    'open_order_count',v_open_order_count,
    'open_table_count',v_open_table_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.try_auto_close_branch_shift(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_mode text:='fixed_time';
  v_auto boolean:=false;
  v_start_time time:='00:00';
  v_end_time time:='00:00';
  v_local_open timestamp;
  v_business_date date;
  v_window jsonb;
  v_window_end timestamptz;
  v_expected numeric(14,2);
  v_open_order_count integer:=0;
  v_open_table_count integer:=0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  SELECT
    COALESCE(bs.business_day_mode,'fixed_time'),
    COALESCE(bs.auto_close_shift_at_day_end,false),
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_mode,v_auto,v_start_time,v_end_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  IF NOT v_auto THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','AUTO_CLOSE_DISABLED');
  END IF;

  IF v_mode<>'fixed_time' THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','AUTO_CLOSE_FIXED_TIME_ONLY');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE branch_id=p_branch_id AND status='open'
  ORDER BY opened_at,id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'closed',false,'reason','NO_OPEN_SHIFT');
  END IF;

  v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
  v_business_date:=v_local_open::date;
  IF v_end_time<=v_start_time AND v_local_open::time < v_end_time THEN
    v_business_date:=v_business_date-1;
  END IF;

  v_window:=public._resolve_business_day_window(p_branch_id,v_business_date);
  v_window_end:=(v_window->>'end_at')::timestamptz;

  IF now()<v_window_end THEN
    RETURN jsonb_build_object(
      'success',true,'closed',false,'reason','BUSINESS_DAY_NOT_FINISHED',
      'window_end',v_window_end
    );
  END IF;

  SELECT
    count(*)::int,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=p_branch_id
    AND o.status IN ('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id AND oi.quantity>0
    );

  IF v_open_order_count>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','OPEN_ORDERS_BLOCK_SHIFT_CLOSE',
      'open_order_count',v_open_order_count,
      'open_table_count',v_open_table_count,
      'window_end',v_window_end
    );
  END IF;

  v_expected:=public._compute_shift_expected_cash(v_shift.id);

  UPDATE public.shifts
  SET
    status='closed',
    closed_at=now(),
    expected_amount=v_expected,
    actual_amount=NULL,
    difference=NULL,
    notes=concat_ws(E'\n',NULLIF(notes,''),'AUTO_CLOSED_AT_BUSINESS_DAY_END')
  WHERE id=v_shift.id AND status='open';

  PERFORM public.log_audit_action(
    p_branch_id,
    'shift_auto_close',
    'shift',
    v_shift.id,
    jsonb_build_object(
      'business_date',v_business_date,
      'window_end',v_window_end,
      'expected_amount',v_expected,
      'actual_counted',false
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'closed',true,
    'shift_id',v_shift.id,
    'expected',v_expected,
    'actual',NULL,
    'difference',NULL,
    'business_date',v_business_date,
    'window_end',v_window_end
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.try_auto_close_branch_shift(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.try_auto_close_branch_shift(uuid) TO authenticated,service_role;
