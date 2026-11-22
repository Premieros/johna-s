-- Candidate only. No installation or activation in production.
-- Replace the negative-lot estimate lookup, not physical stock or historical postings.
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public._raw_last_known_fifo_cost(uuid,uuid,uuid)'::regprocedure)) <> 'fdde2b31a97ec9b8398ac03b7b07a3b0'
 OR md5(pg_get_functiondef('public._raw_price_oversold_batch_from_fifo()'::regprocedure)) <> '4dfcd07a97ec02f0f3d8c95ab842b087'
 THEN RAISE EXCEPTION 'RAW_NEGATIVE_PRICE_BASELINE_DRIFT'; END IF;
END
$guard$;

-- Keep the existing private-to-operation compatibility signature and ACL.
CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost(p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
 SELECT COALESCE((
   SELECT p.unit_cost
   FROM private.latest_approved_raw_prices(p_branch_id,ARRAY[p_raw_material_id],statement_timestamp()) p
   WHERE p.raw_material_id=p_raw_material_id AND p.branch_id=p_branch_id
     AND p.unit_cost>0
     AND EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id)
 ),0)::numeric;
$fn$;

CREATE OR REPLACE FUNCTION public._raw_price_oversold_batch_from_fifo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 -- An update may be a settlement or reversal of a historic lot. Preserve the
 -- caller's stored cost rather than re-resolving it under a newer price.
 IF TG_OP='INSERT' AND NEW.quantity<0 AND COALESCE(NEW.unit_cost,0)<=0
    AND COALESCE(NEW.source_type,'') LIKE '%_oversold' THEN
   NEW.unit_cost:=round(public._raw_last_known_fifo_cost(
     NEW.raw_material_id,NEW.branch_id,NEW.warehouse_id
   ),6);
 END IF;
 RETURN NEW;
END;
$fn$;
