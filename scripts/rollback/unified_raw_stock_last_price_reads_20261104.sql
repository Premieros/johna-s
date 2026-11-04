-- Roll back the read-only release together with the preceding Pages frontend.
-- No business, stock, price event, debt, journal or applied count is changed.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_raw_material_current_prices(uuid,uuid[])'::regprocedure))<>'1f142b367606272ea02c0bc791b01243'
 OR md5(pg_get_functiondef('public.get_raw_material_stock_summary(uuid,integer,integer)'::regprocedure))<>'298275b1ff4153be2f3f7a1b9533f9a9'
 THEN RAISE EXCEPTION 'UNIFIED_RAW_READ_ROLLBACK_BASELINE_CHANGED'; END IF;
END $guard$;
DROP FUNCTION public.get_raw_material_stock_summary(uuid,integer,integer);
CREATE OR REPLACE FUNCTION public.get_raw_material_current_prices(p_branch_id uuid DEFAULT NULL::uuid, p_raw_material_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(raw_material_id uuid, branch_id uuid, unit_cost numeric, price_source text, priced_at timestamp with time zone, reference_number text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT * FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,NULL::timestamptz);
$function$;
COMMIT;
