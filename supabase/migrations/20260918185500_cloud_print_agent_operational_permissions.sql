-- Decouple printer settings administration from background print execution.
-- Printer configuration UI remains settings.manage-only.
-- Operational agents may execute only job kinds covered by their explicit print permissions.

CREATE OR REPLACE FUNCTION public.can_execute_cloud_print_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.can_permission('settings.manage')
      OR (p_kind = 'kitchen' AND public.can_permission('pos.print_kitchen'))
      OR (p_kind IN ('receipt','report') AND public.can_permission('pos.receipt.print'))
    );
$function$;

REVOKE ALL ON FUNCTION public.can_execute_cloud_print_kind(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_execute_cloud_print_kind(text) TO authenticated, service_role;

DO $claim_patch$
DECLARE
  v_def text;
  v_guard text;
  v_filter text;
BEGIN
  SELECT pg_get_functiondef('public.claim_cloud_print_jobs(uuid,uuid,integer)'::regprocedure) INTO v_def;

  v_guard :=
    '  IF NOT public.can_permission(''settings.manage'') THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''settings.manage'');' || E'\n' ||
    '  END IF;' || E'\n';

  IF position(v_guard IN v_def)=0 THEN
    RAISE EXCEPTION 'claim_cloud_print_jobs settings guard drift; refusing patch';
  END IF;
  v_def := replace(v_def, v_guard, '');

  v_filter :=
    '    WHERE branch_id = p_branch_id' || E'\n' ||
    '      AND status IN (''pending'', ''failed'')';

  IF position(v_filter IN v_def)=0 THEN
    RAISE EXCEPTION 'claim_cloud_print_jobs picked filter drift; refusing patch';
  END IF;

  v_def := replace(
    v_def,
    v_filter,
    '    WHERE branch_id = p_branch_id' || E'\n' ||
    '      AND public.can_execute_cloud_print_kind(kind)' || E'\n' ||
    '      AND status IN (''pending'', ''failed'')'
  );

  EXECUTE v_def;
END;
$claim_patch$;

DO $start_patch$
DECLARE
  v_def text;
  v_guard text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef('public.start_cloud_print_job(uuid,uuid)'::regprocedure) INTO v_def;

  v_guard :=
    '  IF NOT public.can_permission(''settings.manage'') THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''settings.manage'');' || E'\n' ||
    '  END IF;' || E'\n';

  IF position(v_guard IN v_def)=0 THEN
    RAISE EXCEPTION 'start_cloud_print_job settings guard drift; refusing patch';
  END IF;
  v_def := replace(v_def, v_guard, '');

  v_anchor :=
    '  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;' || E'\n' ||
    '  IF v_job.id IS NULL THEN RETURN jsonb_build_object(''success'', false, ''error'', ''JOB_NOT_FOUND''); END IF;';

  IF position(v_anchor IN v_def)=0 THEN
    RAISE EXCEPTION 'start_cloud_print_job job lookup drift; refusing patch';
  END IF;

  v_def := replace(
    v_def,
    v_anchor,
    v_anchor || E'\n' ||
    '  IF NOT public.can_execute_cloud_print_kind(v_job.kind) THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''print.execute'');' || E'\n' ||
    '  END IF;'
  );

  EXECUTE v_def;
END;
$start_patch$;

DO $complete_patch$
DECLARE
  v_def text;
  v_guard text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef('public.complete_cloud_print_job(uuid,uuid,boolean,text)'::regprocedure) INTO v_def;

  v_guard :=
    '  IF NOT public.can_permission(''settings.manage'') THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''settings.manage'');' || E'\n' ||
    '  END IF;' || E'\n';

  IF position(v_guard IN v_def)=0 THEN
    RAISE EXCEPTION 'complete_cloud_print_job settings guard drift; refusing patch';
  END IF;
  v_def := replace(v_def, v_guard, '');

  v_anchor :=
    '  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;' || E'\n' ||
    '  IF v_job.id IS NULL THEN RETURN jsonb_build_object(''success'', false, ''error'', ''JOB_NOT_FOUND''); END IF;';

  IF position(v_anchor IN v_def)=0 THEN
    RAISE EXCEPTION 'complete_cloud_print_job job lookup drift; refusing patch';
  END IF;

  v_def := replace(
    v_def,
    v_anchor,
    v_anchor || E'\n' ||
    '  IF NOT public.can_execute_cloud_print_kind(v_job.kind) THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''print.execute'');' || E'\n' ||
    '  END IF;'
  );

  EXECUTE v_def;
END;
$complete_patch$;

NOTIFY pgrst, 'reload schema';
