-- Enforce current source-warehouse availability when a transfer is created.
-- This is advisory at creation time: the existing approve RPC must still check
-- and lock/recheck stock at approval. No balance/FIFO/accounting writers change.
-- Operates only inside the existing SECURITY DEFINER RPC after its auth checks.
DO $transfer_source_preflight$
DECLARE
  v_definition text;
  v_declare_anchor text := $a$  v_validated_items jsonb := '[]'::jsonb;$a$;
  v_insert_anchor text := $a$  v_number := (public.next_document_number('transfer')->>'number')::text;$a$;
  v_guard text;
BEGIN
  SELECT replace(pg_get_functiondef('public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure), chr(13), '')
    INTO STRICT v_definition;
  IF (length(v_definition) - length(replace(v_definition,v_declare_anchor,''))) / length(v_declare_anchor) <> 1
    OR (length(v_definition) - length(replace(v_definition,v_insert_anchor,''))) / length(v_insert_anchor) <> 1
    OR position('TRANSFER_SOURCE_STOCK_CREATE_GATE_V1' in v_definition) <> 0
  THEN
    RAISE EXCEPTION 'TRANSFER_SOURCE_STOCK_CREATE_SOURCE_DRIFT';
  END IF;

  v_definition := replace(v_definition, v_declare_anchor,
    v_declare_anchor || E'\n  v_stock_line record;\n  v_stock_available numeric;');

  v_guard := $guard$
  -- TRANSFER_SOURCE_STOCK_CREATE_GATE_V1
  -- Combine repeated material lines to avoid approving individually valid
  -- lines whose sum exceeds the physical source warehouse balance.
  FOR v_stock_line IN
    SELECT (line->>'source_id')::uuid AS material_id,
           line->>'item_type' AS item_type,
           SUM((line->>'quantity')::numeric) AS required_qty
    FROM jsonb_array_elements(v_validated_items) AS line
    GROUP BY (line->>'source_id')::uuid, line->>'item_type'
  LOOP
    IF v_stock_line.item_type = 'raw_material' THEN
      SELECT COALESCE(quantity, 0)
        INTO v_stock_available
      FROM public.raw_material_warehouse_inventory
      WHERE raw_material_id = v_stock_line.material_id
        AND branch_id = p_branch_id
        AND warehouse_id = p_from_warehouse_id;
    ELSE
      SELECT COALESCE(SUM(quantity), 0)
        INTO v_stock_available
      FROM public.inventory_batches
      WHERE product_id = v_stock_line.material_id
        AND branch_id = p_branch_id
        AND warehouse_id = p_from_warehouse_id;
    END IF;
    v_stock_available := COALESCE(v_stock_available, 0);
    IF v_stock_available < v_stock_line.required_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', CASE WHEN v_stock_line.item_type = 'raw_material'
          THEN 'INSUFFICIENT_RAW_STOCK' ELSE 'INSUFFICIENT_STOCK' END,
        'raw_material_id', CASE WHEN v_stock_line.item_type = 'raw_material'
          THEN v_stock_line.material_id ELSE NULL END,
        'product_id', CASE WHEN v_stock_line.item_type = 'product'
          THEN v_stock_line.material_id ELSE NULL END,
        'required', v_stock_line.required_qty,
        'available', v_stock_available
      );
    END IF;
  END LOOP;
  -- This is not a reservation; subsequent business events may change stock.
$guard$;

  v_definition := replace(v_definition, v_insert_anchor, v_guard || v_insert_anchor);
  EXECUTE v_definition;
END;
$transfer_source_preflight$;
