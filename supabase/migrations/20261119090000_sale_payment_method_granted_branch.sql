-- A sale payment-method correction must respect explicit user_branch_access grants,
-- not only users.branch_id (the user's primary/default branch).
--
-- This only changes the branch authorization predicate. It retains the
-- existing approval, cash/bank journal, shift-operation and audit contracts.
-- Split/multi-payment sales are blocked from header-only payment corrections.
-- No sales, roles, grants, shifts or accounting rows are changed by the migration.
DO $migration$
DECLARE
  v_definition text;
  v_old_guard text := $old$
  IF NOT public.is_pos_admin()
     AND v_user_branch IS NOT NULL
     AND v_user_branch <> v_sale.branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
$old$;
  v_split_anchor text := $anchor$
  IF v_sale.status = 'returned' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALE_RETURNED');
  END IF;
$anchor$;
  v_split_guard text := $split$
  IF v_sale.status = 'returned' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALE_RETURNED');
  END IF;

  -- A split transaction has individual payments and allocation-specific journal
  -- entries. A one-field correction would misstate the cash/card split.
  IF lower(COALESCE(v_sale.payment_method, 'cash')) = 'split'
     OR EXISTS (SELECT 1 FROM public.sale_payments WHERE sale_id = p_sale_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SPLIT_PAYMENT_REQUIRES_ITEM_LEVEL_CORRECTION');
  END IF;
$split$;
  v_new_guard text := $new$
  IF NOT public.is_pos_admin()
     AND NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef('public.change_sale_payment_method(uuid,text,text)'::regprocedure)
    INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'CHANGE_SALE_PAYMENT_METHOD_MISSING';
  END IF;
  IF position(v_new_guard IN v_definition) > 0 THEN
    RAISE NOTICE 'Payment method branch authorization already uses explicit grants';
    RETURN;
  END IF;
  IF position(v_old_guard IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CHANGE_PAYMENT_METHOD_GUARD_DRIFT: review current function before modifying';
  END IF;
  IF position('CHANGE_PAYMENT_APPROVAL_CONSUME_FAILED' IN v_definition) = 0
      OR position('UPDATE public.journal_entry_lines' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CHANGE_PAYMENT_METHOD_CONTRACT_DRIFT';
  END IF;

  IF position(v_split_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CHANGE_PAYMENT_SPLIT_GUARD_DRIFT';
  END IF;

  EXECUTE replace(
    replace(v_definition, v_old_guard, v_new_guard),
    v_split_anchor,
    v_split_guard
  );
END;
$migration$;
