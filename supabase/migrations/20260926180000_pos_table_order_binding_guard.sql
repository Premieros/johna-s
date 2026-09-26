-- Prevent ordinary update_order saves from silently detaching a live
-- table-bound order. Explicit detach_order remains the only detach contract.
-- This is a drift-safe forward patch over the latest canonical function body.

DO $migration$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'
  );
  v_def text;
  v_anchor text := E'    -- New table must belong to the order branch and be active.\n';
  v_guard text := E'    -- An ordinary save must never detach a live table-bound order.\n'
    || E'    -- Explicit detachment has its own audited/permission-checked RPC.\n'
    || E'    IF v_old_table IS NOT NULL AND p_table_id IS NULL THEN\n'
    || E"      RETURN jsonb_build_object('success', false, 'error', 'TABLE_DETACH_REQUIRES_EXPLICIT_ACTION',\n"
    || E"        'detail', 'Use the explicit detach_order action to free a table-bound order.');\n"
    || E'    END IF;\n\n'
    || E"    IF (v_old_table IS NOT NULL OR p_table_id IS NOT NULL) AND COALESCE(p_order_type, 'dine_in') <> 'dine_in' THEN\n"
    || E"      RETURN jsonb_build_object('success', false, 'error', 'TABLE_ORDER_TYPE_MISMATCH',\n"
    || E"        'detail', 'A table-bound order must remain dine_in during ordinary saves.');\n"
    || E'    END IF;\n\n'
    || v_anchor;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'update_order canonical signature not found';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF position('TABLE_DETACH_REQUIRES_EXPLICIT_ACTION' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'update_order table-validation anchor not found; refusing drifted patch';
  END IF;

  EXECUTE replace(v_def, v_anchor, v_guard);
END
$migration$;

ALTER FUNCTION public.update_order(
  uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text
) SET search_path = public, pg_temp;
