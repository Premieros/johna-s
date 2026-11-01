-- Restore the intended branch-manager count workflow without granting
-- approval, rejection or stock-changing apply permissions.
-- Permit authorized finance/warehouse approvers to cancel a stale APPROVED
-- but UNAPPLIED count after verifying no stock/journal effects exist.
-- Neither this migration nor its tests apply any live stock count.
BEGIN;

UPDATE public.roles
SET permissions=COALESCE(permissions,'[]'::jsonb)
  || '["inventory.count.create"]'::jsonb,
    updated_at=now()
WHERE role='branch_manager'
  AND is_active=true
  AND COALESCE(permissions,'[]'::jsonb) ? 'inventory.view'
  AND NOT COALESCE(permissions,'[]'::jsonb) ? 'inventory.count.create';

CREATE OR REPLACE FUNCTION public.reject_stock_count(
  p_stock_count_id uuid,p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_cancel_approved boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  SELECT * INTO v_count FROM public.stock_counts
  WHERE id=p_stock_count_id FOR UPDATE;

  IF v_count.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','COUNT_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_count.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  v_cancel_approved := v_count.status='approved';

  IF v_cancel_approved THEN
    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success',false,'error','NOT_ALLOWED');
    END IF;
    IF NULLIF(btrim(p_reason),'') IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','CANCELLATION_REASON_REQUIRED');
    END IF;
    -- A prior failed apply could have produced entries with old function
    -- behavior. Such a document must be reconciled, not silently canceled.
    IF v_count.applied_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.inventory_ledger WHERE reference_id=v_count.id)
      OR EXISTS(SELECT 1 FROM public.inventory_unit_entries WHERE reference_id=v_count.id)
      OR EXISTS(SELECT 1 FROM public.stock_transactions WHERE reference_id=v_count.id)
      OR EXISTS(SELECT 1 FROM public.journal_entries WHERE reference_id=v_count.id)
    THEN
      RETURN jsonb_build_object('success',false,'error','COUNT_HAS_POSTED_EFFECTS');
    END IF;
  ELSIF v_count.status='submitted' THEN
    IF NOT public.can_permission('inventory.count.reject') THEN
      RETURN jsonb_build_object('success',false,'error','NOT_ALLOWED');
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success',false,'error','INVALID_STATUS','status',v_count.status);
  END IF;

  UPDATE public.stock_counts
  SET status='rejected',
    rejection_reason=CASE WHEN v_cancel_approved
      THEN btrim(p_reason) ELSE p_reason END,
    -- Preserve the original authorizer's identity and approval timestamp
    -- for an approved document. Submitted document rejection follows legacy.
    approved_by=CASE WHEN v_cancel_approved THEN approved_by ELSE auth.uid() END,
    approved_at=CASE WHEN v_cancel_approved THEN approved_at ELSE now() END
  WHERE id=v_count.id;

  RETURN jsonb_build_object(
    'success',true,'stock_count_id',v_count.id,
    'approved_unapplied_cancelled',v_cancel_approved);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',false,'error','TRANSACTION_FAILED','detail',SQLERRM);
END;
$function$;

-- Keep the original RPC's authorized API exposure; no public/anon execute.
REVOKE ALL ON FUNCTION public.reject_stock_count(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_count(uuid,text) TO authenticated;

COMMIT;
