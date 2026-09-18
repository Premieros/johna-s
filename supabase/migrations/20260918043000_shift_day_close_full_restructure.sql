-- Full shift/day close restructuring.
-- Shift close: authoritative cash equation + complete expense/user/detail reporting.
-- Day close: immutable snapshot including shifts, users, expenses and cash purchases.

ALTER TABLE public.daily_closes
  ADD COLUMN IF NOT EXISTS report_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public._compute_shift_expected_cash(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(
    COALESCE(s.opening_amount, 0)
    + COALESCE((
      SELECT sum(
        CASE
          WHEN COALESCE(op.payment_method,'cash')='cash'
               AND op.operation_type IN ('sale','cash_in') THEN op.amount
          WHEN COALESCE(op.payment_method,'cash')='cash'
               AND op.operation_type IN ('refund','expense','cash_out') THEN -op.amount
          ELSE 0
        END
      )
      FROM public.shift_operations op
      WHERE op.shift_id=s.id
    ),0)
    - COALESCE((
      SELECT sum(e.amount)
      FROM public.expenses e
      WHERE e.branch_id=s.branch_id
        AND e.status='posted'
        AND e.shift_id IS NULL
        AND COALESCE(e.payment_method,'cash')='cash'
        AND e.created_at>=s.opened_at
        AND e.created_at<=COALESCE(s.closed_at,now())
    ),0),
    2
  )
  FROM public.shifts s
  WHERE s.id=p_shift_id;
$function$;

REVOKE ALL ON FUNCTION public._compute_shift_expected_cash(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._compute_shift_expected_cash(uuid) TO service_role,postgres;

CREATE OR REPLACE FUNCTION public.get_shift_closing_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_branch_name text;
  v_cashier_name text;
  v_gross numeric:=0;
  v_discounts numeric:=0;
  v_taxes numeric:=0;
  v_returns numeric:=0;
  v_expenses numeric:=0;
  v_net_sales numeric:=0;
  v_expected numeric:=0;
  v_invoice_count integer:=0;
  v_payments jsonb:='[]'::jsonb;
  v_expense_details jsonb:='[]'::jsonb;
  v_sales_details jsonb:='[]'::jsonb;
  v_return_details jsonb:='[]'::jsonb;
  v_users jsonb:='[]'::jsonb;
  v_treasury jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id;
  IF v_shift.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND'); END IF;
  IF auth.uid() IS NULL OR (NOT public.is_pos_admin() AND NOT public.user_may_access_branch(v_shift.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;

  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name FROM public.branches b WHERE b.id=v_shift.branch_id;
  SELECT COALESCE(u.full_name,u.email,'-') INTO v_cashier_name FROM public.users u WHERE u.id=v_shift.cashier_id;

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id AND op.reference_type='sale' AND op.reference_id IS NOT NULL
  )
  SELECT COALESCE(sum(s.subtotal),0),COALESCE(sum(s.discount_amount),0),COALESCE(sum(s.tax_amount),0),
         COALESCE(sum(s.refunded_amount),0),COALESCE(sum(s.total-COALESCE(s.refunded_amount,0)),0),count(*)::int
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales,v_invoice_count
  FROM public.sales s JOIN sale_ids x ON x.id=s.id;

  SELECT COALESCE(sum(e.amount),0)
  INTO v_expenses
  FROM public.expenses e
  WHERE e.status='posted' AND e.branch_id=v_shift.branch_id
    AND (e.shift_id=p_shift_id OR (
      e.shift_id IS NULL AND e.created_at>=v_shift.opened_at AND e.created_at<=COALESCE(v_shift.closed_at,now())
    ));

  v_expected:=public._compute_shift_expected_cash(p_shift_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,'count',q.count,'total',q.total
  ) ORDER BY q.method),'[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT COALESCE(op.payment_method,'cash') method,count(*)::int count,
           round(sum(CASE WHEN op.operation_type IN ('refund','expense','cash_out') THEN -op.amount ELSE op.amount END),2) total
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id AND op.operation_type IN ('sale','refund','expense','cash_in','cash_out')
    GROUP BY COALESCE(op.payment_method,'cash')
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'category',e.category,'description',e.description,'amount',e.amount,
    'payment_method',COALESCE(e.payment_method,'cash'),'expense_date',e.expense_date,'notes',e.notes,
    'created_at',e.created_at,'created_by',e.created_by,'created_by_name',COALESCE(u.full_name,u.email,'-')
  ) ORDER BY e.created_at,e.id),'[]'::jsonb)
  INTO v_expense_details
  FROM public.expenses e
  LEFT JOIN public.users u ON u.id=e.created_by
  WHERE e.status='posted' AND e.branch_id=v_shift.branch_id
    AND (e.shift_id=p_shift_id OR (
      e.shift_id IS NULL AND e.created_at>=v_shift.opened_at AND e.created_at<=COALESCE(v_shift.closed_at,now())
    ));

  WITH attribution AS (
    SELECT DISTINCT ON (op.reference_id) op.reference_id sale_id,op.created_by
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id AND op.reference_type='sale'
    ORDER BY op.reference_id,op.created_at,op.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',COALESCE(a.created_by,s.cashier_id),
    'user_name',COALESCE(u.full_name,u.email,'-'),'subtotal',s.subtotal,'discount_amount',s.discount_amount,
    'tax_amount',s.tax_amount,'total',s.total,'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),
    'payment_method',s.payment_method,'order_type',s.order_type,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales_details
  FROM attribution a
  JOIN public.sales s ON s.id=a.sale_id
  LEFT JOIN public.users u ON u.id=COALESCE(a.created_by,s.cashier_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'operation_id',op.id,'amount',op.amount,'payment_method',COALESCE(op.payment_method,'cash'),
    'reference_type',op.reference_type,'reference_id',op.reference_id,'created_by',op.created_by,
    'created_by_name',COALESCE(u.full_name,u.email,'-'),'created_at',op.created_at
  ) ORDER BY op.created_at,op.id),'[]'::jsonb)
  INTO v_return_details
  FROM public.shift_operations op
  LEFT JOIN public.users u ON u.id=op.created_by
  WHERE op.shift_id=p_shift_id AND op.operation_type='refund';

  WITH ids AS (
    SELECT DISTINCT user_id FROM (
      SELECT COALESCE((x->>'user_id')::uuid,NULL) user_id FROM jsonb_array_elements(v_sales_details) x
      UNION ALL
      SELECT e.created_by FROM public.expenses e
      WHERE e.status='posted' AND e.branch_id=v_shift.branch_id
        AND (e.shift_id=p_shift_id OR (e.shift_id IS NULL AND e.created_at>=v_shift.opened_at AND e.created_at<=COALESCE(v_shift.closed_at,now())))
      UNION ALL
      SELECT op.created_by FROM public.shift_operations op WHERE op.shift_id=p_shift_id AND op.operation_type='refund'
      UNION ALL SELECT v_shift.cashier_id
    ) z WHERE user_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',u.id,'display_name',COALESCE(u.full_name,u.email,'-'),
    'invoice_count',(SELECT count(*) FROM jsonb_array_elements(v_sales_details) s WHERE s->>'user_id'=u.id::text),
    'sales_total',COALESCE((SELECT sum((s->>'total')::numeric) FROM jsonb_array_elements(v_sales_details) s WHERE s->>'user_id'=u.id::text),0),
    'discounts',COALESCE((SELECT sum((s->>'discount_amount')::numeric) FROM jsonb_array_elements(v_sales_details) s WHERE s->>'user_id'=u.id::text),0),
    'returns',COALESCE((SELECT sum((r->>'amount')::numeric) FROM jsonb_array_elements(v_return_details) r WHERE r->>'created_by'=u.id::text),0),
    'expenses',COALESCE((SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(v_expense_details) e WHERE e->>'created_by'=u.id::text),0),
    'net_contribution',round(
      COALESCE((SELECT sum((s->>'total')::numeric) FROM jsonb_array_elements(v_sales_details) s WHERE s->>'user_id'=u.id::text),0)
      -COALESCE((SELECT sum((r->>'amount')::numeric) FROM jsonb_array_elements(v_return_details) r WHERE r->>'created_by'=u.id::text),0)
      -COALESCE((SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(v_expense_details) e WHERE e->>'created_by'=u.id::text),0),2),
    'sales',(SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) FROM jsonb_array_elements(v_sales_details) s WHERE s->>'user_id'=u.id::text),
    'expenses_detail',(SELECT COALESCE(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(v_expense_details) e WHERE e->>'created_by'=u.id::text),
    'returns_detail',(SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) FROM jsonb_array_elements(v_return_details) r WHERE r->>'created_by'=u.id::text)
  ) ORDER BY COALESCE(u.full_name,u.email)),'[]'::jsonb)
  INTO v_users
  FROM ids JOIN public.users u ON u.id=ids.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_id',q.id,'account_name',q.account_name,'opening_balance',q.opening_balance,'gl_balance',q.gl_balance
  ) ORDER BY q.account_name),'[]'::jsonb)
  INTO v_treasury
  FROM (
    SELECT t.id,t.account_name,t.opening_balance,
           round(t.opening_balance+COALESCE(sum(l.debit-l.credit),0),2) gl_balance
    FROM public.treasury_accounts t
    LEFT JOIN public.journal_entry_lines l ON l.account_id=t.account_id
    WHERE t.branch_id=v_shift.branch_id
    GROUP BY t.id,t.account_name,t.opening_balance
  ) q;

  RETURN jsonb_build_object(
    'success',true,'shift_id',p_shift_id,'branch_id',v_shift.branch_id,'branch_name',v_branch_name,
    'cashier_id',v_shift.cashier_id,'cashier_name',v_cashier_name,'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at,
    'opening_amount',v_shift.opening_amount,'expected_cash',v_expected,'actual_cash',v_shift.actual_amount,'difference',v_shift.difference,
    'notes',v_shift.notes,'invoice_count',v_invoice_count,'gross_sales',round(v_gross,2),'discounts',round(v_discounts,2),
    'taxes',round(v_taxes,2),'returns',round(v_returns,2),'voids',0,'expenses',round(v_expenses,2),
    'net_sales',round(v_net_sales,2),'net_revenue',round(v_net_sales-v_expenses,2),
    'payment_methods',v_payments,'expense_details',v_expense_details,'sales_details',v_sales_details,
    'return_details',v_return_details,'users',v_users,'treasury',v_treasury
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_closing_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shift_closing_report(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid,p_business_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_start timestamptz := (p_business_date::timestamp AT TIME ZONE 'Africa/Cairo');
  v_end timestamptz := ((p_business_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo');
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
  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name FROM public.branches b WHERE b.id=p_branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',s.cashier_id,'user_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',s.subtotal,'discount_amount',s.discount_amount,'tax_amount',s.tax_amount,'total',s.total,
    'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),'payment_method',s.payment_method,
    'order_type',s.order_type,'status',s.status,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM public.sales s LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id AND s.created_at>=v_start AND s.created_at<v_end;

  SELECT COALESCE(sum((x->>'subtotal')::numeric),0),COALESCE(sum((x->>'discount_amount')::numeric),0),
         COALESCE(sum((x->>'tax_amount')::numeric),0),COALESCE(sum((x->>'refunded_amount')::numeric),0),
         COALESCE(sum((x->>'total')::numeric-(x->>'refunded_amount')::numeric),0),
         COALESCE(sum(CASE WHEN COALESCE(x->>'payment_method','')='cash' THEN GREATEST((x->>'paid_amount')::numeric-(x->>'refunded_amount')::numeric,0) ELSE 0 END),0)
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales,v_cash_sales
  FROM jsonb_array_elements(v_sales) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'category',e.category,'description',e.description,'amount',e.amount,
    'payment_method',COALESCE(e.payment_method,'cash'),'expense_date',e.expense_date,'notes',e.notes,
    'created_at',e.created_at,'created_by',e.created_by,'created_by_name',COALESCE(u.full_name,u.email,'-'),
    'shift_id',e.shift_id
  ) ORDER BY e.created_at,e.id),'[]'::jsonb)
  INTO v_expenses
  FROM public.expenses e LEFT JOIN public.users u ON u.id=e.created_by
  WHERE e.branch_id=p_branch_id AND e.status='posted' AND e.expense_date=p_business_date;

  SELECT COALESCE(sum((x->>'amount')::numeric),0),
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
  WHERE p.branch_id=p_branch_id AND COALESCE(p.payment_method,'cash')='cash'
    AND p.created_at>=v_start AND p.created_at<v_end
    AND COALESCE(p.status,'completed') IN ('completed','returned');

  SELECT COALESCE(sum((x->>'cash_outflow')::numeric),0) INTO v_cash_purchases FROM jsonb_array_elements(v_purchases) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'cashier_id',s.cashier_id,'cashier_name',COALESCE(u.full_name,u.email,'-'),
    'opened_at',s.opened_at,'closed_at',s.closed_at,'opening_amount',s.opening_amount,
    'expected_amount',s.expected_amount,'actual_amount',s.actual_amount,'difference',s.difference,'status',s.status
  ) ORDER BY s.opened_at,s.id),'[]'::jsonb)
  INTO v_shifts
  FROM public.shifts s LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id AND s.opened_at<v_end AND COALESCE(s.closed_at,v_end)>=v_start;

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
    'success',true,'branch_id',p_branch_id,'branch_name',v_branch_name,'business_date',p_business_date,
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

REVOKE ALL ON FUNCTION public._build_day_closing_report(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._build_day_closing_report(uuid,date) TO service_role,postgres;

CREATE OR REPLACE FUNCTION public.get_day_closing_report(p_branch_id uuid,p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.day_close') AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  SELECT report_snapshot INTO v_snapshot FROM public.daily_closes WHERE branch_id=p_branch_id AND business_date=p_day;
  IF v_snapshot IS NOT NULL AND v_snapshot<>'{}'::jsonb THEN
    RETURN v_snapshot || jsonb_build_object('daily_close_status','closed','snapshot',true);
  END IF;
  RETURN public._build_day_closing_report(p_branch_id,p_day) || jsonb_build_object('daily_close_status','open','snapshot',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_closing_report(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_day_closing_report(uuid,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public._finalize_day_close(p_branch_id uuid,p_business_date date,p_closed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_report jsonb; v_existing jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.shifts WHERE branch_id=p_branch_id AND status='open') THEN
    RETURN jsonb_build_object('success',false,'error','OPEN_SHIFTS_REMAIN');
  END IF;
  SELECT id,report_snapshot INTO v_id,v_existing FROM public.daily_closes WHERE branch_id=p_branch_id AND business_date=p_business_date;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'already_closed',true,'daily_close_id',v_id,'report',v_existing);
  END IF;
  v_report:=public._build_day_closing_report(p_branch_id,p_business_date);
  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,p_business_date,p_closed_by,v_report)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'already_closed',false,'daily_close_id',v_id,'report',v_report);
END;
$function$;

REVOKE ALL ON FUNCTION public._finalize_day_close(uuid,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._finalize_day_close(uuid,date,uuid) TO service_role,postgres;

CREATE OR REPLACE FUNCTION public.day_close(p_branch_id uuid,p_business_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.day_close') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.day_close');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  RETURN public._finalize_day_close(p_branch_id,COALESCE(p_business_date,CURRENT_DATE),auth.uid());
END;
$function$;

REVOKE ALL ON FUNCTION public.day_close(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.day_close(uuid,date) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,p_actual_amount numeric,p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_shift public.shifts%ROWTYPE; v_expected numeric(14,2); v_diff numeric(14,2);
  v_open_order_count integer:=0; v_open_table_count integer:=0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_uid AND u.is_active=true) THEN RETURN jsonb_build_object('success',false,'error','USER_NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.close') THEN
    RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSE_DENIED','detail','Closing shifts requires shifts.close.');
  END IF;
  SELECT * INTO v_shift FROM public.shifts s
  WHERE s.id=p_shift_id AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND'); END IF;
  IF v_shift.status='closed' THEN RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSED'); END IF;
  IF NOT public.is_pos_admin() AND v_shift.cashier_id<>v_uid AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success',false,'error','NOT_YOUR_SHIFT');
  END IF;
  SELECT count(*)::int,count(DISTINCT o.table_id) FILTER(WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=v_shift.branch_id AND o.status IN('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0);
  IF v_open_order_count>0 THEN
    RETURN jsonb_build_object('success',false,'error','OPEN_ORDERS_BLOCK_SHIFT_CLOSE',
      'detail','Resolve open or held orders before normal shift close, or use the separately-permitted open-orders override.',
      'open_order_count',v_open_order_count,'open_table_count',v_open_table_count);
  END IF;
  v_expected:=public._compute_shift_expected_cash(p_shift_id);
  v_diff:=round(COALESCE(p_actual_amount,v_expected)-v_expected,2);
  UPDATE public.shifts SET status='closed',closed_at=now(),expected_amount=v_expected,
    actual_amount=COALESCE(p_actual_amount,v_expected),difference=v_diff,notes=COALESCE(p_notes,notes)
  WHERE id=p_shift_id AND branch_id=v_shift.branch_id AND status='open';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSED'); END IF;
  RETURN jsonb_build_object('success',true,'shift_id',p_shift_id,'expected',v_expected,
    'actual',COALESCE(p_actual_amount,v_expected),'difference',v_diff,'open_orders_preserved',false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail',SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_shift_with_open_orders(
  p_shift_id uuid,p_actual_amount numeric,p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_shift public.shifts%ROWTYPE; v_expected numeric(14,2); v_diff numeric(14,2);
  v_open_order_count integer:=0; v_open_table_count integer:=0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_uid AND u.is_active=true) THEN RETURN jsonb_build_object('success',false,'error','USER_NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() AND (NOT public.can_permission('shifts.close') OR NOT public.can_permission('shifts.close_with_open_orders')) THEN
    RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSE_OPEN_ORDERS_DENIED',
      'detail','Closing a shift while open orders remain requires shifts.close and shifts.close_with_open_orders.');
  END IF;
  SELECT * INTO v_shift FROM public.shifts s
  WHERE s.id=p_shift_id AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND'); END IF;
  IF v_shift.status='closed' THEN RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSED'); END IF;
  IF NOT public.is_pos_admin() AND v_shift.cashier_id<>v_uid AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success',false,'error','NOT_YOUR_SHIFT');
  END IF;
  SELECT count(*)::int,count(DISTINCT o.table_id) FILTER(WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=v_shift.branch_id AND o.status IN('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id AND oi.quantity>0);
  v_expected:=public._compute_shift_expected_cash(p_shift_id);
  v_diff:=round(COALESCE(p_actual_amount,v_expected)-v_expected,2);
  UPDATE public.shifts SET status='closed',closed_at=now(),expected_amount=v_expected,
    actual_amount=COALESCE(p_actual_amount,v_expected),difference=v_diff,
    notes=CASE WHEN v_open_order_count=0 THEN COALESCE(p_notes,notes)
      ELSE concat_ws(E'\n',NULLIF(COALESCE(p_notes,notes),''),
        format('Closed with %s open/held operational order(s) preserved for the next shift.',v_open_order_count)) END
  WHERE id=p_shift_id AND branch_id=v_shift.branch_id AND status='open';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','SHIFT_CLOSED'); END IF;
  PERFORM public.log_audit_action(v_shift.branch_id,'shift_close_with_open_orders','shift',p_shift_id,
    jsonb_build_object('cashier_id',v_shift.cashier_id,'expected',v_expected,'actual',COALESCE(p_actual_amount,v_expected),
      'difference',v_diff,'open_order_count',v_open_order_count,'open_table_count',v_open_table_count));
  RETURN jsonb_build_object('success',true,'shift_id',p_shift_id,'expected',v_expected,
    'actual',COALESCE(p_actual_amount,v_expected),'difference',v_diff,
    'open_orders_preserved',v_open_order_count>0,'open_order_count',v_open_order_count,'open_table_count',v_open_table_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid,numeric,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) TO authenticated,service_role;
