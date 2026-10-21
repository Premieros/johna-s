BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $restore$
DECLARE v_def text;
BEGIN
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.approve_warehouse_transfer(uuid)'::regprocedure),chr(13),'')) NOT IN ('3f9a741de5bc08757518e946f49b45eb','3f9a741de5bc08757518e946f49b45eb') THEN RAISE EXCEPTION 'TRANSFER_RESTORE_BASELINE_CHANGED'; END IF;
 SELECT pg_get_functiondef('public.approve_warehouse_transfer(uuid)'::regprocedure) INTO v_def;
 v_def:=replace(v_def,$new$    ELSE
      IF v_item.source_unit IS DISTINCT FROM v_item.destination_unit THEN
        RETURN jsonb_build_object('success',false,'error','TRANSFER_UNIT_MISMATCH');
      END IF;
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity$new$,$old$    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity$old$);
 v_def:=replace(v_def,$new$FOR v_item IN SELECT i.*,s.unit_id AS source_unit,d.unit_id AS destination_unit FROM public.warehouse_transfer_items i LEFT JOIN public.raw_materials s ON s.id=i.raw_material_id LEFT JOIN public.raw_materials d ON d.id=i.destination_raw_material_id WHERE i.transfer_id = p_transfer_id LOOP$new$,$old$FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP$old$);
 EXECUTE v_def;
END $restore$;

DO $restore$
DECLARE v_def text;
BEGIN
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure),chr(13),'')) NOT IN ('31e690cbc093d30e49cc7ac59c368eab','31e690cbc093d30e49cc7ac59c368eab') THEN RAISE EXCEPTION 'TRANSFER_RESTORE_BASELINE_CHANGED'; END IF;
 SELECT pg_get_functiondef('public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO v_def;
 v_def:=replace(v_def,$new$      END IF;
      IF v_source_unit IS DISTINCT FROM v_destination_unit THEN
        RETURN jsonb_build_object('success',false,'error','TRANSFER_UNIT_MISMATCH');
      END IF;
    END IF;

    v_validated_items$new$,$old$      END IF;
    END IF;

    v_validated_items$old$);
 v_def:=replace(v_def,$new$      SELECT r.id, r.unit_id INTO v_destination_id, v_destination_unit$new$,$old$      SELECT r.id INTO v_destination_id$old$);
 v_def:=replace(v_def,$new$      SELECT unit_id INTO v_source_unit FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active;
      IF NOT FOUND THEN$new$,$old$      IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active) THEN$old$);
 v_def:=replace(v_def,$new$  v_to_branch_id uuid;
  v_source_unit uuid;
  v_destination_unit uuid;$new$,$old$  v_to_branch_id uuid;$old$);
 EXECUTE v_def;
END $restore$;
COMMIT;
