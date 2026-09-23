-- Manufacturing retirement Phase 4:
-- void/refund for snapshot_version=2 reverses the exact raw-material snapshot
-- captured at kitchen send. Historical/mixed events keep the legacy reversal
-- path unchanged.

DO $preflight$
BEGIN
  IF to_regprocedure('public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_VOID_RESTORE_REQUIRED';
  END IF;
  IF to_regprocedure('public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'REFUND_RESTORE_REQUIRED';
  END IF;
  IF to_regprocedure('public._raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'RAW_ADD_WAREHOUSE_REQUIRED';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public._restore_kitchen_snapshot_raws(
  p_event_id uuid,
  p_sent_quantity numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_event public.order_kitchen_inventory_events%ROWTYPE;
  v_item jsonb;
  v_raw_id uuid;
  v_snapshot_qty numeric(18,6);
  v_restore_qty numeric(18,6);
  v_effect_qty numeric(18,6);
  v_effect_cost numeric(18,6);
  v_unit_cost numeric(18,6);
  v_batch text;
  v_res jsonb;
  v_raws_restored numeric(18,6):=0;
BEGIN
  SELECT *
  INTO v_event
  FROM public.order_kitchen_inventory_events
  WHERE id=p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_EVENT_NOT_FOUND');
  END IF;

  IF COALESCE(v_event.snapshot_version,1) < 2
     OR jsonb_typeof(v_event.component_snapshot) <> 'array'
     OR jsonb_array_length(v_event.component_snapshot)=0 THEN
    RETURN jsonb_build_object('success',false,'error','KITCHEN_SNAPSHOT_NOT_AVAILABLE');
  END IF;

  IF p_sent_quantity IS NULL
     OR p_sent_quantity<=0
     OR p_sent_quantity>v_event.sent_quantity+0.000001 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_SNAPSHOT_RESTORE_QUANTITY');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_event.component_snapshot)
  LOOP
    v_raw_id:=NULLIF(v_item->>'raw_material_id','')::uuid;
    v_snapshot_qty:=COALESCE((v_item->>'quantity')::numeric,0);

    IF v_raw_id IS NULL OR v_snapshot_qty<=0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','INVALID_KITCHEN_COMPONENT_SNAPSHOT',
        'event_id',v_event.id
      );
    END IF;

    v_restore_qty:=ROUND(v_snapshot_qty*p_sent_quantity/v_event.sent_quantity,6);
    IF v_restore_qty<=0 THEN CONTINUE; END IF;

    SELECT quantity,total_cost
    INTO v_effect_qty,v_effect_cost
    FROM public.order_kitchen_inventory_effects
    WHERE event_id=v_event.id
      AND target_type='raw_material'
      AND target_id=v_raw_id
    ORDER BY id
    LIMIT 1;

    v_unit_cost:=CASE
      WHEN COALESCE(v_effect_qty,0)>0
        THEN COALESCE(v_effect_cost,0)/v_effect_qty
      ELSE 0
    END;

    v_batch:=
      CASE WHEN p_entry_type='refund' THEN 'RF-' ELSE 'KV-' END
      ||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    v_res:=public._raw_add(
      v_raw_id,
      v_event.branch_id,
      v_event.warehouse_id,
      v_restore_qty,
      v_unit_cost,
      v_batch,
      CURRENT_DATE,
      NULL,
      p_entry_type,
      p_reference_type,
      p_reference_id,
      p_reference_number,
      p_created_by
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','SNAPSHOT_RAW_RESTORE_FAILED',
        'event_id',v_event.id,
        'raw_material_id',v_raw_id,
        'detail',v_res
      );
    END IF;

    v_raws_restored:=v_raws_restored+v_restore_qty;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'snapshot_restored',true,
    'raw_materials_restored',v_raws_restored,
    'event_id',v_event.id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._restore_kitchen_inventory_for_void(
  p_order_id uuid,
  p_order_item_id uuid,
  p_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_remaining numeric(14,6):=p_quantity;
  v_event record;
  v_effect record;
  v_take numeric(14,6);
  v_restore numeric(14,6);
  v_cost numeric(18,6);
  v_batch text;
  v_res jsonb;
  v_restored numeric(14,6):=0;
  v_source_restored numeric(14,6);
  v_source_tracked boolean;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY');
  END IF;

  FOR v_event IN
    SELECT * FROM public.order_kitchen_inventory_events
    WHERE order_id=p_order_id
      AND order_item_id=p_order_item_id
      AND sent_quantity>voided_quantity
      AND settled_sale_id IS NULL
    ORDER BY created_at DESC,id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=LEAST(v_remaining,v_event.sent_quantity-v_event.voided_quantity);

    IF COALESCE(v_event.snapshot_version,1)>=2
       AND jsonb_typeof(v_event.component_snapshot)='array'
       AND jsonb_array_length(v_event.component_snapshot)>0 THEN
      v_res:=public._restore_kitchen_snapshot_raws(
        v_event.id,
        v_take,
        'kitchen_void',
        'kitchen_send',
        v_event.id,
        p_order_id::text,
        auth.uid()
      );
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;
    ELSE
      FOR v_effect IN
        SELECT * FROM public.order_kitchen_inventory_effects
        WHERE event_id=v_event.id
        ORDER BY target_type,target_id
      LOOP
        v_restore:=round(v_effect.quantity*v_take/v_event.sent_quantity,6);
        IF v_restore<=0 THEN CONTINUE; END IF;
        v_cost:=CASE WHEN v_effect.quantity>0 THEN v_effect.total_cost/v_effect.quantity ELSE 0 END;
        v_batch:='KV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

        IF v_effect.target_type = 'inventory_unit' THEN
          v_res := public._restore_inventory_unit_consumption_source(
            'kitchen_send',
            v_event.id,
            v_effect.target_id,
            v_event.branch_id,
            v_event.warehouse_id,
            v_restore,
            'kitchen_void',
            'kitchen_send',
            v_event.id,
            p_order_id::text,
            auth.uid(),
            NULL
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RETURN v_res;
          END IF;
          v_source_restored:=COALESCE((v_res->>'restored_quantity')::numeric,0);
          v_source_tracked:=COALESCE((v_res->>'tracked_source')::boolean,false);

          IF v_source_tracked THEN
            IF v_source_restored+0.000001<v_restore THEN
              RETURN jsonb_build_object(
                'success',false,
                'error','KITCHEN_VOID_UNIT_SOURCE_RESTORE_INCOMPLETE',
                'required',v_restore,
                'restored',v_source_restored
              );
            END IF;
          ELSE
            INSERT INTO public.inventory_unit_batches(
              unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date
            ) VALUES (
              v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_batch,v_restore,v_cost,CURRENT_DATE
            );
            INSERT INTO public.inventory_unit_entries(
              unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,
              reference_type,reference_id,reference_number,batch_number,created_by
            ) VALUES (
              v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_restore,v_cost,
              'kitchen_void','kitchen_send',v_event.id,p_order_id::text,v_batch,auth.uid()
            );
          END IF;
        ELSIF v_effect.target_type = 'raw_material' THEN
          v_res:=public._raw_add(
            v_effect.target_id,v_event.branch_id,v_event.warehouse_id,v_restore,v_cost,v_batch,
            CURRENT_DATE,NULL,'kitchen_void','kitchen_send',v_event.id,p_order_id::text,auth.uid()
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RETURN jsonb_build_object('success',false,'error','KITCHEN_VOID_RAW_RESTORE_FAILED','detail',v_res);
          END IF;
        ELSE
          v_res:=public._product_inv_add(
            v_effect.target_id,v_event.warehouse_id,v_event.branch_id,v_restore,v_cost,v_batch,
            CURRENT_DATE,NULL,'kitchen_void','kitchen_send',v_event.id,p_order_id::text,auth.uid()
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RETURN jsonb_build_object('success',false,'error','KITCHEN_VOID_PRODUCT_RESTORE_FAILED','detail',v_res);
          END IF;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.order_kitchen_inventory_events
    SET voided_quantity=voided_quantity+v_take
    WHERE id=v_event.id;

    v_remaining:=v_remaining-v_take;
    v_restored:=v_restored+v_take;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'inventory_changed',v_restored>0,
    'restored_sent_quantity',v_restored,
    'legacy_untracked_quantity',GREATEST(v_remaining,0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._restore_refund_hybrid_inventory(
  p_sale_item_id uuid,
  p_sale_id uuid,
  p_product_id uuid,
  p_refund_qty numeric,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_reference_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item_qty numeric(14,6);
  v_source_order_item_id uuid;
  v_effect record;
  v_restore_qty numeric(14,6);
  v_unit_cost numeric(18,6);
  v_batch_number text;
  v_res jsonb;
  v_units_restored numeric(14,6):=0;
  v_raws_restored numeric(18,6):=0;
  v_products_restored numeric(14,6):=0;
  v_auto_reversed numeric(14,6):=0;
  v_remaining numeric(14,6);
  v_source_restored numeric(14,6);
  v_event record;
  v_exact_direct boolean;
  v_event_count integer:=0;
  v_snapshot_event_count integer:=0;
  v_effective_sent_total numeric(14,6):=0;
  v_event_refund_qty numeric(14,6);
BEGIN
  SELECT quantity,source_order_item_id
  INTO v_item_qty,v_source_order_item_id
  FROM public.sale_items
  WHERE id=p_sale_item_id AND sale_id=p_sale_id AND product_id=p_product_id;

  IF v_item_qty IS NULL OR v_item_qty<=0 OR p_refund_qty IS NULL OR p_refund_qty<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_REFUND_ITEM');
  END IF;

  -- New Phase-3 sales: every settled event for the sale item must be a v2
  -- snapshot event and must exactly cover the sold quantity. In that case the
  -- refund restores from the immutable kitchen snapshot and never consults
  -- current recipe/manufacturing state.
  IF v_source_order_item_id IS NOT NULL THEN
    SELECT
      count(*),
      count(*) FILTER (
        WHERE COALESCE(snapshot_version,1)>=2
          AND jsonb_typeof(component_snapshot)='array'
          AND jsonb_array_length(component_snapshot)>0
      ),
      COALESCE(sum(sent_quantity-voided_quantity),0)
    INTO v_event_count,v_snapshot_event_count,v_effective_sent_total
    FROM public.order_kitchen_inventory_events
    WHERE settled_sale_id=p_sale_id
      AND order_item_id=v_source_order_item_id
      AND sent_quantity>voided_quantity;

    IF v_event_count>0
       AND v_event_count=v_snapshot_event_count
       AND abs(v_effective_sent_total-v_item_qty)<=0.000001 THEN
      FOR v_event IN
        SELECT *
        FROM public.order_kitchen_inventory_events
        WHERE settled_sale_id=p_sale_id
          AND order_item_id=v_source_order_item_id
          AND sent_quantity>voided_quantity
        ORDER BY created_at,id
      LOOP
        v_event_refund_qty:=ROUND(
          (v_event.sent_quantity-v_event.voided_quantity)
          * p_refund_qty
          / v_item_qty,
          6
        );
        IF v_event_refund_qty<=0 THEN CONTINUE; END IF;

        v_res:=public._restore_kitchen_snapshot_raws(
          v_event.id,
          v_event_refund_qty,
          'refund',
          'sale',
          p_sale_id,
          p_reference_number,
          auth.uid()
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          RETURN v_res;
        END IF;
        v_raws_restored:=v_raws_restored
          +COALESCE((v_res->>'raw_materials_restored')::numeric,0);
      END LOOP;

      RETURN jsonb_build_object(
        'success',true,
        'handled',true,
        'snapshot_restored',true,
        'units_restored',0,
        'auto_production_reversed',0,
        'raw_materials_restored',v_raws_restored,
        'products_restored',0
      );
    END IF;
  END IF;

  -- Legacy/mixed transactions retain the previously proven compatibility path.
  IF EXISTS(SELECT 1 FROM public.sale_item_inventory_effects WHERE sale_item_id = p_sale_item_id) THEN
    FOR v_effect IN
      SELECT * FROM public.sale_item_inventory_effects
      WHERE sale_item_id = p_sale_item_id
      ORDER BY target_type,target_id
    LOOP
      v_restore_qty:=ROUND(v_effect.quantity * p_refund_qty / v_item_qty,6);
      IF v_restore_qty<=0 THEN CONTINUE; END IF;

      IF v_effect.target_type = 'inventory_unit' THEN
        v_remaining:=v_restore_qty;

        IF v_source_order_item_id IS NOT NULL THEN
          FOR v_event IN
            SELECT id,warehouse_id
            FROM public.order_kitchen_inventory_events
            WHERE settled_sale_id=p_sale_id
              AND order_item_id=v_source_order_item_id
            ORDER BY created_at DESC,id DESC
          LOOP
            EXIT WHEN v_remaining<=0.000001;
            v_res:=public._restore_inventory_unit_consumption_source(
              'kitchen_send',
              v_event.id,
              v_effect.target_id,
              p_branch_id,
              COALESCE(v_event.warehouse_id,v_effect.warehouse_id,p_warehouse_id),
              v_remaining,
              'refund',
              'sale',
              p_sale_id,
              p_reference_number,
              auth.uid(),
              NULL
            );
            IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
            v_source_restored:=COALESCE((v_res->>'restored_quantity')::numeric,0);
            v_remaining:=GREATEST(v_remaining-v_source_restored,0);
            v_units_restored:=v_units_restored+COALESCE((v_res->>'unit_quantity_restored')::numeric,0);
            v_auto_reversed:=v_auto_reversed+COALESCE((v_res->>'auto_production_quantity_reversed')::numeric,0);
          END LOOP;

          IF v_remaining>0.000001 THEN
            RETURN jsonb_build_object(
              'success',false,
              'error','REFUND_UNIT_SOURCE_RESTORE_INCOMPLETE',
              'sale_item_id',p_sale_item_id,
              'required',v_restore_qty,
              'unrestored',v_remaining
            );
          END IF;
        ELSE
          SELECT EXISTS(
            SELECT 1
            FROM public.inventory_unit_entries
            WHERE reference_type='sale'
              AND reference_id=p_sale_id
              AND unit_id=v_effect.target_id
              AND branch_id=p_branch_id
              AND source_sale_item_id=p_sale_item_id
              AND quantity<0
          ) INTO v_exact_direct;

          IF v_exact_direct THEN
            v_res:=public._restore_inventory_unit_consumption_source(
              'sale',
              p_sale_id,
              v_effect.target_id,
              p_branch_id,
              COALESCE(v_effect.warehouse_id,p_warehouse_id),
              v_restore_qty,
              'refund',
              'sale',
              p_sale_id,
              p_reference_number,
              auth.uid(),
              p_sale_item_id
            );
            IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
            v_source_restored:=COALESCE((v_res->>'restored_quantity')::numeric,0);
            IF v_source_restored+0.000001<v_restore_qty THEN
              RETURN jsonb_build_object(
                'success',false,
                'error','REFUND_UNIT_SOURCE_RESTORE_INCOMPLETE',
                'sale_item_id',p_sale_item_id,
                'required',v_restore_qty,
                'restored',v_source_restored
              );
            END IF;
            v_units_restored:=v_units_restored+COALESCE((v_res->>'unit_quantity_restored')::numeric,0);
            v_auto_reversed:=v_auto_reversed+COALESCE((v_res->>'auto_production_quantity_reversed')::numeric,0);
          ELSE
            SELECT COALESCE(
              SUM((-iue.quantity)*COALESCE(iue.unit_cost,0)) FILTER(WHERE iue.quantity<0)
              /NULLIF(SUM(-iue.quantity) FILTER(WHERE iue.quantity<0),0),
              iu.cost_price,0
            ) INTO v_unit_cost
            FROM public.inventory_units iu
            LEFT JOIN public.inventory_unit_entries iue
              ON iue.unit_id=iu.id
             AND iue.branch_id=p_branch_id
             AND iue.warehouse_id=COALESCE(v_effect.warehouse_id,p_warehouse_id)
             AND iue.reference_type='sale'
             AND iue.reference_id=p_sale_id
            WHERE iu.id=v_effect.target_id
            GROUP BY iu.cost_price;

            v_batch_number:='RF-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
            INSERT INTO public.inventory_unit_batches(
              unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date
            ) VALUES (
              v_effect.target_id,p_branch_id,COALESCE(v_effect.warehouse_id,p_warehouse_id),
              v_batch_number,v_restore_qty,COALESCE(v_unit_cost,0),CURRENT_DATE
            );
            INSERT INTO public.inventory_unit_entries(
              unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,
              reference_id,reference_number,batch_number,created_by
            ) VALUES (
              v_effect.target_id,p_branch_id,COALESCE(v_effect.warehouse_id,p_warehouse_id),
              v_restore_qty,COALESCE(v_unit_cost,0),'refund','sale',p_sale_id,
              p_reference_number,v_batch_number,auth.uid()
            );
            v_units_restored:=v_units_restored+v_restore_qty;
          END IF;
        END IF;

      ELSIF v_effect.target_type = 'raw_material' THEN
        SELECT COALESCE(
          SUM((-l.quantity)*COALESCE(l.unit_cost,0)) FILTER(WHERE l.quantity<0)
          /NULLIF(SUM(-l.quantity) FILTER(WHERE l.quantity<0),0),0
        ) INTO v_unit_cost
        FROM public.inventory_ledger l
        WHERE l.raw_material_id=v_effect.target_id
          AND l.branch_id=p_branch_id
          AND l.reference_type='sale'
          AND l.reference_id=p_sale_id;

        v_res:=public._raw_add(
          v_effect.target_id,p_branch_id,v_restore_qty,COALESCE(v_unit_cost,0),
          'RF-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
          CURRENT_DATE,NULL,'refund','sale',p_sale_id,p_reference_number,auth.uid()
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
        v_raws_restored:=v_raws_restored+v_restore_qty;

      ELSIF v_effect.target_type = 'product' THEN
        SELECT COALESCE(
          SUM((-l.quantity)*COALESCE(l.unit_cost,0)) FILTER(WHERE l.quantity<0)
          /NULLIF(SUM(-l.quantity) FILTER(WHERE l.quantity<0),0),
          p.cost_price,0
        ) INTO v_unit_cost
        FROM public.products p
        LEFT JOIN public.inventory_ledger l
          ON l.product_id=p.id
         AND l.branch_id=p_branch_id
         AND l.reference_type='sale'
         AND l.reference_id=p_sale_id
        WHERE p.id=v_effect.target_id
        GROUP BY p.cost_price;

        v_res:=public._product_inv_add(
          v_effect.target_id,COALESCE(v_effect.warehouse_id,p_warehouse_id),p_branch_id,
          v_restore_qty,COALESCE(v_unit_cost,0),
          'RF-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
          NULL,NULL,'refund','sale',p_sale_id,p_reference_number,auth.uid()
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
        v_products_restored:=v_products_restored+v_restore_qty;
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'success',true,
      'handled',true,
      'units_restored',v_units_restored,
      'auto_production_reversed',v_auto_reversed,
      'raw_materials_restored',v_raws_restored,
      'products_restored',v_products_restored
    );
  END IF;

  RETURN public._restore_refund_hybrid_inventory(
    p_sale_id,p_product_id,p_refund_qty,p_branch_id,p_warehouse_id,p_reference_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._restore_kitchen_snapshot_raws(uuid,numeric,text,text,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public._restore_kitchen_snapshot_raws(uuid,numeric,text,text,uuid,text,uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)
  TO service_role,postgres;

DO $verify$
DECLARE
  v_void text;
  v_refund text;
BEGIN
  SELECT pg_get_functiondef('public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)'::regprocedure)
  INTO v_void;
  SELECT pg_get_functiondef('public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)'::regprocedure)
  INTO v_refund;

  IF position('_restore_kitchen_snapshot_raws' in v_void)=0 THEN
    RAISE EXCEPTION 'PHASE4_VOID_SNAPSHOT_PATH_MISSING';
  END IF;
  IF position('_restore_kitchen_snapshot_raws' in v_refund)=0 THEN
    RAISE EXCEPTION 'PHASE4_REFUND_SNAPSHOT_PATH_MISSING';
  END IF;
  IF position('snapshot_version' in v_void)=0 OR position('snapshot_version' in v_refund)=0 THEN
    RAISE EXCEPTION 'PHASE4_SNAPSHOT_VERSION_GUARD_MISSING';
  END IF;
END;
$verify$;
