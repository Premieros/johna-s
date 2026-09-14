-- Branch-scope the existing kitchen_stations model while preserving the installed
-- print-agent contract: station_code remains the same text value (main, drinks, ...).
-- Legacy NULL-branch rows become internal templates only; operational rows are per branch.

ALTER TABLE public.kitchen_stations
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;

ALTER TABLE public.kitchen_stations
  DROP CONSTRAINT IF EXISTS kitchen_stations_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_stations_branch_code
  ON public.kitchen_stations(branch_id, lower(btrim(code)))
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_stations_template_code
  ON public.kitchen_stations(lower(btrim(code)))
  WHERE branch_id IS NULL;

-- Reserve cashier for receipt/payment routing only. NOT VALID intentionally avoids
-- rewriting or deleting any legacy production row; it still blocks future bad writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kitchen_stations_cashier_reserved'
      AND conrelid = 'public.kitchen_stations'::regclass
  ) THEN
    ALTER TABLE public.kitchen_stations
      ADD CONSTRAINT kitchen_stations_cashier_reserved
      CHECK (lower(btrim(code)) <> 'cashier') NOT VALID;
  END IF;
END
$$;

-- Materialize existing global definitions for every existing branch.
INSERT INTO public.kitchen_stations(branch_id, code, name_ar, name_en, is_active, sort_order, created_at)
SELECT b.id, s.code, s.name_ar, s.name_en, s.is_active, s.sort_order, now()
FROM public.branches b
CROSS JOIN public.kitchen_stations s
WHERE s.branch_id IS NULL
  AND lower(btrim(s.code)) <> 'cashier'
  AND NOT EXISTS (
    SELECT 1
    FROM public.kitchen_stations existing
    WHERE existing.branch_id = b.id
      AND lower(btrim(existing.code)) = lower(btrim(s.code))
  );

-- Repoint category routing to the branch-owned copy with the same station code.
UPDATE public.categories c
SET kitchen_station_id = branch_station.id
FROM public.kitchen_stations legacy_station,
     public.kitchen_stations branch_station
WHERE c.kitchen_station_id = legacy_station.id
  AND legacy_station.branch_id IS NULL
  AND branch_station.branch_id = c.branch_id
  AND lower(btrim(branch_station.code)) = lower(btrim(legacy_station.code))
  AND lower(btrim(legacy_station.code)) <> 'cashier';

-- Repoint existing user assignments without changing user/branch semantics.
UPDATE public.user_kitchen_station_assignments a
SET station_id = branch_station.id
FROM public.kitchen_stations legacy_station,
     public.kitchen_stations branch_station
WHERE a.station_id = legacy_station.id
  AND legacy_station.branch_id IS NULL
  AND branch_station.branch_id = a.branch_id
  AND lower(btrim(branch_station.code)) = lower(btrim(legacy_station.code))
  AND lower(btrim(legacy_station.code)) <> 'cashier';

-- New branches receive copies of the same internal templates. This is the existing
-- station model, not a new print/station subsystem.
CREATE OR REPLACE FUNCTION public.seed_kitchen_stations_for_new_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.kitchen_stations(branch_id, code, name_ar, name_en, is_active, sort_order, created_at)
  SELECT NEW.id, s.code, s.name_ar, s.name_en, s.is_active, s.sort_order, now()
  FROM public.kitchen_stations s
  WHERE s.branch_id IS NULL
    AND lower(btrim(s.code)) <> 'cashier'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_seed_kitchen_stations_on_branch_insert ON public.branches;
CREATE TRIGGER trg_seed_kitchen_stations_on_branch_insert
AFTER INSERT ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.seed_kitchen_stations_for_new_branch();

REVOKE ALL ON FUNCTION public.seed_kitchen_stations_for_new_branch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_kitchen_stations_for_new_branch() TO service_role, postgres;

-- Branch-aware RLS. NULL-branch template rows are not exposed to ordinary users.
DROP POLICY IF EXISTS ks_admin_all ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_select ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_branch_select ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_branch_insert ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_branch_update ON public.kitchen_stations;
DROP POLICY IF EXISTS ks_branch_delete ON public.kitchen_stations;

CREATE POLICY ks_branch_select ON public.kitchen_stations
FOR SELECT TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.user_may_access_branch(branch_id)
);

CREATE POLICY ks_branch_insert ON public.kitchen_stations
FOR INSERT TO authenticated
WITH CHECK (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
  AND lower(btrim(code)) <> 'cashier'
);

CREATE POLICY ks_branch_update ON public.kitchen_stations
FOR UPDATE TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
)
WITH CHECK (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
  AND lower(btrim(code)) <> 'cashier'
);

CREATE POLICY ks_branch_delete ON public.kitchen_stations
FOR DELETE TO authenticated
USING (
  branch_id IS NOT NULL
  AND public.can_permission('settings.manage')
  AND public.user_may_access_branch(branch_id)
);

-- Category -> station must stay inside one branch and cashier can never be assigned.
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

  IF v_station_branch IS NULL OR v_station_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
  END IF;
  IF NOT COALESCE(v_station_active, false) OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'KITCHEN_STATION_NOT_AVAILABLE';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_category_kitchen_station_branch ON public.categories;
CREATE TRIGGER trg_category_kitchen_station_branch
BEFORE INSERT OR UPDATE OF branch_id, kitchen_station_id
ON public.categories
FOR EACH ROW EXECUTE FUNCTION public._guard_category_kitchen_station_branch();

REVOKE ALL ON FUNCTION public._guard_category_kitchen_station_branch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_category_kitchen_station_branch() TO service_role, postgres;

-- User assignment must respect target-user branch access and station ownership.
CREATE OR REPLACE FUNCTION public._guard_kitchen_station_assignment_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_station_branch uuid;
  v_station_code text;
  v_station_active boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = NEW.user_id
      AND u.is_active = true
      AND (
        u.branch_id = NEW.branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = NEW.user_id
            AND uba.branch_id = NEW.branch_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'KITCHEN_USER_BRANCH_MISMATCH';
  END IF;

  SELECT s.branch_id, lower(btrim(s.code)), s.is_active
  INTO v_station_branch, v_station_code, v_station_active
  FROM public.kitchen_stations s
  WHERE s.id = NEW.station_id;

  IF v_station_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'KITCHEN_STATION_BRANCH_MISMATCH';
  END IF;
  IF NOT COALESCE(v_station_active, false) OR v_station_code = 'cashier' THEN
    RAISE EXCEPTION 'KITCHEN_STATION_NOT_AVAILABLE';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_kitchen_station_assignment_branch ON public.user_kitchen_station_assignments;
CREATE TRIGGER trg_kitchen_station_assignment_branch
BEFORE INSERT OR UPDATE OF user_id, branch_id, station_id
ON public.user_kitchen_station_assignments
FOR EACH ROW EXECUTE FUNCTION public._guard_kitchen_station_assignment_branch();

-- Permission-first branch-scoped station editor.
CREATE OR REPLACE FUNCTION public.get_kitchen_station_assignments(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.can_permission('settings.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'branch_id', s.branch_id,
    'code', s.code,
    'name_ar', s.name_ar,
    'name_en', s.name_en,
    'is_active', s.is_active,
    'sort_order', s.sort_order,
    'user_ids', COALESCE((
      SELECT jsonb_agg(a.user_id ORDER BY a.user_id)
      FROM public.user_kitchen_station_assignments a
      WHERE a.branch_id = p_branch_id AND a.station_id = s.id
    ), '[]'::jsonb),
    'category_ids', COALESCE((
      SELECT jsonb_agg(c.id ORDER BY c.name)
      FROM public.categories c
      WHERE c.branch_id = p_branch_id AND c.kitchen_station_id = s.id
    ), '[]'::jsonb)
  ) ORDER BY s.sort_order, s.code), '[]'::jsonb)
  INTO v_rows
  FROM public.kitchen_stations s
  WHERE s.branch_id = p_branch_id
    AND lower(btrim(s.code)) <> 'cashier';

  RETURN jsonb_build_object('success', true, 'stations', v_rows);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_my_kitchen_stations(p_branch_id uuid DEFAULT public.get_branch_id())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_assignments boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_kitchen_station_assignments a
    WHERE a.user_id = auth.uid() AND a.branch_id = p_branch_id
  ) INTO v_has_assignments;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.code), '[]'::jsonb)
  INTO v_rows
  FROM public.kitchen_stations s
  WHERE s.branch_id = p_branch_id
    AND s.is_active = true
    AND lower(btrim(s.code)) <> 'cashier'
    AND (
      NOT v_has_assignments
      OR EXISTS (
        SELECT 1 FROM public.user_kitchen_station_assignments a
        WHERE a.user_id = auth.uid()
          AND a.branch_id = p_branch_id
          AND a.station_id = s.id
      )
    );

  RETURN COALESCE(v_rows, '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.save_kitchen_station_assignments(
  p_branch_id uuid,
  p_station_id uuid,
  p_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_category_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.can_permission('settings.manage')
     OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.kitchen_stations s
    WHERE s.id = p_station_id
      AND s.branch_id = p_branch_id
      AND s.is_active = true
      AND lower(btrim(s.code)) <> 'cashier'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) x(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = x.id
        AND u.is_active = true
        AND (
          u.branch_id = p_branch_id
          OR EXISTS (
            SELECT 1 FROM public.user_branch_access uba
            WHERE uba.user_id = x.id AND uba.branch_id = p_branch_id
          )
        )
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_category_ids, '{}'::uuid[])) x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = x.id AND c.branch_id = p_branch_id
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_BRANCH_MISMATCH');
  END IF;

  DELETE FROM public.user_kitchen_station_assignments
  WHERE branch_id = p_branch_id AND station_id = p_station_id;

  INSERT INTO public.user_kitchen_station_assignments(user_id, branch_id, station_id, created_by)
  SELECT DISTINCT x.id, p_branch_id, p_station_id, auth.uid()
  FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) x(id)
  ON CONFLICT DO NOTHING;

  UPDATE public.categories
  SET kitchen_station_id = NULL
  WHERE branch_id = p_branch_id
    AND kitchen_station_id = p_station_id
    AND NOT (id = ANY(COALESCE(p_category_ids, '{}'::uuid[])));

  UPDATE public.categories
  SET kitchen_station_id = p_station_id
  WHERE branch_id = p_branch_id
    AND id = ANY(COALESCE(p_category_ids, '{}'::uuid[]));

  RETURN jsonb_build_object('success', true);
END
$function$;

-- Cloud kitchen jobs validate the branch-owned station. Receipt routing remains
-- untouched and continues to use station_code='cashier'.
CREATE OR REPLACE FUNCTION public.enqueue_cloud_kitchen_print(
  p_branch_id uuid,
  p_station_code text,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_station_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('pos.send_kitchen') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.send_kitchen');
  END IF;

  v_station_code := lower(btrim(COALESCE(p_station_code, '')));
  IF v_station_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_REQUIRED');
  END IF;
  IF v_station_code = 'cashier' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CASHIER_RESERVED_FOR_RECEIPTS');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kitchen_stations s
    WHERE s.branch_id = p_branch_id
      AND lower(btrim(s.code)) = v_station_code
      AND s.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATION_BRANCH_MISMATCH');
  END IF;
  IF COALESCE(btrim(p_idempotency_key), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id, requested_by, kind, station_code, payload, idempotency_key
  ) VALUES (
    p_branch_id, auth.uid(), 'kitchen', v_station_code, p_payload, btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id, idempotency_key) DO UPDATE
  SET updated_at = public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
END
$function$;

-- Tighten the already-patched authoritative send_to_kitchen guard so the category
-- station must belong to the order branch. No station_code format changes.
DO $patch_send_branch_station$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := 'WHERE c.id IS NULL OR ks.id IS NULL OR lower(btrim(ks.code)) = ''cashier''';
  v_new text := 'WHERE c.id IS NULL OR ks.id IS NULL OR ks.branch_id IS DISTINCT FROM v_branch_id OR lower(btrim(ks.code)) = ''cashier''';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'send_to_kitchen(uuid,uuid)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'send_to_kitchen(uuid,uuid) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'SEND_TO_KITCHEN_BRANCH_GUARD_MARKER_MISSING';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$patch_send_branch_station$;

REVOKE ALL ON FUNCTION public.get_kitchen_station_assignments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_kitchen_stations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_kitchen_station_assignments(uuid,uuid,uuid[],uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kitchen_station_assignments(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_kitchen_stations(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_kitchen_station_assignments(uuid,uuid,uuid[],uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text) TO authenticated, service_role;
