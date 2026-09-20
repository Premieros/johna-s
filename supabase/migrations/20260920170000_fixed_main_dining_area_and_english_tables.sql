-- Dining-area UX contract:
-- 1) Every branch has exactly one protected default area named "Main Area".
-- 2) The default area owns the canonical fixed tables "Table 01".."Table 50".
-- 3) Custom areas stay user-managed and may contain custom tables.
-- 4) The canonical floor-plan RPCs cannot add/move/rename tables in ways that break the fixed default area.

BEGIN;

ALTER TABLE public.dining_areas
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Normalize the existing main area and its canonical 50 table identities in place.
-- Existing IDs, orders, status and layout are preserved.
DO $normalize$
DECLARE
  v_branch record;
  v_area_id uuid;
  v_row record;
  v_number integer;
  v_name text;
BEGIN
  FOR v_branch IN SELECT id FROM public.branches LOOP
    SELECT a.id
    INTO v_area_id
    FROM public.dining_areas a
    WHERE a.branch_id = v_branch.id
    ORDER BY
      CASE
        WHEN a.name IN ('Main Area', 'الصالة الرئيسية') THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM public.dining_tables t
          WHERE t.area_id = a.id
            AND (
              t.name ~ '^طاولة [0-9]{2}$'
              OR t.name ~ '^Table [0-9]{2}$'
              OR t.name ~ '^[0-9]+$'
            )
        ) THEN 1
        ELSE 2
      END,
      a.sort_order,
      a.created_at,
      a.id
    LIMIT 1;

    IF v_area_id IS NULL THEN
      INSERT INTO public.dining_areas (branch_id, name, sort_order, is_demo, is_default)
      VALUES (v_branch.id, 'Main Area', 0, false, true)
      RETURNING id INTO v_area_id;
    ELSE
      UPDATE public.dining_areas
      SET is_default = (id = v_area_id),
          name = CASE WHEN id = v_area_id THEN 'Main Area' ELSE name END,
          sort_order = CASE WHEN id = v_area_id THEN 0 ELSE sort_order END,
          updated_at = now()
      WHERE branch_id = v_branch.id;
    END IF;

    FOR v_row IN
      SELECT id, name
      FROM public.dining_tables
      WHERE branch_id = v_branch.id
        AND area_id = v_area_id
        AND (
          name ~ '^طاولة [0-9]{2}$'
          OR name ~ '^Table [0-9]{2}$'
          OR name ~ '^[0-9]+$'
        )
    LOOP
      IF v_row.name ~ '^طاولة [0-9]{2}$' THEN
        v_number := substring(v_row.name from '([0-9]{2})$')::integer;
      ELSIF v_row.name ~ '^Table [0-9]{2}$' THEN
        v_number := substring(v_row.name from '([0-9]{2})$')::integer;
      ELSE
        v_number := v_row.name::integer;
      END IF;

      IF v_number BETWEEN 1 AND 50 THEN
        v_name := 'Table ' || lpad(v_number::text, 2, '0');

        IF EXISTS (
          SELECT 1
          FROM public.dining_tables t
          WHERE t.branch_id = v_branch.id
            AND t.name = v_name
            AND t.id <> v_row.id
        ) THEN
          RAISE EXCEPTION
            'DINING_TABLE_ENGLISH_NAME_COLLISION branch=% table=% canonical_name=%',
            v_branch.id, v_row.id, v_name;
        END IF;

        UPDATE public.dining_tables
        SET name = v_name,
            area_id = v_area_id,
            updated_at = now()
        WHERE id = v_row.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$normalize$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dining_areas_one_default_per_branch
  ON public.dining_areas(branch_id)
  WHERE is_default;

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
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RETURN;
  END IF;

  SELECT id INTO v_area_id
  FROM public.dining_areas
  WHERE branch_id = p_branch_id
    AND is_default
  ORDER BY created_at, id
  LIMIT 1;

  IF v_area_id IS NULL THEN
    INSERT INTO public.dining_areas (branch_id, name, sort_order, is_demo, is_default)
    VALUES (p_branch_id, 'Main Area', 0, false, true)
    RETURNING id INTO v_area_id;
  ELSE
    UPDATE public.dining_areas
    SET name = 'Main Area',
        sort_order = 0,
        is_default = true,
        updated_at = now()
    WHERE id = v_area_id;
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
      SET is_active = true,
          area_id = v_area_id,
          updated_at = now()
      WHERE branch_id = p_branch_id
        AND name = v_name;
    ELSE
      INSERT INTO public.dining_tables (
        branch_id,
        area_id,
        name,
        capacity,
        status,
        shape,
        layout,
        is_active,
        is_demo
      ) VALUES (
        p_branch_id,
        v_area_id,
        v_name,
        4,
        'vacant',
        'rect',
        v_layout,
        true,
        false
      );
    END IF;
  END LOOP;
END;
$function$;

-- Re-run the official provisioner after normalization so every branch has all 50.
DO $backfill$
DECLARE
  v_branch_id uuid;
BEGIN
  FOR v_branch_id IN SELECT id FROM public.branches LOOP
    PERFORM private.ensure_default_dining_tables(v_branch_id);
  END LOOP;
END;
$backfill$;

CREATE OR REPLACE FUNCTION private.guard_default_dining_area_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_AREA_FIXED',
      DETAIL = 'Main Area is system-managed and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_default_dining_area_delete ON public.dining_areas;
CREATE TRIGGER trg_guard_default_dining_area_delete
BEFORE DELETE ON public.dining_areas
FOR EACH ROW
EXECUTE FUNCTION private.guard_default_dining_area_delete();

CREATE OR REPLACE FUNCTION private.guard_default_dining_area_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.is_default THEN
    IF NOT NEW.is_default
       OR NEW.name <> 'Main Area'
       OR NEW.sort_order <> 0
       OR NEW.branch_id <> OLD.branch_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_DINING_AREA_FIXED',
        DETAIL = 'Main Area identity is system-managed and cannot be changed.';
    END IF;
  ELSIF NEW.is_default THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_AREA_FIXED',
      DETAIL = 'Only the system provisioner may assign the default dining area.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_default_dining_area_update ON public.dining_areas;
CREATE TRIGGER trg_guard_default_dining_area_update
BEFORE UPDATE OF name, sort_order, is_default, branch_id ON public.dining_areas
FOR EACH ROW
EXECUTE FUNCTION private.guard_default_dining_area_update();

CREATE OR REPLACE FUNCTION private.guard_default_dining_table_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old_default boolean := false;
  v_new_default boolean := false;
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

  IF TG_OP = 'INSERT' AND v_new_default THEN
    IF NEW.name !~ '^Table (0[1-9]|[1-4][0-9]|50)
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dining_areas a
    WHERE a.id = OLD.area_id
      AND a.branch_id = OLD.branch_id
      AND a.is_default
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
      DETAIL = 'The 50 Main Area tables are system-managed and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_default_dining_table_delete ON public.dining_tables;
CREATE TRIGGER trg_guard_default_dining_table_delete
BEFORE DELETE ON public.dining_tables
FOR EACH ROW
EXECUTE FUNCTION private.guard_default_dining_table_delete();

CREATE OR REPLACE FUNCTION public.floor_plan_add_table(
  p_branch_id uuid,
  p_name text,
  p_capacity integer DEFAULT 4,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT 'rect',
  p_layout jsonb DEFAULT '{"x":0,"y":0,"w":120,"h":80}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_shape text := btrim(coalesce(p_shape, 'rect'));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF v_name = '' OR length(v_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
  END IF;

  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  IF p_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id
      AND a.branch_id = p_branch_id
      AND a.is_default
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_AREA_FIXED_50');
  END IF;

  INSERT INTO public.dining_tables (
    branch_id, area_id, name, capacity, status, shape, layout, is_active, is_demo
  ) VALUES (
    p_branch_id, p_area_id, v_name, p_capacity, 'vacant', nullif(v_shape, ''), p_layout, true, false
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'table_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.floor_plan_update_table(
  p_table_id uuid,
  p_name text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT NULL,
  p_layout jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_current_area_id uuid;
  v_current_name text;
  v_current_default boolean := false;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT t.branch_id, t.area_id, t.name
  INTO v_branch_id, v_current_area_id, v_current_name
  FROM public.dining_tables t
  WHERE t.id = p_table_id;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(a.is_default, false)
  INTO v_current_default
  FROM public.dining_areas a
  WHERE a.id = v_current_area_id
    AND a.branch_id = v_branch_id;

  v_current_default := COALESCE(v_current_default, false);

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF v_name = '' OR length(v_name) > 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
    END IF;
  END IF;

  IF v_current_default AND v_name IS NOT NULL AND v_name <> v_current_name THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_TABLE_IDENTITY_FIXED');
  END IF;

  IF v_current_default AND p_area_id IS NOT NULL AND p_area_id <> v_current_area_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_TABLE_IDENTITY_FIXED');
  END IF;

  IF NOT v_current_default AND p_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id
      AND a.branch_id = v_branch_id
      AND a.is_default
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_AREA_FIXED_50');
  END IF;

  IF p_capacity IS NOT NULL AND (p_capacity < 1 OR p_capacity > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NOT NULL AND jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = v_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  UPDATE public.dining_tables
  SET name = COALESCE(v_name, name),
      capacity = COALESCE(p_capacity, capacity),
      area_id = CASE WHEN p_area_id IS NULL THEN area_id ELSE p_area_id END,
      shape = COALESCE(NULLIF(btrim(p_shape), ''), shape),
      layout = COALESCE(p_layout, layout),
      updated_at = now()
  WHERE id = p_table_id
    AND branch_id = v_branch_id;

  RETURN jsonb_build_object('success', true, 'table_id', p_table_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_default_dining_area_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_default_dining_area_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_default_dining_table_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_default_dining_table_delete() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

COMMENT ON COLUMN public.dining_areas.is_default IS
  'True only for the branch Main Area that owns the fixed canonical Table 01..Table 50 set.';

COMMENT ON FUNCTION private.ensure_default_dining_tables(uuid) IS
  'Ensures one Main Area per branch and the fixed English-named Table 01..Table 50 canonical set.';

COMMIT;
 OR NOT NEW.is_active THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_AREA_FIXED_50',
        DETAIL = 'Main Area accepts only the canonical active Table 01..Table 50 set.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_default THEN
    IF NEW.area_id IS DISTINCT FROM OLD.area_id
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.is_active IS NOT TRUE THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
        DETAIL = 'Main Area table identity, membership and active state are fixed.';
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

DROP TRIGGER IF EXISTS trg_guard_default_dining_table_identity ON public.dining_tables;
CREATE TRIGGER trg_guard_default_dining_table_identity
BEFORE INSERT OR UPDATE OF area_id, name, is_active ON public.dining_tables
FOR EACH ROW
EXECUTE FUNCTION private.guard_default_dining_table_identity();

CREATE OR REPLACE FUNCTION private.guard_default_dining_table_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dining_areas a
    WHERE a.id = OLD.area_id
      AND a.branch_id = OLD.branch_id
      AND a.is_default
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DEFAULT_DINING_TABLE_FIXED',
      DETAIL = 'The 50 Main Area tables are system-managed and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_default_dining_table_delete ON public.dining_tables;
CREATE TRIGGER trg_guard_default_dining_table_delete
BEFORE DELETE ON public.dining_tables
FOR EACH ROW
EXECUTE FUNCTION private.guard_default_dining_table_delete();

CREATE OR REPLACE FUNCTION public.floor_plan_add_table(
  p_branch_id uuid,
  p_name text,
  p_capacity integer DEFAULT 4,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT 'rect',
  p_layout jsonb DEFAULT '{"x":0,"y":0,"w":120,"h":80}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_shape text := btrim(coalesce(p_shape, 'rect'));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  IF v_name = '' OR length(v_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
  END IF;

  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  IF p_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id
      AND a.branch_id = p_branch_id
      AND a.is_default
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_AREA_FIXED_50');
  END IF;

  INSERT INTO public.dining_tables (
    branch_id, area_id, name, capacity, status, shape, layout, is_active, is_demo
  ) VALUES (
    p_branch_id, p_area_id, v_name, p_capacity, 'vacant', nullif(v_shape, ''), p_layout, true, false
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'table_id', v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.floor_plan_update_table(
  p_table_id uuid,
  p_name text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_area_id uuid DEFAULT NULL,
  p_shape text DEFAULT NULL,
  p_layout jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_current_area_id uuid;
  v_current_name text;
  v_current_default boolean := false;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT t.branch_id, t.area_id, t.name
  INTO v_branch_id, v_current_area_id, v_current_name
  FROM public.dining_tables t
  WHERE t.id = p_table_id;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('floor_plan.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(a.is_default, false)
  INTO v_current_default
  FROM public.dining_areas a
  WHERE a.id = v_current_area_id
    AND a.branch_id = v_branch_id;

  v_current_default := COALESCE(v_current_default, false);

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF v_name = '' OR length(v_name) > 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TABLE_NAME');
    END IF;
  END IF;

  IF v_current_default AND v_name IS NOT NULL AND v_name <> v_current_name THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_TABLE_IDENTITY_FIXED');
  END IF;

  IF v_current_default AND p_area_id IS NOT NULL AND p_area_id <> v_current_area_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_TABLE_IDENTITY_FIXED');
  END IF;

  IF NOT v_current_default AND p_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id
      AND a.branch_id = v_branch_id
      AND a.is_default
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DEFAULT_AREA_FIXED_50');
  END IF;

  IF p_capacity IS NOT NULL AND (p_capacity < 1 OR p_capacity > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CAPACITY');
  END IF;

  IF p_layout IS NOT NULL AND jsonb_typeof(p_layout) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_LAYOUT');
  END IF;

  IF p_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dining_areas a
    WHERE a.id = p_area_id AND a.branch_id = v_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AREA_BRANCH_MISMATCH');
  END IF;

  UPDATE public.dining_tables
  SET name = COALESCE(v_name, name),
      capacity = COALESCE(p_capacity, capacity),
      area_id = CASE WHEN p_area_id IS NULL THEN area_id ELSE p_area_id END,
      shape = COALESCE(NULLIF(btrim(p_shape), ''), shape),
      layout = COALESCE(p_layout, layout),
      updated_at = now()
  WHERE id = p_table_id
    AND branch_id = v_branch_id;

  RETURN jsonb_build_object('success', true, 'table_id', p_table_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NAME_EXISTS');
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_default_dining_area_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_default_dining_table_delete() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_add_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_update_table(uuid,text,integer,uuid,text,jsonb) TO service_role;

COMMENT ON COLUMN public.dining_areas.is_default IS
  'True only for the branch Main Area that owns the fixed canonical Table 01..Table 50 set.';

COMMENT ON FUNCTION private.ensure_default_dining_tables(uuid) IS
  'Ensures one Main Area per branch and the fixed English-named Table 01..Table 50 canonical set.';

COMMIT;
