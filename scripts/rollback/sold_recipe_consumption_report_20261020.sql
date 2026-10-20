-- Report-only rollback. Deploy the previous frontend alongside this rollback.
BEGIN;
SET LOCAL lock_timeout='2s';
DROP FUNCTION public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer);
NOTIFY pgrst,'reload schema';
COMMIT;
