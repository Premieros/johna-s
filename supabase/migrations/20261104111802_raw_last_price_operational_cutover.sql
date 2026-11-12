-- Operational release. Routing stays OFF until the audited stock cutover.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $release_baseline$ BEGIN IF EXISTS(WITH expected(signature,fingerprint,acl) AS(VALUES ('private.apply_raw_stock_count_last_price(uuid)','c535adc08839b811d8dad7b2f261c99d','{postgres=X/postgres}'),('private.latest_approved_raw_prices(uuid,uuid[],timestamp with time zone)','4907c536c382a105a3ca5ed12a1e61c4','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),('private.offset_stock_count_legacy_quantity(bigint,uuid)','586a72c76d11be6351657f1e23591620','{postgres=X/postgres}'),('private.raw_approved_price_visible(text,text,uuid,uuid,uuid)','35b70047bc97a81c11871a1ca83cb2bc','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),('private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,jsonb)','d2f0b5660fdfcf38c9b5324d1d8f3167','{postgres=X/postgres}'),('private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,jsonb)','4624f216a99d37c18eae677abf47c459','{postgres=X/postgres}'),('private.stock_count_raw_price(uuid,uuid[],timestamp with time zone)','435d387b0b9eb247aefc4fc5d7c20447','{postgres=X/postgres}'),('private.validate_count_legacy_quantity(uuid,uuid,uuid)','5eb940547bd9ff4477143485af028bed','{postgres=X/postgres}'),('_capture_kitchen_ingredient_prices()','5ae433c7fd8b7564c2af20eb1dd8fdcb','{postgres=X/postgres,service_role=X/postgres}'),('_deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid)','7a004fec1a1854b71400978d1a29dc1f','{postgres=X/postgres,service_role=X/postgres}'),('_raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)','a604719308b7ad66592aa9c4f37663b8','{postgres=X/postgres,service_role=X/postgres}'),('_raw_fifo_settle_receipt(bigint,uuid,uuid)','f7192b548e709fafc13a789a7dd72676','{postgres=X/postgres,service_role=X/postgres}'),('_raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)','a042df81a4bfeb0a1be148aa9c065f76','{postgres=X/postgres,service_role=X/postgres}'),('get_current_raw_material_valuation(uuid)','03833ef5b80d88cab0834735f1b1c462','{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'),('raw_fifo_apply_backfill(uuid)','d55c8afdfde4bf3231c738f46eb39bf1','{postgres=X/postgres,service_role=X/postgres}'),('raw_fifo_prepare_backfill(uuid)','b97703a8d00c9eec636ee4ec7d765a75','{postgres=X/postgres,service_role=X/postgres}'),('raw_fifo_price_fallback_apply(uuid)','7ba322089428b5ef39364c576cdf76d8','{postgres=X/postgres,service_role=X/postgres}'),('raw_fifo_price_fallback_prepare(uuid)','5ee296aeca0992fa28f980d2b6af7ab0','{postgres=X/postgres,service_role=X/postgres}'),('raw_fifo_price_fallback_reverse(uuid)','158ad30e53f0c48cf6f3d0463c66cd7e','{postgres=X/postgres,service_role=X/postgres}'),('raw_fifo_reverse_backfill(uuid)','a7274924324e5a5df6fc14688f46332c','{postgres=X/postgres,service_role=X/postgres}'),('raw_opening_cost_apply_repair(uuid)','a628a68efb47c00c6f922c77d17b7ae3','{postgres=X/postgres,service_role=X/postgres}'),('raw_opening_cost_reverse_repair(uuid)','f2d96ba5f6c1edb12fc3fc414415951f','{postgres=X/postgres,service_role=X/postgres}'),('approve_warehouse_transfer(uuid)','774587865931c3f7314eece4973d338c','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),('create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)','7e7570f8dff786aaf7d88fffe84379a9','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')) SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) WHERE md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.fingerprint OR p.proacl::text IS DISTINCT FROM e.acl OR pg_get_userbyid(p.proowner)<>'postgres') THEN RAISE EXCEPTION 'RAW_OPERATIONAL_RELEASE_BASELINE_DRIFT'; END IF; END $release_baseline$;
-- Source: scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql
-- APPROVED RAW COST ENGINE / storage-minimal SCHEMA CANDIDATE.
-- UNWIRED; ISOLATED DEVELOPMENT ONLY. Do not apply to production or
-- put this file under supabase/migrations until the end-to-end writer,
-- accounting, rollback, compatibility and tenancy gates are complete.
-- This proposal reuses existing inventory_ledger and raw_material_batches
-- rather than generating a new debt/price row per movement.

-- NULL means untouched legacy accounting and allows an online cutover.
-- Cost of a new raw movement can later be frozen with one immutable
-- source-price reference and no second debt/snapshot record.
ALTER TABLE public.inventory_ledger
  ADD COLUMN IF NOT EXISTS approved_cost_basis text,
  ADD COLUMN IF NOT EXISTS approved_price_source text,
  ADD COLUMN IF NOT EXISTS approved_price_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_price_ref text,
  ADD COLUMN IF NOT EXISTS approved_cost_recorded_at timestamptz;

DO $approved_ledger_check$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.inventory_ledger'::regclass
      AND conname='inventory_ledger_approved_price_invariant'
  ) THEN
    ALTER TABLE public.inventory_ledger ADD CONSTRAINT inventory_ledger_approved_price_invariant
    CHECK (
      approved_cost_basis IS NULL OR (
        approved_cost_basis='approved_last_known'
        AND raw_material_id IS NOT NULL
        AND approved_price_source IN('purchase','pricing','stock_count','catalog_zero')
        AND approved_price_at IS NOT NULL
        AND approved_cost_recorded_at IS NOT NULL
        AND approved_price_at<=approved_cost_recorded_at
        AND unit_cost>=0
        AND abs(total_cost - quantity*unit_cost)<=0.005
      )
    ) NOT VALID;
  END IF;
END;
$approved_ledger_check$;

-- Physical lots share one rounded monetary movement. An individual lot may
-- carry the residual cent, while the whole movement still equals round(qty*price,2).
-- Retain the entire existing constraint and change only that rounding bound.
DO $lot_rounding_bound$
DECLARE s text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT s FROM pg_constraint
 WHERE conrelid='public.inventory_ledger'::regclass
  AND conname='inventory_ledger_approved_price_invariant';
 IF (length(s)-length(replace(s,'0.005','')))/length('0.005')<>1 THEN
  RAISE EXCEPTION 'APPROVED_LEDGER_ROUNDING_SOURCE_DRIFT';
 END IF;
 ALTER TABLE public.inventory_ledger DROP CONSTRAINT inventory_ledger_approved_price_invariant;
 EXECUTE 'ALTER TABLE public.inventory_ledger ADD CONSTRAINT inventory_ledger_approved_price_invariant '
  ||replace(s,'0.005','0.01');
END;
$lot_rounding_bound$;

-- One aggregate shortage position per branch/warehouse/material; its
-- negative quantity is already counted by the canonical inventory view.
-- Do NOT create one OV-* batch per negative sale after the cutover.
-- A precise amount avoids rounding the accumulated shortage basis.
ALTER TABLE public.raw_material_batches
  ADD COLUMN IF NOT EXISTS approved_shortage_total_cost numeric(20,6);

DO $approved_shortage_check$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.raw_material_batches'::regclass
      AND conname='raw_batches_approved_shortage_position_invariant'
  ) THEN
    ALTER TABLE public.raw_material_batches
    ADD CONSTRAINT raw_batches_approved_shortage_position_invariant
    CHECK (
      source_type<>'approved_shortage_aggregate' OR (
        warehouse_id IS NOT NULL AND quantity<=0
        AND approved_shortage_total_cost IS NOT NULL
        AND approved_shortage_total_cost>=0
        AND (quantity<0 OR approved_shortage_total_cost=0)
      )
    ) NOT VALID;
  END IF;
END;
$approved_shortage_check$;

-- This partial uniqueness uses the existing batch table. For approved
-- shortage positions only, each physical stock coordinate has one row.
-- Existing FIFO lots and OV-* batches are not re-keyed or updated.
CREATE UNIQUE INDEX IF NOT EXISTS raw_batches_one_approved_shortage_position
ON public.raw_material_batches(branch_id,warehouse_id,raw_material_id)
WHERE source_type='approved_shortage_aggregate';

-- Keep old obligations as auditable history when explicitly converted. Never
-- fake a purchase receipt by changing their settled quantity.
ALTER TABLE public.raw_fifo_debts
 ADD COLUMN IF NOT EXISTS approved_conversion_batch_id uuid REFERENCES public.raw_material_batches(id),
 ADD COLUMN IF NOT EXISTS approved_converted_at timestamptz;
-- Keep receipt/batch removal from scanning archived obligations.
CREATE INDEX IF NOT EXISTS raw_fifo_debts_approved_conversion_batch
 ON public.raw_fifo_debts(approved_conversion_batch_id)
 WHERE approved_conversion_batch_id IS NOT NULL;

-- One routing marker per coordinate, or one branch-wide default after every
-- old coordinate in that branch is reconciled. No per-sale state table.
CREATE TABLE IF NOT EXISTS private.raw_cost_v2_activated_coordinates (
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
 raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
 activated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 activation_note text NOT NULL DEFAULT '',
 UNIQUE NULLS NOT DISTINCT(branch_id,warehouse_id,raw_material_id),
 CHECK((warehouse_id IS NULL)=(raw_material_id IS NULL))
);
REVOKE ALL ON private.raw_cost_v2_activated_coordinates FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.raw_last_price_enabled(p_branch uuid,p_warehouse uuid,p_raw uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
  WHERE a.branch_id=p_branch AND ((a.warehouse_id IS NULL AND a.raw_material_id IS NULL)
   OR (a.warehouse_id=p_warehouse AND a.raw_material_id=p_raw)));
$$;
REVOKE ALL ON FUNCTION private.raw_last_price_enabled(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- No background queues / public RPCs / new application privileges.
-- NO canonical writer is redirected by this standalone candidate.

-- Source: scripts/db/candidates/raw_last_price_shared_resolver_20261104.sql
-- One canonical resolver body, with a closed owner-only operational mode.
-- Report invokers retain invoice visibility and source RLS. Authorized writers
-- resolve the same completed purchase/approved price independently of browsing.
DO $shared_resolver$
DECLARE s text; original text; old text;
BEGIN
 SELECT pg_get_functiondef('private.raw_approved_price_visible(text,text,uuid,uuid,uuid)'::regprocedure) INTO original;
 IF md5(original)<>'35b70047bc97a81c11871a1ca83cb2bc' THEN RAISE EXCEPTION 'RAW_SOURCE_VISIBILITY_DRIFT'; END IF;
 s:=regexp_replace(original,'CREATE OR REPLACE FUNCTION private.raw_approved_price_visible\([^)]*\)',
  'CREATE OR REPLACE FUNCTION private.raw_approved_price_visible_mode(p_kind text,p_source_id text,p_parent_id uuid,p_raw uuid,p_branch uuid,p_operational boolean)');
 s:=replace(s,'SELECT CASE','SELECT (NOT p_operational OR current_user IN (''postgres'',''service_role'')) AND CASE');
 old:='((auth.uid() IS NULL AND current_user IN (''postgres'',''service_role'')) OR private.financial_row_visible(p.id,p.branch_id,p.created_at))';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_SOURCE_FINANCIAL_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'((p_operational AND current_user IN (''postgres'',''service_role'')) OR '||old||')');
 EXECUTE s;
 EXECUTE $wrapper$CREATE OR REPLACE FUNCTION private.raw_approved_price_visible(p_kind text,p_source_id text,p_parent_id uuid,p_raw uuid,p_branch uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT private.raw_approved_price_visible_mode(p_kind,p_source_id,p_parent_id,p_raw,p_branch,false);$f$$wrapper$;

 SELECT pg_get_functiondef('private.latest_approved_raw_prices(uuid,uuid[],timestamptz)'::regprocedure) INTO original;
 IF md5(original)<>'4907c536c382a105a3ca5ed12a1e61c4' THEN RAISE EXCEPTION 'RAW_CANONICAL_RESOLVER_DRIFT'; END IF;
 s:=regexp_replace(original,'CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices\([^)]*\)',
  'CREATE OR REPLACE FUNCTION private.resolve_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz,p_operational boolean)');
 old:='private.raw_approved_price_visible(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_CANONICAL_SOURCE_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'private.raw_approved_price_visible_mode(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id,p_operational)');
 old:='WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_CANONICAL_SCOPE_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,'WHERE (NOT p_operational OR current_user IN (''postgres'',''service_role'')) AND (p_branch_id IS NULL OR rm.branch_id=p_branch_id)');
 EXECUTE s;
 EXECUTE $wrapper$CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
 RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT * FROM private.resolve_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of,false);$f$$wrapper$;

 SELECT pg_get_functiondef('private.stock_count_raw_price(uuid,uuid[],timestamptz)'::regprocedure) INTO s;
 old:='private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of)';
 IF position(old IN s)=0 THEN RAISE EXCEPTION 'RAW_INTERNAL_PRICE_ANCHOR_DRIFT'; END IF;
 EXECUTE replace(s,old,'private.resolve_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of,true)');
END $shared_resolver$;
REVOKE ALL ON FUNCTION private.raw_approved_price_visible_mode(text,text,uuid,uuid,uuid,boolean),
 private.resolve_approved_raw_prices(uuid,uuid[],timestamptz,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.raw_approved_price_visible_mode(text,text,uuid,uuid,uuid,boolean),
 private.resolve_approved_raw_prices(uuid,uuid[],timestamptz,boolean) TO authenticated,service_role;
-- Source: scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql
-- Remove the previous internal overloads to keep default-argument calls unambiguous.
DROP FUNCTION IF EXISTS private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz);
-- UNWIRED disposable-Postgres prototype, NEVER a production migration.
-- Requires scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql
-- See docs/RAW_COST_ENGINE_V2_APPROVED_PRICE_20261031.md.
-- All functions remain in private schema and have no new public invoker.
-- Internal wrappers in production MUST authenticate/authorize the full
-- branch/warehouse movement before ever calling these helpers.
CREATE OR REPLACE FUNCTION private.raw_issue_approved_v2(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_entry_type text,p_reference_type text,p_reference_id uuid,
  p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL,
  p_valuation_as_of timestamptz DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_frozen_price jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_price record;
  v_batch record;
  v_qty numeric(18,6);
  v_take numeric(18,6);
  v_before numeric(18,6);
  v_running numeric(18,6);
  v_batch_no text;
  v_shortage_basis numeric(20,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  v_ledger_id bigint;
  v_count_deficit_batch uuid;
  -- Keep legacy document-date correction matching on the transaction clock.
  -- Price observation has its own wall-clock provenance below.
  v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
    WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  -- Existing batch, stock-count and ledger quantity columns use four decimals.
  -- Normalize once, before both physical and monetary writes, and return the
  -- actual quantity so kitchen snapshots do not promise a different amount.
  p_qty:=round(p_qty,4);
  IF p_qty=0 THEN
    RETURN jsonb_build_object('success',true,'quantity',0,'shortage',0,'removed',0,
      'oversold',0,'total_cost',0,'avg_cost',0);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=p_raw_material_id
      AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
      AND d.settled_quantity<d.debt_quantity
      AND d.approved_converted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
      AND b.branch_id=p_branch_id AND b.quantity<0
      AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_price;
  ELSE
  -- Same canonical projection as counts, including a real numeric zero.
  -- NULL cutoff is a current lookup, retaining known undated source prices.
  -- A known undated current source is observed now, never backdated into history.
  SELECT p.unit_cost,p.price_source,COALESCE(p.priced_at,v_now) priced_at,
    p.reference_number INTO v_price
  FROM private.stock_count_raw_price(
    p_branch_id,ARRAY[p_raw_material_id],p_valuation_as_of) p
  WHERE raw_material_id=p_raw_material_id;
  END IF;
  IF v_price.unit_cost IS NULL OR v_price.unit_cost<0
    OR v_price.priced_at IS NULL
    OR v_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero') THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RAW_PRICE_UNAVAILABLE');
  END IF;
  SELECT COALESCE(SUM(quantity),0) INTO v_before
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;
  v_running:=v_before;
  v_qty:=p_qty;

  FOR v_batch IN
    SELECT b.id,b.batch_number,b.quantity,b.expiry_date
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.branch_id=p_branch_id
      AND b.warehouse_id=p_warehouse_id AND b.quantity>0
    ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_qty<=0;
    v_take:=LEAST(v_qty,v_batch.quantity);
    UPDATE public.raw_material_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
    IF p_reference_type IS DISTINCT FROM 'stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_take,
      -- Allocate currency rounding cumulatively across the physical lots.
      -- Summed ledger money must equal one rounded raw movement amount.
      v_price.unit_cost,
      round((v_before-v_running)*v_price.unit_cost,2)
        -round((v_before-v_running+v_take)*v_price.unit_cost,2),
      v_running,v_running-v_take,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,transaction_timestamp()),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    );
    END IF;
    v_running:=v_running-v_take;
    v_qty:=v_qty-v_take;
  END LOOP;

  IF v_qty>0 THEN
    IF p_reference_type='stock_count' AND NOT private.raw_last_price_enabled(p_branch_id,p_warehouse_id,p_raw_material_id) THEN
      INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,source_id)
      VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,'SC-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
        -v_qty,v_price.unit_cost,'stock_count_oversold',p_reference_id)
      RETURNING id,batch_number INTO v_count_deficit_batch,v_batch_no;
    ELSE
    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,
      source_type,source_id,approved_shortage_total_cost
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,
      'AS-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
      -v_qty,v_price.unit_cost,NULL,NULL,'approved_shortage_aggregate',NULL,
      v_qty*v_price.unit_cost
    )
    ON CONFLICT(branch_id,warehouse_id,raw_material_id)
      WHERE source_type='approved_shortage_aggregate'
    DO UPDATE SET
      quantity=public.raw_material_batches.quantity+EXCLUDED.quantity,
      approved_shortage_total_cost=
        public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost,
      unit_cost=(public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost)
        / abs(public.raw_material_batches.quantity+EXCLUDED.quantity)
    RETURNING batch_number INTO v_batch_no;

    END IF;

    IF p_reference_type IS DISTINCT FROM 'stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,-v_qty,
      v_price.unit_cost,
      round((v_before-v_running)*v_price.unit_cost,2)
        -round(p_qty*v_price.unit_cost,2),
      v_running,v_running-v_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,transaction_timestamp()),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    END IF;
  END IF;

  -- One monetary movement per counted raw material. Lot-level rounding
  -- must not create a different total from the count and its journal.
  IF p_reference_type='stock_count' THEN
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,
      before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,NULL,-p_qty,v_price.unit_cost,-round(p_qty*v_price.unit_cost,2),
      v_before,v_before-p_qty,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,COALESCE(p_effective_at,transaction_timestamp()),
      'approved_last_known',v_price.price_source,v_price.priced_at,v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    IF v_count_deficit_batch IS NOT NULL THEN
      INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,
        reference_type,reference_id,reference_number,debt_quantity,source_created_at)
      VALUES(v_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,v_count_deficit_batch,
        p_reference_type,p_reference_id,p_reference_number,v_qty,COALESCE(p_effective_at,transaction_timestamp()));
    END IF;
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  RETURN jsonb_build_object(
    'success',true,'quantity',p_qty,'shortage',0,
    'removed',CASE WHEN p_reference_type='stock_count' THEN p_qty ELSE p_qty-v_qty END,
    'oversold',v_qty,
    'total_cost',round(p_qty*v_price.unit_cost,2),'avg_cost',v_price.unit_cost,
    'approved_price_source',v_price.price_source,'approved_price_at',v_price.priced_at,
    'approved_price_ref',v_price.reference_number,
    'warehouse_id',p_warehouse_id,'shortage_ledger_id',v_ledger_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION private.raw_receive_approved_v2(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_receipt_unit_cost numeric,p_entry_type text,p_reference_type text,p_reference_id uuid,
  p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL,
  p_valuation_as_of timestamptz DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_frozen_price jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_shortage public.raw_material_batches%ROWTYPE;
  v_approved_price record;
  v_approved_price_source text;
  v_approved_priced_at timestamptz;
  v_approved_price_ref text;
  v_shortage_absorbed numeric(18,6):=0;
  v_shortage_basis numeric(20,6):=0;
  v_variance numeric(20,6):=0;
  v_posted_variance numeric(18,2);
  v_available_after numeric(18,6);
  v_before numeric(18,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  -- Keep legacy document-date correction matching on the transaction clock.
  -- Price observation has its own wall-clock provenance below.
  v_now timestamptz:=statement_timestamp();
  v_batch_no text;
  v_receipt_ledger bigint;
  v_receipt_batch uuid;
  v_journal uuid;
  v_journal_number text;
  v_variance_account uuid;
  v_inventory_account uuid;
  v_variance_reference uuid;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_receipt_unit_cost IS NULL
     OR p_receipt_unit_cost<0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
      WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
      WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  p_qty:=round(p_qty,4);
  IF p_qty=0 THEN
    RETURN jsonb_build_object('success',true,'quantity',0,'warehouse_id',p_warehouse_id,
      'approved_shortage_absorbed',0,'approved_price_variance_posted',0);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d WHERE d.raw_material_id=p_raw_material_id
    AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
    AND d.settled_quantity<d.debt_quantity AND d.approved_converted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
      WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
        AND b.branch_id=p_branch_id AND b.quantity<0
        AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  -- Stock-count receipts must use the very same historically approved price
  -- as the posting RPC and persist the source on the physical ledger.
  IF p_reference_type='stock_count' THEN
    IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_approved_price;
    ELSE
    SELECT * INTO v_approved_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
    END IF;
    IF v_approved_price.unit_cost IS NULL OR v_approved_price.unit_cost<0
       OR v_approved_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero')
       OR v_approved_price.unit_cost IS DISTINCT FROM p_receipt_unit_cost THEN
      RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_PRICE_MISMATCH');
    END IF;
    v_approved_price_source:=v_approved_price.price_source;
    v_approved_priced_at:=v_approved_price.priced_at;
    v_approved_price_ref:=v_approved_price.reference_number;
  END IF;
  SELECT COALESCE(sum(quantity),0) INTO v_before FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;

  SELECT * INTO v_shortage FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id AND source_type='approved_shortage_aggregate'
    FOR UPDATE;
  IF v_shortage.id IS NOT NULL AND v_shortage.quantity<0 THEN
    v_shortage_absorbed:=LEAST(p_qty,abs(v_shortage.quantity));
    v_shortage_basis:=v_shortage_absorbed
      *(v_shortage.approved_shortage_total_cost/abs(v_shortage.quantity));
    v_variance:=v_shortage_absorbed*p_receipt_unit_cost-v_shortage_basis;
    UPDATE public.raw_material_batches SET
      quantity=v_shortage.quantity+v_shortage_absorbed,
      approved_shortage_total_cost=GREATEST(
        v_shortage.approved_shortage_total_cost-v_shortage_basis,0),
      unit_cost=CASE WHEN v_shortage.quantity+v_shortage_absorbed<0
        THEN GREATEST(v_shortage.approved_shortage_total_cost-v_shortage_basis,0)
            /abs(v_shortage.quantity+v_shortage_absorbed)
        ELSE 0 END
    WHERE id=v_shortage.id;
  END IF;
  v_available_after:=p_qty-v_shortage_absorbed;
  v_batch_no:='AR-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  INSERT INTO public.raw_material_batches(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    source_type,source_id
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    v_available_after,p_receipt_unit_cost,COALESCE(p_reference_type,p_entry_type),p_reference_id
  ) RETURNING id INTO v_receipt_batch;
  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,
    reference_number,created_by,created_at,
    approved_cost_basis,approved_price_source,approved_price_at,
    approved_price_ref,approved_cost_recorded_at
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,
    p_receipt_unit_cost,p_qty*p_receipt_unit_cost,v_before,v_before+p_qty,
    p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,transaction_timestamp()),
    CASE WHEN p_reference_type='stock_count' THEN 'approved_last_known' ELSE NULL END,
    v_approved_price_source,v_approved_priced_at,
    v_approved_price_ref,
    CASE WHEN p_reference_type='stock_count' THEN v_now ELSE NULL END
  ) RETURNING id INTO v_receipt_ledger;

  IF p_reference_type='stock_count' AND coalesce((p_frozen_price->>'defer_quantity_offset')::boolean,false) IS NOT TRUE THEN
    PERFORM private.offset_stock_count_legacy_quantity(v_receipt_ledger,v_receipt_batch);
  END IF;
  v_posted_variance:=round(v_variance,2);
  IF abs(v_posted_variance)>=0.01 THEN
    SELECT account_id INTO v_variance_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='stock_variance';
    SELECT account_id INTO v_inventory_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='inventory_rm';
    IF v_variance_account IS NULL OR v_inventory_account IS NULL
      OR v_variance_account=v_inventory_account THEN
      RAISE EXCEPTION 'APPROVED_COST_ACCOUNT_MAPPING_MISSING branch=%',p_branch_id;
    END IF;
    v_variance_reference:=md5('approved-raw-shortage-receipt:'||v_receipt_ledger::text)::uuid;
    v_journal_number:=(public.next_document_number('journal')->>'number');
    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_journal_number,p_branch_id,(v_now AT TIME ZONE 'Africa/Cairo')::date,
      'approved_raw_shortage_variance',v_variance_reference,p_reference_number,
      'Frozen approved raw issue / actual receipt shortage variance '||v_receipt_ledger,
      p_created_by
    ) RETURNING id INTO v_journal;
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES(
      v_journal,v_variance_account,
      GREATEST(v_posted_variance,0),GREATEST(-v_posted_variance,0),
      'Approved shortage vs receipt cost'
    ),(
      v_journal,v_inventory_account,
      GREATEST(-v_posted_variance,0),GREATEST(v_posted_variance,0),
      'Raw warehouse inventory shortage offset'
    );
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
    INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();

  RETURN jsonb_build_object(
    'success',true,'quantity',p_qty,'warehouse_id',p_warehouse_id,
    'before_qty',v_before,'after_qty',v_before+p_qty,
    'approved_shortage_absorbed',v_shortage_absorbed,
    'approved_price_variance_exact',v_variance,
    'approved_price_variance_posted',v_posted_variance,
    'receipt_ledger_id',v_receipt_ledger,'journal_entry_id',v_journal
  );
END;
$fn$;

-- Deliberately NO SECURITY DEFINER, no public RPC, no API execute grant.
REVOKE ALL ON FUNCTION private.raw_issue_approved_v2(
 uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.raw_receive_approved_v2(
 uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
-- Source: scripts/db/candidates/approved_raw_cost_v2_coordinate_gate_20261031.sql
-- CANDIDATE ONLY. A default-OFF warehouse/material cutover gate.
-- Prerequisites: approved_raw_cost_engine_minimal_storage_20261031.sql and
-- approved_raw_cost_engine_v2_helpers_20261031.sql; general routing remains disabled.
-- IMPORTANT: never apply to a live customer project until kitchen/sales,
-- reversals, reports, accounting period and legacy FIFO conversion are released.

-- At most ONE durable cutover marker per warehouse/material, not a row
-- per sale, debt or inventory movement. No users can mutate the private table.
-- The storage candidate defines this empty marker table and its internal reader.
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
  IF (v_result->>'quantity')::numeric=0 THEN RETURN v_result; END IF;
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
  IF private.raw_last_price_enabled(p_branch_id,p_warehouse_id,p_raw_material_id) THEN
    IF p_allow_negative IS NOT TRUE AND
       (SELECT COALESCE(sum(quantity),0) FROM public.raw_material_batches
        WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
          AND warehouse_id=p_warehouse_id)<p_qty THEN
      RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_STOCK',
        'shortage',p_qty,'removed',0,'total_cost',0,'avg_cost',0);
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
  -- The lot adapter retains source batch identity and physical expiry dates.
  IF private.raw_last_price_enabled(p_branch_id,p_warehouse_id,p_raw_material_id) THEN
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
-- Source: scripts/db/candidates/raw_last_price_kitchen_snapshot_20261104.sql
-- Reuse the exact authorized movement snapshot; do not query price history twice.
DO $kitchen_movement_snapshot$
DECLARE s text; old text; newer text;
BEGIN
 SELECT pg_get_functiondef('public._deduct_kitchen_raw_components(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid)'::regprocedure) INTO s;
 IF md5(s)<>'7a004fec1a1854b71400978d1a29dc1f' THEN RAISE EXCEPTION 'RAW_COMPONENT_DEDUCT_SOURCE_DRIFT'; END IF;
 old:=$old$'quantity', v_row.required_qty,$old$;
 newer:=$new$'quantity', COALESCE((v_res->>'quantity')::numeric,v_row.required_qty),
      'unit_cost', (v_res->>'avg_cost')::numeric,
      'price_source', v_res->>'approved_price_source',
      'priced_at', v_res->>'approved_price_at',
      'price_reference', v_res->>'approved_price_ref',
      'cost_basis',CASE WHEN v_res ? 'approved_price_source' THEN 'approved_last_known' END,$new$;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'RAW_COMPONENT_QUANTITY_ANCHOR_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);

 SELECT pg_get_functiondef('public._capture_kitchen_ingredient_prices()'::regprocedure) INTO s;
 IF md5(s)<>'5ae433c7fd8b7564c2af20eb1dd8fdcb' THEN RAISE EXCEPTION 'KITCHEN_CAPTURE_SOURCE_DRIFT'; END IF;
 s:=replace(s,'  v_raw_ids uuid[];','  v_movement_prices jsonb := ''{}''::jsonb;'||chr(10)||'  v_raw_ids uuid[];');
 old:=$old$  SELECT array_agg(DISTINCT (component->>'raw_material_id')::uuid)$old$;
 newer:=$new$  -- Read the ledger already written for this event, using its reference index.
  -- No price-source scan; zero and the actual rounded movement amount survive.
  SELECT COALESCE(jsonb_object_agg(p.raw_material_id::text,p.snapshot),'{}'::jsonb)
  INTO v_movement_prices
  FROM (
    SELECT l.raw_material_id,jsonb_build_object(
      'unit_cost',max(l.unit_cost),'extended_cost',-sum(l.total_cost),
      'price_source',max(l.approved_price_source),'priced_at',max(l.approved_price_at),
      'price_reference',max(l.approved_price_ref),'cost_basis','approved_last_known',
      'quantity',-sum(l.quantity)) snapshot
    FROM public.inventory_ledger l
    WHERE l.reference_id=NEW.id AND l.reference_type='kitchen_send'
      AND l.branch_id=NEW.branch_id AND l.warehouse_id=NEW.warehouse_id
    GROUP BY l.raw_material_id
    HAVING bool_and(l.approved_cost_basis='approved_last_known')
      AND count(DISTINCT l.unit_cost)=1 AND count(DISTINCT l.approved_price_source)=1
  ) p;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.component_snapshot) c
    WHERE NOT(v_movement_prices ? (c->>'raw_material_id'))) THEN
    SELECT jsonb_agg(c||(v_movement_prices->(c->>'raw_material_id')) ORDER BY c->>'raw_material_id')
    INTO NEW.component_snapshot FROM jsonb_array_elements(NEW.component_snapshot) c;
    RETURN NEW;
  END IF;

$new$||old;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'KITCHEN_CAPTURE_EARLY_ANCHOR_DRIFT'; END IF;
 s:=replace(s,old,newer);
 old:=$old$    v_price := v_prices -> (v_component->>'raw_material_id');$old$;
 newer:=$new$    IF v_movement_prices ? (v_component->>'raw_material_id') THEN
      v_components:=v_components||jsonb_build_array(v_component||(v_movement_prices->(v_component->>'raw_material_id')));
      CONTINUE;
    END IF;
$new$||old;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'KITCHEN_CAPTURE_COMPONENT_ANCHOR_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);
END $kitchen_movement_snapshot$;
-- Source: scripts/db/candidates/raw_last_price_retire_legacy_tools_20261104.sql
-- Compatibility API keeps its authorization and JSON contract. After branch
-- cutover it uses the shared balance/price projection, without FIFO health scans.
DO $valuation_compatibility$
DECLARE s text; old text:='  RETURN ('; newer text;
BEGIN
 SELECT pg_get_functiondef('public.get_current_raw_material_valuation(uuid)'::regprocedure) INTO s;
 IF md5(s)<>'03833ef5b80d88cab0834735f1b1c462' THEN RAISE EXCEPTION 'RAW_VALUATION_COMPATIBILITY_SOURCE_DRIFT'; END IF;
 newer:=$new$  IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
   WHERE a.branch_id=p_branch_id AND a.warehouse_id IS NULL) THEN
   RETURN (
    WITH quantities AS MATERIALIZED(SELECT raw_material_id,sum(quantity) quantity
     FROM private.raw_stock_quantities WHERE branch_id=p_branch_id GROUP BY raw_material_id),
    prices AS MATERIALIZED(SELECT * FROM private.stock_count_raw_price(p_branch_id,NULL,NULL))
    SELECT coalesce(jsonb_agg(jsonb_build_object(
     'raw_material_id',rm.id,'raw_material_name',rm.name,'raw_material_code',rm.code,
     'unit_name',coalesce(u.name,''),'current_quantity',coalesce(q.quantity,0),
     'fifo_current_unit_cost',coalesce(p.unit_cost,0),
     'current_inventory_value',round(coalesce(q.quantity,0)*coalesce(p.unit_cost,0),2),
     'latest_authoritative_cost',coalesce(p.unit_cost,0),'price_source',p.price_source,'priced_at',p.priced_at,
     'valuation_basis','last_approved_price','open_fifo_batches',0,
     'outstanding_fifo_debt_quantity',0,'outstanding_fifo_debt_rows',0,
     'fifo_debt_warehouse_count',0,'fifo_debt_warehouses_without_receipt_history',0,
     'unpriced_fifo_debt_quantity',0,'fifo_debt_estimated_unit_cost',0,
     'estimated_fifo_debt_value',0,'fifo_debt_pricing_coverage_pct',100,
     'has_unpriced_fifo_debt',false,'has_missing_purchase_receipt_history',false,'fifo_debt_status','RETIRED'
    ) ORDER BY rm.name),'[]'::jsonb)
    FROM public.raw_materials rm LEFT JOIN quantities q ON q.raw_material_id=rm.id
    LEFT JOIN prices p ON p.raw_material_id=rm.id LEFT JOIN public.units u ON u.id=rm.unit_id
    WHERE rm.branch_id=p_branch_id AND(rm.is_active OR coalesce(q.quantity,0)<>0)
   );
  END IF;

$new$||old;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'RAW_VALUATION_RETURN_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);
END $valuation_compatibility$;

-- Old administrative replay tools remain for unconverted historical rehearsal;
-- they cannot prepare/apply/reverse a cost replay once cutover has started.
DO $retire_replay$
DECLARE f record; s text; old text:=chr(10)||'BEGIN'||chr(10); newer text;
BEGIN
 newer:=old||$new$ IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates) THEN
  RAISE EXCEPTION 'FIFO_RETIRED_USE_LAST_PRICE';
 END IF;
$new$;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN('raw_fifo_prepare_backfill','raw_fifo_apply_backfill',
   'raw_fifo_reverse_backfill','raw_fifo_price_fallback_prepare','raw_fifo_price_fallback_apply',
   'raw_fifo_price_fallback_reverse','raw_opening_cost_apply_repair','raw_opening_cost_reverse_repair')
 LOOP
  SELECT pg_get_functiondef(f.oid) INTO s;
  IF position(old IN s)=0 THEN RAISE EXCEPTION 'FIFO_REPLAY_ENTRY_DRIFT'; END IF;
  EXECUTE overlay(s placing newer from position(old IN s) for length(old));
 END LOOP;
END $retire_replay$;
-- Source: scripts/db/candidates/raw_last_price_cutover_20261104.sql
-- CANDIDATE ONLY. Owner-only, bounded, audited quantity conversion. Not a
-- production migration. No source cost, sale, journal or settlement rewrite.
CREATE OR REPLACE FUNCTION private.activate_raw_last_price_coordinate(
 p_branch uuid,p_warehouse uuid,p_raw uuid,p_expected_quantity numeric,
 p_expected_debts integer,p_expected_debt_quantity numeric
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid(); before_qty numeric; after_qty numeric;
 debt_count integer; debt_qty numeric; basis numeric; negative_qty numeric;
 debt_ids uuid[]; batch_ids uuid[]; new_batch uuid; changed integer;
BEGIN
 IF actor IS NULL OR NOT public.can_permission('inventory.count.apply')
  OR NOT public.user_may_access_branch(p_branch) THEN RAISE EXCEPTION 'CUTOVER_NOT_ALLOWED'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_debts IS NULL OR p_expected_debts<0
  OR p_expected_debts>500 OR p_expected_debt_quantity IS NULL OR p_expected_debt_quantity<0
  THEN RAISE EXCEPTION 'CUTOVER_INVALID_SNAPSHOT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse AND branch_id=p_branch AND is_active)
  OR NOT EXISTS(SELECT 1 FROM public.raw_materials WHERE id=p_raw AND branch_id=p_branch)
  THEN RAISE EXCEPTION 'CUTOVER_BRANCH_MISMATCH'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_raw::text||':'||p_branch::text,0))
  THEN RAISE EXCEPTION 'CUTOVER_STOCK_BUSY'; END IF;
 IF private.raw_last_price_enabled(p_branch,p_warehouse,p_raw) THEN
  RETURN jsonb_build_object('success',true,'already_active',true);
 END IF;
 SELECT coalesce(sum(quantity),0) INTO before_qty FROM public.raw_material_batches
  WHERE branch_id=p_branch AND warehouse_id=p_warehouse AND raw_material_id=p_raw;
 IF before_qty IS DISTINCT FROM p_expected_quantity THEN RAISE EXCEPTION 'CUTOVER_STOCK_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.raw_material_batches WHERE branch_id=p_branch
  AND warehouse_id=p_warehouse AND raw_material_id=p_raw AND source_type='approved_shortage_aggregate')
  THEN RAISE EXCEPTION 'CUTOVER_APPROVED_STATE_WITHOUT_MARKER'; END IF;

 SELECT count(*),coalesce(sum(d.debt_quantity-d.settled_quantity),0),array_agg(d.id ORDER BY d.id)
 INTO debt_count,debt_qty,debt_ids FROM (
  SELECT d.* FROM public.raw_fifo_debts d WHERE d.branch_id=p_branch
   AND d.warehouse_id=p_warehouse AND d.raw_material_id=p_raw
   AND d.settled_quantity<d.debt_quantity AND d.approved_converted_at IS NULL
   ORDER BY d.id LIMIT 501 FOR UPDATE
 ) d;
 IF debt_count>500 OR debt_count IS DISTINCT FROM p_expected_debts
  OR debt_qty IS DISTINCT FROM p_expected_debt_quantity THEN RAISE EXCEPTION 'CUTOVER_DEBT_CHANGED'; END IF;
 -- Original source rows are the monetary authority. This first conversion
 -- deliberately refuses a partially settled position rather than guessing
 -- which historical costs a partial settlement has already recognized.
 IF EXISTS(SELECT 1 FROM public.raw_fifo_debts WHERE id=ANY(debt_ids) AND settled_quantity<>0)
  THEN RAISE EXCEPTION 'CUTOVER_PARTIAL_POSITION_REQUIRES_RECONCILIATION'; END IF;
 PERFORM 1 FROM public.inventory_ledger s JOIN public.raw_fifo_debts d ON d.source_ledger_id=s.id
  WHERE d.id=ANY(debt_ids) ORDER BY s.id FOR UPDATE OF s;
 IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d LEFT JOIN public.inventory_ledger s ON s.id=d.source_ledger_id
  WHERE d.id=ANY(debt_ids) AND (s.id IS NULL OR s.raw_material_id IS DISTINCT FROM p_raw
   OR s.branch_id IS DISTINCT FROM p_branch OR s.warehouse_id IS DISTINCT FROM p_warehouse
   OR s.quantity>=0 OR abs(s.quantity)<d.debt_quantity OR s.unit_cost<0
   OR s.total_cost>0 OR (s.approved_cost_basis IS DISTINCT FROM 'approved_last_known'
    AND (s.unit_cost<>0 OR s.total_cost<>0))))
  THEN RAISE EXCEPTION 'CUTOVER_SOURCE_COST_REQUIRES_RECONCILIATION'; END IF;
 SELECT coalesce(sum((d.debt_quantity-d.settled_quantity)*s.unit_cost),0) INTO basis
 FROM public.raw_fifo_debts d JOIN public.inventory_ledger s ON s.id=d.source_ledger_id
 WHERE d.id=ANY(debt_ids);

 PERFORM 1 FROM public.raw_material_batches b WHERE b.branch_id=p_branch
  AND b.warehouse_id=p_warehouse AND b.raw_material_id=p_raw AND b.quantity<0
  ORDER BY b.id FOR UPDATE;
 SELECT coalesce(-sum(quantity),0),array_agg(id ORDER BY id) INTO negative_qty,batch_ids
 FROM public.raw_material_batches WHERE branch_id=p_branch AND warehouse_id=p_warehouse
  AND raw_material_id=p_raw AND quantity<0;
 IF negative_qty IS DISTINCT FROM debt_qty OR EXISTS(
  WITH d AS(SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) q FROM public.raw_fifo_debts
   WHERE id=ANY(debt_ids) GROUP BY oversold_batch_id)
  SELECT 1 FROM public.raw_material_batches b FULL JOIN d ON d.oversold_batch_id=b.id
  WHERE (b.id=ANY(batch_ids) OR d.oversold_batch_id IS NOT NULL)
   AND (b.id IS NULL OR d.oversold_batch_id IS NULL OR b.quantity IS DISTINCT FROM -d.q)
 ) THEN RAISE EXCEPTION 'CUTOVER_QUANTITY_UNRECONCILED'; END IF;
 IF debt_qty>0 THEN
  INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,
   quantity,unit_cost,source_type,approved_shortage_total_cost)
  VALUES(p_raw,p_branch,p_warehouse,'AS-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
   -debt_qty,basis/debt_qty,'approved_shortage_aggregate',basis) RETURNING id INTO new_batch;
  UPDATE public.raw_material_batches SET quantity=0 WHERE id=ANY(batch_ids);
  UPDATE public.raw_fifo_debts SET approved_conversion_batch_id=new_batch,
   approved_converted_at=statement_timestamp() WHERE id=ANY(debt_ids) AND approved_converted_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>debt_count THEN RAISE EXCEPTION 'CUTOVER_DEBT_WRITE_MISMATCH'; END IF;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO after_qty FROM public.raw_material_batches
  WHERE branch_id=p_branch AND warehouse_id=p_warehouse AND raw_material_id=p_raw;
 IF after_qty IS DISTINCT FROM before_qty THEN RAISE EXCEPTION 'CUTOVER_CHANGED_NET_STOCK'; END IF;
 INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,warehouse_id,raw_material_id,activation_note)
 VALUES(p_branch,p_warehouse,p_raw,'audited legacy quantity conversion; source costs and journals retained');
 INSERT INTO public.audit_log(user_id,action,entity,entity_id,branch_id,details)
 VALUES(actor,'update','raw_materials',p_raw,p_branch,jsonb_build_object(
  'kind','raw_last_price_coordinate_cutover','warehouse_id',p_warehouse,
  'quantity_before',before_qty,'quantity_after',after_qty,'debt_quantity',debt_qty,
  'frozen_shortage_basis',basis,'legacy_debt_ids',debt_ids,'legacy_batch_ids',batch_ids,
  'aggregate_batch_id',new_batch,'legacy_settled_quantity_unchanged',true));
 RETURN jsonb_build_object('success',true,'already_active',false,'quantity',after_qty,
  'converted_debts',debt_count,'shortage_quantity',debt_qty,'frozen_basis',basis);
END;
$$;
REVOKE ALL ON FUNCTION private.activate_raw_last_price_coordinate(uuid,uuid,uuid,numeric,integer,numeric)
 FROM PUBLIC,anon,authenticated,service_role;

-- A legacy receipt/repair must never consume an archived obligation a second time.
DO $skip_archived$
DECLARE s text; old text:='AND d.settled_quantity<d.debt_quantity';
BEGIN
 SELECT pg_get_functiondef('public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure) INTO s;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'CUTOVER_RECEIPT_SOURCE_DRIFT'; END IF;
 EXECUTE replace(s,old,old||' AND d.approved_converted_at IS NULL');
END $skip_archived$;

-- Cutover is additive. After new movements, deleting its marker is not a
-- valid rollback: old writers would ignore the aggregate shortage accounting.
CREATE OR REPLACE FUNCTION private.guard_raw_last_price_cutover_history()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'RAW_LAST_PRICE_CUTOVER_HISTORY_IMMUTABLE';
END;
$$;
REVOKE ALL ON FUNCTION private.guard_raw_last_price_cutover_history()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER raw_last_price_marker_immutable
 BEFORE UPDATE OR DELETE ON private.raw_cost_v2_activated_coordinates
 FOR EACH ROW EXECUTE FUNCTION private.guard_raw_last_price_cutover_history();
CREATE TRIGGER raw_converted_debt_immutable
 BEFORE UPDATE OR DELETE ON public.raw_fifo_debts
 FOR EACH ROW WHEN (OLD.approved_converted_at IS NOT NULL)
 EXECUTE FUNCTION private.guard_raw_last_price_cutover_history();

-- Old repair tools cannot retroactively reprice converted sale/count sources.
-- INSERTs and ordinary movements incur no extra lookup; the existing unique
-- source_ledger_id index supports only the exceptional cost correction check.
CREATE OR REPLACE FUNCTION private.guard_raw_converted_source_cost()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d
  WHERE d.source_ledger_id=OLD.id AND d.approved_converted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'RAW_CONVERTED_SOURCE_COST_IMMUTABLE';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_raw_converted_source_cost()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER raw_converted_source_cost_immutable
 BEFORE UPDATE OF unit_cost,total_cost ON public.inventory_ledger
 FOR EACH ROW WHEN (OLD.unit_cost IS DISTINCT FROM NEW.unit_cost OR OLD.total_cost IS DISTINCT FROM NEW.total_cost)
 EXECUTE FUNCTION private.guard_raw_converted_source_cost();

-- Final branch default covers later materials/warehouses without creating a
-- per-sale marker. Only enable after every old negative coordinate is converted.
CREATE OR REPLACE FUNCTION private.finalize_raw_last_price_branch(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); material uuid;
BEGIN
 IF actor IS NULL OR NOT public.can_permission('inventory.count.apply')
  OR NOT public.user_may_access_branch(p_branch) THEN RAISE EXCEPTION 'CUTOVER_NOT_ALLOWED'; END IF;
 IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates
  WHERE branch_id=p_branch AND warehouse_id IS NULL AND raw_material_id IS NULL) THEN
  RETURN jsonb_build_object('success',true,'already_active',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch) THEN RAISE EXCEPTION 'CUTOVER_BRANCH_MISMATCH'; END IF;
 -- NOWAIT: fail promptly rather than queue behind a sale or catalog change.
 LOCK TABLE public.raw_materials IN SHARE MODE NOWAIT;
 FOR material IN SELECT id FROM public.raw_materials WHERE branch_id=p_branch ORDER BY id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(material::text||':'||p_branch::text,0)) THEN
   RAISE EXCEPTION 'CUTOVER_STOCK_BUSY';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.raw_fifo_debts WHERE branch_id=p_branch
  AND settled_quantity<debt_quantity AND approved_converted_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.raw_material_batches WHERE branch_id=p_branch
   AND quantity<0 AND source_type<>'approved_shortage_aggregate') THEN
  RAISE EXCEPTION 'CUTOVER_BRANCH_LEGACY_POSITION_REMAINS';
 END IF;
 INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,activation_note)
 VALUES(p_branch,'all legacy negatives reconciled; new raw coordinates use last price');
 INSERT INTO public.audit_log(user_id,action,entity,entity_id,branch_id,details)
 VALUES(actor,'update','branches',p_branch,p_branch,jsonb_build_object('kind','raw_last_price_branch_cutover'));
 RETURN jsonb_build_object('success',true,'already_active',false);
END;
$$;
REVOKE ALL ON FUNCTION private.finalize_raw_last_price_branch(uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Source: scripts/db/candidates/raw_last_price_count_compatibility_20261104.sql
-- CANDIDATE ONLY. Retain count effective dates and the existing quantity source.
-- Ignore explicitly archived legacy positions; aggregate shortage is already
-- included in the same signed-batch SUM and must not require a fake FIFO debt.
CREATE OR REPLACE FUNCTION private.validate_count_legacy_quantity(p_raw uuid,p_branch uuid,p_warehouse uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(
  WITH debt AS MATERIALIZED(
   SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) qty
   FROM public.raw_fifo_debts WHERE raw_material_id=p_raw AND branch_id=p_branch
    AND warehouse_id=p_warehouse AND settled_quantity<debt_quantity AND approved_converted_at IS NULL
   GROUP BY oversold_batch_id
  ),negative AS MATERIALIZED(
   SELECT id,quantity FROM public.raw_material_batches WHERE raw_material_id=p_raw
    AND branch_id=p_branch AND warehouse_id=p_warehouse AND quantity<0
    AND source_type<>'approved_shortage_aggregate'
  ) SELECT 1 FROM negative b FULL JOIN debt d ON d.oversold_batch_id=b.id
   WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
 ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_count_legacy_quantity(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $count_group_validation$
DECLARE s text; old text; newer text;
BEGIN
 SELECT pg_get_functiondef('private.apply_raw_stock_count_last_price(uuid)'::regprocedure) INTO s;
 old:='AND d.settled_quantity<d.debt_quantity';
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_DEBT_SOURCE_DRIFT'; END IF;
 s:=replace(s,old,old||' AND d.approved_converted_at IS NULL');
 old:='AND b.warehouse_id=v_count.warehouse_id AND b.quantity<0';
 newer:=old||' AND b.source_type<>''approved_shortage_aggregate''';
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_BATCH_SOURCE_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);
END $count_group_validation$;

DO $count_cleanup_archives$
DECLARE s text; old text:='AND f.settled_quantity<f.debt_quantity';
BEGIN
 SELECT pg_get_functiondef('private.offset_stock_count_legacy_quantity(bigint,uuid)'::regprocedure) INTO s;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_CLEANUP_SOURCE_DRIFT'; END IF;
 EXECUTE replace(s,old,old||' AND f.approved_converted_at IS NULL');
END $count_cleanup_archives$;
-- Source: scripts/db/candidates/raw_last_price_new_branch_defaults_20261104.sql
-- Installed disabled. Enable only in the final, guarded all-branch cutover step.
-- A brand-new branch has no historical stock/FIFO obligations to reconcile.
CREATE FUNCTION private.raw_last_price_new_branch_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL AND coalesce(current_setting('role',true),'') NOT IN('service_role','none') THEN
  RAISE EXCEPTION 'AUTH_REQUIRED';
 END IF;
 INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,activation_note)
 VALUES(NEW.id,'new branch created after global last-price cutover');
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.raw_last_price_new_branch_default() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER raw_last_price_new_branch_default AFTER INSERT ON public.branches
 FOR EACH ROW EXECUTE FUNCTION private.raw_last_price_new_branch_default();
ALTER TABLE public.branches DISABLE TRIGGER raw_last_price_new_branch_default;
-- Source: scripts/db/candidates/raw_last_price_backend_compatibility_20261104.sql
-- Existing raw adapters are INVOKER and are already executable by the trusted
-- service backend. Preserve that server contract without granting any helper
-- or activation-table access to authenticated/anon clients.
GRANT SELECT ON private.raw_cost_v2_activated_coordinates TO service_role;
GRANT EXECUTE ON FUNCTION private.raw_last_price_enabled(uuid,uuid,uuid),
 private.stock_count_raw_price(uuid,uuid[],timestamptz),
 private.validate_count_legacy_quantity(uuid,uuid,uuid),
 private.offset_stock_count_legacy_quantity(bigint,uuid),
 private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb),
 private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb),
 private.raw_receive_approved_v2_lot(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,text,date,date)
 TO service_role;
-- Owner-only activation functions and all mutation rights on the routing table
-- stay revoked from service_role; no new PUBLIC or browser API is introduced.
-- Source: scripts/db/candidates/raw_last_price_transfer_context_20261104.sql
-- The transfer RPC already authorizes source/receiver branches and approval.
-- Its quote/receipt must use the same trusted operational price as raw issues,
-- independently of permission to browse old purchase invoices. Report visibility
-- remains unchanged, including existing nested financial-context readers.
DO $transfer_price_context$
DECLARE f text; s text; old text:='private.latest_approved_raw_prices(';
BEGIN
 FOREACH f IN ARRAY ARRAY['public.create_warehouse_transfer(uuid,uuid,uuid,jsonb,text,text)',
   'public.approve_warehouse_transfer(uuid)'] LOOP
  SELECT pg_get_functiondef(f::regprocedure) INTO s;
  IF (f LIKE '%create_%' AND md5(s)<>'7e7570f8dff786aaf7d88fffe84379a9')
   OR (f LIKE '%approve_%' AND md5(s)<>'774587865931c3f7314eece4973d338c') THEN
   RAISE EXCEPTION 'TRANSFER_OPERATIONAL_PRICE_BASELINE_DRIFT';
  END IF;
  IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN
   RAISE EXCEPTION 'TRANSFER_OPERATIONAL_PRICE_SOURCE_DRIFT:%',f;
  END IF;
  EXECUTE replace(s,old,'private.stock_count_raw_price(');
 END LOOP;
END $transfer_price_context$;

COMMIT;
