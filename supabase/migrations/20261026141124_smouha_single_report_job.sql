-- Owner requests Smouha use Cleopatra's existing report enqueue path.
-- No existing queue jobs, grants, permissions, routes or other functions change.
DO $patch$
DECLARE current_def text; old_block text := $old$ IF p_branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'::uuid THEN
  v_parts:=public.split_legacy_report_text(v_payload->>'text');
 ELSE v_parts:=ARRAY[v_payload->>'text']; END IF;$old$; new_block text := $new$ -- All branches use Cleopatra's existing single-job report path.
 v_parts:=ARRAY[v_payload->>'text'];$new$;
BEGIN
 SELECT pg_get_functiondef('public.enqueue_cloud_report_print(uuid,jsonb,text)'::regprocedure) INTO current_def;
 IF md5(current_def)<>'c80ad7f4acf15aeb306716b8165cf4ff' OR strpos(current_def,old_block)=0 THEN
  RAISE EXCEPTION 'SINGLE_REPORT_BASELINE_CHANGED';
 END IF;
 EXECUTE replace(current_def,old_block,new_block);
END $patch$;
