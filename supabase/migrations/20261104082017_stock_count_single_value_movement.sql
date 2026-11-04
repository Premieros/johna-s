BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $baseline$ BEGIN
 IF md5(pg_get_functiondef('private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure))<>'577e61805de419362e6b312fbd84061b' THEN RAISE EXCEPTION 'COUNT_SINGLE_VALUE_BASELINE_CHANGED'; END IF;
END $baseline$;
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
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=p_raw_material_id
      AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
      AND d.settled_quantity<d.debt_quantity)
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
  SELECT * INTO v_price FROM private.latest_approved_raw_prices(
    p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
  WHERE raw_material_id=p_raw_material_id;
  IF p_reference_type='stock_count' AND v_price.unit_cost IS NULL THEN
    SELECT * INTO v_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
  END IF;
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
      v_price.unit_cost,-v_take*v_price.unit_cost,v_running,v_running-v_take,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    );
    END IF;
    v_running:=v_running-v_take;
    v_qty:=v_qty-v_take;
  END LOOP;

  IF v_qty>0 THEN
    IF p_reference_type='stock_count' THEN
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
      v_price.unit_cost,-v_qty*v_price.unit_cost,v_running,v_running-v_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
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
      v_before,v_before-p_qty,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    IF v_count_deficit_batch IS NOT NULL THEN
      INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,
        reference_type,reference_id,reference_number,debt_quantity,source_created_at)
      VALUES(v_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,v_count_deficit_batch,
        p_reference_type,p_reference_id,p_reference_number,v_qty,COALESCE(p_effective_at,v_now));
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
    'success',true,'removed',p_qty,'oversold',v_qty,
    'total_cost',p_qty*v_price.unit_cost,'avg_cost',v_price.unit_cost,
    'approved_price_source',v_price.price_source,'approved_price_at',v_price.priced_at,
    'approved_price_ref',v_price.reference_number,
    'warehouse_id',p_warehouse_id,'shortage_ledger_id',v_ledger_id
  );
END;
$fn$;


REVOKE ALL ON FUNCTION private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Audited repair of split monetary rows created by the previous count writer.
-- Keeps row IDs/debt links, total quantity, physical stock and journals unchanged.
CREATE OR REPLACE FUNCTION private.consolidate_stock_count_value(p_count_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.stock_counts%ROWTYPE; g record; old_rows jsonb; new_rows jsonb;
  first_qty numeric; last_qty numeric; fixed integer:=0; audit_groups jsonb:='[]';
BEGIN
 SELECT * INTO STRICT c FROM public.stock_counts WHERE id=p_count_id FOR UPDATE;
 IF c.status<>'applied' THEN RAISE EXCEPTION 'COUNT_NOT_APPLIED'; END IF;
 IF NOT public.can_permission('inventory.count.apply') OR NOT public.user_may_access_branch(c.branch_id) THEN
   RAISE EXCEPTION 'NOT_ALLOWED';
 END IF;
 FOR g IN
   SELECT i.raw_material_id,i.variance_quantity,i.variance_value,i.unit_cost,
     sum(l.quantity) qty,sum(l.total_cost) value,
     count(*) FILTER(WHERE l.approved_cost_basis IS DISTINCT FROM 'approved_last_known' OR l.unit_cost IS DISTINCT FROM i.unit_cost) invalid,
     count(d.id) debts,coalesce(max(l.id) FILTER(WHERE d.id IS NOT NULL),min(l.id)) keep_id
   FROM public.stock_count_items i JOIN public.inventory_ledger l ON l.reference_type='stock_count'
     AND l.reference_id=i.stock_count_id AND l.raw_material_id=i.raw_material_id
   LEFT JOIN public.raw_fifo_debts d ON d.source_ledger_id=l.id
   WHERE i.stock_count_id=p_count_id
   GROUP BY i.raw_material_id,i.variance_quantity,i.variance_value,i.unit_cost
   HAVING sum(l.total_cost) IS DISTINCT FROM i.variance_value
   ORDER BY i.raw_material_id
 LOOP
   IF g.invalid<>0 OR g.debts>1 OR g.qty IS DISTINCT FROM g.variance_quantity
      OR round(g.qty*g.unit_cost,2) IS DISTINCT FROM g.variance_value THEN
     RAISE EXCEPTION 'COUNT_CURRENCY_REPAIR_BASELINE_INVALID material %',g.raw_material_id;
   END IF;
   IF NOT pg_try_advisory_xact_lock(hashtextextended(g.raw_material_id::text||':'||c.branch_id::text,0)) THEN
     RAISE EXCEPTION 'COUNT_STOCK_BUSY_RETRY';
   END IF;
   PERFORM 1 FROM public.inventory_ledger WHERE reference_type='stock_count' AND reference_id=c.id
     AND raw_material_id=g.raw_material_id ORDER BY id FOR UPDATE;
   SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO old_rows FROM public.inventory_ledger l
     WHERE reference_type='stock_count' AND reference_id=c.id AND raw_material_id=g.raw_material_id;
   SELECT before_qty INTO first_qty FROM public.inventory_ledger WHERE reference_type='stock_count'
     AND reference_id=c.id AND raw_material_id=g.raw_material_id ORDER BY id LIMIT 1;
   SELECT after_qty INTO last_qty FROM public.inventory_ledger WHERE reference_type='stock_count'
     AND reference_id=c.id AND raw_material_id=g.raw_material_id ORDER BY id DESC LIMIT 1;
   UPDATE public.inventory_ledger SET
     quantity=CASE WHEN id=g.keep_id THEN g.qty ELSE 0 END,
     total_cost=CASE WHEN id=g.keep_id THEN g.variance_value ELSE 0 END,
     before_qty=CASE WHEN id<=g.keep_id THEN first_qty ELSE last_qty END,
     after_qty=CASE WHEN id<g.keep_id THEN first_qty ELSE last_qty END,
     batch_number=CASE WHEN id=g.keep_id THEN NULL ELSE batch_number END,
     reference_number=CASE WHEN id=g.keep_id THEN c.count_number ELSE c.count_number||' (مجمّع ضمن الحركة '||g.keep_id||')' END
     WHERE reference_type='stock_count' AND reference_id=c.id AND raw_material_id=g.raw_material_id;
   IF (SELECT sum(quantity) FROM public.inventory_ledger WHERE reference_type='stock_count' AND reference_id=c.id AND raw_material_id=g.raw_material_id)
       IS DISTINCT FROM g.qty
     OR (SELECT sum(total_cost) FROM public.inventory_ledger WHERE reference_type='stock_count' AND reference_id=c.id AND raw_material_id=g.raw_material_id)
       IS DISTINCT FROM g.variance_value THEN RAISE EXCEPTION 'COUNT_CURRENCY_REPAIR_PARITY_FAILED'; END IF;
   SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO new_rows FROM public.inventory_ledger l
     WHERE reference_type='stock_count' AND reference_id=c.id AND raw_material_id=g.raw_material_id;
   audit_groups:=audit_groups||jsonb_build_array(jsonb_build_object('raw_material_id',g.raw_material_id,'kept_ledger_id',g.keep_id,'before',old_rows,'after',new_rows));
   fixed:=fixed+1;
 END LOOP;
 IF fixed>0 THEN
   INSERT INTO public.audit_log(user_id,action,entity,entity_id,branch_id,details)
   VALUES(auth.uid(),'update','stock_counts',c.id,c.branch_id,jsonb_build_object('kind','stock_count_currency_consolidation',
     'message','تجميع تفاصيل حركة الجرد لمنع فروق التقريب، دون تغيير إجمالي الكمية أو القيد المالي.',
     'materials_fixed',fixed,'groups',audit_groups));
 END IF;
 RETURN jsonb_build_object('success',true,'materials_fixed',fixed);
END;
$$;
REVOKE ALL ON FUNCTION private.consolidate_stock_count_value(uuid) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
