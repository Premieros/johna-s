DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.get_raw_material_consumption_report(uuid,date,date)'::regprocedure);
BEGIN
  IF md5(definition) <> '7c004a2575374c13bc72939cb091e747' THEN
    RAISE EXCEPTION 'RAW_MOVEMENT_REPORT_BASELINE_CHANGED';
  END IF;
  -- Stop before evaluating financial visibility on rows after the period.
  definition := replace(definition, 'AND il.raw_material_id IS NOT NULL',
    'AND il.raw_material_id IS NOT NULL
        AND (v_to IS NULL OR il.created_at < ((v_to + 1)::timestamp AT TIME ZONE ''Africa/Cairo''))');
  definition := replace(definition, '(created_at AT TIME ZONE ''Africa/Cairo'')::date < v_from',
    'created_at < (v_from::timestamp AT TIME ZONE ''Africa/Cairo'')');
  definition := replace(definition, '(created_at AT TIME ZONE ''Africa/Cairo'')::date >= v_from',
    'created_at >= (v_from::timestamp AT TIME ZONE ''Africa/Cairo'')');
  definition := replace(definition, '(created_at AT TIME ZONE ''Africa/Cairo'')::date <= v_to',
    'created_at < ((v_to + 1)::timestamp AT TIME ZONE ''Africa/Cairo'')');
  EXECUTE definition;
END;
$migration$;
