-- Fix auto-close using the live-report window end (now()) after business-day rollover support.
-- The auto-close RPC must use the configured fixed cutoff, not the mutable live report boundary.

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
  v_state jsonb;
  v_state_date date;
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

  -- Business-day reporting may intentionally expose end_at=now() while a day is live.
  -- Auto-close must instead use the persisted live business date plus the configured
  -- branch end time so an 08:00 -> 03:00 day closes at 03:00 the following morning.
  v_state:=public._ensure_business_day_state(p_branch_id);
  v_state_date:=NULLIF(v_state->>'business_date','')::date;

  IF v_state_date IS NOT NULL THEN
    v_business_date:=v_state_date;
  ELSE
    v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
    v_business_date:=v_local_open::date;
    IF v_end_time<=v_start_time AND v_local_open::time<v_end_time THEN
      v_business_date:=v_business_date-1;
    END IF;
  END IF;

  v_window_end:=(
    (
      (v_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp
      + v_end_time
    ) AT TIME ZONE 'Africa/Cairo'
  );

  -- Never let a stale or gap-period business date produce a cutoff at/before
  -- the shift opening instant. Advance to the first configured cutoff after open.
  WHILE v_window_end<=v_shift.opened_at LOOP
    v_business_date:=v_business_date+1;
    v_window_end:=(
      (
        (v_business_date + CASE WHEN v_end_time<=v_start_time THEN 1 ELSE 0 END)::timestamp
        + v_end_time
      ) AT TIME ZONE 'Africa/Cairo'
    );
  END LOOP;

  IF now()<v_window_end THEN
    RETURN jsonb_build_object(
      'success',true,'closed',false,'reason','BUSINESS_DAY_NOT_FINISHED',
      'business_date',v_business_date,
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
      'business_date',v_business_date,
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
