-- Guarded rollback for the staged production-audit candidate. Transaction required.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.set_kitchen_status(uuid,text)'::regprocedure))<>'b7d045c9a752a1f3633398fcdbfcd676'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_shift_closing_report(uuid)'::regprocedure))<>'c32a9a2d193f3289568d492a68415b45' THEN
  RAISE EXCEPTION 'AUDIT_ROLLBACK_SOURCE_CHANGED';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_shift_closing_report(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  FROM public.sales s JOIN sale_ids x ON x.id=s.id
  WHERE COALESCE(s.is_archived,false)=false;

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

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id
      AND op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',s.cashier_id,
    'user_name',COALESCE(u.full_name,u.email,'-'),'subtotal',s.subtotal,'discount_amount',s.discount_amount,
    'tax_amount',s.tax_amount,'total',s.total,'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),
    'payment_method',s.payment_method,'order_type',s.order_type,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales_details
  FROM sale_ids a
  JOIN public.sales s ON s.id=a.sale_id
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE COALESCE(s.is_archived,false)=false;

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
$function$
;
CREATE OR REPLACE FUNCTION public.set_kitchen_status(p_order_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_user_email text;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_status NOT IN ('pending','sent','cooking','ready','served','cancelled') THEN
    RAISE EXCEPTION 'Invalid kitchen_status: %', p_status;
  END IF;

  SELECT o.branch_id INTO v_branch_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF NOT v_is_service_role THEN
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;
    IF NOT public.can_permission('pos.kds_update') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update';
    END IF;
    IF NOT public.kds_order_in_user_station_scope(p_order_id) THEN
      RAISE EXCEPTION 'KDS_STATION_ACCESS_DENIED';
    END IF;
  END IF;

  IF p_status = 'served' THEN
    PERFORM public._record_kitchen_served_baseline(p_order_id);
  END IF;

  UPDATE public.orders
  SET kitchen_status = p_status,
      kitchen_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE kitchen_sent_at END,
      kitchen_ready_at = CASE WHEN p_status = 'ready' THEN now() ELSE kitchen_ready_at END,
      updated_at = now()
  WHERE id = p_order_id;

  SELECT u.email INTO v_user_email FROM public.users u WHERE u.id = auth.uid();
  INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), v_user_email, 'kitchen_status', 'order', p_order_id,
    jsonb_build_object('status', p_status), v_branch_id
  );
END;
$function$
;
-- Additive read indexes are deliberately retained. Review removal separately.
