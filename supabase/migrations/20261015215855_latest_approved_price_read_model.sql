-- Owner-approved latest approved price, isolated from FIFO stock/accounting.
-- Promotion requires localhost regression, security, performance and rollback proof.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_raw_material_current_prices(uuid,uuid[])'::regprocedure))<>'c883a34810a148b89f8fb3d7069220c2'
 OR md5(pg_get_functiondef('public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)'::regprocedure))<>'cc3b92de1c8c95471fcfee7372fcccf2'
 THEN RAISE EXCEPTION 'LATEST_PRICE_BASELINE_CHANGED'; END IF;
END $guard$;

-- A compact price-only projection, not a copy of FIFO batches/issues. Keeping
-- approved source identities preserves per-user financial visibility, old as-of
-- snapshots, cancellations and deterministic ties without a contended last-row lock.
CREATE TABLE private.raw_approved_price_read_model (
 source_kind text NOT NULL CHECK(source_kind IN ('inventory_ledger','purchase_items','stock_count_items','raw_material_price_events')),
 source_id text NOT NULL,
 raw_material_id uuid NOT NULL,
 branch_id uuid NOT NULL,
 unit_cost numeric NOT NULL CHECK(unit_cost>0),
 priced_at timestamptz,
 reference_number text,
 parent_id uuid,
 source_rank integer NOT NULL,
 source_created_at timestamptz,
 purchase_quantity numeric,
 purchase_unit text,
 event_id text GENERATED ALWAYS AS (CASE source_kind WHEN 'purchase_items' THEN 'legacy-purchase:'||source_id WHEN 'raw_material_price_events' THEN 'pricing:'||source_id ELSE source_id END) STORED,
 PRIMARY KEY(source_kind,source_id)
);
CREATE INDEX raw_approved_price_latest ON private.raw_approved_price_read_model
 (branch_id,raw_material_id,priced_at DESC NULLS LAST,source_rank,
 reference_number DESC NULLS LAST,event_id DESC);
CREATE INDEX raw_approved_price_parent ON private.raw_approved_price_read_model(parent_id,source_kind);
ALTER TABLE private.raw_approved_price_read_model ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_approved_price_read_model FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.raw_approved_price_read_model TO authenticated,service_role;

CREATE FUNCTION private.raw_approved_price_visible(p_kind text,p_source_id text,p_parent_id uuid,p_raw uuid,p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT CASE
 WHEN p_kind IN ('inventory_ledger','purchase_items') THEN EXISTS (
  SELECT 1 FROM public.purchases p WHERE p.id=p_parent_id AND p.branch_id=p_branch AND p.status='completed'
  AND ((auth.uid() IS NULL AND current_user IN ('postgres','service_role')) OR private.financial_row_visible(p.id,p.branch_id,p.created_at))
  AND (p_kind<>'purchase_items' OR NOT EXISTS (
   SELECT 1 FROM public.inventory_ledger il WHERE il.reference_id=p.id AND il.reference_type='purchase'
    AND il.entry_type='purchase' AND il.raw_material_id=p_raw)))
 WHEN p_kind='stock_count_items' THEN EXISTS (
  SELECT 1 FROM public.stock_counts sc WHERE sc.id=p_parent_id AND sc.branch_id=p_branch AND sc.status='applied')
 WHEN p_kind='raw_material_price_events' THEN EXISTS (
  SELECT 1 FROM public.raw_material_price_events pe WHERE pe.id=p_source_id::uuid AND pe.raw_material_id=p_raw AND pe.branch_id=p_branch)
 ELSE false END;
$f$;
REVOKE ALL ON FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.raw_approved_price_visible(text,text,uuid,uuid,uuid) TO authenticated,service_role;
CREATE POLICY raw_approved_price_select ON private.raw_approved_price_read_model FOR SELECT TO authenticated,service_role
 USING (EXISTS(SELECT 1 FROM public.raw_materials rm WHERE rm.id=raw_approved_price_read_model.raw_material_id AND rm.branch_id=raw_approved_price_read_model.branch_id)
 AND private.raw_approved_price_visible(source_kind,source_id,parent_id,raw_material_id,branch_id));

-- Maintenance is trigger-only, has no caller-controlled arguments, and is never
-- callable by app roles. It can only mirror the source row of its attached table.
-- Read APIs remain INVOKER and keep both source RLS and explicit financial checks.
CREATE FUNCTION private.sync_raw_approved_price_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
DECLARE v jsonb; v_branch uuid; v_parent uuid; v_date timestamptz; v_ref text; v_rank integer; v_cost numeric; v_created timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM private.raw_approved_price_read_model WHERE source_kind=TG_TABLE_NAME AND source_id=to_jsonb(OLD)->>'id';
  RETURN OLD;
 END IF;
 v:=to_jsonb(NEW); v_created:=(v->>'created_at')::timestamptz;
 v_cost:=(v->>'unit_cost')::numeric;
 IF v->>'raw_material_id' IS NULL OR COALESCE(v_cost,0)<=0
 OR (TG_TABLE_NAME='inventory_ledger' AND (v->>'entry_type' IS DISTINCT FROM 'purchase' OR v->>'reference_type' IS DISTINCT FROM 'purchase'))
 OR (TG_TABLE_NAME='purchase_items' AND COALESCE((v->>'quantity')::numeric,0)<=0) THEN
  DELETE FROM private.raw_approved_price_read_model WHERE source_kind=TG_TABLE_NAME AND source_id=v->>'id';
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='inventory_ledger' THEN
  v_parent:=(v->>'reference_id')::uuid; v_branch:=(v->>'branch_id')::uuid; v_date:=v_created; v_rank:=3;
  SELECT COALESCE(NULLIF(v->>'reference_number',''),p.invoice_number) INTO v_ref FROM public.purchases p WHERE p.id=v_parent;
 ELSIF TG_TABLE_NAME='purchase_items' THEN
  v_parent:=(v->>'purchase_id')::uuid; v_rank:=3;
  SELECT p.branch_id,COALESCE(p.approved_at,v_created,p.created_at),p.invoice_number INTO v_branch,v_date,v_ref FROM public.purchases p WHERE p.id=v_parent;
 ELSIF TG_TABLE_NAME='stock_count_items' THEN
  v_parent:=(v->>'stock_count_id')::uuid; v_rank:=2;
  SELECT sc.branch_id,COALESCE(sc.applied_at,sc.approved_at,sc.created_at),sc.count_number INTO v_branch,v_date,v_ref FROM public.stock_counts sc WHERE sc.id=v_parent;
 ELSE
  v_branch:=(v->>'branch_id')::uuid; v_date:=(v->>'priced_at')::timestamptz; v_ref:=v->>'reference_number'; v_rank:=1;
 END IF;
 IF v_branch IS NULL THEN
  DELETE FROM private.raw_approved_price_read_model WHERE source_kind=TG_TABLE_NAME AND source_id=v->>'id';
  RETURN NEW;
 END IF;
 INSERT INTO private.raw_approved_price_read_model(source_kind,source_id,raw_material_id,branch_id,unit_cost,priced_at,reference_number,parent_id,source_rank,source_created_at,purchase_quantity,purchase_unit)
 VALUES(TG_TABLE_NAME,v->>'id',(v->>'raw_material_id')::uuid,v_branch,v_cost,v_date,v_ref,v_parent,v_rank,v_created,
 CASE WHEN TG_TABLE_NAME='purchase_items' THEN (v->>'quantity')::numeric END,CASE WHEN TG_TABLE_NAME='purchase_items' THEN v->>'unit_name' END)
 ON CONFLICT(source_kind,source_id) DO UPDATE SET raw_material_id=EXCLUDED.raw_material_id,branch_id=EXCLUDED.branch_id,
 unit_cost=EXCLUDED.unit_cost,priced_at=EXCLUDED.priced_at,reference_number=EXCLUDED.reference_number,parent_id=EXCLUDED.parent_id,
 source_rank=EXCLUDED.source_rank,source_created_at=EXCLUDED.source_created_at,purchase_quantity=EXCLUDED.purchase_quantity,purchase_unit=EXCLUDED.purchase_unit;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.sync_raw_approved_price_source() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.sync_raw_approved_price_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM private.raw_approved_price_read_model WHERE parent_id=OLD.id AND
   ((TG_TABLE_NAME='purchases' AND source_kind IN('inventory_ledger','purchase_items')) OR (TG_TABLE_NAME='stock_counts' AND source_kind='stock_count_items'));
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='purchases' THEN
  UPDATE private.raw_approved_price_read_model c SET
   branch_id=CASE WHEN c.source_kind='purchase_items' THEN NEW.branch_id ELSE c.branch_id END,
   priced_at=CASE WHEN c.source_kind='purchase_items' THEN COALESCE(NEW.approved_at,c.source_created_at,NEW.created_at) ELSE c.priced_at END,
   reference_number=CASE WHEN c.source_kind='purchase_items' THEN NEW.invoice_number ELSE COALESCE(NULLIF(il.reference_number,''),NEW.invoice_number) END
  FROM (SELECT NULL::text AS reference_number,NULL::text AS source_id UNION ALL SELECT l.reference_number,l.id::text FROM public.inventory_ledger l WHERE l.reference_id=NEW.id AND l.reference_type='purchase' AND l.entry_type='purchase') il
  WHERE c.parent_id=NEW.id AND ((c.source_kind='purchase_items' AND il.source_id IS NULL) OR(c.source_kind='inventory_ledger' AND il.source_id=c.source_id));
 ELSE
  UPDATE private.raw_approved_price_read_model SET branch_id=NEW.branch_id,priced_at=COALESCE(NEW.applied_at,NEW.approved_at,NEW.created_at),reference_number=NEW.count_number
   WHERE parent_id=NEW.id AND source_kind='stock_count_items';
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.sync_raw_approved_price_parent() FROM PUBLIC,anon,authenticated,service_role;

-- Do not attach a generic ledger trigger to FIFO issues or debt reconciliation.
CREATE TRIGGER raw_price_source_insert AFTER INSERT ON public.inventory_ledger FOR EACH ROW
 WHEN(NEW.entry_type='purchase' AND NEW.reference_type='purchase' AND NEW.raw_material_id IS NOT NULL) EXECUTE FUNCTION private.sync_raw_approved_price_source();
CREATE TRIGGER raw_price_source_update AFTER UPDATE OF raw_material_id,branch_id,unit_cost,created_at,reference_number,reference_id,reference_type,entry_type ON public.inventory_ledger FOR EACH ROW
 WHEN((OLD.entry_type='purchase' AND OLD.reference_type='purchase') OR(NEW.entry_type='purchase' AND NEW.reference_type='purchase')) EXECUTE FUNCTION private.sync_raw_approved_price_source();
CREATE TRIGGER raw_price_source_delete AFTER DELETE ON public.inventory_ledger FOR EACH ROW
 WHEN(OLD.entry_type='purchase' AND OLD.reference_type='purchase') EXECUTE FUNCTION private.sync_raw_approved_price_source();
DO $triggers$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purchase_items','stock_count_items','raw_material_price_events'] LOOP
  EXECUTE format('CREATE TRIGGER raw_price_source_sync AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.sync_raw_approved_price_source()',t);
 END LOOP;
END $triggers$;
CREATE TRIGGER raw_price_parent_update AFTER UPDATE OF approved_at,created_at,branch_id,invoice_number ON public.purchases FOR EACH ROW EXECUTE FUNCTION private.sync_raw_approved_price_parent();
CREATE TRIGGER raw_price_parent_delete AFTER DELETE ON public.purchases FOR EACH ROW EXECUTE FUNCTION private.sync_raw_approved_price_parent();
CREATE TRIGGER raw_price_parent_update AFTER UPDATE OF applied_at,approved_at,created_at,branch_id,count_number ON public.stock_counts FOR EACH ROW EXECUTE FUNCTION private.sync_raw_approved_price_parent();
CREATE TRIGGER raw_price_parent_delete AFTER DELETE ON public.stock_counts FOR EACH ROW EXECUTE FUNCTION private.sync_raw_approved_price_parent();

-- One-time source projection. No batches, issues, stock balances or old costs change.
INSERT INTO private.raw_approved_price_read_model(source_kind,source_id,raw_material_id,branch_id,unit_cost,priced_at,reference_number,parent_id,source_rank,source_created_at,purchase_quantity,purchase_unit)
 SELECT 'inventory_ledger',il.id::text,il.raw_material_id,il.branch_id,il.unit_cost,il.created_at,COALESCE(NULLIF(il.reference_number,''),p.invoice_number),p.id,3,il.created_at,NULL::numeric,NULL::text
 FROM public.inventory_ledger il JOIN public.purchases p ON p.id=il.reference_id AND il.reference_type='purchase'
 WHERE il.entry_type='purchase' AND il.raw_material_id IS NOT NULL AND il.branch_id IS NOT NULL AND il.unit_cost>0
 UNION ALL
 SELECT 'purchase_items',pi.id::text,pi.raw_material_id,p.branch_id,pi.unit_cost,COALESCE(p.approved_at,pi.created_at,p.created_at),p.invoice_number,p.id,3,pi.created_at,pi.quantity,pi.unit_name
 FROM public.purchase_items pi JOIN public.purchases p ON p.id=pi.purchase_id WHERE pi.raw_material_id IS NOT NULL AND p.branch_id IS NOT NULL AND pi.unit_cost>0 AND pi.quantity>0
 UNION ALL
 SELECT 'stock_count_items',sci.id::text,sci.raw_material_id,sc.branch_id,sci.unit_cost,COALESCE(sc.applied_at,sc.approved_at,sc.created_at),sc.count_number,sc.id,2,NULL::timestamptz,NULL::numeric,NULL::text
 FROM public.stock_count_items sci JOIN public.stock_counts sc ON sc.id=sci.stock_count_id WHERE sci.raw_material_id IS NOT NULL AND sc.branch_id IS NOT NULL AND sci.unit_cost>0
 UNION ALL
 SELECT 'raw_material_price_events',pe.id::text,pe.raw_material_id,pe.branch_id,pe.unit_cost,pe.priced_at,pe.reference_number,NULL::uuid,1,NULL::timestamptz,NULL::numeric,NULL::text
 FROM public.raw_material_price_events pe WHERE pe.unit_cost>0;
ANALYZE private.raw_approved_price_read_model;

CREATE FUNCTION private.latest_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT rm.id,rm.branch_id,w.unit_cost,COALESCE(w.price_source,'unpriced'),w.priced_at,w.reference_number
 FROM public.raw_materials rm
 LEFT JOIN LATERAL (
  SELECT CASE WHEN c.source_kind='purchase_items' THEN (norm.value->>'stock_unit_cost')::numeric(18,6) ELSE c.unit_cost::numeric(18,6) END AS unit_cost,
   CASE WHEN c.source_kind IN('inventory_ledger','purchase_items') THEN 'purchase' WHEN c.source_kind='stock_count_items' THEN 'stock_count' ELSE 'pricing' END AS price_source,
   c.priced_at,c.reference_number
  FROM private.raw_approved_price_read_model c
  LEFT JOIN LATERAL(SELECT public._normalize_raw_purchase_uom(c.raw_material_id,c.purchase_quantity,c.unit_cost,c.purchase_unit) AS value WHERE c.source_kind='purchase_items') norm ON true
  WHERE c.branch_id=rm.branch_id AND c.raw_material_id=rm.id AND c.priced_at<=p_as_of
   AND private.raw_approved_price_visible(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id)
   AND (c.source_kind<>'purchase_items' OR (COALESCE((norm.value->>'success')::boolean,false) AND COALESCE((norm.value->>'stock_unit_cost')::numeric,0)>0))
  ORDER BY c.priced_at DESC NULLS LAST,c.source_rank,c.reference_number DESC NULLS LAST,c.event_id DESC LIMIT 1
 ) w ON true
 WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id) AND(p_raw_material_ids IS NULL OR rm.id=ANY(p_raw_material_ids));
$f$;
REVOKE ALL ON FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.latest_approved_raw_prices(uuid,uuid[],timestamptz) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_raw_material_current_prices(p_branch_id uuid DEFAULT NULL,p_raw_material_ids uuid[] DEFAULT NULL)
RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
 SELECT * FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,'infinity'::timestamptz);
$function$;
CREATE OR REPLACE FUNCTION public._kitchen_approved_price_candidate(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
 SELECT p.* FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of) p
 WHERE p_branch_id IS NOT NULL AND p_raw_material_ids IS NOT NULL AND p_as_of IS NOT NULL AND p.unit_cost>0;
$function$;
COMMIT;
