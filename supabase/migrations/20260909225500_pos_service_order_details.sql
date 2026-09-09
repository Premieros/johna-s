-- Delivery / Drive-Thru operational parity without creating a parallel POS flow.
-- The canonical create_order/update_order RPCs remain unchanged. Service-specific
-- wrappers validate structured metadata, delegate to the canonical RPCs, and
-- persist metadata atomically in the same transaction.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS service_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_service_details_object_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_service_details_object_check
  CHECK (jsonb_typeof(service_details) = 'object');

CREATE OR REPLACE FUNCTION public.normalize_order_service_details(
  p_order_type text,
  p_service_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_details jsonb := COALESCE(p_service_details, '{}'::jsonb);
  v_phone text;
  v_address text;
  v_note text;
  v_vehicle text;
  v_customer_name text;
BEGIN
  IF jsonb_typeof(v_details) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SERVICE_DETAILS');
  END IF;

  IF p_order_type = 'delivery' THEN
    v_phone := NULLIF(trim(v_details->>'phone'), '');
    v_address := NULLIF(trim(v_details->>'address'), '');
    v_note := NULLIF(trim(v_details->>'note'), '');

    IF v_phone IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_PHONE_REQUIRED');
    END IF;
    IF length(v_phone) > 40 THEN
      RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_PHONE_TOO_LONG');
    END IF;
    IF v_address IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_ADDRESS_REQUIRED');
    END IF;
    IF length(v_address) > 500 THEN
      RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_ADDRESS_TOO_LONG');
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_NOTE_TOO_LONG');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'address', v_address,
        'note', v_note
      ))
    );
  END IF;

  IF p_order_type = 'drive_thru' THEN
    v_vehicle := NULLIF(trim(v_details->>'vehicle_identifier'), '');
    v_customer_name := NULLIF(trim(v_details->>'customer_name'), '');
    v_note := NULLIF(trim(v_details->>'note'), '');

    IF v_vehicle IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'VEHICLE_IDENTIFIER_REQUIRED');
    END IF;
    IF length(v_vehicle) > 80 THEN
      RETURN jsonb_build_object('success', false, 'error', 'VEHICLE_IDENTIFIER_TOO_LONG');
    END IF;
    IF v_customer_name IS NOT NULL AND length(v_customer_name) > 160 THEN
      RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NAME_TOO_LONG');
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_NOTE_TOO_LONG');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'vehicle_identifier', v_vehicle,
        'customer_name', v_customer_name,
        'note', v_note
      ))
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ORDER_TYPE_REQUIRED');
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_order_service_details(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.normalize_order_service_details(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_order_service_details(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_service_order(
  p_branch_id uuid,
  p_order_type text DEFAULT 'delivery'::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT NULL::integer,
  p_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'amount'::text,
  p_tax_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_cashier_id uuid DEFAULT NULL::uuid,
  p_service_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_validation jsonb;
  v_details jsonb;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  BEGIN
    IF p_order_type NOT IN ('delivery', 'drive_thru') THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ORDER_TYPE_REQUIRED');
    END IF;
    IF p_table_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ORDER_CANNOT_HAVE_TABLE');
    END IF;

    v_validation := public.normalize_order_service_details(p_order_type, p_service_details);
    IF COALESCE((v_validation->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_validation;
    END IF;
    v_details := v_validation->'details';

    v_result := public.create_order(
      p_branch_id,
      p_order_type,
      NULL,
      p_customer_id,
      p_guest_count,
      p_notes,
      p_items,
      p_subtotal,
      p_discount_amount,
      p_discount_type,
      p_tax_amount,
      p_total,
      p_cashier_id
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    v_order_id := NULLIF(v_result->>'order_id', '')::uuid;
    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'ORDER_ID_MISSING';
    END IF;

    UPDATE public.orders
    SET service_details = v_details,
        updated_at = now()
    WHERE id = v_order_id
      AND branch_id = p_branch_id
      AND order_type = p_order_type;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SERVICE_DETAILS_PERSIST_FAILED';
    END IF;

    RETURN v_result || jsonb_build_object('service_details', v_details);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_service_order(
  p_order_id uuid,
  p_order_type text DEFAULT 'delivery'::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT NULL::integer,
  p_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'amount'::text,
  p_tax_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_status text DEFAULT 'held'::text,
  p_service_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_validation jsonb;
  v_details jsonb;
  v_result jsonb;
  v_branch_id uuid;
BEGIN
  BEGIN
    IF p_order_type NOT IN ('delivery', 'drive_thru') THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ORDER_TYPE_REQUIRED');
    END IF;
    IF p_table_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'SERVICE_ORDER_CANNOT_HAVE_TABLE');
    END IF;

    SELECT branch_id INTO v_branch_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    v_validation := public.normalize_order_service_details(p_order_type, p_service_details);
    IF COALESCE((v_validation->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_validation;
    END IF;
    v_details := v_validation->'details';

    v_result := public.update_order(
      p_order_id,
      p_order_type,
      NULL,
      p_customer_id,
      p_guest_count,
      p_notes,
      p_items,
      p_subtotal,
      p_discount_amount,
      p_discount_type,
      p_tax_amount,
      p_total,
      p_status
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    UPDATE public.orders
    SET service_details = v_details,
        updated_at = now()
    WHERE id = p_order_id
      AND branch_id = v_branch_id
      AND order_type = p_order_type;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SERVICE_DETAILS_PERSIST_FAILED';
    END IF;

    RETURN v_result || jsonb_build_object('service_details', v_details);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_service_order(uuid, text, uuid, uuid, integer, text, jsonb, numeric, numeric, text, numeric, numeric, text, jsonb) TO authenticated, service_role;
