-- Keep dining_tables.status derived from effective active dine-in orders.
-- A table is occupied when at least one open/held order on it has a positive-quantity item.
-- Empty orders do not occupy tables. Reserved/closed states are preserved when no effective
-- active order exists. Direct attempts to mark an effectively occupied table non-occupied
-- are normalized back to occupied, covering settlement code that may otherwise stale-vacate it.

CREATE OR REPLACE FUNCTION private.reconcile_dining_table_occupancy(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
          AND oi.quantity > 0
      )
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
SET search_path = pg_catalog, public, pg_temp
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

CREATE OR REPLACE FUNCTION private.reconcile_dining_table_occupancy_from_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_old_table_id uuid;
  v_new_table_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT o.table_id INTO v_old_table_id
    FROM public.orders o
    WHERE o.id = OLD.order_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT o.table_id INTO v_new_table_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;

  IF v_old_table_id IS NOT NULL THEN
    PERFORM private.reconcile_dining_table_occupancy(v_old_table_id);
  END IF;

  IF v_new_table_id IS NOT NULL
     AND v_new_table_id IS DISTINCT FROM v_old_table_id THEN
    PERFORM private.reconcile_dining_table_occupancy(v_new_table_id);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_dining_table_occupancy_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = NEW.id
      AND o.status IN ('open', 'held')
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
          AND oi.quantity > 0
      )
  ) THEN
    NEW.status := 'occupied';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_dining_table_occupancy ON public.orders;
CREATE TRIGGER trg_reconcile_dining_table_occupancy
AFTER INSERT OR DELETE OR UPDATE OF table_id, status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION private.reconcile_dining_table_occupancy_from_order();

DROP TRIGGER IF EXISTS trg_reconcile_dining_table_occupancy_from_item ON public.order_items;
CREATE TRIGGER trg_reconcile_dining_table_occupancy_from_item
AFTER INSERT OR DELETE OR UPDATE OF order_id, quantity
ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION private.reconcile_dining_table_occupancy_from_order_item();

DROP TRIGGER IF EXISTS trg_enforce_dining_table_occupancy_status ON public.dining_tables;
CREATE TRIGGER trg_enforce_dining_table_occupancy_status
BEFORE UPDATE OF status
ON public.dining_tables
FOR EACH ROW
EXECUTE FUNCTION private.enforce_dining_table_occupancy_status();

-- One-time repair for stale rows predating the invariant.
UPDATE public.dining_tables t
SET status = 'occupied',
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.orders o
  WHERE o.table_id = t.id
    AND o.status IN ('open', 'held')
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.quantity > 0
    )
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
      AND EXISTS (
        SELECT 1
        FROM public.order_items oi
        WHERE oi.order_id = o.id
          AND oi.quantity > 0
      )
  );

COMMENT ON FUNCTION private.reconcile_dining_table_occupancy(uuid) IS
  'Reconciles table occupancy from open/held orders that contain positive-quantity items.';

COMMENT ON FUNCTION private.enforce_dining_table_occupancy_status() IS
  'Prevents an effectively occupied dining table from being stale-marked vacant/reserved/closed.';
