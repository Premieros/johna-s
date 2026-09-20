BEGIN;

-- Fully returned sales are never hard-deleted. Archiving removes them from
-- operational sales/day/shift reports while preserving inventory, accounting,
-- print and audit history.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_branch_archived_created
  ON public.sales(branch_id, is_archived, created_at DESC);

CREATE OR REPLACE FUNCTION public.archive_returned_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
  END IF;

  IF NOT public.is_pos_admin()
     AND NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT public.is_pos_admin()
     AND NOT public.can_permission('refunds.approve') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'refunds.approve'
    );
  END IF;

  -- Full return is established from the actual returned quantities, not from
  -- refunded_amount. This is required for valid 100%-discount invoices whose
  -- financial total/refund amount can both be zero.
  IF v_sale.status <> 'returned'
     OR NOT EXISTS (
       SELECT 1 FROM public.sale_items si WHERE si.sale_id = p_sale_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.sale_items si
       WHERE si.sale_id = p_sale_id
         AND COALESCE(si.refunded_quantity,0) < COALESCE(si.quantity,0)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FULL_REFUND_REQUIRED');
  END IF;

  UPDATE public.sales
  SET is_archived = true,
      archived_at = COALESCE(archived_at, now()),
      archived_by = COALESCE(archived_by, v_uid)
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'archived', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_returned_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_returned_sale(uuid) TO authenticated, service_role;

-- Operational day and shift reports exclude only archived, fully returned
-- invoices. Normal discounts (including legitimate 100% discounts) remain
-- visible until an actual refund is completed and the returned sale is archived.
CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_active_shift public.shifts%ROWTYPE;
  v_start_time time:='00:00';
  v_active_business_date date;
BEGIN
  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name
  FROM public.branches b WHERE b.id=p_branch_id;

  -- Live workday = currently open shift, for both fixed_time and shift_span.
  -- Historical/final day close remains on the canonical configured window
  -- because this override disappears as soon as no shift is open.
  SELECT * INTO v_active_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  IF v_active_shift.id IS NOT NULL THEN
    SELECT COALESCE(bs.business_day_start,'00:00'::time)
    INTO v_start_time
    FROM public.branch_settings bs
    WHERE bs.branch_id=p_branch_id;

    v_active_business_date := (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::date;
    IF (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::time < v_start_time THEN
      v_active_business_date := v_active_business_date - 1;
    END IF;

    IF v_active_business_date=p_business_date THEN
      v_start := v_active_shift.opened_at;
      v_end := now();
    END IF;
  END IF;

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
    AND COALESCE(s.is_archived,false)=false
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
    WHERE s.branch_id=p_branch_id
      AND COALESCE(s.is_archived,false)=false
      AND s.created_at>=v_start AND s.created_at<=v_end
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
  LEFT JOIN public.users u ON u.id=COALESCE(a.created_by,s.cashier_id)
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
$function$;

COMMIT;
