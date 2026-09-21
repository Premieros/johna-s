-- Allow each branch to choose how many of the canonical Main Area tables are active.
-- Canonical identities Table 01..Table 50 remain protected and undeletable.
-- Default remains 50 for every branch unless branch_settings overrides it.

BEGIN;

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS main_area_table_count integer NOT NULL DEFAULT 50;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branch_settings_main_area_table_count_check'
      AND conrelid = 'public.branch_settings'::regclass
  ) THEN
    ALTER TABLE public.branch_settings
      ADD CONSTRAINT branch_settings_main_area_table_count_check
      CHECK (main_area_table_count BETWEEN 1 AND 50);
  END IF;
END;
$constraint$;

COMMENT ON COLUMN public.branch_settings.main_area_table_count IS
  'Number of active canonical Main Area tables for this branch. Canonical rows Table 01..Table 50 remain protected.';

CREATE OR REPLACE FUNCTION private.default_dining_table_limit(p_branch_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (
      SELECT bs.main_area_table_count
      FROM public.branch_settings bs
      WHERE bs.branch_id = p_branch_id
    ),
    50
  );
$function$;

CREATE OR REPLACE FUNCTION private.guard_default_dining_table_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old_default boolean := false;
  v_new_default boolean := false;
  v_limit integer := 50;
  v_number integer;
  v_expected_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.area_id IS NOT NULL THEN
    SELECT COALESCE(a.is_default, false)
      INTO v_old_default
    FROM public.dining_areas a
    WHERE a.id = OLD.area_id
      AND a.branch_id = OLD.branch_id;
    v_old_default := COALESCE(v_old_default, false);
  END IF;

  IF NEW.area_id IS NOT NULL THEN
    SELECT COALESCE(a.is_default, false)
      INTO v_new_default
    FROM public.dining_areas a
    WHERE a.id = NEW.area_id
      AND a.branch_id = NEW.branch_id;
    v_new_default := COALESCE(v_new_default, false);
  END IF;

  IF v_new_default OR v_old_default THEN
    v_limit := private.default_dining_table_limit(NEW.branch_id);
  END IF;

  IF NEW.name ~ '^Table (0[1-9]|[1-4][0-9]|50)$' THEN
    v_number := substring(NEW.name from '([0-9]{2})$')::integer;
    v_expected_active := (v_number <= v_limit);
  END IF;

  IF TG_OP = 'INSERT' AND v_new_default THEN
    IF v_number IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_AREA_FIXED_50',
        DETAIL = 'Main Area accepts only canonical Table 01..Table 50 identities.';
    END IF;

    IF NEW.is_active IS DISTINCT FROM v_expected_active THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
        DETAIL = 'Main Area active table state is controlled by the branch table-count setting.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_default THEN
    IF NEW.area_id IS DISTINCT FROM OLD.area_id
       OR NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
        DETAIL = 'Main Area table identity and membership are fixed.';
    END IF;

    IF v_number IS NULL
       OR NEW.is_active IS DISTINCT FROM v_expected_active THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
        DETAIL = 'Main Area active table state is controlled by the branch table-count setting.';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND v_new_default THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_AREA_FIXED_50',
      DETAIL = 'Custom tables cannot be moved into Main Area.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.ensure_default_dining_tables(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_area_id uuid;
  v_i integer;
  v_name text;
  v_layout jsonb;
  v_limit integer := 50;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id
  ) THEN
    RETURN;
  END IF;

  v_limit := private.default_dining_table_limit(p_branch_id);

  SELECT id
    INTO v_area_id
  FROM public.dining_areas
  WHERE branch_id = p_branch_id
    AND is_default
  ORDER BY created_at, id
  LIMIT 1;

  IF v_area_id IS NULL THEN
    INSERT INTO public.dining_areas(branch_id, name, sort_order, is_demo, is_default)
    VALUES(p_branch_id, 'Main Area', 0, false, true)
    RETURNING id INTO v_area_id;
  ELSE
    UPDATE public.dining_areas
    SET name = 'Main Area',
        sort_order = 0,
        is_default = true,
        updated_at = now()
    WHERE id = v_area_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dining_tables t
    WHERE t.branch_id = p_branch_id
      AND t.area_id = v_area_id
      AND t.is_active
      AND t.name ~ '^Table (0[1-9]|[1-4][0-9]|50)$'
      AND substring(t.name from '([0-9]{2})$')::integer > v_limit
      AND (
        t.status <> 'vacant'
        OR EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.table_id = t.id
            AND o.status NOT IN ('completed', 'cancelled', 'canceled', 'voided', 'closed')
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'MAIN_AREA_TABLE_LIMIT_BUSY',
      DETAIL = 'Cannot reduce Main Area table count while a table above the requested limit is occupied or has a non-final order.';
  END IF;

  FOR v_i IN 1..50 LOOP
    v_name := 'Table ' || lpad(v_i::text, 2, '0');
    v_layout := jsonb_build_object(
      'x', 20 + ((v_i - 1) % 10) * 130,
      'y', 20 + ((v_i - 1) / 10) * 100,
      'w', 110,
      'h', 70
    );

    IF EXISTS (
      SELECT 1
      FROM public.dining_tables
      WHERE branch_id = p_branch_id
        AND name = v_name
    ) THEN
      UPDATE public.dining_tables
      SET area_id = v_area_id,
          is_active = (v_i <= v_limit),
          updated_at = now()
      WHERE branch_id = p_branch_id
        AND name = v_name;
    ELSE
      INSERT INTO public.dining_tables(
        branch_id,
        area_id,
        name,
        capacity,
        status,
        shape,
        layout,
        is_active,
        is_demo
      )
      VALUES(
        p_branch_id,
        v_area_id,
        v_name,
        4,
        'vacant',
        'rect',
        v_layout,
        (v_i <= v_limit),
        false
      );
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.sync_default_dining_tables_from_branch_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM private.ensure_default_dining_tables(NEW.branch_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_main_area_table_count ON public.branch_settings;
CREATE TRIGGER trg_sync_main_area_table_count
AFTER INSERT OR UPDATE OF main_area_table_count ON public.branch_settings
FOR EACH ROW
EXECUTE FUNCTION private.sync_default_dining_tables_from_branch_settings();

REVOKE ALL ON FUNCTION private.default_dining_table_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_default_dining_tables_from_branch_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_default_dining_tables(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_default_dining_table_identity() FROM PUBLIC, anon, authenticated;

COMMIT;
