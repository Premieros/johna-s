BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
-- Change only the receiving authorization guard. Keep the established purchase
-- manager umbrella and every stock/accounting/branch/atomicity check intact.
DO $repair$
DECLARE
 definition text;
 original text := $guard$IF NOT public.can_permission('purchases.manage') THEN$guard$;
 replacement text := $guard$IF NOT (public.can_permission('procurement.receive') OR public.can_permission('purchases.manage')) THEN$guard$;
BEGIN
 SELECT pg_get_functiondef('public.receive_purchase_order(uuid,jsonb)'::regprocedure) INTO STRICT definition;
 IF position(replacement IN definition)>0 THEN RETURN; END IF;
 IF (length(definition)-length(replace(definition,original,'')))/length(original)<>1 THEN
  RAISE EXCEPTION 'RECEIVING_PERMISSION_GUARD_SOURCE_DRIFT';
 END IF;
 EXECUTE replace(definition,original,replacement);
END;
$repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
