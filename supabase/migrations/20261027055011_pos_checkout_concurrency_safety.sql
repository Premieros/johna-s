-- Only existing checkout bodies change. No schema, grants, RLS, kitchen, queue or financial equations change.
BEGIN;
DO $checkout_process_sale$
DECLARE v_oid oid; v_def text; v_before text; v_old text; v_new text;
BEGIN
  SELECT p.oid,pg_get_functiondef(p.oid) INTO v_oid,v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_sale' AND p.pronargs=20;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'process_sale missing'; END IF;
  v_before := v_def;
  v_old := $old$  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.branch_id = p_branch_id
      AND s.status = 'open'
  ) THEN$old$;
  v_new := $new$  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.branch_id = p_branch_id
      AND s.status = 'open'
    FOR SHARE -- POS_CHECKOUT_SHIFT_LOCK
  ) THEN$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN RAISE EXCEPTION 'process_sale fragment drift; refusing patch'; END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$    WHERE o.id = p_order_id
      AND o.branch_id = p_branch_id;$old$;
  v_new := $new$    WHERE o.id = p_order_id
      AND o.branch_id = p_branch_id
    FOR UPDATE; -- POS_CHECKOUT_OWNER_LOCK: capture the captain under the settlement lock.$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN RAISE EXCEPTION 'process_sale fragment drift; refusing patch'; END IF;
  v_def := replace(v_def,v_old,v_new);
  IF v_def=v_before THEN RAISE EXCEPTION 'process_sale unchanged'; END IF;
  EXECUTE v_def;
END;
$checkout_process_sale$;
DO $checkout_process_sale_split$
DECLARE v_oid oid; v_def text; v_before text; v_old text; v_new text;
BEGIN
  SELECT p.oid,pg_get_functiondef(p.oid) INTO v_oid,v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_sale_split' AND p.pronargs=20;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'process_sale_split missing'; END IF;
  v_before := v_def;
  v_old := $old$    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) < 2 THEN$old$;
  v_new := $new$  -- POS_CHECKOUT_SHIFT_LOCK: shared row lock lets payments run concurrently,
  -- while close_shift cannot close this exact shift before checkout commits.
  IF p_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.shifts s
    WHERE s.id = p_shift_id AND s.branch_id = p_branch_id AND s.status = 'open'
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'error','NO_OPEN_SHIFT');
    END IF;
  END IF;

    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) < 2 THEN$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN RAISE EXCEPTION 'process_sale_split fragment drift; refusing patch'; END IF;
  v_def := replace(v_def,v_old,v_new);
  v_old := $old$      WHERE o.id=p_order_id AND o.branch_id=p_branch_id AND o.status IN ('open','held');$old$;
  v_new := $new$      WHERE o.id=p_order_id AND o.branch_id=p_branch_id AND o.status IN ('open','held')
      FOR UPDATE; -- POS_CHECKOUT_OWNER_LOCK: capture the captain under the settlement lock.$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN RAISE EXCEPTION 'process_sale_split fragment drift; refusing patch'; END IF;
  v_def := replace(v_def,v_old,v_new);
  IF v_def=v_before THEN RAISE EXCEPTION 'process_sale_split unchanged'; END IF;
  EXECUTE v_def;
END;
$checkout_process_sale_split$;
COMMIT;
