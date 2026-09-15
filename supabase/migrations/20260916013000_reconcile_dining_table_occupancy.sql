-- Keep dining_tables.status derived from the real active-order state.
-- A table with any open/held order is occupied. A table with no active order
-- must not remain stale-occupied. Reserved/closed states are preserved when
-- there is no active order.

CREATE OR REPLACE FUNCTION private.reconcile_dining_table_occupancy(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_table_id
      AND o.status IN ('open', 'held')
  ) THEN
    UPDATE public.dining_tables
    SET status = 'occupied',
        updated_at = now()
    WHERE id = p_table_id
      AND status IS DISTINCT FROM 'occupied';
  ELSE
    UPDATE public.dining_tables
    SET status = 'vacant',
        updated_at = now()
    WHERE id = p_table_id
      AND status = 'occupied';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.reconcile_dining_table_occupancy_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.reconcile_dining_table_occupancy(OLD.table_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.table_id IS DISTINCT FROM NEW.table_id THEN
    PERFORM private.reconcile_dining_table_occupancy(OLD.table_id);
  END IF;

  PERFORM private.reconcile_dining_table_occupancy(NEW.table_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_dining_table_occupancy ON public.orders;
CREATE TRIGGER trg_reconcile_dining_table_occupancy
AFTER INSERT OR DELETE OR UPDATE OF table_id, status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION private.reconcile_dining_table_occupancy_from_order();

-- One-time repair for data that predates the invariant.
UPDATE public.dining_tables t
SET status = 'occupied',
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.orders o
  WHERE o.table_id = t.id
    AND o.status IN ('open', 'held')
)
  AND t.status IS DISTINCT FROM 'occupied';

UPDATE public.dining_tables t
SET status = 'vacant',
    updated_at = now()
WHERE t.status = 'occupied'
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = t.id
      AND o.status IN ('open', 'held')
  );

COMMENT ON FUNCTION private.reconcile_dining_table_occupancy(uuid) IS
  'Keeps table occupied/vacant state consistent with open or held orders without overwriting reserved/closed empty tables.';
