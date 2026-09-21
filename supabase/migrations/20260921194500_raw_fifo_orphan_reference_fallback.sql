-- Production patch: safely reconcile historical FIFO rows whose source
-- kitchen event or purchase header was removed while the inventory ledger remains.
BEGIN;

CREATE OR REPLACE FUNCTION public._fifo_adjust_reference_delta(
  p_reference_type text,
  p_reference_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_delta numeric,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_ref_no text;
  v_entry_date date;
BEGIN
  IF p_reference_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  IF p_depth>16 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_REFERENCE_PROPAGATION_TOO_DEEP');
  END IF;

  IF p_reference_type='sale' THEN
    RETURN public._fifo_adjust_sale_cogs_delta(p_reference_id,p_delta);

  ELSIF p_reference_type='kitchen_send' THEN
    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.id=p_reference_id
    ) THEN
      RETURN public._fifo_adjust_kitchen_effect_delta(
        p_reference_id,p_target_type,p_target_id,p_delta
      );
    END IF;

    SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.inventory_ledger il
    WHERE il.reference_type='kitchen_send'
      AND il.reference_id=p_reference_id
      AND il.branch_id=p_branch_id
    ORDER BY il.created_at,il.id
    LIMIT 1;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.branch_id=p_branch_id AND o.order_number=v_ref_no
    ) OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.branch_id=p_branch_id AND s.invoice_number=v_ref_no
    ) OR EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.branch_id=p_branch_id AND je.reference_id=p_reference_id
    ) THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_REFERENCE',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no
      );
    END IF;

    RETURN jsonb_build_object(
      'success',true,
      'delta',p_delta,
      'orphan_reference',true,
      'ledger_only',true,
      'reference_type','kitchen_send',
      'reference_id',p_reference_id,
      'reference_number',v_ref_no
    );

  ELSIF p_reference_type='production' THEN
    RETURN public._fifo_adjust_production_delta(
      p_reference_id,p_delta,p_depth+1
    );

  ELSIF p_reference_type='purchase_return' THEN
    SELECT invoice_number,(created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.purchases
    WHERE id=p_reference_id;

    IF NOT FOUND THEN
      SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
      INTO v_ref_no,v_entry_date
      FROM public.inventory_ledger il
      WHERE il.reference_type='purchase_return'
        AND il.reference_id=p_reference_id
        AND il.branch_id=p_branch_id
      ORDER BY il.created_at,il.id
      LIMIT 1;
    END IF;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_PURCHASE_RETURN_REFERENCE_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    RETURN public._fifo_adjust_stock_variance_delta(
      p_branch_id,'purchase_return',p_reference_id,
      v_ref_no,v_entry_date,p_delta
    );
  END IF;

  RETURN jsonb_build_object(
    'success',false,
    'error','FIFO_UNSUPPORTED_REFERENCE_TYPE',
    'reference_type',p_reference_type,
    'reference_id',p_reference_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._fifo_adjust_reference_delta(text,uuid,uuid,uuid,text,uuid,numeric,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_reference_delta(text,uuid,uuid,uuid,text,uuid,numeric,integer)
  TO service_role,postgres;

COMMIT;
