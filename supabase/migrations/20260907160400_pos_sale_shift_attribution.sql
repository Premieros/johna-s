-- Stage 4.2 follow-up: preserve shared-shift sale attribution for POS operators
-- who also hold shifts.manage.
--
-- _process_sale_core intentionally exempts shifts.manage from cashier-style shift
-- enforcement, but that also leaves its local v_shift_id NULL. When the caller
-- explicitly supplies a valid shared branch shift, the sale succeeds without a
-- shift_operations sale row. Patch the public checkout wrapper only:
--   1) validate an explicitly supplied shift before any financial write;
--   2) after a successful sale, backfill the trusted sale operation only when the
--      core did not already create one.
-- Existing function signature, discount/payment/ownership rules and grants remain
-- unchanged.

DO $patch_process_sale_shared_shift_attribution$
DECLARE
  v_oid oid;
  v_def text;
  v_original text;
  v_identity text;
BEGIN
  SELECT p.oid, pg_get_function_identity_arguments(p.oid)
    INTO v_oid, v_identity
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_sale'
    AND p.prokind = 'f'
    AND p.pronargs = 20
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'process_sale(20 args) not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;

  -- A shifts.manage caller is exempt from the core's register-operator branch,
  -- so validate an explicitly supplied shift here before _process_sale_core can
  -- create the sale. NULL keeps the pre-existing manager behavior unchanged.
  v_def := replace(
    v_def,
    '  IF NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object(''success'',false,''error'',''BRANCH_MISMATCH''); END IF;' || E'\n' ||
    '  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RETURN jsonb_build_object(''success'',false,''error'',''EMPTY_CART''); END IF;',
    '  IF NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object(''success'',false,''error'',''BRANCH_MISMATCH''); END IF;' || E'\n' ||
    '  IF p_shift_id IS NOT NULL AND NOT EXISTS (' || E'\n' ||
    '    SELECT 1 FROM public.shifts s' || E'\n' ||
    '    WHERE s.id = p_shift_id' || E'\n' ||
    '      AND s.branch_id = p_branch_id' || E'\n' ||
    '      AND s.status = ''open''' || E'\n' ||
    '  ) THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''success'',false,''error'',''NO_OPEN_SHIFT'',''detail'',''The supplied shift must be open and belong to the sale branch.'');' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RETURN jsonb_build_object(''success'',false,''error'',''EMPTY_CART''); END IF;'
  );

  -- Normal register operators already get a shift_operations row from the core.
  -- shifts.manage operators do not, because v_shift_id is never populated there.
  -- Fill only the missing row, sourcing amount/payment from the authoritative sale.
  v_def := replace(
    v_def,
    '  IF p_order_id IS NOT NULL THEN' || E'\n' ||
    '    PERFORM set_config(''app.kitchen_inventory_settlement'',''off'',true);',
    '  IF COALESCE((v_result->>''success'')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN' || E'\n' ||
    '    v_sale_id := NULLIF(v_result->>''sale_id'','''')::uuid;' || E'\n' ||
    '    INSERT INTO public.shift_operations(' || E'\n' ||
    '      shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by' || E'\n' ||
    '    )' || E'\n' ||
    '    SELECT p_shift_id, ''sale'', s.paid_amount, s.payment_method, ''sale'', s.id, auth.uid()' || E'\n' ||
    '    FROM public.sales s' || E'\n' ||
    '    WHERE s.id = v_sale_id' || E'\n' ||
    '      AND s.branch_id = p_branch_id' || E'\n' ||
    '      AND NOT EXISTS (' || E'\n' ||
    '        SELECT 1 FROM public.shift_operations so' || E'\n' ||
    '        WHERE so.reference_type = ''sale''' || E'\n' ||
    '          AND so.reference_id = s.id' || E'\n' ||
    '      );' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  IF p_order_id IS NOT NULL THEN' || E'\n' ||
    '    PERFORM set_config(''app.kitchen_inventory_settlement'',''off'',true);'
  );

  IF v_def = v_original
     OR position('The supplied shift must be open and belong to the sale branch.' IN v_def) = 0
     OR position('NOT EXISTS (' IN v_def) = 0
     OR position('shift_operations' IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale shared-shift attribution patch failed for %', v_identity;
  END IF;

  EXECUTE v_def;
END;
$patch_process_sale_shared_shift_attribution$;
