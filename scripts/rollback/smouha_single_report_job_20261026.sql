-- Guarded rollback: restore only the original Smouha split block.
DO $rollback$
DECLARE current_def text; restored text; old_block text := $old$ IF p_branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'::uuid THEN
  v_parts:=public.split_legacy_report_text(v_payload->>'text');
 ELSE v_parts:=ARRAY[v_payload->>'text']; END IF;$old$; new_block text := $new$ -- All branches use Cleopatra's existing single-job report path.
 v_parts:=ARRAY[v_payload->>'text'];$new$;
BEGIN
 SELECT pg_get_functiondef('public.enqueue_cloud_report_print(uuid,jsonb,text)'::regprocedure) INTO current_def;
 restored:=replace(current_def,new_block,old_block);
 IF strpos(current_def,new_block)=0 OR md5(restored)<>'c80ad7f4acf15aeb306716b8165cf4ff' THEN RAISE EXCEPTION 'SINGLE_REPORT_ROLLBACK_BASELINE_CHANGED'; END IF;
 EXECUTE restored;
END $rollback$;
