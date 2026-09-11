-- Stage 1 stabilization: align Purchase Request creation with the canonical
-- Permission-First capability exposed by the application permission model.
--
-- Scope is deliberately narrow: this migration changes only the create RPC.
-- Submit/cancel/approve/reject transitions remain untouched until their
-- independent contracts are reviewed in a later approved stage.

DO $$
DECLARE
  v_oid regprocedure := to_regprocedure('public.create_purchase_request(uuid,uuid,text,date,text,jsonb)');
  v_def text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_REQUEST_PERMISSION_ALIGNMENT: create_purchase_request/6 missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  -- Idempotent when a reconciled schema is re-verified.
  IF position('can_permission(''procurement.request.create'')' IN v_def) > 0
     AND position('can_permission(''purchases.manage'')' IN v_def) = 0 THEN
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    'can_permission(''purchases.manage'')',
    'can_permission(''procurement.request.create'')'
  );
  v_new := replace(
    v_new,
    'Purchase requests require the purchases.manage permission.',
    'Purchase requests require the procurement.request.create permission.'
  );

  IF v_new IS NOT DISTINCT FROM v_def
     OR position('can_permission(''procurement.request.create'')' IN v_new) = 0
     OR position('can_permission(''purchases.manage'')' IN v_new) > 0 THEN
    RAISE EXCEPTION 'PURCHASE_REQUEST_PERMISSION_ALIGNMENT: expected legacy gate not found or replacement incomplete';
  END IF;

  EXECUTE v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_request(uuid,uuid,text,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_request(uuid,uuid,text,date,text,jsonb) TO authenticated, service_role;
