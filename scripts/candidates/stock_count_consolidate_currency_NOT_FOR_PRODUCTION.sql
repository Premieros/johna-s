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
