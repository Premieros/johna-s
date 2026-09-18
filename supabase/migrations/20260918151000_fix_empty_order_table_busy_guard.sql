-- Align create_order table-busy guard with effective dining-table occupancy.
-- Empty open/held order shells are intentionally non-operational and must not
-- block a table that the UI correctly shows as vacant.

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure
  ) INTO v_def;

  v_old :=
    '    -- Occupancy guard: a table that already has an open/held order cannot take' || E'\n' ||
    '    -- a second order (H2). The one path that legitimately bypasses this is a' || E'\n' ||
    '    -- manager resuming the SAME order, which routes to update_order instead.' || E'\n' ||
    '    IF p_table_id IS NOT NULL AND EXISTS (' || E'\n' ||
    '      SELECT 1 FROM public.orders' || E'\n' ||
    '      WHERE table_id = p_table_id AND status IN (''open'', ''held'')' || E'\n' ||
    '    ) THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'', false, ''error'', ''TABLE_BUSY'',' || E'\n' ||
    '        ''detail'', ''This table already has an open order.'');' || E'\n' ||
    '    END IF;';

  v_new :=
    '    -- Occupancy guard: only an effective open/held order with positive-quantity' || E'\n' ||
    '    -- items occupies the table. Empty shells are non-operational and must not' || E'\n' ||
    '    -- block a table that the floor plan shows as vacant.' || E'\n' ||
    '    IF p_table_id IS NOT NULL AND EXISTS (' || E'\n' ||
    '      SELECT 1 FROM public.orders o' || E'\n' ||
    '      WHERE o.table_id = p_table_id' || E'\n' ||
    '        AND o.status IN (''open'', ''held'')' || E'\n' ||
    '        AND EXISTS (' || E'\n' ||
    '          SELECT 1 FROM public.order_items oi' || E'\n' ||
    '          WHERE oi.order_id = o.id' || E'\n' ||
    '            AND oi.quantity > 0' || E'\n' ||
    '        )' || E'\n' ||
    '    ) THEN' || E'\n' ||
    '      RETURN jsonb_build_object(''success'', false, ''error'', ''TABLE_BUSY'',' || E'\n' ||
    '        ''detail'', ''This table already has an open order.'');' || E'\n' ||
    '    END IF;';

  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'create_order occupancy guard drift; refusing patch';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

COMMENT ON FUNCTION public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid) IS
  'Creates POS orders; TABLE_BUSY applies only to open/held orders with positive-quantity items.';
