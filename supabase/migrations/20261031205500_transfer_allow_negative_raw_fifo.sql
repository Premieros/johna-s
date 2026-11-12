-- Raw stock is allowed to go negative for warehouse transfers.
-- Uses the existing FIFO debt ledger/settlement system; preserves all
-- approval permissions, warehouse scope, status locks and rollback semantics.
-- No business data is modified by this migration at installation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $patch_transfer_negative_raw$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  SELECT replace(pg_get_functiondef('public.approve_warehouse_transfer(uuid)'::regprocedure),chr(13),'') INTO STRICT v_def;
  IF position('TRANSFER_ALLOW_NEGATIVE_RAW_V1' in v_def)<>0 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_ALREADY_PATCHED';
  END IF;

  -- Do not refuse a raw transfer because source stock is negative/short.
  -- Product transfers retain their existing strict shortage rule.
  v_old:=$old$      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW_STOCK', 'raw_material_id', v_item.raw_material_id, 'required', v_item.quantity, 'available', v_avail); END IF;$old$;
  v_new:=$new$      -- TRANSFER_ALLOW_NEGATIVE_RAW_V1: negative raw stock is explicitly supported.
      -- Actual consumption uses the canonical FIFO debt path below.$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_PRECHECK_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  -- Same-branch, cross-warehouse: explicit warehouse FIFO with debt enabled.
  v_old:=$old$        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$old$;
  v_new:=$new$        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid(), true);$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_SAME_BRANCH_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  -- Cross-branch: bypass legacy implicit-warehouse wrapper and pass the
  -- exact source warehouse; p_allow_negative=true records FIFO debts.
  v_old:=$old$      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$old$;
  v_new:=$new$      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid(), true);$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_CROSS_BRANCH_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  EXECUTE v_def;
END;
$patch_transfer_negative_raw$;
COMMIT;
