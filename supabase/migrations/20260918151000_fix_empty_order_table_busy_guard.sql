-- Align create_order table-busy guard with effective dining-table occupancy.
-- Empty open/held order shells are non-operational and must not block a table
-- that the floor plan correctly shows as vacant.

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure
  ) INTO v_def;

  -- Match only the semantic TABLE_BUSY predicate so this remains compatible
  -- with both the older Production body and the newer Permission-First body.
  v_old :=
    '    IF p_table_id IS NOT NULL AND EXISTS (' || E'\n' ||
    '      SELECT 1 FROM public.orders' || E'\n' ||
    '      WHERE table_id = p_table_id AND status IN (''open'', ''held'')' || E'\n' ||
    '    ) THEN';

  v_new :=
    '    IF p_table_id IS NOT NULL AND EXISTS (' || E'\n' ||
    '      SELECT 1 FROM public.orders o' || E'\n' ||
    '      WHERE o.table_id = p_table_id' || E'\n' ||
    '        AND o.status IN (''open'', ''held'')' || E'\n' ||
    '        AND EXISTS (' || E'\n' ||
    '          SELECT 1 FROM public.order_items oi' || E'\n' ||
    '          WHERE oi.order_id = o.id' || E'\n' ||
    '            AND oi.quantity > 0' || E'\n' ||
    '        )' || E'\n' ||
    '    ) THEN';

  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'create_order occupancy predicate drift; refusing patch';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

-- Existing empty open/held shells are safe to retire: they have no positive
-- item quantity, never reached an operational order state, and should not stay
-- attached to dining tables indefinitely.
UPDATE public.orders o
SET status='cancelled',
    updated_at=now()
WHERE o.table_id IS NOT NULL
  AND o.status IN ('open','held')
  AND NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id=o.id
      AND oi.quantity > 0
  );

COMMENT ON FUNCTION public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid) IS
  'Creates POS orders; TABLE_BUSY applies only to open/held orders with positive-quantity items.';
