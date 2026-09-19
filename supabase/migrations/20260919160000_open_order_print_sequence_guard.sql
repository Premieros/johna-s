-- Open-order cashier print sequence guard.
--
-- Open POS checks are queued as kind='receipt' so they route through the
-- existing cashier transport, but they are not completed sales and therefore
-- have no sale_id / expected_print_number. Sale receipt sequencing must remain
-- enforced for real sale receipts only.
--
-- Patch the two execution RPCs in place to preserve every current permission,
-- branch, lease, approval, retry, and physical-print-truth guard.

DO $patch$
DECLARE
  v_def text;
  v_old text := 'IF v_job.kind = ''receipt'' THEN';
  v_new text := 'IF v_job.kind = ''receipt'' AND v_job.sale_id IS NOT NULL THEN';
BEGIN
  SELECT pg_get_functiondef('public.start_cloud_print_job(uuid,uuid)'::regprocedure)
  INTO v_def;

  IF position(v_new IN v_def) > 0 THEN
    NULL;
  ELSIF position(v_old IN v_def) > 0 THEN
    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  ELSE
    RAISE EXCEPTION 'start_cloud_print_job receipt guard drift; refusing patch';
  END IF;
END;
$patch$;

DO $patch$
DECLARE
  v_def text;
  v_old text := 'IF v_job.kind = ''receipt'' THEN';
  v_new text := 'IF v_job.kind = ''receipt'' AND v_job.sale_id IS NOT NULL THEN';
BEGIN
  SELECT pg_get_functiondef('public.complete_cloud_print_job(uuid,uuid,boolean,text)'::regprocedure)
  INTO v_def;

  IF position(v_new IN v_def) > 0 THEN
    NULL;
  ELSIF position(v_old IN v_def) > 0 THEN
    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  ELSE
    RAISE EXCEPTION 'complete_cloud_print_job receipt guard drift; refusing patch';
  END IF;
END;
$patch$;

NOTIFY pgrst, 'reload schema';
