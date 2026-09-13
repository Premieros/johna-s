-- Reusable modifier groups: one group may be linked to many products and each
-- product may use many groups. Existing group/option ids are preserved so
-- historical order/sale snapshots stay valid.
--
-- Forward-only / additive migration. Production execution requires the normal
-- Full Verify + explicit approval gate.

-- ---------------------------------------------------------------------------
-- 1. Many-to-many product assignment, preserving legacy group ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_modifier_group_products (
  group_id uuid NOT NULL REFERENCES public.product_modifier_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_modifier_group_products_product
  ON public.product_modifier_group_products(product_id, sort_order, group_id);
CREATE INDEX IF NOT EXISTS idx_modifier_group_products_branch
  ON public.product_modifier_group_products(branch_id, product_id);

-- Every legacy group starts linked to its existing product. This is idempotent.
INSERT INTO public.product_modifier_group_products(group_id, product_id, branch_id, sort_order)
SELECT g.id, g.product_id, g.branch_id, g.sort_order
FROM public.product_modifier_groups g
WHERE g.product_id IS NOT NULL
ON CONFLICT (group_id, product_id) DO NOTHING;

-- product_id becomes legacy-origin metadata only. Keep it for compatibility but
-- do not let deleting one origin product destroy a shared group.
DO $fk$
DECLARE
  v_constraint text;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'product_modifier_groups'
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) ILIKE '%FOREIGN KEY (product_id)%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.product_modifier_groups DROP CONSTRAINT %I', v_constraint);
  END IF;
END
$fk$;

ALTER TABLE public.product_modifier_groups
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.product_modifier_groups
  ADD CONSTRAINT product_modifier_groups_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.product_modifier_group_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS modifier_group_products_branch_select ON public.product_modifier_group_products;
CREATE POLICY modifier_group_products_branch_select
ON public.product_modifier_group_products
FOR SELECT TO authenticated
USING (public.user_may_access_branch(branch_id));

-- Configuration writes stay behind SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS modifier_group_products_no_direct_insert ON public.product_modifier_group_products;
CREATE POLICY modifier_group_products_no_direct_insert
ON public.product_modifier_group_products
FOR INSERT TO authenticated
WITH CHECK (false);
DROP POLICY IF EXISTS modifier_group_products_no_direct_update ON public.product_modifier_group_products;
CREATE POLICY modifier_group_products_no_direct_update
ON public.product_modifier_group_products
FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS modifier_group_products_no_direct_delete ON public.product_modifier_group_products;
CREATE POLICY modifier_group_products_no_direct_delete
ON public.product_modifier_group_products
FOR DELETE TO authenticated
USING (false);

REVOKE ALL ON public.product_modifier_group_products FROM PUBLIC, anon;
GRANT SELECT ON public.product_modifier_group_products TO authenticated;
GRANT ALL ON public.product_modifier_group_products TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Branch invariants for groups and assignments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enforce_modifier_group_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product_branch uuid;
BEGIN
  -- A reusable group may be unassigned, therefore product_id may be NULL.
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_product_branch
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_product_branch IS NULL THEN
    RAISE EXCEPTION 'MODIFIER_PRODUCT_NOT_FOUND';
  END IF;
  IF NEW.branch_id <> v_product_branch THEN
    RAISE EXCEPTION 'MODIFIER_GROUP_BRANCH_MISMATCH';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._enforce_modifier_group_product_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_group_branch uuid;
  v_product_branch uuid;
BEGIN
  SELECT branch_id INTO v_group_branch
  FROM public.product_modifier_groups
  WHERE id = NEW.group_id;

  SELECT branch_id INTO v_product_branch
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_group_branch IS NULL THEN RAISE EXCEPTION 'MODIFIER_GROUP_NOT_FOUND'; END IF;
  IF v_product_branch IS NULL THEN RAISE EXCEPTION 'MODIFIER_PRODUCT_NOT_FOUND'; END IF;
  IF NEW.branch_id <> v_group_branch OR NEW.branch_id <> v_product_branch THEN
    RAISE EXCEPTION 'MODIFIER_GROUP_PRODUCT_BRANCH_MISMATCH';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_modifier_group_product_branch_consistency
ON public.product_modifier_group_products;
CREATE TRIGGER trg_modifier_group_product_branch_consistency
BEFORE INSERT OR UPDATE OF branch_id, group_id, product_id
ON public.product_modifier_group_products
FOR EACH ROW EXECUTE FUNCTION public._enforce_modifier_group_product_branch();

REVOKE ALL ON FUNCTION public._enforce_modifier_group_product_branch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enforce_modifier_group_product_branch() TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 3. POS read/validation now resolves membership through the junction table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_modifiers(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_groups jsonb;
BEGIN
  SELECT p.branch_id INTO v_branch_id
  FROM public.products p
  WHERE p.id = p_product_id AND p.is_active = true;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(jsonb_agg(group_row ORDER BY (group_row->>'link_sort_order')::integer, (group_row->>'sort_order')::integer), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'name_en', g.name_en,
      'min_selections', g.min_selections,
      'max_selections', g.max_selections,
      'sort_order', g.sort_order,
      'link_sort_order', gp.sort_order,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'name_en', o.name_en,
          'price_delta', o.price_delta,
          'is_default', o.is_default,
          'sort_order', o.sort_order
        ) ORDER BY o.sort_order, o.created_at)
        FROM public.product_modifier_options o
        WHERE o.group_id = g.id AND o.is_active = true
      ), '[]'::jsonb)
    ) AS group_row
    FROM public.product_modifier_group_products gp
    JOIN public.product_modifier_groups g ON g.id = gp.group_id
    WHERE gp.product_id = p_product_id
      AND gp.branch_id = v_branch_id
      AND g.branch_id = v_branch_id
      AND g.is_active = true
  ) q;

  RETURN jsonb_build_object('success', true, 'groups', COALESCE(v_groups, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_product_modifiers(
  p_product_id uuid,
  p_branch_id uuid,
  p_option_ids jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_group record;
  v_selected_count integer;
  v_input_count integer;
  v_distinct_count integer;
  v_price_delta numeric(14,2) := 0;
  v_snapshot jsonb := '[]'::jsonb;
  v_invalid uuid;
  v_active_user boolean;
  v_uid uuid := auth.uid();
  v_auth_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_uid IS NULL THEN
    IF COALESCE(v_auth_role, '') NOT IN ('', 'service_role') THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.is_active = true
    ) INTO v_active_user;
    IF NOT COALESCE(v_active_user, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
  END IF;

  IF p_option_ids IS NULL OR jsonb_typeof(p_option_ids) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_SELECTION');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.branch_id = p_branch_id AND p.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.option_id)
  INTO v_input_count, v_distinct_count
  FROM (
    SELECT NULLIF(value, '')::uuid AS option_id
    FROM jsonb_array_elements_text(p_option_ids)
  ) x;
  IF v_input_count <> v_distinct_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_MODIFIER_OPTION');
  END IF;

  SELECT x.option_id INTO v_invalid
  FROM (
    SELECT NULLIF(value, '')::uuid AS option_id
    FROM jsonb_array_elements_text(p_option_ids)
  ) x
  LEFT JOIN public.product_modifier_options o
    ON o.id = x.option_id AND o.is_active = true
  LEFT JOIN public.product_modifier_groups g
    ON g.id = o.group_id AND g.is_active = true
  LEFT JOIN public.product_modifier_group_products gp
    ON gp.group_id = g.id
   AND gp.product_id = p_product_id
   AND gp.branch_id = p_branch_id
  WHERE o.id IS NULL OR g.id IS NULL OR gp.group_id IS NULL
     OR g.branch_id <> p_branch_id OR o.branch_id <> p_branch_id
  LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_OPTION', 'option_id', v_invalid);
  END IF;

  FOR v_group IN
    SELECT g.id, g.name, g.name_en, g.min_selections, g.max_selections
    FROM public.product_modifier_group_products gp
    JOIN public.product_modifier_groups g ON g.id = gp.group_id
    WHERE gp.product_id = p_product_id
      AND gp.branch_id = p_branch_id
      AND g.branch_id = p_branch_id
      AND g.is_active = true
    ORDER BY gp.sort_order, g.sort_order, g.created_at
  LOOP
    SELECT COUNT(*) INTO v_selected_count
    FROM public.product_modifier_options o
    WHERE o.group_id = v_group.id
      AND o.is_active = true
      AND o.id IN (
        SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(p_option_ids)
      );
    IF v_selected_count < v_group.min_selections THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'MODIFIER_SELECTION_REQUIRED',
        'group_id', v_group.id, 'group_name', v_group.name,
        'min_selections', v_group.min_selections
      );
    END IF;
    IF v_selected_count > v_group.max_selections THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'TOO_MANY_MODIFIER_OPTIONS',
        'group_id', v_group.id, 'group_name', v_group.name,
        'max_selections', v_group.max_selections
      );
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(o.price_delta), 0),
         COALESCE(jsonb_agg(
           jsonb_build_object(
             'group_id', g.id,
             'group_name', g.name,
             'group_name_en', g.name_en,
             'option_id', o.id,
             'option_name', o.name,
             'option_name_en', o.name_en,
             'price_delta', o.price_delta
           ) ORDER BY g.sort_order, o.sort_order, o.created_at
         ), '[]'::jsonb)
  INTO v_price_delta, v_snapshot
  FROM public.product_modifier_options o
  JOIN public.product_modifier_groups g ON g.id = o.group_id
  JOIN public.product_modifier_group_products gp
    ON gp.group_id = g.id
   AND gp.product_id = p_product_id
   AND gp.branch_id = p_branch_id
  WHERE o.id IN (
    SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(p_option_ids)
  );

  RETURN jsonb_build_object(
    'success', true,
    'price_delta', COALESCE(v_price_delta, 0),
    'snapshot', COALESCE(v_snapshot, '[]'::jsonb)
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_OPTION_ID');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Group-centric admin read surface.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_modifier_groups_admin(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_groups jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.modifiers.manage');
  END IF;
  IF p_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_REQUIRED'); END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(jsonb_agg(group_json ORDER BY sort_order, id), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT g.id, g.sort_order,
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'name_en', g.name_en,
        'min_selections', g.min_selections,
        'max_selections', g.max_selections,
        'sort_order', g.sort_order,
        'product_ids', COALESCE((
          SELECT jsonb_agg(gp.product_id ORDER BY gp.sort_order, gp.product_id)
          FROM public.product_modifier_group_products gp
          WHERE gp.group_id = g.id AND gp.branch_id = p_branch_id
        ), '[]'::jsonb),
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'name_en', o.name_en,
            'price_delta', o.price_delta,
            'is_default', o.is_default,
            'sort_order', o.sort_order,
            'inventory_effects', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'target_type', e.target_type,
                'target_id', CASE WHEN e.target_type = 'raw_material' THEN e.raw_material_id ELSE e.inventory_unit_id END,
                'quantity_delta', e.quantity_delta
              ) ORDER BY e.id)
              FROM public.product_modifier_inventory_effects e
              WHERE e.option_id = o.id
            ), '[]'::jsonb)
          ) ORDER BY o.sort_order, o.created_at)
          FROM public.product_modifier_options o
          WHERE o.group_id = g.id AND o.is_active = true
        ), '[]'::jsonb)
      ) AS group_json
    FROM public.product_modifier_groups g
    WHERE g.branch_id = p_branch_id AND g.is_active = true
  ) q;

  RETURN jsonb_build_object('success', true, 'branch_id', p_branch_id, 'groups', v_groups);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_product_modifiers_admin(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_groups jsonb;
BEGIN
  SELECT branch_id INTO v_branch_id FROM public.products WHERE id = p_product_id;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND'); END IF;
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.modifiers.manage');
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT COALESCE(jsonb_agg(group_json ORDER BY link_sort_order, sort_order, id), '[]'::jsonb)
  INTO v_groups
  FROM (
    SELECT g.id, g.sort_order, gp.sort_order AS link_sort_order,
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'name_en', g.name_en,
        'min_selections', g.min_selections,
        'max_selections', g.max_selections,
        'sort_order', g.sort_order,
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'name_en', o.name_en,
            'price_delta', o.price_delta,
            'is_default', o.is_default,
            'sort_order', o.sort_order,
            'inventory_effects', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'target_type', e.target_type,
                'target_id', CASE WHEN e.target_type = 'raw_material' THEN e.raw_material_id ELSE e.inventory_unit_id END,
                'quantity_delta', e.quantity_delta
              ) ORDER BY e.id)
              FROM public.product_modifier_inventory_effects e
              WHERE e.option_id = o.id
            ), '[]'::jsonb)
          ) ORDER BY o.sort_order, o.created_at)
          FROM public.product_modifier_options o
          WHERE o.group_id = g.id AND o.is_active = true
        ), '[]'::jsonb)
      ) AS group_json
    FROM public.product_modifier_group_products gp
    JOIN public.product_modifier_groups g ON g.id = gp.group_id
    WHERE gp.product_id = p_product_id
      AND gp.branch_id = v_branch_id
      AND g.is_active = true
  ) q;

  RETURN jsonb_build_object('success', true, 'product_id', p_product_id, 'branch_id', v_branch_id, 'groups', v_groups);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Atomic central group editor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_modifier_group(
  p_group_id uuid,
  p_branch_id uuid,
  p_group jsonb,
  p_product_ids jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_group_id uuid;
  v_group jsonb := COALESCE(p_group, '{}'::jsonb);
  v_option jsonb;
  v_effect jsonb;
  v_option_id uuid;
  v_target_id uuid;
  v_product_id uuid;
  v_origin_product_id uuid;
  v_min integer;
  v_max integer;
  v_option_count integer;
  v_default_count integer;
  v_delta numeric;
  v_seen_products uuid[] := '{}'::uuid[];
  v_seen_options uuid[] := '{}'::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.modifiers.manage');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF jsonb_typeof(v_group) <> 'object' OR NULLIF(btrim(v_group->>'name'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_NAME_REQUIRED');
  END IF;
  IF p_product_ids IS NULL OR jsonb_typeof(p_product_ids) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRODUCT_ASSIGNMENTS');
  END IF;
  IF v_group ? 'options' AND jsonb_typeof(v_group->'options') <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_OPTIONS');
  END IF;

  BEGIN
    v_min := COALESCE((v_group->>'min_selections')::integer, 0);
    v_max := COALESCE((v_group->>'max_selections')::integer, 1);
    PERFORM COALESCE((v_group->>'sort_order')::integer, 0);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_GROUP_BOUNDS');
  END;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE((opt->>'is_default')::boolean, false))
  INTO v_option_count, v_default_count
  FROM jsonb_array_elements(COALESCE(v_group->'options', '[]'::jsonb)) options(opt);

  IF v_min < 0 OR v_max < 1 OR v_max < v_min OR v_min > v_option_count OR v_max > GREATEST(v_option_count, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_GROUP_BOUNDS');
  END IF;
  IF v_default_count > v_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'TOO_MANY_DEFAULT_MODIFIER_OPTIONS');
  END IF;

  -- Validate assigned products and reject duplicates before mutation.
  FOR v_product_id IN
    SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(p_product_ids)
  LOOP
    IF v_product_id IS NULL OR v_product_id = ANY(v_seen_products) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRODUCT_ASSIGNMENTS');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id AND p.branch_id = p_branch_id AND p.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;
    v_seen_products := array_append(v_seen_products, v_product_id);
    IF v_origin_product_id IS NULL THEN v_origin_product_id := v_product_id; END IF;
  END LOOP;

  -- Validate options/effects before mutation.
  FOR v_option IN SELECT value FROM jsonb_array_elements(COALESCE(v_group->'options', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_option) <> 'object' OR NULLIF(btrim(v_option->>'name'), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_OPTION_NAME_REQUIRED');
    END IF;
    IF NULLIF(v_option->>'id', '') IS NOT NULL THEN
      BEGIN v_option_id := (v_option->>'id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_OPTION_ID');
      END;
      IF v_option_id = ANY(v_seen_options) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_MODIFIER_OPTION');
      END IF;
      IF p_group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_modifier_options o
        WHERE o.id = v_option_id AND o.group_id = p_group_id AND o.branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_OPTION_NOT_IN_GROUP');
      END IF;
      v_seen_options := array_append(v_seen_options, v_option_id);
    END IF;

    BEGIN
      PERFORM COALESCE((v_option->>'price_delta')::numeric, 0);
      PERFORM COALESCE((v_option->>'is_default')::boolean, false);
      PERFORM COALESCE((v_option->>'sort_order')::integer, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_CONFIG_VALUE');
    END;

    IF v_option ? 'inventory_effects' AND jsonb_typeof(v_option->'inventory_effects') <> 'array' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_INVENTORY_EFFECT');
    END IF;

    FOR v_effect IN SELECT value FROM jsonb_array_elements(COALESCE(v_option->'inventory_effects', '[]'::jsonb))
    LOOP
      BEGIN
        v_target_id := NULLIF(v_effect->>'target_id', '')::uuid;
        v_delta := COALESCE((v_effect->>'quantity_delta')::numeric, 0);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_INVENTORY_EFFECT');
      END;
      IF v_target_id IS NULL OR v_delta = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_INVENTORY_EFFECT');
      END IF;
      IF v_effect->>'target_type' = 'raw_material' THEN
        IF NOT EXISTS (SELECT 1 FROM public.raw_materials rm WHERE rm.id = v_target_id AND rm.branch_id = p_branch_id AND rm.is_active = true) THEN
          RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_IN_BRANCH');
        END IF;
      ELSIF v_effect->>'target_type' = 'inventory_unit' THEN
        IF NOT EXISTS (SELECT 1 FROM public.inventory_units iu WHERE iu.id = v_target_id AND iu.branch_id = p_branch_id AND iu.is_active = true) THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVENTORY_UNIT_NOT_IN_BRANCH');
        END IF;
      ELSE
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_TARGET_TYPE');
      END IF;
    END LOOP;
  END LOOP;

  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.product_modifier_groups g
      WHERE g.id = p_group_id AND g.branch_id = p_branch_id AND g.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_NOT_FOUND');
    END IF;

    -- Any change to a group used by an open/held product could change the
    -- authoritative checkout result. Refuse the edit instead of mutating an
    -- in-flight order's meaning.
    IF EXISTS (
      SELECT 1
      FROM public.product_modifier_group_products gp
      JOIN public.order_items oi ON oi.product_id = gp.product_id
      JOIN public.orders ord ON ord.id = oi.order_id
      WHERE gp.group_id = p_group_id AND ord.status IN ('open', 'held')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_HAS_OPEN_ORDERS');
    END IF;

    v_group_id := p_group_id;
    UPDATE public.product_modifier_groups
    SET product_id = v_origin_product_id,
        name = btrim(v_group->>'name'),
        name_en = NULLIF(btrim(v_group->>'name_en'), ''),
        min_selections = v_min,
        max_selections = v_max,
        sort_order = COALESCE((v_group->>'sort_order')::integer, 0),
        is_active = true,
        updated_at = now()
    WHERE id = v_group_id;
  ELSE
    -- A new required group would make an already-open order incomplete.
    IF v_min > 0 AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders ord ON ord.id = oi.order_id
      WHERE oi.product_id = ANY(v_seen_products)
        AND ord.status IN ('open', 'held')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'REQUIRED_MODIFIER_HAS_OPEN_ORDERS');
    END IF;

    INSERT INTO public.product_modifier_groups(
      branch_id, product_id, name, name_en,
      min_selections, max_selections, sort_order, is_active
    ) VALUES (
      p_branch_id, v_origin_product_id,
      btrim(v_group->>'name'), NULLIF(btrim(v_group->>'name_en'), ''),
      v_min, v_max, COALESCE((v_group->>'sort_order')::integer, 0), true
    ) RETURNING id INTO v_group_id;
  END IF;

  DELETE FROM public.product_modifier_group_products WHERE group_id = v_group_id;
  FOR v_product_id IN SELECT unnest(v_seen_products)
  LOOP
    INSERT INTO public.product_modifier_group_products(group_id, product_id, branch_id, sort_order)
    VALUES (v_group_id, v_product_id, p_branch_id, COALESCE((v_group->>'sort_order')::integer, 0));
  END LOOP;

  -- Preserve option ids. Options removed from the editor are deactivated rather
  -- than deleted, keeping historical references intact.
  UPDATE public.product_modifier_options
  SET is_active = false, updated_at = now()
  WHERE group_id = v_group_id;

  FOR v_option IN SELECT value FROM jsonb_array_elements(COALESCE(v_group->'options', '[]'::jsonb))
  LOOP
    IF NULLIF(v_option->>'id', '') IS NOT NULL THEN
      v_option_id := (v_option->>'id')::uuid;
      UPDATE public.product_modifier_options
      SET name = btrim(v_option->>'name'),
          name_en = NULLIF(btrim(v_option->>'name_en'), ''),
          price_delta = COALESCE((v_option->>'price_delta')::numeric, 0),
          is_default = COALESCE((v_option->>'is_default')::boolean, false),
          sort_order = COALESCE((v_option->>'sort_order')::integer, 0),
          is_active = true,
          updated_at = now()
      WHERE id = v_option_id AND group_id = v_group_id;
      DELETE FROM public.product_modifier_inventory_effects WHERE option_id = v_option_id;
    ELSE
      INSERT INTO public.product_modifier_options(
        branch_id, group_id, name, name_en, price_delta, is_default, sort_order, is_active
      ) VALUES (
        p_branch_id, v_group_id, btrim(v_option->>'name'), NULLIF(btrim(v_option->>'name_en'), ''),
        COALESCE((v_option->>'price_delta')::numeric, 0),
        COALESCE((v_option->>'is_default')::boolean, false),
        COALESCE((v_option->>'sort_order')::integer, 0), true
      ) RETURNING id INTO v_option_id;
    END IF;

    FOR v_effect IN SELECT value FROM jsonb_array_elements(COALESCE(v_option->'inventory_effects', '[]'::jsonb))
    LOOP
      v_target_id := (v_effect->>'target_id')::uuid;
      v_delta := (v_effect->>'quantity_delta')::numeric;
      IF v_effect->>'target_type' = 'raw_material' THEN
        INSERT INTO public.product_modifier_inventory_effects(
          branch_id, option_id, target_type, raw_material_id, quantity_delta
        ) VALUES (p_branch_id, v_option_id, 'raw_material', v_target_id, v_delta);
      ELSE
        INSERT INTO public.product_modifier_inventory_effects(
          branch_id, option_id, target_type, inventory_unit_id, quantity_delta
        ) VALUES (p_branch_id, v_option_id, 'inventory_unit', v_target_id, v_delta);
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), 'MODIFIER_GROUP_SAVED', 'product_modifier_group', v_group_id,
    jsonb_build_object('product_count', cardinality(v_seen_products), 'option_count', v_option_count),
    p_branch_id
  );

  RETURN jsonb_build_object('success', true, 'group_id', v_group_id);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_CONFIG_VALUE');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAVE_MODIFIER_GROUP_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_modifier_group(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.modifiers.manage');
  END IF;

  SELECT branch_id INTO v_branch_id FROM public.product_modifier_groups WHERE id = p_group_id AND is_active = true;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.product_modifier_group_products gp
    JOIN public.order_items oi ON oi.product_id = gp.product_id
    JOIN public.orders ord ON ord.id = oi.order_id
    WHERE gp.group_id = p_group_id AND ord.status IN ('open', 'held')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_HAS_OPEN_ORDERS');
  END IF;

  UPDATE public.product_modifier_groups SET is_active = false, updated_at = now() WHERE id = p_group_id;
  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (auth.uid(), 'MODIFIER_GROUP_ARCHIVED', 'product_modifier_group', p_group_id, '{}'::jsonb, v_branch_id);
  RETURN jsonb_build_object('success', true, 'group_id', p_group_id);
END;
$function$;

-- Legacy product-first write remains compatible for stale clients. It creates
-- dedicated groups for that product only and never deletes shared group rows.
CREATE OR REPLACE FUNCTION public.save_product_modifiers(p_product_id uuid, p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_group jsonb;
  v_existing_group uuid;
  v_result jsonb;
BEGIN
  SELECT branch_id INTO v_branch_id FROM public.products WHERE id = p_product_id;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND'); END IF;
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_CONFIG');
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.modifiers.manage');
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders ord ON ord.id = oi.order_id
    WHERE oi.product_id = p_product_id AND ord.status IN ('open', 'held')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_HAS_OPEN_ORDERS');
  END IF;

  -- Detach only; never delete a group that may also belong to another product.
  DELETE FROM public.product_modifier_group_products WHERE product_id = p_product_id;

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups)
  LOOP
    v_existing_group := NULL;
    IF NULLIF(v_group->>'id', '') IS NOT NULL THEN
      BEGIN v_existing_group := (v_group->>'id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN v_existing_group := NULL;
      END;
      IF NOT EXISTS (
        SELECT 1 FROM public.product_modifier_groups g
        WHERE g.id = v_existing_group AND g.branch_id = v_branch_id
      ) THEN
        v_existing_group := NULL;
      END IF;
    END IF;

    v_result := public.save_modifier_group(
      v_existing_group,
      v_branch_id,
      v_group,
      jsonb_build_array(p_product_id)
    );
    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_modifiers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_modifiers(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_modifier_groups_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_modifier_groups_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_product_modifiers_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_modifiers_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_modifier_group(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_modifier_group(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_modifier_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_modifier_group(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_product_modifiers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_modifiers(uuid, jsonb) TO authenticated, service_role;
