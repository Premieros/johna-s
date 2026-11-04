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
