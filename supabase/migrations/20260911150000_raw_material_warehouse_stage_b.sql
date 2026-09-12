-- Stage B / step 1: make raw-material receive, same-branch transfer and
-- availability warehouse-aware without changing Production data.
-- raw_material_inventory remains the branch aggregate; warehouse truth is
-- derived from raw_material_batches once warehouse_id is present.

ALTER TABLE public.raw_material_batches
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_raw_material_batches_branch_warehouse_material
  ON public.raw_material_batches(branch_id, warehouse_id, raw_material_id)
  WHERE quantity > 0;

CREATE OR REPLACE VIEW public.raw_material_warehouse_inventory
WITH (security_invoker = true)
AS
SELECT b.raw_material_id, b.branch_id, b.warehouse_id,
       COALESCE(SUM(b.quantity),0)::numeric AS quantity,
       CASE WHEN COALESCE(SUM(b.quantity),0)>0
         THEN round(SUM(b.quantity*COALESCE(b.unit_cost,0))/SUM(b.quantity),2)
         ELSE 0 END::numeric AS avg_cost
FROM public.raw_material_batches b
WHERE b.warehouse_id IS NOT NULL
GROUP BY b.raw_material_id,b.branch_id,b.warehouse_id;

REVOKE ALL ON public.raw_material_warehouse_inventory FROM PUBLIC, anon;
GRANT SELECT ON public.raw_material_warehouse_inventory TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric,
  p_unit_cost numeric DEFAULT 0, p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL, p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase', p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL, p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_before numeric(14,4):=0; v_after numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0; v_branch_value numeric(18,4):=0;
  v_branch_avg numeric(12,2):=0; v_batch_no text;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_PARAMS'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.raw_materials WHERE id=p_raw_material_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_BRANCH_MISMATCH'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  SELECT COALESCE(SUM(quantity),0) INTO v_before FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
  v_batch_no:=COALESCE(NULLIF(btrim(COALESCE(p_batch_number,'')),''),'RB-'||substr(replace(gen_random_uuid()::text,'-',''),1,10));
  INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date,expiry_date,source_type,source_id)
  VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,COALESCE(p_unit_cost,0),p_production_date,p_expiry_date,COALESCE(p_reference_type,p_entry_type),p_reference_id);
  v_after:=v_before+p_qty;
  SELECT COALESCE(SUM(quantity),0),COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0) INTO v_branch_qty,v_branch_value FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  v_branch_avg:=CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES(p_raw_material_id,p_branch_id,v_branch_qty,v_branch_avg)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
  VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,COALESCE(p_unit_cost,0),p_qty*COALESCE(p_unit_cost,0),v_before,v_after,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
  RETURN jsonb_build_object('success',true,'before_qty',v_before,'after_qty',v_after,'avg_cost',v_branch_avg,'batch_number',v_batch_no,'warehouse_id',p_warehouse_id);
END $$;

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_entry_type text DEFAULT 'production',p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_remaining numeric(14,4); v_batch record; v_deduct numeric(14,4);
  v_running numeric(14,4):=0; v_branch_qty numeric(14,4):=0; v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0; v_total_removed numeric(14,4):=0;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN RETURN jsonb_build_object('success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0); END IF;
  IF p_warehouse_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active) THEN RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  SELECT COALESCE(SUM(quantity),0) INTO v_running FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
  v_remaining:=p_qty;
  FOR v_batch IN SELECT id,quantity,unit_cost,batch_number FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0; v_deduct:=LEAST(v_batch.quantity,v_remaining);
    UPDATE public.raw_material_batches SET quantity=quantity-v_deduct WHERE id=v_batch.id;
    INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by)
    VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_deduct,COALESCE(v_batch.unit_cost,0),-v_deduct*COALESCE(v_batch.unit_cost,0),v_running,v_running-v_deduct,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by);
    v_running:=v_running-v_deduct; v_remaining:=v_remaining-v_deduct; v_total_removed:=v_total_removed+v_deduct; v_total_cost:=v_total_cost+v_deduct*COALESCE(v_batch.unit_cost,0);
  END LOOP;
  SELECT COALESCE(SUM(quantity),0),COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0) INTO v_branch_qty,v_branch_value FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES(p_raw_material_id,p_branch_id,v_branch_qty,CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  RETURN jsonb_build_object('success',true,'shortage',v_remaining,'removed',v_total_removed,'total_cost',v_total_cost,'avg_cost',CASE WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2) ELSE 0 END,'warehouse_id',p_warehouse_id);
END $$;

REVOKE ALL ON FUNCTION public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid) TO service_role,postgres;

-- Patch current receipt function to pass its already-canonical warehouse id.
DO $patch$
DECLARE v_oid oid; v_def text; v_new text; v_patched text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='receive_purchase_order' AND pg_get_function_identity_arguments(p.oid)='p_purchase_id uuid, p_receipt_items jsonb';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'receive_purchase_order target not found'; END IF;
  v_def:=pg_get_functiondef(v_oid);
  v_new:=$new$v_res := public._raw_add(v_pitem.raw_material_id, v_purchase.branch_id, v_purchase.warehouse_id,
          (v_res->>'stock_quantity')::numeric, (v_res->>'stock_unit_cost')::numeric,$new$;
  v_patched:=regexp_replace(
    v_def,
    'v_res[[:space:]]*:=[[:space:]]*public\._raw_add\([[:space:]]*v_pitem\.raw_material_id[[:space:]]*,[[:space:]]*v_purchase\.branch_id[[:space:]]*,[[:space:]]*\(v_res->>''stock_quantity''\)::numeric[[:space:]]*,[[:space:]]*\(v_res->>''stock_unit_cost''\)::numeric[[:space:]]*,',
    v_new,
    'i'
  );
  IF v_patched = v_def THEN RAISE EXCEPTION 'receive_purchase_order raw posting marker not found'; END IF;
  EXECUTE v_patched;
END $patch$;

-- Patch exact availability source from branch aggregate to requested warehouse batches.
-- pg_get_functiondef() normalizes qualification/whitespace, so use a narrow regexp
-- anchored to the unique raw-material availability block instead of a brittle literal.
DO $patch$
DECLARE v_oid oid; v_def text; v_new text; v_patched text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='check_product_availability' AND pg_get_function_identity_arguments(p.oid)='p_product_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_quantity numeric';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'check_product_availability target not found'; END IF;
  v_def:=pg_get_functiondef(v_oid);
  v_new:=$new$SELECT COALESCE((SELECT SUM(b.quantity)
      FROM public.raw_material_batches b
      WHERE b.raw_material_id = v_row.raw_material_id
        AND b.branch_id = p_branch_id
        AND b.warehouse_id = p_warehouse_id), 0)
    INTO v_available;$new$;
  v_patched:=regexp_replace(
    v_def,
    'SELECT[[:space:]]+COALESCE\(rmi\.quantity,[[:space:]]*0\)[[:space:]]+INTO[[:space:]]+v_available[[:space:]]+FROM[[:space:]]+(public\.)?raw_material_inventory[[:space:]]+rmi[[:space:]]+WHERE[[:space:]]+rmi\.raw_material_id[[:space:]]*=[[:space:]]*v_row\.raw_material_id[[:space:]]+AND[[:space:]]+rmi\.branch_id[[:space:]]*=[[:space:]]*p_branch_id;',
    v_new,
    'i'
  );
  IF v_patched = v_def THEN RAISE EXCEPTION 'check_product_availability raw marker not found'; END IF;
  EXECUTE v_patched;
END $patch$;

-- Allow same-branch raw transfer identity; destination remains explicit for cross-branch.
DO $patch$
DECLARE v_oid oid; v_def text; v_old text; v_new text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='create_warehouse_transfer' AND pg_get_function_identity_arguments(p.oid)='p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_branch_id uuid, p_items jsonb, p_reason text, p_notes text';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'create_warehouse_transfer target not found'; END IF;
  v_def:=pg_get_functiondef(v_oid);
  v_old:=$old$IF p_branch_id = v_to_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED');
      END IF;
      IF v_requested_destination_id IS NULL THEN$old$;
  v_new:=$new$IF p_branch_id = v_to_branch_id THEN
        IF v_requested_destination_id IS NOT NULL AND v_requested_destination_id <> v_source_id THEN
          RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_BRANCH_MISMATCH', 'raw_material_id', v_source_id);
        END IF;
        v_requested_destination_id := v_source_id;
      END IF;
      IF v_requested_destination_id IS NULL THEN$new$;
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'create raw same-branch marker not found'; END IF;
  v_def:=replace(v_def,v_old,v_new); EXECUTE v_def;
END $patch$;

-- Approval uses warehouse FIFO for same-branch raw transfers. Cross-branch legacy
-- path is left intact in this first stabilization step and will be removed only
-- after its fixture is migrated to explicit warehouse batches.
DO $patch$
DECLARE v_oid oid; v_def text; v_old text; v_new text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='approve_warehouse_transfer' AND pg_get_function_identity_arguments(p.oid)='p_transfer_id uuid';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'approve_warehouse_transfer target not found'; END IF;
  v_def:=pg_get_functiondef(v_oid);
  v_old:=$old$SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_inventory WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id;
      v_avail := COALESCE(v_avail, 0);$old$;
  v_new:=$new$IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_warehouse_inventory
        WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id AND warehouse_id = v_transfer.from_warehouse_id;
      ELSE
        SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_inventory WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id;
      END IF;
      v_avail := COALESCE(v_avail, 0);$new$;
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'approve raw preflight marker not found'; END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_old:=$old$IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN RAISE EXCEPTION 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED'; END IF;
      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$old$;
  v_new:=$new$IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_RAW_REMOVE_FAILED raw=% detail=%', v_item.raw_material_id, v_res::text; END IF;
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_RAW_STOCK_RACE raw=% shortage=%', v_item.raw_material_id, v_short; END IF;
        v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
        v_add := public._raw_add(v_item.raw_material_id, v_transfer.branch_id, v_transfer.to_warehouse_id, v_item.quantity, v_cost, NULL, NULL, NULL, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_DESTINATION_RAW_ADD_FAILED raw=% detail=%', v_item.raw_material_id, v_add::text; END IF;
        CONTINUE;
      END IF;
      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());$new$;
  IF position(v_old in v_def)=0 THEN RAISE EXCEPTION 'approve raw movement marker not found'; END IF;
  v_def:=replace(v_def,v_old,v_new); EXECUTE v_def;
END $patch$;

COMMENT ON VIEW public.raw_material_warehouse_inventory IS 'Stage B warehouse-level raw stock derived from explicit warehouse-tagged FIFO batches.';
