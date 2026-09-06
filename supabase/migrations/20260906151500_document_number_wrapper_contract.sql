-- Keep guarded document-number wrappers visible to the generated frontend API
-- contract by preserving the established { p_type } call shape. Each wrapper
-- rejects any type outside its single allowed document family.

DROP FUNCTION IF EXISTS public.next_purchase_document_number();
DROP FUNCTION IF EXISTS public.next_sale_document_number();

CREATE OR REPLACE FUNCTION public.next_purchase_document_number(p_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF p_type IS DISTINCT FROM 'purchase' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  IF NOT public.can_permission('purchases.manage') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'Creating purchases requires the purchases.manage permission.'
    );
  END IF;

  RETURN public.next_document_number('purchase');
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_sale_document_number(p_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF p_type IS DISTINCT FROM 'sale' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TYPE');
  END IF;

  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'Taking payment requires the pos.payment.take permission.'
    );
  END IF;

  RETURN public.next_document_number('sale');
END;
$function$;

REVOKE ALL ON FUNCTION public.next_purchase_document_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_sale_document_number(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_purchase_document_number(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_sale_document_number(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_purchase_document_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_sale_document_number(text) TO authenticated;

-- The generic allocator remains internal-only.
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM PUBLIC, anon, authenticated;
