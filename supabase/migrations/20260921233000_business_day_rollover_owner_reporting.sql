-- Business-day rollover without closing the active shift.
-- Also restores per-user shift sales attribution to the order/table owner.
--
-- Safety:
-- - shift id stays unchanged during rollover;
-- - open orders/tables are untouched;
-- - payment collector remains in shift_operations.created_by for audit;
-- - sales/user report ownership comes from sales.cashier_id;
-- - historical daily-close snapshots remain immutable.

CREATE TABLE IF NOT EXISTS public.business_day_state (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_day_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_day_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.business_day_state TO service_role,postgres;

CREATE OR REPLACE FUNCTION public._next_unclosed_business_date(
  p_branch_id uuid,
  p_candidate date
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_date date:=p_candidate;
BEGIN
  WHILE EXISTS (
    SELECT 1
    FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id
      AND dc.business_date=v_date
  ) LOOP
    v_date:=v_date+1;
  END LOOP;
  RETURN v_date;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ensure_business_day_state(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_existing public.business_day_state%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_last_close public.daily_closes%ROWTYPE;
  v_start_time time:='00:00';
  v_candidate date;
  v_started_at timestamptz;
  v_local_open timestamp;
BEGIN
  SELECT * INTO v_existing
  FROM public.business_day_state
  WHERE branch_id=p_branch_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'branch_id',v_existing.branch_id,
      'business_date',v_existing.business_date,
      'started_at',v_existing.started_at,
      'updated_at',v_existing.updated_at
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_day_state:'||p_branch_id::text,0));

  SELECT * INTO v_existing
  FROM public.business_day_state
  WHERE branch_id=p_branch_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'branch_id',v_existing.branch_id,
      'business_date',v_existing.business_date,
      'started_at',v_existing.started_at,
      'updated_at',v_existing.updated_at
    );
  END IF;

  SELECT COALESCE(bs.business_day_start,'00:00'::time)
  INTO v_start_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id
    AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  SELECT * INTO v_last_close
  FROM public.daily_closes dc
  WHERE dc.branch_id=p_branch_id
  ORDER BY dc.business_date DESC,dc.closed_at DESC NULLS LAST,dc.id DESC
  LIMIT 1;

  IF v_shift.id IS NOT NULL THEN
    v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
    v_candidate:=v_local_open::date;
    IF v_local_open::time < v_start_time THEN
      v_candidate:=v_candidate-1;
    END IF;

    IF v_last_close.id IS NOT NULL
       AND v_last_close.closed_at IS NOT NULL
       AND v_shift.opened_at>v_last_close.closed_at THEN
      v_candidate:=GREATEST(v_candidate,v_last_close.business_date+1);
    END IF;
    v_started_at:=v_shift.opened_at;
  ELSE
    v_candidate:=(now() AT TIME ZONE 'Africa/Cairo')::date;
    IF (now() AT TIME ZONE 'Africa/Cairo')::time < v_start_time THEN
      v_candidate:=v_candidate-1;
    END IF;
    IF v_last_close.id IS NOT NULL THEN
      v_candidate:=GREATEST(v_candidate,v_last_close.business_date+1);
    END IF;
    v_started_at:=COALESCE(v_last_close.closed_at,now());
  END IF;

  v_candidate:=public._next_unclosed_business_date(p_branch_id,v_candidate);

  INSERT INTO public.business_day_state(branch_id,business_date,started_at,updated_at)
  VALUES(p_branch_id,v_candidate,v_started_at,now())
  ON CONFLICT(branch_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.business_day_state
  WHERE branch_id=p_branch_id;

  RETURN jsonb_build_object(
    'branch_id',v_existing.branch_id,
    'business_date',v_existing.business_date,
    'started_at',v_existing.started_at,
    'updated_at',v_existing.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_business_day(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_state jsonb;
  v_shift_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  v_state:=public._ensure_business_day_state(p_branch_id);

  SELECT s.id INTO v_shift_id
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success',true,
    'branch_id',p_branch_id,
    'business_date',v_state->>'business_date',
    'started_at',v_state->>'started_at',
    'shift_id',v_shift_id,
    'shift_open',v_shift_id IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_current_business_day(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_current_business_day(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public._resolve_business_day_window(p_branch_id uuid, p_business_date date)
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
  v_state jsonb;
  v_state_date date;
  v_state_start timestamptz;
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

  v_state:=public._ensure_business_day_state(p_branch_id);
  v_state_date:=NULLIF(v_state->>'business_date','')::date;
  v_state_start:=NULLIF(v_state->>'started_at','')::timestamptz;

  IF v_state_date=p_business_date AND v_state_start IS NOT NULL THEN
    SELECT
      count(*)::int,
      count(*) FILTER (WHERE s.status='open')::int
    INTO v_shift_count,v_open_shift_count
    FROM public.shifts s
    WHERE s.branch_id=p_branch_id
      AND s.opened_at<=now()
      AND COALESCE(s.closed_at,now())>=v_state_start;

    RETURN jsonb_build_object(
      'mode',v_mode,
      'start_at',v_state_start,
      'end_at',now(),
      'nominal_start_at',v_nominal_start,
      'next_cutoff_at',v_nominal_next,
      'shift_count',v_shift_count,
      'open_shift_count',v_open_shift_count,
      'has_shifts',v_shift_count>0,
      'configured_start',v_start_time::text,
      'configured_end',v_end_time::text,
      'active_state',true
    );
  END IF;

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
    'configured_end',v_end_time::text,
    'active_state',false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_day_closing_report(p_branch_id uuid,p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_state jsonb;
  v_state_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin()
     AND NOT public.can_permission('shifts.day_close')
     AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;

  v_state:=public._ensure_business_day_state(p_branch_id);
  v_state_date:=NULLIF(v_state->>'business_date','')::date;

  IF v_state_date=p_day THEN
    RETURN public._build_day_closing_report(p_branch_id,p_day)
      || jsonb_build_object('daily_close_status','open','snapshot',false,'active_business_day',true);
  END IF;

  SELECT report_snapshot INTO v_snapshot
  FROM public.daily_closes
  WHERE branch_id=p_branch_id AND business_date=p_day;

  IF v_snapshot IS NOT NULL AND v_snapshot<>'{}'::jsonb THEN
    RETURN v_snapshot
      || jsonb_build_object('daily_close_status','closed','snapshot',true,'active_business_day',false);
  END IF;

  RETURN public._build_day_closing_report(p_branch_id,p_day)
    || jsonb_build_object('daily_close_status','open','snapshot',false,'active_business_day',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_day_closing_report(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_day_closing_report(uuid,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.rollover_business_day(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_state public.business_day_state%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_report jsonb;
  v_close_id uuid;
  v_next_date date;
  v_now timestamptz:=now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.day_close') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.day_close');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('business_day_state:'||p_branch_id::text,0));
  PERFORM public._ensure_business_day_state(p_branch_id);

  SELECT * INTO v_state
  FROM public.business_day_state
  WHERE branch_id=p_branch_id
  FOR UPDATE;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','NO_OPEN_SHIFT_FOR_ROLLOVER');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id AND dc.business_date=v_state.business_date
  ) THEN
    RETURN jsonb_build_object('success',false,'error','CURRENT_BUSINESS_DAY_ALREADY_CLOSED');
  END IF;

  v_report:=public._build_day_closing_report(p_branch_id,v_state.business_date);

  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,v_state.business_date,v_uid,v_report)
  RETURNING id INTO v_close_id;

  v_next_date:=public._next_unclosed_business_date(p_branch_id,v_state.business_date+1);

  UPDATE public.business_day_state
  SET business_date=v_next_date,
      started_at=v_now,
      updated_at=v_now
  WHERE branch_id=p_branch_id;

  PERFORM public.log_audit_action(
    p_branch_id,
    'business_day_rollover',
    'daily_close',
    v_close_id,
    jsonb_build_object(
      'closed_business_date',v_state.business_date,
      'next_business_date',v_next_date,
      'shift_id',v_shift.id,
      'shift_preserved',true,
      'boundary_at',v_now
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'rolled_over',true,
    'daily_close_id',v_close_id,
    'closed_business_date',v_state.business_date,
    'next_business_date',v_next_date,
    'shift_id',v_shift.id,
    'shift_preserved',true,
    'boundary_at',v_now,
    'report',v_report
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rollover_business_day(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rollover_business_day(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.day_close(p_branch_id uuid, p_business_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_result jsonb;
  v_state jsonb;
  v_state_date date;
  v_next_date date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.day_close') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.day_close');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.branch_id=p_branch_id AND s.status='open'
  ) THEN
    RETURN public.rollover_business_day(p_branch_id);
  END IF;

  v_result:=public._finalize_day_close(
    p_branch_id,
    COALESCE(p_business_date,(now() AT TIME ZONE 'Africa/Cairo')::date),
    v_uid
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE
     AND COALESCE((v_result->>'already_closed')::boolean,false) IS NOT TRUE THEN
    v_state:=public._ensure_business_day_state(p_branch_id);
    v_state_date:=NULLIF(v_state->>'business_date','')::date;
    IF v_state_date=COALESCE(p_business_date,(now() AT TIME ZONE 'Africa/Cairo')::date) THEN
      v_next_date:=public._next_unclosed_business_date(p_branch_id,v_state_date+1);
      UPDATE public.business_day_state
      SET business_date=v_next_date,started_at=now(),updated_at=now()
      WHERE branch_id=p_branch_id;
      v_result:=v_result || jsonb_build_object(
        'closed_business_date',v_state_date,
        'next_business_date',v_next_date,
        'shift_preserved',false
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.day_close(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.day_close(uuid,date) TO authenticated,service_role;

-- Shift report: sales belong to the order/table owner (sales.cashier_id).
-- The authenticated payment collector remains separately in shift_operations.created_by.
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
$function$;

REVOKE ALL ON FUNCTION public.get_shift_closing_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shift_closing_report(uuid) TO authenticated,service_role;

-- Initialize state after functions exist. If a branch already has a closed snapshot
-- followed by a newer open shift, the active shift automatically receives the next
-- unused business date while keeping its original shift id.
SELECT public._ensure_business_day_state(b.id)
FROM public.branches b
WHERE b.is_active=true;

REVOKE ALL ON FUNCTION public._next_unclosed_business_date(uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._ensure_business_day_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._next_unclosed_business_date(uuid,date) TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._ensure_business_day_state(uuid) TO service_role,postgres;
