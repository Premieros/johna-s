-- POS financial safety hardening: durable idempotency for sale attempts.
--
-- This migration does NOT replace the canonical process_sale/process_sale_split
-- bodies. It wraps them with a narrow, branch-scoped operation identity so:
--   * same-key concurrent calls serialize before any financial write;
--   * a lost HTTP response can be retried safely and returns the original result;
--   * different payloads cannot silently reuse one operation key;
--   * existing invoice uniqueness, accounting, kitchen, FIFO and RLS contracts
--     remain unchanged.

CREATE TABLE IF NOT EXISTS private.pos_sale_idempotency (
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  operation_key text NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('normal','split')),
  request_hash text NOT NULL,
  sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id),
  response jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, operation_key),
  CHECK (char_length(operation_key) BETWEEN 16 AND 128)
);

ALTER TABLE private.pos_sale_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.pos_sale_idempotency FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.pos_sale_idempotency IS
'Private atomic idempotency ledger for POS normal/split sale attempts. No direct client access.';

CREATE OR REPLACE FUNCTION public.process_sale_idempotent(
  p_client_operation_key text,
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_status text,
  p_items jsonb,
  p_shift_id uuid,
  p_order_type text,
  p_table_id uuid,
  p_order_id uuid,
  p_guest_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $function$
DECLARE
  v_key text := btrim(COALESCE(p_client_operation_key,''));
  v_request_hash text;
  v_existing private.pos_sale_idempotency%ROWTYPE;
  v_result jsonb;
  v_sale_id uuid;
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role',true),'')='service_role';
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_REQUIRED');
  END IF;

  IF char_length(v_key) < 16
     OR char_length(v_key) > 128
     OR v_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_CLIENT_OPERATION_KEY');
  END IF;

  IF NOT v_is_service_role THEN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED','permission','pos.payment.take'
      );
    END IF;
  END IF;

  -- The invoice number is deliberately excluded. A retry after an ambiguous
  -- network response may allocate a fresh display number before it learns that
  -- the original transaction committed. The operation key, actor and financial
  -- payload are the durable identity.
  v_request_hash := md5(jsonb_build_object(
    'branch_id',p_branch_id,
    'warehouse_id',p_warehouse_id,
    'customer_id',p_customer_id,
    'salesperson_id',p_salesperson_id,
    'subtotal',p_subtotal,
    'discount_amount',p_discount_amount,
    'discount_type',p_discount_type,
    'tax_amount',p_tax_amount,
    'bonus_amount',p_bonus_amount,
    'total',p_total,
    'paid_amount',p_paid_amount,
    'payment_method',p_payment_method,
    'status',p_status,
    'items',COALESCE(p_items,'[]'::jsonb),
    'shift_id',p_shift_id,
    'order_type',p_order_type,
    'table_id',p_table_id,
    'order_id',p_order_id,
    'guest_count',p_guest_count
  )::text);

  -- Serialize the exact logical attempt before checking/creating its sale.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pos-sale:'||p_branch_id::text||':'||v_key,0)
  );

  SELECT *
  INTO v_existing
  FROM private.pos_sale_idempotency
  WHERE branch_id=p_branch_id
    AND operation_key=v_key;

  IF FOUND THEN
    IF v_existing.operation_kind <> 'normal'
       OR v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
      );
    END IF;

    IF NOT v_is_service_role
       AND v_existing.created_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_OWNER_MISMATCH'
      );
    END IF;

    RETURN v_existing.response || jsonb_build_object('idempotent_replay',true);
  END IF;

  v_result := public.process_sale(
    p_invoice_number := p_invoice_number,
    p_branch_id := p_branch_id,
    p_warehouse_id := p_warehouse_id,
    p_customer_id := p_customer_id,
    p_salesperson_id := p_salesperson_id,
    p_subtotal := p_subtotal,
    p_discount_amount := p_discount_amount,
    p_discount_type := p_discount_type,
    p_tax_amount := p_tax_amount,
    p_bonus_amount := p_bonus_amount,
    p_total := p_total,
    p_paid_amount := p_paid_amount,
    p_payment_method := p_payment_method,
    p_status := p_status,
    p_items := p_items,
    p_shift_id := p_shift_id,
    p_order_type := p_order_type,
    p_table_id := p_table_id,
    p_order_id := p_order_id,
    p_guest_count := p_guest_count
  );

  IF COALESCE((v_result->>'success')::boolean,false) THEN
    v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
    IF v_sale_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.sales s
         WHERE s.id=v_sale_id AND s.branch_id=p_branch_id
       ) THEN
      RAISE EXCEPTION 'IDEMPOTENT_SALE_RESULT_MISSING_DURABLE_SALE';
    END IF;

    v_result := v_result || jsonb_build_object(
      'invoice_number',COALESCE(NULLIF(v_result->>'invoice_number',''),p_invoice_number),
      'client_operation_key',v_key,
      'idempotent_replay',false
    );

    INSERT INTO private.pos_sale_idempotency(
      branch_id,operation_key,operation_kind,request_hash,sale_id,response,created_by
    )
    VALUES (
      p_branch_id,v_key,'normal',v_request_hash,v_sale_id,v_result,v_uid
    );
  ELSE
    v_result := COALESCE(v_result,'{}'::jsonb) || jsonb_build_object(
      'client_operation_key',v_key,
      'idempotent_replay',false
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_sale_idempotent(
  text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_idempotent(
  text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_sale_split_idempotent(
  p_client_operation_key text,
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_payments jsonb,
  p_status text,
  p_items jsonb,
  p_shift_id uuid,
  p_order_type text,
  p_table_id uuid,
  p_order_id uuid,
  p_guest_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $function$
DECLARE
  v_key text := btrim(COALESCE(p_client_operation_key,''));
  v_request_hash text;
  v_existing private.pos_sale_idempotency%ROWTYPE;
  v_result jsonb;
  v_sale_id uuid;
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role',true),'')='service_role';
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_REQUIRED');
  END IF;

  IF char_length(v_key) < 16
     OR char_length(v_key) > 128
     OR v_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_CLIENT_OPERATION_KEY');
  END IF;

  IF NOT v_is_service_role THEN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED','permission','pos.payment.take'
      );
    END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'branch_id',p_branch_id,
    'warehouse_id',p_warehouse_id,
    'customer_id',p_customer_id,
    'salesperson_id',p_salesperson_id,
    'subtotal',p_subtotal,
    'discount_amount',p_discount_amount,
    'discount_type',p_discount_type,
    'tax_amount',p_tax_amount,
    'bonus_amount',p_bonus_amount,
    'total',p_total,
    'payments',COALESCE(p_payments,'[]'::jsonb),
    'status',p_status,
    'items',COALESCE(p_items,'[]'::jsonb),
    'shift_id',p_shift_id,
    'order_type',p_order_type,
    'table_id',p_table_id,
    'order_id',p_order_id,
    'guest_count',p_guest_count
  )::text);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('pos-sale:'||p_branch_id::text||':'||v_key,0)
  );

  SELECT *
  INTO v_existing
  FROM private.pos_sale_idempotency
  WHERE branch_id=p_branch_id
    AND operation_key=v_key;

  IF FOUND THEN
    IF v_existing.operation_kind <> 'split'
       OR v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
      );
    END IF;

    IF NOT v_is_service_role
       AND v_existing.created_by IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','IDEMPOTENCY_KEY_OWNER_MISMATCH'
      );
    END IF;

    RETURN v_existing.response || jsonb_build_object('idempotent_replay',true);
  END IF;

  v_result := public.process_sale_split(
    p_invoice_number := p_invoice_number,
    p_branch_id := p_branch_id,
    p_warehouse_id := p_warehouse_id,
    p_customer_id := p_customer_id,
    p_salesperson_id := p_salesperson_id,
    p_subtotal := p_subtotal,
    p_discount_amount := p_discount_amount,
    p_discount_type := p_discount_type,
    p_tax_amount := p_tax_amount,
    p_bonus_amount := p_bonus_amount,
    p_total := p_total,
    p_payments := p_payments,
    p_status := p_status,
    p_items := p_items,
    p_shift_id := p_shift_id,
    p_order_type := p_order_type,
    p_table_id := p_table_id,
    p_order_id := p_order_id,
    p_guest_count := p_guest_count
  );

  IF COALESCE((v_result->>'success')::boolean,false) THEN
    v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
    IF v_sale_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.sales s
         WHERE s.id=v_sale_id AND s.branch_id=p_branch_id
       ) THEN
      RAISE EXCEPTION 'IDEMPOTENT_SPLIT_RESULT_MISSING_DURABLE_SALE';
    END IF;

    v_result := v_result || jsonb_build_object(
      'invoice_number',COALESCE(NULLIF(v_result->>'invoice_number',''),p_invoice_number),
      'client_operation_key',v_key,
      'idempotent_replay',false
    );

    INSERT INTO private.pos_sale_idempotency(
      branch_id,operation_key,operation_kind,request_hash,sale_id,response,created_by
    )
    VALUES (
      p_branch_id,v_key,'split',v_request_hash,v_sale_id,v_result,v_uid
    );
  ELSE
    v_result := COALESCE(v_result,'{}'::jsonb) || jsonb_build_object(
      'client_operation_key',v_key,
      'idempotent_replay',false
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_sale_split_idempotent(
  text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_split_idempotent(
  text,text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
