-- Captain send UX, operator transfer targets, transferred-sale attribution,
-- and POS open-check printing through the cashier cloud print station.

-- Keep the internal sale core private. Public callers must use the guarded sale wrappers.
REVOKE ALL ON FUNCTION public._process_sale_core(
  text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,
  text,text,jsonb,uuid,text,uuid,uuid,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._process_sale_core(
  text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,
  text,text,jsonb,uuid,text,uuid,uuid,integer
) TO service_role, postgres;

-- Make the internal sale header use the sanitized operator supplied by the
-- guarded wrapper. For direct sales the wrappers pass auth.uid(); for linked
-- orders they pass the current order owner.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public._process_sale_core(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  v_old := '  v_order_table uuid;' || E'\n';
  v_new := '  v_order_table uuid;' || E'\n' || '  v_effective_operator uuid;' || E'\n';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION '_process_sale_core declaration drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := '    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====' || E'\n' ||
           '    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,';
  v_new := '    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====' || E'\n' ||
           '    v_effective_operator := COALESCE(p_salesperson_id, auth.uid());' || E'\n' ||
           '    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION '_process_sale_core sale-header marker drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := '    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, auth.uid(), p_salesperson_id,';
  v_new := '    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, v_effective_operator, v_effective_operator,';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION '_process_sale_core operator values drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  EXECUTE v_def;
END;
$patch$;

-- Normal checkout: linked-order sales belong to the CURRENT order operator,
-- not to the user who merely collected payment. The payer remains in
-- shift_operations.created_by for audit.
--
-- Production may legitimately be missing the earlier forward-only
-- process_sale ownership patch while keeping the same RPC signature. Reconcile
-- that body drift here before changing sale attribution, but refuse any unknown
-- shape.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_preview_marker text;
  v_preview_with_owner text;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position('v_order_owner uuid;' IN v_def)=0 THEN
    v_old := '  v_order_table uuid;' || E'\n';
    v_new := '  v_order_table uuid;' || E'\n' || '  v_order_owner uuid;' || E'\n';
    IF position(v_old IN v_def)=0 THEN
      RAISE EXCEPTION 'process_sale order-table declaration drift; refusing compatibility patch';
    END IF;
    v_def := replace(v_def,v_old,v_new);

    v_preview_marker :=
      '  IF p_order_id IS NOT NULL THEN' || E'\n' ||
      '    v_preview := public._build_order_settlement_preview(p_order_id);';

    v_preview_with_owner :=
      '  IF p_order_id IS NOT NULL THEN' || E'\n' ||
      '    SELECT o.cashier_id' || E'\n' ||
      '    INTO v_order_owner' || E'\n' ||
      '    FROM public.orders o' || E'\n' ||
      '    WHERE o.id = p_order_id' || E'\n' ||
      '      AND o.branch_id = p_branch_id;' || E'\n\n' ||
      '    IF NOT FOUND THEN' || E'\n' ||
      '      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id) THEN' || E'\n' ||
      '        RETURN jsonb_build_object(''success'', false, ''error'', ''BRANCH_MISMATCH'');' || E'\n' ||
      '      END IF;' || E'\n' ||
      '      RETURN jsonb_build_object(''success'', false, ''error'', ''ORDER_NOT_FOUND'');' || E'\n' ||
      '    END IF;' || E'\n\n' ||
      '    IF v_order_owner IS DISTINCT FROM auth.uid()' || E'\n' ||
      '       AND NOT public.can_manage_other_pos_orders() THEN' || E'\n' ||
      '      RETURN jsonb_build_object(''success'', false, ''error'', ''ORDER_OPERATOR_REQUIRED'');' || E'\n' ||
      '    END IF;' || E'\n\n' ||
      '    v_preview := public._build_order_settlement_preview(p_order_id);';

    IF position(v_preview_marker IN v_def)=0 THEN
      RAISE EXCEPTION 'process_sale settlement-preview marker drift; refusing compatibility patch';
    END IF;
    v_def := replace(v_def,v_preview_marker,v_preview_with_owner);
  END IF;

  v_old := '    p_salesperson_id,' || E'\n' ||
           '    v_server_subtotal,';
  v_new := '    CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,' || E'\n' ||
           '    v_server_subtotal,';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'process_sale core-call operator fragment drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END;
$patch$;

-- Split checkout has its own wrapper, so enforce the same ownership and
-- attribution contract there.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  v_old := '  v_email text;' || E'\n';
  v_new := '  v_email text;' || E'\n' || '  v_order_owner uuid;' || E'\n';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'process_sale_split declaration drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := '    -- The existing sale core remains the single stock/write boundary.' || E'\n' ||
           '    -- Use a temporary cash collection, then replace only the collection-side accounting below.' || E'\n' ||
           '    IF p_order_id IS NOT NULL THEN' || E'\n' ||
           '      v_core := public._prepare_kitchen_sale_settlement(p_order_id,p_branch_id,p_warehouse_id,p_items);';
  v_new := '    -- The existing sale core remains the single stock/write boundary.' || E'\n' ||
           '    -- Use a temporary cash collection, then replace only the collection-side accounting below.' || E'\n' ||
           '    IF p_order_id IS NOT NULL THEN' || E'\n' ||
           '      SELECT o.cashier_id INTO v_order_owner' || E'\n' ||
           '      FROM public.orders o' || E'\n' ||
           '      WHERE o.id=p_order_id AND o.branch_id=p_branch_id AND o.status IN (''open'',''held'');' || E'\n' ||
           '      IF NOT FOUND THEN' || E'\n' ||
           '        RETURN jsonb_build_object(''success'',false,''error'',''ORDER_NOT_FOUND'');' || E'\n' ||
           '      END IF;' || E'\n' ||
           '      IF v_order_owner IS DISTINCT FROM auth.uid() AND NOT public.can_manage_other_pos_orders() THEN' || E'\n' ||
           '        RETURN jsonb_build_object(''success'',false,''error'',''ORDER_OPERATOR_REQUIRED'');' || E'\n' ||
           '      END IF;' || E'\n' ||
           '      v_core := public._prepare_kitchen_sale_settlement(p_order_id,p_branch_id,p_warehouse_id,p_items);';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'process_sale_split order preparation drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := '      p_salesperson_id,' || E'\n' ||
           '      p_subtotal,';
  v_new := '      CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,' || E'\n' ||
           '      p_subtotal,';
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'process_sale_split core-call operator fragment drift; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END;
$patch$;

-- Make pos.order.transfer the complete authorization for this action.
-- users.manage remains unrelated; branch/target/order guards stay intact.
DO $transfer_permission$
DECLARE
  v_def text;
  v_old text;
BEGIN
  SELECT pg_get_functiondef('public.transfer_order_operator(uuid,uuid)'::regprocedure) INTO v_def;

  -- Fresh/local databases keep the canonical multiline body, while Production
  -- may have the same function normalized to a compact one-line body.
  v_old := '  IF NOT public.can_manage_other_pos_orders() THEN' || E'\n' ||
           '    RETURN jsonb_build_object(''success'', false, ''error'', ''POS_ADMIN_PERMISSION_REQUIRED'');' || E'\n' ||
           '  END IF;' || E'\n';
  IF position(v_old IN v_def)>0 THEN
    v_def := replace(v_def,v_old,'');
  ELSE
    v_old := 'IF NOT public.can_manage_other_pos_orders() THEN RETURN jsonb_build_object(''success'',false,''error'',''POS_ADMIN_PERMISSION_REQUIRED''); END IF;';
    IF position(v_old IN v_def)=0 THEN
      RAISE EXCEPTION 'transfer_order_operator manage-others fragment drift; refusing patch';
    END IF;
    v_def := replace(v_def,v_old,'');
  END IF;

  EXECUTE v_def;
END;
$transfer_permission$;

-- The generic ownership trigger must recognize the dedicated transfer
-- permission as sufficient only when the signed transfer RPC established the
-- exact order/target context. Other cross-user mutations still use
-- can_manage_other_pos_orders().
DO $ownership_guard$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.guard_pos_operator_ownership()'::regprocedure) INTO v_def;

  v_old :=
    '      IF NOT v_transfer_context THEN' || E'\n' ||
    '        RAISE EXCEPTION ''ORDER_TRANSFER_RPC_REQUIRED'';' || E'\n' ||
    '      END IF;' || E'\n' ||
    '      IF NOT v_can_manage_others THEN' || E'\n' ||
    '        RAISE EXCEPTION ''POS_ADMIN_PERMISSION_REQUIRED'';' || E'\n' ||
    '      END IF;' || E'\n';
  v_new :=
    '      IF NOT v_transfer_context THEN' || E'\n' ||
    '        RAISE EXCEPTION ''ORDER_TRANSFER_RPC_REQUIRED'';' || E'\n' ||
    '      END IF;' || E'\n';

  IF position(v_old IN v_def)>0 THEN
    v_def := replace(v_def,v_old,v_new);
  ELSE
    v_old := 'IF NOT v_transfer_context THEN RAISE EXCEPTION ''ORDER_TRANSFER_RPC_REQUIRED''; END IF; IF NOT v_can_manage_others THEN RAISE EXCEPTION ''POS_ADMIN_PERMISSION_REQUIRED''; END IF;';
    v_new := 'IF NOT v_transfer_context THEN RAISE EXCEPTION ''ORDER_TRANSFER_RPC_REQUIRED''; END IF;';
    IF position(v_old IN v_def)=0 THEN
      RAISE EXCEPTION 'guard_pos_operator_ownership transfer fragment drift; refusing patch';
    END IF;
    v_def := replace(v_def,v_old,v_new);
  END IF;

  EXECUTE v_def;
END;
$ownership_guard$;

-- Permission-first list used by the transfer dialog. No role names are used.
CREATE OR REPLACE FUNCTION public.list_pos_order_transfer_targets(p_order_id uuid)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id=p_order_id;

  IF v_order.id IS NULL OR v_order.status NOT IN ('open','held') THEN RETURN; END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(NULLIF(trim(u.full_name),''),NULLIF(trim(u.username),''),u.email,'—')
  FROM public.users u
  LEFT JOIN public.roles r ON r.role=u.role
  WHERE u.is_active=true
    AND u.id IS DISTINCT FROM v_order.cashier_id
    AND (
      u.branch_id=v_order.branch_id
      OR EXISTS (
        SELECT 1 FROM public.user_branch_access uba
        WHERE uba.user_id=u.id AND uba.branch_id=v_order.branch_id
      )
    )
    AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.view'
  ORDER BY COALESCE(NULLIF(trim(u.full_name),''),NULLIF(trim(u.username),''),u.email);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_pos_order_transfer_targets(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_pos_order_transfer_targets(uuid) TO authenticated,service_role;

-- Open checks are not sale receipts and therefore do not consume print-once
-- authorization. They still require receipt-print permission, branch scope and
-- order ownership, and always route to the cashier station.
CREATE OR REPLACE FUNCTION public.enqueue_cloud_open_order_print(
  p_order_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
  v_job public.cloud_print_jobs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.receipt.print') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.receipt.print');
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id=p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_order.cashier_id IS DISTINCT FROM v_uid AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_OPERATOR_REQUIRED');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    v_order.branch_id,v_uid,'receipt','cashier',p_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,
    'job_id',v_job.id,
    'status',v_job.status,
    'station_code','cashier'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_open_order_print(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_open_order_print(uuid,jsonb,text) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
