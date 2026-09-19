-- Permission-contract UI reconciliation.
--
-- Goals:
-- 1) Retire the obsolete pos.refund alias in persisted role payloads.
-- 2) Make sales.refund.create the canonical permission for initiating refunds.
-- 3) Preserve refunds.approve as the direct-execution capability.
-- 4) Keep the existing approval workflow for initiators without direct approval.
-- 5) Do not change printing, RLS, branch isolation, or approval consumption rules.

UPDATE public.roles
SET permissions =
  (COALESCE(permissions, '[]'::jsonb) - 'pos.refund')
  || CASE
       WHEN COALESCE(permissions, '[]'::jsonb) ? 'sales.refund.create'
         THEN '[]'::jsonb
       ELSE '["sales.refund.create"]'::jsonb
     END,
    updated_at = now()
WHERE COALESCE(permissions, '[]'::jsonb) ? 'pos.refund';


DO $patch_refund_initiation_permission$
DECLARE
  v_sig regprocedure;
  v_def text;
  v_next text;
  v_marker text := $marker$    -- Permission: managers/admins execute directly. Cashiers need a matching manager approval.
    IF NOT is_pos_admin() AND NOT can_permission('refunds.approve') THEN$marker$;
  v_replacement text := $replacement$    -- Permission contract:
    -- sales.refund.create starts the refund/approval path.
    -- refunds.approve executes directly.
    IF NOT public.is_pos_admin()
       AND NOT public.can_permission('refunds.approve')
       AND NOT public.can_permission('sales.refund.create') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'NOT_ALLOWED',
        'permission', 'sales.refund.create'
      );
    END IF;

    IF NOT is_pos_admin() AND NOT can_permission('refunds.approve') THEN$replacement$;
BEGIN
  v_sig := to_regprocedure(
    'public._process_refund_single_core(uuid,jsonb,text)'
  );

  IF v_sig IS NULL THEN
    RAISE EXCEPTION '_process_refund_single_core target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('sales.refund.create' in v_def) = 0 THEN
    IF position(v_marker in v_def) = 0 THEN
      RAISE EXCEPTION
        '_process_refund_single_core permission marker changed; refusing migration';
    END IF;

    v_next := replace(v_def, v_marker, v_replacement);

    IF v_next = v_def
       OR position('sales.refund.create' in v_next) = 0
       OR position('refunds.approve' in v_next) = 0 THEN
      RAISE EXCEPTION
        '_process_refund_single_core permission patch failed; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_refund_initiation_permission$;

NOTIFY pgrst, 'reload schema';
