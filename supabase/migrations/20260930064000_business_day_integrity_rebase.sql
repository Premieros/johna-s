-- Rebased Business Day integrity guard on top of emergency financial/readings fixes.
-- Scope: business_day_state / manual rollover / no-open-shift day_close only.
-- No treasury formula, printing, KDS, inventory, payment, or historical data rewrite.

CREATE OR REPLACE FUNCTION private.current_fixed_business_date(
  p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_start time := '00:00';
  v_local timestamp;
  v_business_date date;
BEGIN
  SELECT COALESCE(bs.business_day_start,'00:00'::time)
  INTO v_start
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  v_local:=p_at AT TIME ZONE 'Africa/Cairo';
  v_business_date:=v_local::date;
  IF v_local::time < v_start THEN
    v_business_date:=v_business_date-1;
  END IF;
  RETURN v_business_date;
END;
$function$;

REVOKE ALL ON FUNCTION private.current_fixed_business_date(uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.current_fixed_business_date(uuid,timestamptz)
  TO service_role,postgres;

CREATE OR REPLACE FUNCTION private.max_reachable_business_state_date(
  p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_business_date date;
  v_cutoff timestamptz;
BEGIN
  v_business_date:=private.current_fixed_business_date(p_branch_id,p_at);
  v_cutoff:=private.business_day_fixed_cutoff(p_branch_id,v_business_date);
  IF v_cutoff IS NOT NULL AND p_at>=v_cutoff THEN
    RETURN v_business_date+1;
  END IF;

  RETURN v_business_date;
END;
$function$;

REVOKE ALL ON FUNCTION private.max_reachable_business_state_date(uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.max_reachable_business_state_date(uuid,timestamptz)
  TO service_role,postgres;

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
  v_max_date date;
  v_started_at timestamptz;
  v_local_open timestamp;
  v_next date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business_day_state:'||p_branch_id::text,0));

  SELECT COALESCE(bs.business_day_start,'00:00'::time)
  INTO v_start_time
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  v_max_date:=private.max_reachable_business_state_date(p_branch_id,now());

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

  SELECT * INTO v_existing
  FROM public.business_day_state
  WHERE branch_id=p_branch_id
  FOR UPDATE;

  IF v_existing.branch_id IS NOT NULL THEN
    IF v_shift.id IS NOT NULL AND v_existing.started_at < v_shift.opened_at THEN
      v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
      v_candidate:=v_local_open::date;
      IF v_local_open::time < v_start_time THEN
        v_candidate:=v_candidate-1;
      END IF;

      IF v_last_close.id IS NOT NULL
         AND v_last_close.closed_at IS NOT NULL
         AND v_shift.opened_at>v_last_close.closed_at
         AND v_last_close.business_date < v_max_date THEN
        v_candidate:=GREATEST(
          v_candidate,
          LEAST(v_last_close.business_date+1,v_max_date)
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.daily_closes dc
        WHERE dc.branch_id=p_branch_id AND dc.business_date=v_candidate
      ) AND v_candidate < v_max_date THEN
        v_next:=public._next_unclosed_business_date(p_branch_id,v_candidate+1);
        v_candidate:=LEAST(v_next,v_max_date);
      END IF;

      v_candidate:=LEAST(v_candidate,v_max_date);

      UPDATE public.business_day_state
      SET business_date=v_candidate,
          started_at=v_shift.opened_at,
          updated_at=now()
      WHERE branch_id=p_branch_id
      RETURNING * INTO v_existing;
    END IF;

    RETURN jsonb_build_object(
      'branch_id',v_existing.branch_id,
      'business_date',v_existing.business_date,
      'started_at',v_existing.started_at,
      'updated_at',v_existing.updated_at
    );
  END IF;

  IF v_shift.id IS NOT NULL THEN
    v_local_open:=v_shift.opened_at AT TIME ZONE 'Africa/Cairo';
    v_candidate:=v_local_open::date;
    IF v_local_open::time < v_start_time THEN
      v_candidate:=v_candidate-1;
    END IF;
    v_started_at:=v_shift.opened_at;
  ELSE
    v_candidate:=v_max_date;
    v_started_at:=COALESCE(v_last_close.closed_at,now());
  END IF;

  IF v_last_close.id IS NOT NULL
     AND v_last_close.business_date < v_max_date
     AND v_last_close.closed_at IS NOT NULL
     AND (v_shift.id IS NULL OR v_shift.opened_at>v_last_close.closed_at) THEN
    v_candidate:=GREATEST(
      v_candidate,
      LEAST(v_last_close.business_date+1,v_max_date)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id AND dc.business_date=v_candidate
  ) AND v_candidate < v_max_date THEN
    v_next:=public._next_unclosed_business_date(p_branch_id,v_candidate+1);
    v_candidate:=LEAST(v_next,v_max_date);
  END IF;

  v_candidate:=LEAST(v_candidate,v_max_date);

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

REVOKE ALL ON FUNCTION public._ensure_business_day_state(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_business_day_state(uuid)
  TO service_role,postgres;

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
  v_cutoff timestamptz;
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

  v_cutoff:=private.business_day_fixed_cutoff(p_branch_id,v_state.business_date);
  IF v_cutoff IS NULL OR v_now < v_cutoff THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','BUSINESS_DAY_NOT_FINISHED',
      'business_date',v_state.business_date,
      'cutoff_at',v_cutoff
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id AND dc.business_date=v_state.business_date
  ) THEN
    RETURN jsonb_build_object('success',false,'error','CURRENT_BUSINESS_DAY_ALREADY_CLOSED');
  END IF;

  v_next_date:=v_state.business_date+1;
  IF EXISTS (
    SELECT 1 FROM public.daily_closes dc
    WHERE dc.branch_id=p_branch_id AND dc.business_date=v_next_date
  ) THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','NEXT_BUSINESS_DAY_ALREADY_CLOSED',
      'business_date',v_state.business_date,
      'next_business_date',v_next_date
    );
  END IF;

  v_report:=public._build_day_closing_report(p_branch_id,v_state.business_date);

  INSERT INTO public.daily_closes(branch_id,business_date,closed_by,report_snapshot)
  VALUES(p_branch_id,v_state.business_date,v_uid,v_report)
  RETURNING id INTO v_close_id;

  UPDATE public.business_day_state
  SET business_date=v_next_date,
      started_at=v_cutoff,
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
      'boundary_at',v_cutoff
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
    'boundary_at',v_cutoff,
    'report',v_report
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rollover_business_day(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rollover_business_day(uuid)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.day_close(
  p_branch_id uuid,
  p_business_date date DEFAULT CURRENT_DATE
)
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
  v_target_date date;
  v_cutoff timestamptz;
  v_max_state_date date;
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

  v_target_date:=COALESCE(p_business_date,(now() AT TIME ZONE 'Africa/Cairo')::date);
  v_cutoff:=private.business_day_fixed_cutoff(p_branch_id,v_target_date);
  IF v_cutoff IS NULL OR now()<v_cutoff THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','BUSINESS_DAY_NOT_FINISHED',
      'business_date',v_target_date,
      'cutoff_at',v_cutoff
    );
  END IF;

  v_result:=public._finalize_day_close(
    p_branch_id,
    v_target_date,
    v_uid
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE
     AND COALESCE((v_result->>'already_closed')::boolean,false) IS NOT TRUE THEN
    v_state:=public._ensure_business_day_state(p_branch_id);
    v_state_date:=NULLIF(v_state->>'business_date','')::date;

    IF v_state_date=v_target_date THEN
      v_max_state_date:=private.max_reachable_business_state_date(p_branch_id,now());
      v_next_date:=public._next_unclosed_business_date(p_branch_id,v_state_date+1);
      v_next_date:=LEAST(v_next_date,v_max_state_date);

      UPDATE public.business_day_state
      SET business_date=v_next_date,
          started_at=v_cutoff,
          updated_at=now()
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
GRANT EXECUTE ON FUNCTION public.day_close(uuid,date)
  TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
