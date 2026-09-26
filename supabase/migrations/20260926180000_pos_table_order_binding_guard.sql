-- Prevent ordinary update_order saves from silently detaching a live
-- table-bound order. Explicit detach_order remains the only detach contract.
-- Drift-safe patch anchored on the stable table validation code path.

DO $migration$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'
  );
  v_def text;
  v_anchor text := $anchor$
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables
      WHERE id = p_table_id AND branch_id = v_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

$anchor$;
  v_guard text := $guard$
    -- Ordinary saves must never detach a live table-bound order.
    -- Explicit detachment has its own permission-checked RPC.
    IF v_old_table IS NOT NULL AND p_table_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TABLE_DETACH_REQUIRES_EXPLICIT_ACTION',
        'detail', 'Use the explicit detach_order action to free a table-bound order.'
      );
    END IF;

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

  IF position('TABLE_DETACH_REQUIRES_EXPLICIT_ACTION' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'update_order stable table-validation anchor not found; refusing drifted patch';
  END IF;

  EXECUTE replace(v_def, v_anchor, v_guard || v_anchor);
END
$migration$;

ALTER FUNCTION public.update_order(
  uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text
) SET search_path = public, pg_temp;
