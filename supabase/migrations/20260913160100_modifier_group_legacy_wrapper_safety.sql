-- Keep stale product-first clients safe after reusable modifier groups are added.
-- A legacy save must never replace another product's assignments or option ids.

CREATE OR REPLACE FUNCTION public.save_product_modifiers(p_product_id uuid, p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_group jsonb;
  v_candidate_group_id uuid;
  v_result jsonb;
  v_saved_group_id uuid;
  v_saved_group_ids uuid[] := '{}'::uuid[];
  v_previous_group_ids uuid[] := '{}'::uuid[];
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.products
  WHERE id = p_product_id;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;
  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_CONFIG');
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('products.modifiers.manage') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'products.modifiers.manage'
    );
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders ord ON ord.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND ord.status IN ('open', 'held')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'MODIFIER_GROUP_HAS_OPEN_ORDERS');
  END IF;

  SELECT COALESCE(array_agg(gp.group_id), '{}'::uuid[])
  INTO v_previous_group_ids
  FROM public.product_modifier_group_products gp
  WHERE gp.product_id = p_product_id;

  FOR v_group IN
    SELECT value FROM jsonb_array_elements(p_groups)
  LOOP
    v_candidate_group_id := NULL;

    IF NULLIF(v_group->>'id', '') IS NOT NULL THEN
      BEGIN
        v_candidate_group_id := (v_group->>'id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_candidate_group_id := NULL;
      END;

      IF v_candidate_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.product_modifier_groups g
        WHERE g.id = v_candidate_group_id
          AND g.branch_id = v_branch_id
          AND g.is_active = true
      ) THEN
        v_candidate_group_id := NULL;
      END IF;
    END IF;

    -- A product-first client has no concept of shared groups. If the submitted
    -- group is currently shared with another product, clone it for this product
    -- instead of mutating the shared definition or replacing its assignments.
    IF v_candidate_group_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.product_modifier_group_products gp
      WHERE gp.group_id = v_candidate_group_id
        AND gp.product_id <> p_product_id
    ) THEN
      v_candidate_group_id := NULL;

      v_group := jsonb_set(
        v_group - 'id',
        '{options}',
        COALESCE((
          SELECT jsonb_agg(opt - 'id' ORDER BY ordinality)
          FROM jsonb_array_elements(COALESCE(v_group->'options', '[]'::jsonb))
               WITH ORDINALITY AS x(opt, ordinality)
        ), '[]'::jsonb),
        true
      );
    END IF;

    v_result := public.save_modifier_group(
      v_candidate_group_id,
      v_branch_id,
      v_group,
      jsonb_build_array(p_product_id)
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      -- Raise so PostgreSQL rolls back every group mutation made earlier in
      -- this function invocation instead of leaving a partially saved product.
      RAISE EXCEPTION 'LEGACY_MODIFIER_SAVE_FAILED:%', COALESCE(v_result->>'error', 'UNKNOWN');
    END IF;

    v_saved_group_id := (v_result->>'group_id')::uuid;
    v_saved_group_ids := array_append(v_saved_group_ids, v_saved_group_id);
  END LOOP;

  -- Detach definitions the stale client removed, but never delete history.
  DELETE FROM public.product_modifier_group_products gp
  WHERE gp.product_id = p_product_id
    AND NOT (gp.group_id = ANY(v_saved_group_ids));

  -- Dedicated legacy groups that are no longer linked anywhere are archived.
  UPDATE public.product_modifier_groups g
  SET is_active = false,
      updated_at = now()
  WHERE g.id = ANY(v_previous_group_ids)
    AND NOT (g.id = ANY(v_saved_group_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_modifier_group_products gp
      WHERE gp.group_id = g.id
    );

  RETURN jsonb_build_object(
    'success', true,
    'group_ids', to_jsonb(v_saved_group_ids)
  );
EXCEPTION
  WHEN raise_exception THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', split_part(SQLERRM, ':', 2),
      'detail', SQLERRM
    );
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_MODIFIER_CONFIG_VALUE');
END;
$function$;

REVOKE ALL ON FUNCTION public.save_product_modifiers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_modifiers(uuid, jsonb) TO authenticated, service_role;
