-- Shift drawer model and treasury day-close reconciliation.
-- Shift drawer starts at zero. Negative shift net/actual values are valid.
-- Branch treasury remains cumulative and is not reset by shift/day close.

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_nonnegative_amounts;

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_opening_amount_nonnegative;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_opening_amount_nonnegative
  CHECK (opening_amount >= 0);

CREATE OR REPLACE FUNCTION public.open_shift(
  p_branch_id uuid,
  p_opening_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_primary_branch uuid;
  v_shift_id uuid;
  v_opener uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('shifts.open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_ALLOWED', 'detail', 'Opening shifts requires shifts.open.');
  END IF;

  SELECT branch_id INTO v_primary_branch
  FROM public.users
  WHERE id = v_uid;

  IF p_branch_id IS NULL THEN p_branch_id := v_primary_branch; END IF;
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_BRANCH');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_branch_id::text)::bigint);

  SELECT id, cashier_id INTO v_shift_id, v_opener
  FROM public.shifts
  WHERE branch_id = p_branch_id AND status = 'open'
  ORDER BY opened_at, id
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'shift_id', v_shift_id,
      'branch_id', p_branch_id,
      'shared', true,
      'already_open', true,
      'opened_by', v_opener
    );
  END IF;

  -- Canonical drawer contract: every new shift starts from zero.
  -- p_opening_amount is retained only for API compatibility and intentionally ignored.
  INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, notes)
  VALUES (p_branch_id, v_uid, 0, p_notes)
  RETURNING id INTO v_shift_id;

  INSERT INTO public.shift_operations (
    shift_id, operation_type, amount, payment_method, reference_type, created_by
  ) VALUES (
    v_shift_id, 'opening', 0, 'cash', 'shift_opening', v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', v_shift_id,
    'branch_id', p_branch_id,
    'shared', true,
    'already_open', false,
    'opened_by', v_uid,
    'opening_amount', 0
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.open_shift(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_shift_with_open_orders(
  p_shift_id uuid,
  p_actual_amount numeric,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_actual numeric(14,2);
  v_diff numeric(14,2);
  v_open_order_count integer := 0;
  v_open_table_count integer := 0;
  v_next_shift_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id=v_uid AND u.is_active=true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.is_pos_admin()
     AND (
       NOT public.can_permission('shifts.close')
       OR NOT public.can_permission('shifts.close_with_open_orders')
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SHIFT_CLOSE_OPEN_ORDERS_DENIED',
      'detail', 'Closing a shift with open orders requires shifts.close and shifts.close_with_open_orders.'
    );
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  WHERE s.id=p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.status='closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  IF NOT public.is_pos_admin()
     AND v_shift.cashier_id<>v_uid
     AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;

  -- Serialize close + successor-open for the branch.
  PERFORM pg_advisory_xact_lock(hashtext(v_shift.branch_id::text)::bigint);

  SELECT
    count(*)::int,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=v_shift.branch_id
    AND o.status IN ('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id
        AND oi.quantity>0
    );

  v_expected:=public._compute_shift_expected_cash(p_shift_id);
  v_actual:=COALESCE(p_actual_amount,v_expected);
  v_diff:=round(v_actual-v_expected,2);

  UPDATE public.shifts
  SET status='closed',
      closed_at=now(),
      expected_amount=v_expected,
      actual_amount=v_actual,
      difference=v_diff,
      notes=CASE
        WHEN v_open_order_count=0 THEN COALESCE(p_notes,notes)
        ELSE concat_ws(
          E'\n',
          NULLIF(COALESCE(p_notes,notes),''),
          format('Closed with %s open/held operational order(s); successor shift opened automatically.',v_open_order_count)
        )
      END
  WHERE id=p_shift_id
    AND branch_id=v_shift.branch_id
    AND status='open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  -- Orders are branch-level operational rows and intentionally are not mutated.
  -- If open orders remain, a new zero-opening branch shift becomes the active
  -- financial settlement target. Later payment of those orders is therefore
  -- recorded on the successor shift by the canonical payment flow.
  IF v_open_order_count>0 THEN
    INSERT INTO public.shifts(
      branch_id,cashier_id,opening_amount,expected_amount,difference,status,notes
    )
    VALUES(
      v_shift.branch_id,v_uid,0,0,0,'open',
      format('Auto-opened after shift %s closed with %s open/held order(s).',p_shift_id,v_open_order_count)
    )
    RETURNING id INTO v_next_shift_id;

    INSERT INTO public.shift_operations(
      shift_id,operation_type,amount,payment_method,reference_type,created_by
    )
    VALUES(
      v_next_shift_id,'opening',0,'cash','shift_opening',v_uid
    );
  END IF;

  PERFORM public.log_audit_action(
    v_shift.branch_id,
    'shift_close_with_open_orders',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'cashier_id',v_shift.cashier_id,
      'expected',v_expected,
      'actual',v_actual,
      'difference',v_diff,
      'open_order_count',v_open_order_count,
      'open_table_count',v_open_table_count,
      'orders_preserved',true,
      'successor_shift_id',v_next_shift_id,
      'successor_opening_amount',CASE WHEN v_next_shift_id IS NULL THEN NULL ELSE 0 END
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'shift_id',p_shift_id,
    'expected',v_expected,
    'actual',v_actual,
    'difference',v_diff,
    'open_orders_preserved',v_open_order_count>0,
    'open_order_count',v_open_order_count,
    'open_table_count',v_open_table_count,
    'next_shift_id',v_next_shift_id,
    'next_shift_opening_amount',CASE WHEN v_next_shift_id IS NULL THEN NULL ELSE 0 END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_branch_treasury_day_close_reconciliation(
  p_branch_id uuid,
  p_limit integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT (
    public.can_permission('accounts.view')
    OR public.can_permission('reports.view')
    OR public.is_pos_admin()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  WITH closes AS (
    SELECT
      dc.id,
      dc.business_date,
      dc.created_at AS closed_at,
      dc.report_snapshot,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(dc.report_snapshot->'payment_methods','[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method',''))='cash'
      ),0)::numeric AS cash_sales,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(dc.report_snapshot->'payment_methods','[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method','')) IN ('card','bank','transfer')
      ),0)::numeric AS bank_sales,
      COALESCE((
        SELECT sum((pm->>'sales_total')::numeric)
        FROM jsonb_array_elements(COALESCE(dc.report_snapshot->'payment_methods','[]'::jsonb)) pm
        WHERE lower(COALESCE(pm->>'method',''))='credit'
      ),0)::numeric AS credit_sales,
      COALESCE(NULLIF(dc.report_snapshot->>'net_sales','')::numeric,0) AS net_sales,
      COALESCE(NULLIF(dc.report_snapshot->>'expenses','')::numeric,0) AS expenses,
      COALESCE(NULLIF(dc.report_snapshot->>'cash_purchases','')::numeric,0) AS cash_purchases
    FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id
    ORDER BY dc.created_at DESC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,60),365))
  ),
  account_balances AS (
    SELECT
      c.id close_id,
      t.account_type,
      sum(
        COALESCE(t.opening_balance,0)
        + COALESCE((
          SELECT sum(l.debit-l.credit)
          FROM public.journal_entry_lines l
          JOIN public.journal_entries je ON je.id=l.journal_entry_id
          WHERE l.account_id=t.account_id
            AND je.created_at<=c.closed_at
        ),0)
      ) AS balance
    FROM closes c
    JOIN public.treasury_accounts t
      ON t.branch_id=p_branch_id
     AND t.is_active
     AND COALESCE(t.scope,'branch')='branch'
    GROUP BY c.id,t.account_type
  ),
  rows AS (
    SELECT
      c.*,
      round(COALESCE(cash.balance,0),2) AS cash_balance_after_close,
      round(COALESCE(bank.balance,0),2) AS bank_balance_after_close,
      round(COALESCE(cash.balance,0)+COALESCE(bank.balance,0),2) AS total_balance_after_close
    FROM closes c
    LEFT JOIN account_balances cash ON cash.close_id=c.id AND cash.account_type='cash'
    LEFT JOIN account_balances bank ON bank.close_id=c.id AND bank.account_type='bank'
  ),
  sequenced AS (
    SELECT
      r.*,
      lag(r.cash_balance_after_close) OVER (ORDER BY r.closed_at) AS previous_cash_balance,
      lag(r.bank_balance_after_close) OVER (ORDER BY r.closed_at) AS previous_bank_balance,
      lag(r.total_balance_after_close) OVER (ORDER BY r.closed_at) AS previous_total_balance
    FROM rows r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'daily_close_id',s.id,
    'business_date',s.business_date,
    'closed_at',s.closed_at,
    'cash_sales',round(s.cash_sales,2),
    'bank_sales',round(s.bank_sales,2),
    'credit_sales',round(s.credit_sales,2),
    'net_sales',round(s.net_sales,2),
    'expenses',round(s.expenses,2),
    'cash_purchases',round(s.cash_purchases,2),
    'cash_balance_after_close',s.cash_balance_after_close,
    'bank_balance_after_close',s.bank_balance_after_close,
    'total_balance_after_close',s.total_balance_after_close,
    'previous_cash_balance',s.previous_cash_balance,
    'previous_bank_balance',s.previous_bank_balance,
    'previous_total_balance',s.previous_total_balance,
    'cash_movement_since_previous_close',
      CASE WHEN s.previous_cash_balance IS NULL THEN NULL
           ELSE round(s.cash_balance_after_close-s.previous_cash_balance,2) END,
    'bank_movement_since_previous_close',
      CASE WHEN s.previous_bank_balance IS NULL THEN NULL
           ELSE round(s.bank_balance_after_close-s.previous_bank_balance,2) END,
    'total_movement_since_previous_close',
      CASE WHEN s.previous_total_balance IS NULL THEN NULL
           ELSE round(s.total_balance_after_close-s.previous_total_balance,2) END
  ) ORDER BY s.closed_at DESC),'[]'::jsonb)
  INTO v_result
  FROM sequenced s;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'rows', COALESCE(v_result,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_treasury_day_close_reconciliation(uuid,integer) TO authenticated, service_role;
