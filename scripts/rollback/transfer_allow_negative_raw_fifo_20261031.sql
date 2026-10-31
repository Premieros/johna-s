-- Emergency schema rollback only: restores strict raw transfer approval policy.
-- Does not reverse already-posted transfers or rewrite FIFO debt/balances.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $rollback_transfer_negative_raw$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  SELECT replace(pg_get_functiondef('public.approve_warehouse_transfer(uuid)'::regprocedure),chr(13),'') INTO STRICT v_def;
  v_old:=$old$      -- TRANSFER_ALLOW_NEGATIVE_RAW_V1: negative raw stock is explicitly supported.
      -- Actual consumption uses the canonical FIFO debt path below.$old$;
  v_new:=$new$      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW_STOCK', 'raw_material_id', v_item.raw_material_id, 'required', v_item.quantity, 'available', v_avail); END IF;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_ROLLBACK_GUARD_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_old:=$old$        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid(), true);$old$;
  v_new:=$new$        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_ROLLBACK_SAME_BRANCH_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_old:=$old$      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid(), true);$old$;
  v_new:=$new$      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'TRANSFER_NEGATIVE_RAW_ROLLBACK_CROSS_BRANCH_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  EXECUTE v_def;
END;
$rollback_transfer_negative_raw$;
COMMIT;
