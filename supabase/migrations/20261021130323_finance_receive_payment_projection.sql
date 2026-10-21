-- Staged only: preserve the existing body/security/ACL and repair its record projection.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE v_def text;
 v_old text := 'SELECT total, COALESCE(paid_amount, 0), COALESCE(refunded_amount, 0) INTO v_sale';
 v_new text := 'SELECT id, total, COALESCE(paid_amount, 0) AS paid_amount, COALESCE(refunded_amount, 0) AS refunded_amount INTO v_sale';
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.receive_payment(uuid,uuid,numeric,text,uuid,text)'::regprocedure)) <> '61cef56d5a382ee177d0c9113559ac6e' THEN
   RAISE EXCEPTION 'FINANCE_RECEIVE_BASELINE_CHANGED';
 END IF;
 SELECT pg_get_functiondef('public.receive_payment(uuid,uuid,numeric,text,uuid,text)'::regprocedure) INTO v_def;
 IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'FINANCE_RECEIVE_PROJECTION_CHANGED'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END $patch$;
