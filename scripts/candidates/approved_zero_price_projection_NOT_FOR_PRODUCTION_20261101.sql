-- SOURCE CANDIDATE ONLY. DO NOT DEPLOY OR RUN ON CUSTOMER DATA.
-- Extend the EXISTING price projection; do not create a second price engine.
-- Explicit historical zero-price source events must survive and be distinguishable
-- from NULL/unpriced. Requires a disposable-DB rehearsal and financial audit.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

DO $guard$
DECLARE v_fn text;
BEGIN
 SELECT pg_get_functiondef('private.sync_raw_approved_price_source()'::regprocedure) INTO v_fn;
 IF position('COALESCE(v_cost,0)<=0' IN v_fn)=0 THEN
   RAISE EXCEPTION 'APPROVED_ZERO_SOURCE_TRIGGER_DRIFT';
 END IF;
END $guard$;

ALTER TABLE private.raw_approved_price_read_model
 DROP CONSTRAINT IF EXISTS raw_approved_price_read_model_unit_cost_check;
ALTER TABLE private.raw_approved_price_read_model
 ADD CONSTRAINT raw_approved_price_read_model_unit_cost_check CHECK (unit_cost>=0) NOT VALID;

DO $replace_sync$
DECLARE s text;
BEGIN
 SELECT pg_get_functiondef('private.sync_raw_approved_price_source()'::regprocedure) INTO s;
 IF position('COALESCE(v_cost,0)<=0' IN s)=0 THEN
  RAISE EXCEPTION 'APPROVED_ZERO_SOURCE_TRIGGER_DRIFT';
 END IF;
 s:=replace(s,'COALESCE(v_cost,0)<=0','(v_cost IS NULL OR v_cost<0)');
 EXECUTE s;
END $replace_sync$;

-- Backfill only genuinely existing, timestamped zero price events, retaining
-- original source identity. The projection visibility function still governs use.
INSERT INTO private.raw_approved_price_read_model(
 source_kind,source_id,raw_material_id,branch_id,unit_cost,priced_at,
 reference_number,parent_id,source_rank,source_created_at,purchase_quantity,purchase_unit
)
SELECT 'raw_material_price_events',p.id::text,p.raw_material_id,p.branch_id,
 p.unit_cost,p.priced_at,p.reference_number,NULL::uuid,1,NULL::timestamptz,
 NULL::numeric,NULL::text
FROM public.raw_material_price_events p WHERE p.unit_cost=0 AND p.priced_at IS NOT NULL
ON CONFLICT(source_kind,source_id) DO NOTHING;

-- Other source kinds (purchases/stock counts) need source-specific zero-price
-- provenance tests before any broader backfill. No fabricated source events.
COMMIT;
