-- Candidate only: server-side source stock preflight at transfer creation.
-- Does not reserve stock; approve_warehouse_transfer still rechecks atomically.
-- Fail if the target function differs from the verified signature/body.
DO $patch$
DECLARE
  v_def text;
  v_anchor text := '  v_number := (public.next_document_number(''transfer'')->>''number'')::text;';
  v_insert text;
BEGIN
  SELECT pg_get_functiondef('public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure)
    INTO v_def;
  IF (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'CREATE_TRANSFER_SOURCE_DRIFT';
  END IF;
  v_insert := $guard$
  -- Sum duplicate lines before inserting a pending document.
  -- Branch balance is canonical for cross-branch FIFO stock; warehouse
  -- stock is authoritative for same-branch warehouse transfers.
  FOR v_item IN
    SELECT (i->>'source_id')::uuid AS source_id,
           i->>'item_type' AS item_type,
           SUM((i->>'quantity')::numeric) AS required
    FROM jsonb_array_elements(v_validated_items) i
    GROUP BY (i->>'source_id')::uuid, i->>'item_type'
  LOOP
    IF v_item.item_type = 'raw_material' THEN
      IF p_branch_id = v_to_branch_id THEN
        SELECT COALESCE(quantity,0) INTO v_qty
        FROM public.raw_material_warehouse_inventory
        WHERE raw_material_id=v_item.source_id
          AND branch_id=p_branch_id AND warehouse_id=p_from_warehouse_id;
      ELSE
        SELECT COALESCE(quantity,0) INTO v_qty
        FROM public.raw_material_inventory
        WHERE raw_material_id=v_item.source_id AND branch_id=p_branch_id;
      END IF;
    ELSE
      SELECT COALESCE(SUM(quantity),0) INTO v_qty
      FROM public.inventory_batches
      WHERE product_id=v_item.source_id AND branch_id=p_branch_id
        AND warehouse_id=p_from_warehouse_id;
    END IF;
    v_qty := COALESCE(v_qty,0);
    IF v_qty < v_item.required THEN
      RETURN jsonb_build_object('success',false,
        'error', CASE WHEN v_item.item_type='raw_material'
          THEN 'INSUFFICIENT_RAW_STOCK' ELSE 'INSUFFICIENT_STOCK' END,
        'raw_material_id', CASE WHEN v_item.item_type='raw_material' THEN v_item.source_id ELSE NULL END,
        'product_id', CASE WHEN v_item.item_type='product' THEN v_item.source_id ELSE NULL END,
        'required',v_item.required,'available',v_qty);
    END IF;
  END LOOP;

$guard$;
  v_def := replace(v_def,v_anchor,v_insert || v_anchor);
  EXECUTE v_def;
END;
$patch$;
