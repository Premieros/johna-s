-- Thermal print payload guard.
--
-- The legacy Windows localhost print service is a text transport. Receipt and
-- Z-report jobs must therefore never reach it as raw HTML/CSS. Normalize every
-- receipt/report payload at the durable queue boundary so cached or older web
-- clients cannot reintroduce literal markup on paper.
--
-- This does not change printer routing, print authorization, RLS, agent
-- ownership, print-once semantics, or Windows installation requirements.

CREATE OR REPLACE FUNCTION public._normalize_thermal_print_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_text text := btrim(COALESCE(p_payload->>'text', ''));
  v_html text := COALESCE(p_payload->>'html', '');
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN COALESCE(p_payload, '{}'::jsonb);
  END IF;

  -- Canonical payload already has text: keep it and remove the dangerous HTML
  -- fallback so downstream transports have exactly one representation.
  IF v_text <> '' THEN
    RETURN (p_payload - 'html') || jsonb_build_object('text', v_text);
  END IF;

  IF btrim(v_html) = '' THEN
    RETURN p_payload - 'html';
  END IF;

  -- Compatibility for cached/old clients. Remove non-print content first,
  -- preserve block boundaries as new lines, then remove tags.
  v_text := regexp_replace(v_html, '<style[^>]*>.*?</style>', '', 'gis');
  v_text := regexp_replace(v_text, '<script[^>]*>.*?</script>', '', 'gis');
  v_text := regexp_replace(v_text, '<noscript[^>]*>.*?</noscript>', '', 'gis');
  v_text := regexp_replace(v_text, '<svg[^>]*>.*?</svg>', '', 'gis');
  v_text := regexp_replace(v_text, '<br[[:space:]]*/?>', E'\n', 'gi');
  v_text := regexp_replace(v_text, '</(div|p|h[1-6]|tr|section|li|header|footer|table|thead|tbody)>', E'\n', 'gi');
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

REVOKE ALL ON FUNCTION public._normalize_thermal_print_payload(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._normalize_thermal_print_payload(jsonb)
  TO authenticated, service_role, postgres;


CREATE OR REPLACE FUNCTION public.normalize_cloud_thermal_print_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  IF NEW.kind IN ('receipt','report') THEN
    NEW.payload := public._normalize_thermal_print_payload(NEW.payload);
    IF COALESCE(btrim(NEW.payload->>'text'), '') = '' THEN
      RAISE EXCEPTION 'THERMAL_PRINT_TEXT_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_cloud_thermal_print_job()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_cloud_thermal_print_job()
  TO service_role, postgres;

DROP TRIGGER IF EXISTS trg_normalize_cloud_thermal_print_job
  ON public.cloud_print_jobs;
CREATE TRIGGER trg_normalize_cloud_thermal_print_job
BEFORE INSERT OR UPDATE OF payload, kind
ON public.cloud_print_jobs
FOR EACH ROW
EXECUTE FUNCTION public.normalize_cloud_thermal_print_job();


-- Repair only jobs that have not reached physical submission yet. Never touch
-- submitted jobs because replaying an ambiguous physical outcome could duplicate
-- a receipt/report.
UPDATE public.cloud_print_jobs
SET payload = public._normalize_thermal_print_payload(payload),
    updated_at = now()
WHERE kind IN ('receipt','report')
  AND status IN ('pending','failed')
  AND COALESCE(btrim(payload->>'text'), '') = ''
  AND COALESCE(btrim(payload->>'html'), '') <> '';

NOTIFY pgrst, 'reload schema';
