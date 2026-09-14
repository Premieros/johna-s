-- Compatibility closure for branch-scoped kitchen stations.
-- 1) Existing/reused branches receive branch-owned station copies even when branch
--    setup uses UPDATE/ON CONFLICT instead of a fresh INSERT.
-- 2) A truly missing station UUID is left to the FK to reject, preserving the
--    established FK error contract; real cross-branch stations remain blocked.

-- Idempotent self-heal for every branch that currently lacks one or more templates.
INSERT INTO public.kitchen_stations(branch_id, code, name_ar, name_en, is_active, sort_order, created_at)
SELECT b.id, t.code, t.name_ar, t.name_en, t.is_active, t.sort_order, now()
FROM public.branches b
CROSS JOIN public.kitchen_stations t
WHERE t.branch_id IS NULL
  AND lower(btrim(t.code)) <> 'cashier'
ON CONFLICT DO NOTHING;

-- Reuse the existing seeder but run it after INSERT OR UPDATE because CI and some
-- setup flows use INSERT ... ON CONFLICT DO UPDATE for branch fixtures/config.
DROP TRIGGER IF EXISTS trg_seed_kitchen_stations_on_branch_insert ON public.branches;
DROP TRIGGER IF EXISTS trg_seed_kitchen_stations_on_branch_write ON public.branches;
CREATE TRIGGER trg_seed_kitchen_stations_on_branch_write
AFTER INSERT OR UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.seed_kitchen_stations_for_new_branch();

CREATE OR REPLACE FUNCTION public._guard_category_kitchen_station_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_station_branch uuid;
  v_station_code text;
  v_station_active boolean;
BEGIN
  IF NEW.kitchen_station_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.branch_id, lower(btrim(s.code)), s.is_active
  INTO v_station_branch, v_station_code, v_station_active
  FROM public.kitchen_stations s
  WHERE s.id = NEW.kitchen_station_id;

  -- Preserve the existing foreign-key contract for an unknown UUID. The FK still
  -- rejects it; this guard only owns cross-branch/disabled/cashier validation.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_station_branch IS NULL OR v_station_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
  END IF;
  IF NOT COALESCE(v_station_active, false) OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'KITCHEN_STATION_NOT_AVAILABLE';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public._guard_category_kitchen_station_branch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_category_kitchen_station_branch() TO service_role, postgres;
