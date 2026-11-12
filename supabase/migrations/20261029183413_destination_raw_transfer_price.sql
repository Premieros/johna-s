-- Cross-branch raw receipts use the receiver's existing canonical latest price.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
-- Preserve the six-decimal canonical unit price, rather than rounding it to cents.
ALTER TABLE public.warehouse_transfer_items ALTER COLUMN unit_cost TYPE numeric(18,6);
CREATE TABLE IF NOT EXISTS private.raw_transfer_receipt_prices(
 transfer_item_id uuid PRIMARY KEY REFERENCES public.warehouse_transfer_items(id) ON DELETE CASCADE,
 transfer_id uuid NOT NULL REFERENCES public.warehouse_transfers(id) ON DELETE CASCADE,
 source_raw_material_id uuid NOT NULL,destination_raw_material_id uuid NOT NULL,destination_branch_id uuid NOT NULL,
 unit_cost numeric(18,6) NOT NULL CHECK(unit_cost>=0),price_source text NOT NULL,priced_at timestamptz,
 captured_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_raw_transfer_receipt_source ON private.raw_transfer_receipt_prices(transfer_id,source_raw_material_id);
ALTER TABLE private.raw_transfer_receipt_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_transfer_receipt_prices FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.raw_transfer_receipt_prices TO service_role;
DO $patch_create_warehouse_transfer$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_warehouse_transfer' AND p.pronargs=6;
 v_old:=$old$  v_destination_unit uuid;$old$;
 v_new:=$new$  v_destination_unit uuid;
  v_destination_prices jsonb;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'create_warehouse_transfer source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  v_number := (public.next_document_number('transfer')->>'number')::text;$old$;
 v_new:=$new$  -- DESTINATION_RAW_PRICE_QUOTE: one canonical batch, scoped to the receiver.
  IF p_branch_id IS DISTINCT FROM v_to_branch_id THEN
    SELECT jsonb_object_agg(p.raw_material_id::text,to_jsonb(p)) INTO v_destination_prices
    FROM private.latest_approved_raw_prices(v_to_branch_id,ARRAY(
      SELECT DISTINCT (i->>'destination_id')::uuid FROM jsonb_array_elements(v_validated_items) i
      WHERE i->>'item_type'='raw_material'
    ),NULL) p;
  END IF;

  v_number := (public.next_document_number('transfer')->>'number')::text;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'create_warehouse_transfer source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$      VALUES (v_transfer_id, v_source_id, v_destination_id, v_qty, v_unit_cost);
    END IF;$old$;
 v_new:=$new$      VALUES (v_transfer_id, v_source_id, v_destination_id, v_qty,
        CASE WHEN p_branch_id IS DISTINCT FROM v_to_branch_id
          THEN COALESCE((v_destination_prices->v_destination_id::text->>'unit_cost')::numeric,0)
          ELSE v_unit_cost END);
    END IF;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'create_warehouse_transfer source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_create_warehouse_transfer$;
DO $patch_approve_warehouse_transfer$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='approve_warehouse_transfer' AND p.pronargs=1;
 v_old:=$old$  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id ORDER BY id LOOP$old$;
 v_new:=$new$  -- DESTINATION_RAW_PRICE_RECEIPT: freeze the receiver's canonical latest price
  -- at approval, before stock writes; transfer receipts never become price sources.
  IF v_transfer.branch_id IS DISTINCT FROM COALESCE(v_transfer.to_branch_id,v_transfer.branch_id) THEN
    WITH prices AS MATERIALIZED (
      SELECT * FROM private.latest_approved_raw_prices(v_transfer.to_branch_id,ARRAY(
        SELECT DISTINCT destination_raw_material_id FROM public.warehouse_transfer_items
        WHERE transfer_id=p_transfer_id AND raw_material_id IS NOT NULL
      ),NULL)
    )
    INSERT INTO private.raw_transfer_receipt_prices(transfer_item_id,transfer_id,source_raw_material_id,destination_raw_material_id,destination_branch_id,unit_cost,price_source,priced_at)
    SELECT i.id,i.transfer_id,i.raw_material_id,i.destination_raw_material_id,v_transfer.to_branch_id,
      COALESCE(p.unit_cost,0),p.price_source,p.priced_at
    FROM public.warehouse_transfer_items i JOIN prices p ON p.raw_material_id=i.destination_raw_material_id
    WHERE i.transfer_id=p_transfer_id AND i.raw_material_id IS NOT NULL;

    IF (SELECT count(*) FROM private.raw_transfer_receipt_prices WHERE transfer_id=p_transfer_id)
       <> (SELECT count(*) FROM public.warehouse_transfer_items WHERE transfer_id=p_transfer_id AND raw_material_id IS NOT NULL) THEN
      RAISE EXCEPTION 'TRANSFER_DESTINATION_PRICE_UNAVAILABLE';
    END IF;
    UPDATE public.warehouse_transfer_items i SET unit_cost=p.unit_cost
    FROM private.raw_transfer_receipt_prices p WHERE p.transfer_item_id=i.id AND p.transfer_id=p_transfer_id;
  END IF;

  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id ORDER BY id LOOP$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'approve_warehouse_transfer source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$      v_add := public._raw_add(v_item.destination_raw_material_id, v_transfer.to_branch_id, v_item.quantity, v_cost,$old$;
 v_new:=$new$      v_add := public._raw_add(v_item.destination_raw_material_id, v_transfer.to_branch_id, v_item.quantity, v_item.unit_cost,$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'approve_warehouse_transfer source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_approve_warehouse_transfer$;
DO $patch__fifo_adjust_warehouse_transfer_delta$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_fifo_adjust_warehouse_transfer_delta' AND p.pronargs=6;
 v_old:=$old$  SELECT count(*) INTO v_item_count
  FROM public.warehouse_transfer_items$old$;
 v_new:=$new$  -- DESTINATION_RAW_PRICE_FROZEN: new cross-branch receipts have independent
  -- receiver valuation; a source-layer correction must not reprice the receipt.
  IF EXISTS(SELECT 1 FROM private.raw_transfer_receipt_prices p
    WHERE p.transfer_id=p_transfer_id AND p.source_raw_material_id=p_target_id) THEN
    RETURN jsonb_build_object('success',true,'transfer_id',p_transfer_id,'delta',0,'destination_price_frozen',true);
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.warehouse_transfer_items$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION '_fifo_adjust_warehouse_transfer_delta source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch__fifo_adjust_warehouse_transfer_delta$;
COMMIT;
