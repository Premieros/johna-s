-- Emergency POS line-identity stabilization.
-- Prevent resumed identical cart lines from swapping database identity and
-- creating false kitchen deltas / repeated kitchen prints.

DO $patch_update_order_identity$
DECLARE
  v_oid regprocedure := to_regprocedure('public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)');
  v_def text;
  v_next text;
  v_old_decl text := $old$
  v_matched_id uuid;
  v_owner_id uuid;
$old$;
  v_new_decl text := $new$
  v_matched_id uuid;
  v_requested_item_id uuid;
  v_owner_id uuid;
$new$;
  v_old_match text := $old$
      v_matched_id := NULL;
      SELECT oi.id INTO v_matched_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.product_id = v_product_id
        AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
        AND oi.modifier_option_ids = ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)))
        AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
        AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
        AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
        AND NOT EXISTS (
          SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
        )
      LIMIT 1;
$old$;
  v_new_match text := $new$
      v_matched_id := NULL;
      v_requested_item_id := NULLIF(v_item->>'order_item_id', '')::uuid;

      -- New clients preserve the database identity of resumed lines. This is
      -- critical for kitchen delta accounting because order_kitchen_sends is
      -- keyed by order_item_id. Never silently swap one identical line for
      -- another.
      IF v_requested_item_id IS NOT NULL THEN
        SELECT oi.id INTO v_matched_id
        FROM public.order_items oi
        WHERE oi.id = v_requested_item_id
          AND oi.order_id = p_order_id
          AND oi.product_id = v_product_id
          AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
          AND oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)
          AND oi.modifier_option_ids = ARRAY(
            SELECT NULLIF(value, '')::uuid
            FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))
            ORDER BY value
          )
          AND ARRAY(
            SELECT x::uuid
            FROM unnest(COALESCE(oi.modifier_option_ids, ARRAY[]::uuid[])) x
            ORDER BY x::text
          ) = ARRAY(
            SELECT NULLIF(value, '')::uuid
            FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))
            ORDER BY value
          )
          AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
          AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
          AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
          AND NOT EXISTS (
            SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
          );

        IF v_matched_id IS NULL THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'ORDER_ITEM_IDENTITY_MISMATCH',
            'order_item_id', v_requested_item_id
          );
        END IF;
      ELSE
        -- Backward compatibility for older deployed clients. Match the exact
        -- commercial configuration, including unit price, without crossing an
        -- already matched line.
        SELECT oi.id INTO v_matched_id
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
          AND oi.product_id = v_product_id
          AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
          AND oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)
          AND ARRAY(
            SELECT x::uuid
            FROM unnest(COALESCE(oi.modifier_option_ids, ARRAY[]::uuid[])) x
            ORDER BY x::text
          ) = ARRAY(
            SELECT NULLIF(value, '')::uuid
            FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))
            ORDER BY value
          )
          AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
          AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
          AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
          AND NOT EXISTS (
            SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
          )
        ORDER BY oi.id
        LIMIT 1;
      END IF;
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'update_order signature missing';
  END IF;

  SELECT pg_get_functiondef(v_oid::oid) INTO v_def;
  v_next := replace(v_def, v_old_decl, v_new_decl);
  IF v_next = v_def THEN
    RAISE EXCEPTION 'update_order declaration patch marker not found';
  END IF;

  v_def := v_next;
  v_next := replace(v_def, v_old_match, v_new_match);
  IF v_next = v_def THEN
    RAISE EXCEPTION 'update_order matching patch marker not found';
  END IF;

  IF position('ORDER_ITEM_IDENTITY_MISMATCH' IN v_next) = 0
     OR position('v_requested_item_id' IN v_next) = 0 THEN
    RAISE EXCEPTION 'update_order identity patch incomplete';
  END IF;

  EXECUTE v_next;
END;
$patch_update_order_identity$;

NOTIFY pgrst, 'reload schema';
