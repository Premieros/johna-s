-- P0-B final handover hardening.
-- Prevent resolve_product_modifiers from disclosing cross-branch product/modifier
-- information before authentication and branch authorization are established.

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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
  )
  INTO v_active_user;

  IF NOT COALESCE(v_active_user, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_option_ids IS NULL OR jsonb_typeof(p_option_ids) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_SELECTION');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
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

  SELECT x.option_id
  INTO v_invalid
  FROM (
    SELECT NULLIF(value, '')::uuid AS option_id
    FROM jsonb_array_elements_text(p_option_ids)
  ) x
  LEFT JOIN public.product_modifier_options o
    ON o.id = x.option_id
   AND o.is_active = true
  LEFT JOIN public.product_modifier_groups g
    ON g.id = o.group_id
   AND g.is_active = true
  WHERE o.id IS NULL
     OR g.id IS NULL
     OR g.product_id <> p_product_id
     OR g.branch_id <> p_branch_id
     OR o.branch_id <> p_branch_id
  LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_MODIFIER_OPTION',
      'option_id', v_invalid
    );
  END IF;

  FOR v_group IN
    SELECT g.id, g.name, g.name_en, g.min_selections, g.max_selections
    FROM public.product_modifier_groups g
    WHERE g.product_id = p_product_id
      AND g.branch_id = p_branch_id
      AND g.is_active = true
    ORDER BY g.sort_order, g.created_at
  LOOP
    SELECT COUNT(*)
    INTO v_selected_count
    FROM public.product_modifier_options o
    WHERE o.group_id = v_group.id
      AND o.is_active = true
      AND o.id IN (
        SELECT NULLIF(value, '')::uuid
        FROM jsonb_array_elements_text(p_option_ids)
      );

    IF v_selected_count < v_group.min_selections THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MODIFIER_SELECTION_REQUIRED',
        'group_id', v_group.id,
        'group_name', v_group.name,
        'min_selections', v_group.min_selections
      );
    END IF;

    IF v_selected_count > v_group.max_selections THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TOO_MANY_MODIFIER_OPTIONS',
        'group_id', v_group.id,
        'group_name', v_group.name,
        'max_selections', v_group.max_selections
      );
    END IF;
  END LOOP;

  SELECT
    COALESCE(SUM(o.price_delta), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'group_id', g.id,
          'group_name', g.name,
          'group_name_en', g.name_en,
          'option_id', o.id,
          'option_name', o.name,
          'option_name_en', o.name_en,
          'price_delta', o.price_delta
        )
        ORDER BY g.sort_order, o.sort_order, o.created_at
      ),
      '[]'::jsonb
    )
  INTO v_price_delta, v_snapshot
  FROM public.product_modifier_options o
  JOIN public.product_modifier_groups g ON g.id = o.group_id
  WHERE o.id IN (
    SELECT NULLIF(value, '')::uuid
    FROM jsonb_array_elements_text(p_option_ids)
  );

  RETURN jsonb_build_object(
    'success', true,
    'price_delta', COALESCE(v_price_delta, 0),
    'snapshot', COALESCE(v_snapshot, '[]'::jsonb)
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_OPTION_ID');
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_product_modifiers(uuid, uuid, jsonb) TO authenticated, service_role;
