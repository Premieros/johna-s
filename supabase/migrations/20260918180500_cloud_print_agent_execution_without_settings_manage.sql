-- Decouple print-agent execution from printer-settings administration.
-- The queue is already authorization-gated when jobs are enqueued. An installed
-- device agent only executes existing branch-scoped jobs; it must not require
-- settings.manage, otherwise cashier/captain logins stop the durable queue.
-- Printer configuration UI remains protected by settings.manage.

DO $patch$
DECLARE
  v_name text;
  v_sig regprocedure;
  v_def text;
  v_old text :=
    '  IF NOT public.can_permission(''settings.manage'') THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''settings.manage'');' || E'\n' ||
    '  END IF;' || E'\n';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.claim_cloud_print_jobs(uuid,uuid,integer)',
    'public.start_cloud_print_job(uuid,uuid)',
    'public.complete_cloud_print_job(uuid,uuid,boolean,text)'
  ]
  LOOP
    v_sig := to_regprocedure(v_name);
    IF v_sig IS NULL THEN
      RAISE EXCEPTION 'Missing cloud print RPC %', v_name;
    END IF;

    SELECT pg_get_functiondef(v_sig) INTO v_def;
    IF position(v_old IN v_def)=0 THEN
      RAISE EXCEPTION 'Cloud print execution permission fragment drift in %; refusing patch', v_name;
    END IF;

    v_def := replace(v_def, v_old, '');
    EXECUTE v_def;
  END LOOP;
END;
$patch$;

-- Re-assert the intended exposed surface.
REVOKE ALL ON FUNCTION public.claim_cloud_print_jobs(uuid,uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.start_cloud_print_job(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid,uuid,boolean,text) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.claim_cloud_print_jobs(uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_cloud_print_job(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid,uuid,boolean,text) TO authenticated;

COMMENT ON FUNCTION public.claim_cloud_print_jobs(uuid,uuid,integer) IS
'Installed print-agent execution endpoint. Requires authentication and branch scope; printer settings remain settings.manage-only.';
COMMENT ON FUNCTION public.start_cloud_print_job(uuid,uuid) IS
'Installed print-agent execution endpoint. Requires authentication, branch scope and exact agent claim.';
COMMENT ON FUNCTION public.complete_cloud_print_job(uuid,uuid,boolean,text) IS
'Installed print-agent execution endpoint. Requires authentication, branch scope and exact agent claim.';

NOTIFY pgrst,'reload schema';
