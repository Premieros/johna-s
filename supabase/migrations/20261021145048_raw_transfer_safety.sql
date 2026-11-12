SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE v_def text;
BEGIN
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.approve_warehouse_transfer(uuid)'::regprocedure),chr(13),'')) NOT IN ('0538b8f71f0e9389c24bc92c6794fad2') THEN RAISE EXCEPTION 'TRANSFER_BASELINE_CHANGED'; END IF;
 SELECT replace(pg_get_functiondef('public.approve_warehouse_transfer(uuid)'::regprocedure),chr(13),'') INTO v_def;
 IF position($old0$FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP$old0$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old0$FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP$old0$,$new0$FOR v_item IN SELECT i.*,s.unit_id AS source_unit,d.unit_id AS destination_unit FROM public.warehouse_transfer_items i LEFT JOIN public.raw_materials s ON s.id=i.raw_material_id LEFT JOIN public.raw_materials d ON d.id=i.destination_raw_material_id WHERE i.transfer_id = p_transfer_id LOOP$new0$);
 IF position($old1$    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity$old1$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old1$    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity$old1$,$new1$    ELSE
      IF v_item.source_unit IS DISTINCT FROM v_item.destination_unit THEN
        RETURN jsonb_build_object('success',false,'error','TRANSFER_UNIT_MISMATCH');
      END IF;
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        SELECT COALESCE(quantity$new1$);
 EXECUTE v_def;
END $patch$;

DO $patch$
DECLARE v_def text;
BEGIN
 IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid='public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure),chr(13),'')) NOT IN ('1d39efa5845ac2147163c8d26d294e06') THEN RAISE EXCEPTION 'TRANSFER_BASELINE_CHANGED'; END IF;
 SELECT replace(pg_get_functiondef('public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)'::regprocedure),chr(13),'') INTO v_def;
 IF position($old0$  v_to_branch_id uuid;$old0$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old0$  v_to_branch_id uuid;$old0$,$new0$  v_to_branch_id uuid;
  v_source_unit uuid;
  v_destination_unit uuid;$new0$);
 IF position($old1$      IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active) THEN$old1$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old1$      IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active) THEN$old1$,$new1$      SELECT unit_id INTO v_source_unit FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active;
      IF NOT FOUND THEN$new1$);
 IF position($old2$      SELECT r.id INTO v_destination_id$old2$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old2$      SELECT r.id INTO v_destination_id$old2$,$new2$      SELECT r.id, r.unit_id INTO v_destination_id, v_destination_unit$new2$);
 IF position($old3$      END IF;
    END IF;

    v_validated_items$old3$ in v_def)=0 THEN RAISE EXCEPTION 'TRANSFER_PATCH_TARGET_CHANGED'; END IF;
 v_def:=replace(v_def,$old3$      END IF;
    END IF;

    v_validated_items$old3$,$new3$      END IF;
      IF v_source_unit IS DISTINCT FROM v_destination_unit THEN
        RETURN jsonb_build_object('success',false,'error','TRANSFER_UNIT_MISMATCH');
      END IF;
    END IF;

    v_validated_items$new3$);
 EXECUTE v_def;
END $patch$;
