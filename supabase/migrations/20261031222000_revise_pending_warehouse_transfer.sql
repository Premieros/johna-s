-- Atomic revision of a PENDING raw-material transfer, before stock posting.
-- Existing approved/rejected transfer items are immutable. No stock writers.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE OR REPLACE FUNCTION public.revise_pending_warehouse_transfer(
  p_transfer_id uuid,
  p_original_items jsonb,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transfer public.warehouse_transfers%ROWTYPE;
  v_original jsonb;
  v_line jsonb;
  v_id uuid;
  v_qty numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_existing_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN
    RETURN jsonb_build_object('success',false,'error','NOT_ALLOWED');
  END IF;
  IF p_transfer_id IS NULL OR jsonb_typeof(p_original_items) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_ITEMS');
  END IF;

  -- Serialize revisions and approvals by locking the same transfer header.
  SELECT * INTO v_transfer
  FROM public.warehouse_transfers
  WHERE id=p_transfer_id
  FOR UPDATE;
  IF v_transfer.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','TRANSFER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_transfer.branch_id)
     OR NOT public.user_may_access_branch(COALESCE(v_transfer.to_branch_id,v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_STATUS');
  END IF;

  -- All preexisting lines must be visible, unposted raw-material lines;
  -- no partial edits that discard hidden product lines.
  IF EXISTS (SELECT 1 FROM public.warehouse_transfer_items
             WHERE transfer_id=p_transfer_id AND
             (raw_material_id IS NULL OR destination_raw_material_id IS NULL)) THEN
    RETURN jsonb_build_object('success',false,'error','TRANSFER_ITEMS_READ_ONLY');
  END IF;
  PERFORM 1 FROM public.warehouse_transfer_items WHERE transfer_id=p_transfer_id FOR UPDATE;
  SELECT count(*),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) ORDER BY id),'[]'::jsonb)
  INTO v_existing_count,v_original
  FROM public.warehouse_transfer_items WHERE transfer_id=p_transfer_id;
  IF v_existing_count=0 OR v_existing_count>100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_ITEMS');
  END IF;
  IF v_original IS DISTINCT FROM p_original_items THEN
    RETURN jsonb_build_object('success',false,'error','TRANSFER_ITEMS_CHANGED');
  END IF;

  -- Verify the entire desired set BEFORE any writes. IDs may only be
  -- existing lines, quantities >0 with stock's four-decimal precision.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_line) <> 'object' OR
       jsonb_typeof(v_line->'id') <> 'string' OR
       jsonb_typeof(v_line->'quantity') <> 'number' THEN
      RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_ITEMS');
    END IF;
    BEGIN
      v_id := (v_line->>'id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_ITEMS');
    END;
    IF v_qty<=0 OR v_qty>=10000000000 OR scale(v_qty)>4
       OR v_id = ANY(v_seen)
       OR NOT EXISTS (SELECT 1 FROM public.warehouse_transfer_items
                      WHERE id=v_id AND transfer_id=p_transfer_id AND raw_material_id IS NOT NULL) THEN
      RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_ITEMS');
    END IF;
    v_seen := array_append(v_seen,v_id);
  END LOOP;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    UPDATE public.warehouse_transfer_items
       SET quantity=(v_line->>'quantity')::numeric
     WHERE id=(v_line->>'id')::uuid AND transfer_id=p_transfer_id;
  END LOOP;
  DELETE FROM public.warehouse_transfer_items
   WHERE transfer_id=p_transfer_id AND NOT (id = ANY(v_seen));
  UPDATE public.warehouse_transfers SET updated_at=statement_timestamp() WHERE id=p_transfer_id;

  RETURN jsonb_build_object('success',true,'transfer_id',p_transfer_id,
                            'items_saved',array_length(v_seen,1));
END;
$$;
REVOKE ALL ON FUNCTION public.revise_pending_warehouse_transfer(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revise_pending_warehouse_transfer(uuid,jsonb,jsonb) TO authenticated,service_role;
COMMIT;
