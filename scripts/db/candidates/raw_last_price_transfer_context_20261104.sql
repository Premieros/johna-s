-- The transfer RPC already authorizes source/receiver branches and approval.
-- Its quote/receipt must use the same trusted operational price as raw issues,
-- independently of permission to browse old purchase invoices. Report visibility
-- remains unchanged, including existing nested financial-context readers.
DO $transfer_price_context$
DECLARE f text; s text; old text:='private.latest_approved_raw_prices(';
BEGIN
 FOREACH f IN ARRAY ARRAY['public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)',
   'public.approve_warehouse_transfer(uuid)'] LOOP
  SELECT pg_get_functiondef(f::regprocedure) INTO s;
  IF (f LIKE '%create_%' AND md5(s)<>'7e7570f8dff786aaf7d88fffe84379a9')
   OR (f LIKE '%approve_%' AND md5(s)<>'774587865931c3f7314eece4973d338c') THEN
   RAISE EXCEPTION 'TRANSFER_OPERATIONAL_PRICE_BASELINE_DRIFT';
  END IF;
  IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN
   RAISE EXCEPTION 'TRANSFER_OPERATIONAL_PRICE_SOURCE_DRIFT:%',f;
  END IF;
  EXECUTE replace(s,old,'private.stock_count_raw_price(');
 END LOOP;
END $transfer_price_context$;
