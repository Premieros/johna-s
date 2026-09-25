-- Extend V8 Realtime wake to Cleopatra while preserving Smouha.
-- Forward-only and branch-scoped. Does NOT modify cloud print queue RPCs,
-- printer routing, payloads, receipt rendering, or V7 executable behavior.

DROP POLICY IF EXISTS cloud_print_wake_state_agent_read
  ON public.cloud_print_wake_state;

CREATE POLICY cloud_print_wake_state_agent_read
ON public.cloud_print_wake_state
FOR SELECT TO authenticated
USING (
  branch_id IN (
    '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid, -- Smouha
    '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid  -- Cleopatra
  )
  AND public.user_may_access_branch(branch_id)
  AND (
    public.can_execute_cloud_print_kind('kitchen')
    OR public.can_execute_cloud_print_kind('receipt')
  )
);

CREATE OR REPLACE FUNCTION public.touch_cloud_print_v8_wake_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.branch_id NOT IN (
    '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid,
    '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cloud_print_wake_state(branch_id, seq, last_kind, updated_at)
  VALUES (NEW.branch_id, 1, NEW.kind, now())
  ON CONFLICT (branch_id) DO UPDATE
  SET seq = public.cloud_print_wake_state.seq + 1,
      last_kind = EXCLUDED.last_kind,
      updated_at = now();

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.touch_cloud_print_v8_wake_state()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_cloud_print_v8_wake_state()
  TO service_role;

DROP TRIGGER IF EXISTS trg_cloud_print_v8_wake
  ON public.cloud_print_jobs;

CREATE TRIGGER trg_cloud_print_v8_wake
AFTER INSERT ON public.cloud_print_jobs
FOR EACH ROW
WHEN (
  NEW.branch_id IN (
    '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid,
    '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid
  )
)
EXECUTE FUNCTION public.touch_cloud_print_v8_wake_state();
