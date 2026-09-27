-- Automatic fixed-time business-day close.
-- Runs independently of browser/user sessions and preserves open shifts/orders.
-- Only fixed_time branches participate.
--
-- Safety:
-- - system closes use closed_by = NULL; no employee impersonation
-- - one immutable daily_closes row per branch/business_date
-- - current business-day state advances at the configured cutoff before snapshot build
--   so post-cutoff activity cannot leak into the prior day
-- - missed due dates after the latest close are caught up idempotently
-- - pg_cron installation/scheduling is guarded for environments where the extension
--   is unavailable (for example some CI images)

CREATE OR REPLACE FUNCTION private.business_day_fixed_cutoff(
  p_branch_id uuid,
  p_business_date date
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_start time := '00:00';
  v_end time := '00:00';
BEGIN
  SELECT
    COALESCE(bs.business_day_start,'00:00'::time),
    COALESCE(bs.business_day_end,'00:00'::time)
  INTO v_start,v_end
  FROM public.branch_settings bs
  WHERE bs.branch_id=p_branch_id;

  RETURN (
    (
      p_business_date
      + CASE WHEN v_end<=v_start THEN 1 ELSE 0 END
    )::timestamp
    + v_end
  ) AT TIME ZONE 'Africa/Cairo';
END;
$function$;

REVOKE ALL ON FUNCTION private.business_day_fixed_cutoff(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.business_day_fixed_cutoff(uuid,date) TO service_role;

CREATE OR REPLACE FUNCTION private.run_due_business_day_closes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_branch record;
  v_state jsonb;
  v_state_date date;
  v_last_close date;
  v_candidate date;
  v_cutoff timestamptz;
  v_report jsonb;
  v_next_date date;
  v_close_id uuid;
  v_closed_count integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
BEGIN
  FOR v_branch IN
    SELECT b.id AS branch_id
    FROM public.branches b
    JOIN public.branch_settings bs ON bs.branch_id=b.id
    WHERE COALESCE(bs.business_day_mode,'fixed_time')='fixed_time'
    ORDER BY b.id
  LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('auto_business_day_close:'||v_branch.branch_id::text,0));

      v_state:=public._ensure_business_day_state(v_branch.branch_id);
      v_state_date:=NULLIF(v_state->>'business_date','')::date;

      SELECT max(dc.business_date)
      INTO v_last_close
      FROM public.daily_closes dc
      WHERE dc.branch_id=v_branch.branch_id
        AND dc.status='closed';

      v_candidate:=COALESCE(v_last_close+1,v_state_date);

      WHILE v_candidate IS NOT NULL
        AND v_state_date IS NOT NULL
        AND v_candidate<=v_state_date
      LOOP
        v_cutoff:=private.business_day_fixed_cutoff(v_branch.branch_id,v_candidate);
        EXIT WHEN v_cutoff IS NULL OR now()<v_cutoff;

        IF EXISTS (
          SELECT 1
          FROM public.daily_closes dc
          WHERE dc.branch_id=v_branch.branch_id
            AND dc.business_date=v_candidate
        ) THEN
          v_candidate:=v_candidate+1;
          CONTINUE;
        END IF;

        -- When closing the currently active state, advance it first at the exact
        -- configured cutoff. The function call is transactional; any later error
        -- rolls the state change back with the snapshot insert.
        IF v_state_date=v_candidate THEN
          v_next_date:=public._next_unclosed_business_date(
            v_branch.branch_id,
            v_candidate+1
          );

          UPDATE public.business_day_state
          SET business_date=v_next_date,
              started_at=v_cutoff,
              updated_at=now()
          WHERE branch_id=v_branch.branch_id;

          v_state_date:=v_next_date;
        END IF;

        v_report:=private.normalize_day_close_cash(
          public._build_day_closing_report(v_branch.branch_id,v_candidate),
          v_branch.branch_id
        );

        INSERT INTO public.daily_closes(
          branch_id,
          business_date,
          status,
          closed_at,
          closed_by,
          report_snapshot
        )
        VALUES(
          v_branch.branch_id,
          v_candidate,
          'closed',
          v_cutoff,
          NULL,
          v_report
        )
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_close_id;

        IF v_close_id IS NOT NULL THEN
          v_closed_count:=v_closed_count+1;
          v_closed:=v_closed || jsonb_build_array(jsonb_build_object(
            'branch_id',v_branch.branch_id,
            'business_date',v_candidate,
            'closed_at',v_cutoff,
            'daily_close_id',v_close_id
          ));
        END IF;

        v_close_id:=NULL;
        v_candidate:=v_candidate+1;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_errors:=v_errors || jsonb_build_array(jsonb_build_object(
        'branch_id',v_branch.branch_id,
        'error',SQLERRM,
        'sqlstate',SQLSTATE
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',jsonb_array_length(v_errors)=0,
    'closed_count',v_closed_count,
    'closed',v_closed,
    'errors',v_errors,
    'checked_at',now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.run_due_business_day_closes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.run_due_business_day_closes() TO service_role;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_available_extensions
    WHERE name='pg_cron'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

    EXECUTE $sql$
      SELECT cron.schedule(
        'auto-business-day-close',
        '* * * * *',
        'SELECT private.run_due_business_day_closes();'
      )
    $sql$;
  END IF;
END;
$do$;
