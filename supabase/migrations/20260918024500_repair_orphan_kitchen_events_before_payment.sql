-- Repair legacy orphan kitchen inventory events that block sent-only payment,
-- and harden sent-item mutation so an unsettled kitchen inventory event can
-- never be orphaned by deleting/reducing its order line.
--
-- Inventory remains authoritative at send_to_kitchen. A deleted sent line is
-- treated as a void only after its kitchen inventory event has been restored.

DO $do$
DECLARE
  v_row record;
  v_result jsonb;
BEGIN
  FOR v_row IN
    SELECT
      e.order_id,
      e.order_item_id,
      sum(e.sent_quantity - e.voided_quantity)::numeric(14,6) AS pending_quantity
    FROM public.order_kitchen_inventory_events e
    LEFT JOIN public.order_items oi ON oi.id = e.order_item_id
    WHERE oi.id IS NULL
      AND e.settled_sale_id IS NULL
      AND e.sent_quantity > e.voided_quantity
    GROUP BY e.order_id, e.order_item_id
    ORDER BY e.order_id, e.order_item_id
  LOOP
    v_result := public._restore_kitchen_inventory_for_void(
      v_row.order_id,
      v_row.order_item_id,
      v_row.pending_quantity
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE
       OR abs(COALESCE((v_result->>'restored_sent_quantity')::numeric, 0) - v_row.pending_quantity) > 0.000001 THEN
      RAISE EXCEPTION
        'ORPHAN_KITCHEN_EVENT_REPAIR_FAILED order=% item=% expected=% result=%',
        v_row.order_id, v_row.order_item_id, v_row.pending_quantity, v_result;
    END IF;
  END LOOP;
END;
$do$;

CREATE OR REPLACE FUNCTION public.guard_sent_order_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_sent boolean := false;
  v_is_reduction boolean := false;
  v_internal boolean := COALESCE(current_setting('app.approved_sent_item_void', true), '') = '1';
  v_pending_event_quantity numeric(14,6) := 0;
BEGIN
  SELECT
    EXISTS(
      SELECT 1
      FROM public.order_kitchen_sends s
      WHERE s.order_item_id = OLD.id
    )
    OR EXISTS(
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_item_id = OLD.id
        AND e.order_id = OLD.order_id
        AND e.settled_sale_id IS NULL
        AND e.sent_quantity > e.voided_quantity
    )
  INTO v_has_sent;

  IF NOT v_has_sent THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_reduction := true;
  ELSIF TG_OP = 'UPDATE'
        AND COALESCE(NEW.quantity, 0) < COALESCE(OLD.quantity, 0) THEN
    v_is_reduction := true;
  END IF;

  IF NOT v_is_reduction THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT v_internal THEN
    RAISE EXCEPTION 'SENT_ITEM_APPROVAL_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity), 0)
  INTO v_pending_event_quantity
  FROM public.order_kitchen_inventory_events e
  WHERE e.order_item_id = OLD.id
    AND e.order_id = OLD.order_id
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity > e.voided_quantity;

  IF TG_OP = 'DELETE' AND v_pending_event_quantity > 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_pending_event_quantity > COALESCE(NEW.quantity, 0) + 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_sent_order_item_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_sent_order_item_mutation() TO service_role, postgres;

COMMENT ON FUNCTION public.guard_sent_order_item_mutation() IS
  'Blocks sent-line reduction/deletion unless the approved void path has already restored every affected unsettled kitchen inventory event.';
