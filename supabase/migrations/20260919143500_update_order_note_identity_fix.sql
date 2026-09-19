-- Fix update_order line identity for duplicate products that differ only by notes.
--
-- Root cause:
-- update_order matched existing order_items by product/unit/modifiers/discount/bonus
-- but ignored notes. Two sent lines for the same product with different notes
-- could therefore be swapped during a positive-delta save, making one line appear
-- reduced and incorrectly triggering SENT_ITEM_APPROVAL_REQUIRED.
--
-- This patch changes only the line-matching predicate in update_order.
-- It does not modify send_to_kitchen, printing, KDS, shifts, day close, or stock deduction.

DO $patch$
DECLARE
  v_def text;
  v_old text := $old$
        AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
        AND NOT EXISTS (
$old$;
  v_new text := $new$
        AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
        AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
        AND NOT EXISTS (
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'::regprocedure
  ) INTO v_def;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'update_order line-identity fragment not found; refusing drifted patch';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

COMMENT ON FUNCTION public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)
  IS 'Updates an open/held order while preserving sent-line identity by product, unit, modifiers, discount/bonus, and notes.';
