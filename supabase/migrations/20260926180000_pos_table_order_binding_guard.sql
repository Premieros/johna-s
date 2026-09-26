-- Prevent ordinary update_order saves from silently detaching a live
-- table-bound order. Explicit detach_order remains the only detach contract.
-- Drift-safe patch anchored on the stable table validation code path.

DO $migration$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'
  );
  v_def text;
  v_anchor text := E'    IF p_table_id IS NOT NULL AND NOT EXISTS (\n';
  v_guard text := $guard$
    -- TABLE_ORDER_BINDING_PRESERVE_V1
    -- Legacy/ordinary POS saves may omit p_table_id while editing a dine-in
    -- order. Treat NULL as "preserve the existing binding", never as detach.
    IF v_old_table IS NOT NULL
       AND p_table_id IS NULL
       AND COALESCE(p_order_type, 'dine_in') = 'dine_in' THEN
      p_table_id := v_old_table;
    END IF;

    -- A table-bound order cannot be converted to another order type by an
    -- ordinary save. Explicit detach/transfer actions own that boundary.
    IF (v_old_table IS NOT NULL OR p_table_id IS NOT NULL)
       AND COALESCE(p_order_type, 'dine_in') <> 'dine_in' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TABLE_ORDER_TYPE_MISMATCH',
        'detail', 'A table-bound order must remain dine_in during ordinary saves.'
      );
    END IF;

$guard$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'update_order canonical signature not found';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF position('TABLE_ORDER_BINDING_PRESERVE_V1' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'update_order stable table-validation anchor not found; refusing drifted patch';
  END IF;

  -- update_order has exactly one table-validation block. Anchor at its stable
  -- opening line so the patch tolerates formatting drift inside that block.
  EXECUTE replace(v_def, v_anchor, v_guard || v_anchor);
END
$migration$;

ALTER FUNCTION public.update_order(
  uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text
) SET search_path = public, pg_temp;
