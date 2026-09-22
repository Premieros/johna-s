-- V8.1 Realtime wake signal.
-- Canonical Production migration after successful local paper test and
-- exact-head Full Verify Green. Does not change V7 RPC signatures, queue
-- state machine, payload, printer routing, or receipt renderer.

CREATE TABLE IF NOT EXISTS public.cloud_print_wake_state (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  seq bigint NOT NULL DEFAULT 0,
  last_kind text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cloud_print_wake_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_print_wake_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_print_wake_state REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE public.cloud_print_wake_state FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.cloud_print_wake_state TO authenticated;
GRANT ALL ON TABLE public.cloud_print_wake_state TO service_role;

DROP POLICY IF EXISTS cloud_print_wake_state_agent_read
  ON public.cloud_print_wake_state;

CREATE POLICY cloud_print_wake_state_agent_read
ON public.cloud_print_wake_state
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
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
EXECUTE FUNCTION public.touch_cloud_print_v8_wake_state();

DO $publication$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cloud_print_wake_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.cloud_print_wake_state;
  END IF;
END
$publication$;

