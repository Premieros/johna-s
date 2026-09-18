-- Prevent legacy/cached web clients from sending HTML/CSS to thermal printers.
-- The server normalizes report payloads to plain text before they enter the
-- durable cloud print queue. This protects the installed Windows/local print
-- service without requiring a reinstall.

CREATE OR REPLACE FUNCTION public._normalize_cloud_report_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_text text := btrim(COALESCE(p_payload->>'text', ''));
  v_html text := COALESCE(p_payload->>'html', '');
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN p_payload;
  END IF;

  -- Canonical payload: text wins and HTML is removed so the legacy localhost
  -- print service can never fall back to printing markup as literal text.
  IF v_text <> '' THEN
    RETURN (p_payload - 'html') || jsonb_build_object('text', v_text);
  END IF;

  IF btrim(v_html) = '' THEN
    RETURN p_payload - 'html';
  END IF;

  -- Legacy Z-report HTML compatibility. Keep only the body, remove non-print
  -- content, add line breaks for block elements, then strip the remaining tags.
  v_text := regexp_replace(v_html, '^.*<body[^>]*>', '', 'is');
  v_text := regexp_replace(v_text, '</body>.*$', '', 'is');
  v_text := regexp_replace(v_text, '<style[^>]*>.*?</style>', '', 'gis');
  v_text := regexp_replace(v_text, '<script[^>]*>.*?</script>', '', 'gis');
  v_text := regexp_replace(v_text, '<br[[:space:]]*/?>', E'\n', 'gi');
  v_text := regexp_replace(v_text, '</(div|p|h[1-6]|tr|section|li)>', E'\n', 'gi');
  v_text := regexp_replace(v_text, '</(span|td|th)>', ' ', 'gi');
  v_text := regexp_replace(v_text, '<[^>]+>', '', 'g');

  v_text := replace(v_text, '&nbsp;', ' ');
  v_text := replace(v_text, '&amp;', '&');
  v_text := replace(v_text, '&lt;', '<');
  v_text := replace(v_text, '&gt;', '>');
  v_text := replace(v_text, '&quot;', '"');
  v_text := replace(v_text, '&#39;', '''');

  v_text := regexp_replace(v_text, E'[ \\t]+', ' ', 'g');
  v_text := regexp_replace(v_text, E' *\\n *', E'\n', 'g');
  v_text := regexp_replace(v_text, E'\\n{3,}', E'\n\n', 'g');
  v_text := btrim(v_text);

  RETURN (p_payload - 'html') || jsonb_build_object('text', v_text);
END;
$function$;

REVOKE ALL ON FUNCTION public._normalize_cloud_report_payload(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._normalize_cloud_report_payload(jsonb) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.enqueue_cloud_report_print(
  p_branch_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  v_payload := public._normalize_cloud_report_payload(p_payload);
  IF COALESCE(btrim(v_payload->>'text'),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','REPORT_TEXT_REQUIRED');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    p_branch_id,auth.uid(),'report','cashier',v_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,'job_id',v_job.id,'status',v_job.status,'station_code','cashier'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) TO authenticated, service_role;


-- Repair only jobs that have not reached the physical printer yet.
UPDATE public.cloud_print_jobs
SET payload = public._normalize_cloud_report_payload(payload),
    updated_at = now()
WHERE kind='report'
  AND status IN ('pending','failed')
  AND COALESCE(btrim(payload->>'text'),'')=''
  AND COALESCE(btrim(payload->>'html'),'')<>'';

NOTIFY pgrst,'reload schema';
