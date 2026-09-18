-- Current live business-day scope in shift_span mode starts with the currently
-- open shift. Historical/finalized day reports keep the full first-shift -> last-shift
-- window once no shift is open, so day-close history is not lost.
--
-- This is intentionally limited to shift_span. fixed_time keeps its configured
-- boundary because auto-close depends on that configured end.

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
  v_active_shift_id uuid;
  v_active_shift_start timestamptz;
  v_active_business_date date;
  v_current_shift_only boolean := false;
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

    -- A live workday is the current open shift. This prevents previous shifts,
    -- purchases or expenses from leaking into the live "current day" view.
    SELECT
      s.id,
      s.opened_at,
      ((s.opened_at AT TIME ZONE 'Africa/Cairo')::date
        - CASE
            WHEN (s.opened_at AT TIME ZONE 'Africa/Cairo')::time < v_start_time THEN 1
            ELSE 0
          END)
    INTO v_active_shift_id,v_active_shift_start,v_active_business_date
    FROM public.shifts s
    WHERE s.branch_id=p_branch_id
      AND s.status='open'
    ORDER BY s.opened_at DESC,s.id DESC
    LIMIT 1;

    IF v_active_shift_id IS NOT NULL AND v_active_business_date=p_business_date THEN
      v_start := v_active_shift_start;
      v_end := now();
      v_current_shift_only := true;
    ELSIF v_shift_count=0 OR v_start IS NULL THEN
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
    'current_shift_only',v_current_shift_only,
    'active_shift_id',v_active_shift_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_business_day_window(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_business_day_window(uuid,date) TO service_role,postgres;
