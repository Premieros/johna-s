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

-- Retain source physical lot identity; original v2 helper already
-- inserts one receipt ledger and one physical batch under a canonical lock.
-- This adapter writes expiry/production metadata to THAT new batch only,
-- never to historical stock or invoices.
CREATE OR REPLACE FUNCTION private.raw_receive_approved_v2_lot(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_receipt_unit_cost numeric,p_entry_type text,p_reference_type text,p_reference_id uuid,
  p_reference_number text,p_created_by uuid,
  p_batch_number text,p_production_date date,p_expiry_date date
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $lot$
DECLARE
  v_result jsonb;
  v_ledger_id bigint;
  v_batch_no text;
  v_adjusted_batches integer;
BEGIN
  IF p_production_date IS NOT NULL AND p_expiry_date IS NOT NULL
     AND p_expiry_date<p_production_date THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_LOT_DATES');
  END IF;
  IF p_batch_number IS NOT NULL AND btrim(p_batch_number)='' THEN
    RETURN jsonb_build_object('success',false,'error','EMPTY_LOT_NUMBER');
  END IF;
  v_result:=private.raw_receive_approved_v2(
    p_raw_material_id,p_branch_id,p_warehouse_id,p_qty,p_receipt_unit_cost,
    p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
  );
  IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  v_ledger_id:=(v_result->>'receipt_ledger_id')::bigint;
  SELECT l.batch_number INTO STRICT v_batch_no
  FROM public.inventory_ledger l WHERE l.id=v_ledger_id
    AND l.raw_material_id=p_raw_material_id
    AND l.branch_id=p_branch_id AND l.warehouse_id=p_warehouse_id;
  IF p_batch_number IS NOT NULL THEN
    v_batch_no:=btrim(p_batch_number);
  END IF;
  UPDATE public.raw_material_batches b
  SET batch_number=v_batch_no,
      production_date=p_production_date,expiry_date=p_expiry_date
  WHERE b.batch_number=(SELECT l.batch_number FROM public.inventory_ledger l WHERE l.id=v_ledger_id)
    AND b.raw_material_id=p_raw_material_id AND b.branch_id=p_branch_id
    AND b.warehouse_id=p_warehouse_id
    AND b.source_type=COALESCE(p_reference_type,p_entry_type)
    AND b.source_id IS NOT DISTINCT FROM p_reference_id;
  GET DIAGNOSTICS v_adjusted_batches=ROW_COUNT;
  IF v_adjusted_batches<>1 THEN
    RAISE EXCEPTION 'V2_RECEIPT_BATCH_IDENTIFICATION_NOT_UNIQUE ledger=% rows=%',
      v_ledger_id,v_adjusted_batches;
  END IF;
  UPDATE public.inventory_ledger SET batch_number=v_batch_no WHERE id=v_ledger_id;
  RETURN v_result||jsonb_build_object(
    'batch_number',v_batch_no,'avg_cost',p_receipt_unit_cost,
    'fifo_settled_quantity',0,'fifo_settled_value',0
  );
END;
$lot$;
REVOKE ALL ON FUNCTION private.raw_receive_approved_v2_lot(
  uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,text,date,date
) FROM PUBLIC,anon,authenticated,service_role;

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
    RETURN private.raw_receive_approved_v2_lot(
      p_raw_material_id,p_branch_id,p_warehouse_id,p_qty,p_unit_cost,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      p_batch_number,p_production_date,p_expiry_date
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
