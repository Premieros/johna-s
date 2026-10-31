-- CANDIDATE ONLY. A default-OFF warehouse/material cutover gate.
-- Prerequisites: approved_raw_cost_engine_minimal_storage_20261031.sql and
-- approved_raw_cost_engine_v2_helpers_20261031.sql; both still uninstalled.
-- IMPORTANT: never apply to a live customer project until kitchen/sales,
-- reversals, reports, accounting period and legacy FIFO conversion are released.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

-- At most ONE durable cutover marker per warehouse/material, not a row
-- per sale, debt or inventory movement. No users can mutate the private table.
CREATE TABLE IF NOT EXISTS private.raw_cost_v2_activated_coordinates (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  activation_note text NOT NULL DEFAULT '',
  PRIMARY KEY (branch_id,warehouse_id,raw_material_id)
);
REVOKE ALL ON private.raw_cost_v2_activated_coordinates FROM PUBLIC,anon,authenticated,service_role;

-- The old SQL functions continue to exist unchanged for all default-OFF
-- coordinates. Route only explicitly activated coordinates under the *same*
-- branch+material transaction advisory lock used by legacy operations.
DO $route_v2_issue$
DECLARE s text; old text; newer text;
BEGIN
  SELECT replace(pg_get_functiondef(
    'public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)'::regprocedure
  ),chr(13),'') INTO STRICT s;
  IF position('APPROVED_RAW_V2_COORDINATE_ROUTE_V1' IN s)>0 THEN
    RAISE EXCEPTION 'V2_ISSUE_ROUTE_ALREADY_PRESENT';
  END IF;
  old:=$old$  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );$old$;
  newer:=$new$  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  -- APPROVED_RAW_V2_COORDINATE_ROUTE_V1:
  -- the activation row is the durable, non-reversible v2 accounting cutover.
  IF EXISTS (
    SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
    WHERE a.branch_id=p_branch_id AND a.warehouse_id=p_warehouse_id
      AND a.raw_material_id=p_raw_material_id
  ) THEN
    IF p_allow_negative IS NOT TRUE AND
       (SELECT COALESCE(sum(quantity),0) FROM public.raw_material_batches
        WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
          AND warehouse_id=p_warehouse_id)<p_qty THEN
      RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_STOCK');
    END IF;
    RETURN private.raw_issue_approved_v2(
      p_raw_material_id,p_branch_id,p_warehouse_id,p_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );
  END IF;$new$;
  IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'V2_ISSUE_ROUTE_SOURCE_DRIFT';
  END IF;
  EXECUTE replace(s,old,newer);
END;
$route_v2_issue$;

DO $route_v2_receipt$
DECLARE s text; old text; newer text;
BEGIN
  SELECT replace(pg_get_functiondef(
    'public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)'::regprocedure
  ),chr(13),'') INTO STRICT s;
  IF position('APPROVED_RAW_V2_RECEIPT_ROUTE_V1' IN s)>0 THEN
    RAISE EXCEPTION 'V2_RECEIPT_ROUTE_ALREADY_PRESENT';
  END IF;
  old:=$old$  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );$old$;
  newer:=$new$  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  -- APPROVED_RAW_V2_RECEIPT_ROUTE_V1:
  -- reject callers supplying physical lot metadata until v2 preserves
  -- source batch / expiry dates. This ensures no silent traceability loss.
  IF EXISTS(
    SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
    WHERE a.branch_id=p_branch_id AND a.warehouse_id=p_warehouse_id
      AND a.raw_material_id=p_raw_material_id
  ) THEN
    IF p_batch_number IS NOT NULL OR p_production_date IS NOT NULL
       OR p_expiry_date IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'error','V2_RECEIPT_LOT_METADATA_NOT_SUPPORTED');
    END IF;
    RETURN private.raw_receive_approved_v2(
      p_raw_material_id,p_branch_id,p_warehouse_id,p_qty,p_unit_cost,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );
  END IF;$new$;
  IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'V2_RECEIPT_ROUTE_SOURCE_DRIFT';
  END IF;
  EXECUTE replace(s,old,newer);
END;
$route_v2_receipt$;

-- There are ZERO activation rows. Merely installing this candidate
-- would not enable the new cost engine on an existing warehouse.
DO $guard_empty$
BEGIN
  IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates) THEN
    RAISE EXCEPTION 'V2_GATE_EXPECTED_EMPTY_ON_INSTALL';
  END IF;
END;
$guard_empty$;
COMMIT;
