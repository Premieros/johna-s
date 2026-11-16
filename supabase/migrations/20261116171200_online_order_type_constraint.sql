-- The canonical CI order lifecycle schema has a four-type CHECK. Extend it
-- without reprocessing existing orders. Fail closed on an unknown constraint.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_definition
  FROM pg_constraint
  WHERE conrelid='public.orders'::regclass AND conname='orders_order_type_check';
  IF v_definition IS NOT NULL THEN
    IF v_definition NOT ILIKE '%dine_in%'
       OR v_definition NOT ILIKE '%takeaway%'
       OR v_definition NOT ILIKE '%drive_thru%'
       OR v_definition NOT ILIKE '%delivery%'
       OR v_definition ILIKE '%online%' THEN
      RAISE EXCEPTION 'ORDER_TYPE_CONSTRAINT_DRIFT: %',v_definition;
    END IF;
    ALTER TABLE public.orders DROP CONSTRAINT orders_order_type_check;
    ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check
      CHECK (order_type IN ('dine_in','takeaway','drive_thru','delivery','online'));
  END IF;
END;
$guard$;
COMMIT;
