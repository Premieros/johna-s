-- Exact source reversal for manufactured inventory consumed by POS.
-- Rule:
--   * pre-existing manufactured stock returns as manufactured stock;
--   * AUTO_SALE_PRODUCTION created for the same sale/order is reversed back
--     through its production inputs (raw materials and nested manufactured units);
--   * partial void/refund is idempotent and never restores the same source twice.

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS source_order_item_id uuid;

COMMENT ON COLUMN public.sale_items.source_order_item_id IS
'Immutable snapshot of the originating POS order item when a sale settles kitchen inventory. Used for exact refund source reversal.';

ALTER TABLE public.inventory_unit_entries
  ADD COLUMN IF NOT EXISTS source_sale_item_id uuid;

COMMENT ON COLUMN public.inventory_unit_entries.source_sale_item_id IS
'Exact sale-item source for direct-sale inventory-unit consumption. Null for kitchen-send consumption and legacy rows.';

CREATE INDEX IF NOT EXISTS idx_inventory_unit_entries_source_sale_item
  ON public.inventory_unit_entries(source_sale_item_id)
  WHERE source_sale_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_unit_entry_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_entry_id uuid NOT NULL REFERENCES public.inventory_unit_entries(id) ON DELETE CASCADE,
  reversed_quantity numeric(14,6) NOT NULL CHECK (reversed_quantity > 0),
  reversal_entry_type text NOT NULL,
  reversal_reference_type text,
  reversal_reference_id uuid,
  reference_number text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_unit_entry_reversals_source
  ON public.inventory_unit_entry_reversals(original_entry_id);

CREATE TABLE IF NOT EXISTS public.auto_sale_production_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES public.inventory_unit_productions(id) ON DELETE CASCADE,
  reversed_quantity numeric(14,6) NOT NULL CHECK (reversed_quantity > 0),
  reversal_entry_type text NOT NULL,
  reversal_reference_type text,
  reversal_reference_id uuid,
  reference_number text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_sale_production_reversals_production
  ON public.auto_sale_production_reversals(production_id);

ALTER TABLE public.inventory_unit_entry_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_sale_production_reversals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventory_unit_entry_reversals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.auto_sale_production_reversals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inventory_unit_entry_reversals TO service_role, postgres;
GRANT ALL ON public.auto_sale_production_reversals TO service_role, postgres;

-- Bootstrap the mutually-recursive production reversal contract.
CREATE OR REPLACE FUNCTION public._reverse_auto_sale_production(
  p_production_id uuid,
  p_quantity numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_created_by uuid,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  RETURN jsonb_build_object('success',false,'error','AUTO_PRODUCTION_REVERSAL_NOT_INITIALIZED');
END;
$function$;

CREATE OR REPLACE FUNCTION public._restore_inventory_unit_entry_source(
  p_original_entry_id uuid,
  p_quantity numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_created_by uuid,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_entry public.inventory_unit_entries%ROWTYPE;
  v_consumed numeric(14,6);
  v_already numeric(14,6);
  v_available numeric(14,6);
  v_take numeric(14,6);
  v_production_id uuid;
  v_batch_id uuid;
  v_res jsonb;
  v_actual numeric(14,6) := 0;
  v_unit_restored numeric(14,6) := 0;
  v_auto_reversed numeric(14,6) := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success',true,'restored_quantity',0,'unit_quantity_restored',0,'auto_production_quantity_reversed',0);
  END IF;
  IF p_depth > 16 THEN
    RETURN jsonb_build_object('success',false,'error','AUTO_PRODUCTION_REVERSAL_TOO_DEEP');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('unit-entry-reverse:' || p_original_entry_id::text, 0));

  SELECT * INTO v_entry
  FROM public.inventory_unit_entries
  WHERE id=p_original_entry_id AND quantity<0
  FOR UPDATE;

  IF v_entry.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','UNIT_CONSUMPTION_ENTRY_NOT_FOUND');
  END IF;

  v_consumed := -v_entry.quantity;
  SELECT COALESCE(sum(reversed_quantity),0)
  INTO v_already
  FROM public.inventory_unit_entry_reversals
  WHERE original_entry_id=v_entry.id;

  v_available := GREATEST(v_consumed-v_already,0);
  v_take := LEAST(p_quantity,v_available);
  IF v_take <= 0 THEN
    RETURN jsonb_build_object('success',true,'restored_quantity',0,'unit_quantity_restored',0,'auto_production_quantity_reversed',0);
  END IF;

  SELECT p.id
  INTO v_production_id
  FROM public.inventory_unit_entries out_e
  JOIN public.inventory_unit_productions p
    ON p.id=out_e.reference_id
   AND p.notes='AUTO_SALE_PRODUCTION'
  WHERE out_e.unit_id=v_entry.unit_id
    AND out_e.branch_id=v_entry.branch_id
    AND out_e.warehouse_id IS NOT DISTINCT FROM v_entry.warehouse_id
    AND out_e.batch_number IS NOT DISTINCT FROM v_entry.batch_number
    AND out_e.reference_type='production'
    AND out_e.entry_type='production'
    AND out_e.quantity>0
  ORDER BY out_e.created_at DESC,out_e.id DESC
  LIMIT 1;

  IF v_production_id IS NOT NULL THEN
    v_res := public._reverse_auto_sale_production(
      v_production_id,
      v_take,
      p_entry_type,
      p_reference_type,
      p_reference_id,
      p_reference_number,
      p_created_by,
      p_depth+1
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;
    v_actual := COALESCE((v_res->>'restored_quantity')::numeric,0);
    v_auto_reversed := v_actual;
  ELSE
    SELECT id INTO v_batch_id
    FROM public.inventory_unit_batches
    WHERE unit_id=v_entry.unit_id
      AND branch_id=v_entry.branch_id
      AND warehouse_id IS NOT DISTINCT FROM v_entry.warehouse_id
      AND batch_number IS NOT DISTINCT FROM v_entry.batch_number
    ORDER BY created_at,id
    LIMIT 1
    FOR UPDATE;

    IF v_batch_id IS NULL THEN
      INSERT INTO public.inventory_unit_batches(
        unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date
      ) VALUES (
        v_entry.unit_id,v_entry.branch_id,v_entry.warehouse_id,
        COALESCE(v_entry.batch_number,'RV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
        v_take,COALESCE(v_entry.unit_cost,0),CURRENT_DATE
      )
      RETURNING id INTO v_batch_id;
    ELSE
      UPDATE public.inventory_unit_batches
      SET quantity=quantity+v_take
      WHERE id=v_batch_id;
    END IF;

    INSERT INTO public.inventory_unit_entries(
      unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,
      reference_type,reference_id,reference_number,batch_number,created_by
    ) VALUES (
      v_entry.unit_id,v_entry.branch_id,v_entry.warehouse_id,v_take,COALESCE(v_entry.unit_cost,0),
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,
      v_entry.batch_number,p_created_by
    );
    v_actual := v_take;
    v_unit_restored := v_actual;
  END IF;

  IF v_actual > 0 THEN
    INSERT INTO public.inventory_unit_entry_reversals(
      original_entry_id,reversed_quantity,reversal_entry_type,reversal_reference_type,
      reversal_reference_id,reference_number,created_by
    ) VALUES (
      v_entry.id,v_actual,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'restored_quantity',v_actual,
    'unit_quantity_restored',v_unit_restored,
    'auto_production_quantity_reversed',v_auto_reversed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._reverse_auto_sale_production(
  p_production_id uuid,
  p_quantity numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_created_by uuid,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_prod public.inventory_unit_productions%ROWTYPE;
  v_already numeric(14,6);
  v_available numeric(14,6);
  v_take numeric(14,6);
  v_ratio numeric(18,10);
  v_raw record;
  v_component record;
  v_restore numeric(14,6);
  v_res jsonb;
  v_component_restored numeric(14,6);
  v_raw_restored numeric(14,6) := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',true,'restored_quantity',0,'raw_materials_restored',0);
  END IF;
  IF p_depth > 16 THEN
    RETURN jsonb_build_object('success',false,'error','AUTO_PRODUCTION_REVERSAL_TOO_DEEP');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('auto-production-reverse:'||p_production_id::text,0));

  SELECT * INTO v_prod
  FROM public.inventory_unit_productions
  WHERE id=p_production_id
  FOR UPDATE;

  IF v_prod.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTO_PRODUCTION_NOT_FOUND');
  END IF;
  IF COALESCE(v_prod.notes,'') <> 'AUTO_SALE_PRODUCTION' THEN
    RETURN jsonb_build_object('success',false,'error','PRODUCTION_NOT_AUTO_SALE');
  END IF;
  IF v_prod.quantity IS NULL OR v_prod.quantity<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_AUTO_PRODUCTION_QUANTITY');
  END IF;

  SELECT COALESCE(sum(reversed_quantity),0)
  INTO v_already
  FROM public.auto_sale_production_reversals
  WHERE production_id=v_prod.id;

  v_available := GREATEST(v_prod.quantity-v_already,0);
  v_take := LEAST(p_quantity,v_available);
  IF v_take<=0 THEN
    RETURN jsonb_build_object('success',true,'restored_quantity',0,'raw_materials_restored',0);
  END IF;

  v_ratio := v_take / v_prod.quantity;

  FOR v_raw IN
    SELECT id,raw_material_id,quantity,unit_cost
    FROM public.inventory_ledger
    WHERE reference_type='production'
      AND reference_id=v_prod.id
      AND raw_material_id IS NOT NULL
      AND quantity<0
    ORDER BY id
  LOOP
    v_restore := round((-v_raw.quantity)*v_ratio,6);
    IF v_restore<=0 THEN CONTINUE; END IF;

    v_res := public._raw_add(
      v_raw.raw_material_id,
      v_prod.branch_id,
      v_prod.warehouse_id,
      v_restore,
      COALESCE(v_raw.unit_cost,0),
      'APR-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
      CURRENT_DATE,
      NULL,
      p_entry_type,
      p_reference_type,
      p_reference_id,
      p_reference_number,
      p_created_by
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success',false,'error','AUTO_PRODUCTION_RAW_RESTORE_FAILED','detail',v_res);
    END IF;
    v_raw_restored := v_raw_restored+v_restore;
  END LOOP;

  FOR v_component IN
    SELECT id,quantity
    FROM public.inventory_unit_entries
    WHERE reference_type='production'
      AND reference_id=v_prod.id
      AND entry_type='production_consumption'
      AND quantity<0
    ORDER BY created_at DESC,id DESC
  LOOP
    v_restore := round((-v_component.quantity)*v_ratio,6);
    IF v_restore<=0 THEN CONTINUE; END IF;

    v_res := public._restore_inventory_unit_entry_source(
      v_component.id,
      v_restore,
      p_entry_type,
      p_reference_type,
      p_reference_id,
      p_reference_number,
      p_created_by,
      p_depth+1
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;
    v_component_restored := COALESCE((v_res->>'restored_quantity')::numeric,0);
    IF v_component_restored+0.000001 < v_restore THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','AUTO_PRODUCTION_COMPONENT_RESTORE_INCOMPLETE',
        'required',v_restore,
        'restored',v_component_restored
      );
    END IF;
  END LOOP;

  INSERT INTO public.auto_sale_production_reversals(
    production_id,reversed_quantity,reversal_entry_type,reversal_reference_type,
    reversal_reference_id,reference_number,created_by
  ) VALUES (
    v_prod.id,v_take,p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
  );

  RETURN jsonb_build_object(
    'success',true,
    'restored_quantity',v_take,
    'raw_materials_restored',v_raw_restored
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._restore_inventory_unit_consumption_source(
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_unit_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_entry_type text,
  p_reversal_reference_type text,
  p_reversal_reference_id uuid,
  p_reference_number text,
  p_created_by uuid,
  p_source_sale_item_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_remaining numeric(14,6) := p_quantity;
  v_available numeric(14,6);
  v_take numeric(14,6);
  v_res jsonb;
  v_actual numeric(14,6);
  v_restored numeric(14,6) := 0;
  v_units numeric(14,6) := 0;
  v_auto numeric(14,6) := 0;
  v_tracked boolean := false;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RETURN jsonb_build_object('success',true,'tracked_source',false,'restored_quantity',0,'unrestored_quantity',0);
  END IF;

  FOR v_row IN
    SELECT e.id,e.quantity,
           COALESCE((SELECT sum(r.reversed_quantity)
                     FROM public.inventory_unit_entry_reversals r
                     WHERE r.original_entry_id=e.id),0) AS already_reversed
    FROM public.inventory_unit_entries e
    WHERE e.reference_type=p_source_reference_type
      AND e.reference_id=p_source_reference_id
      AND e.unit_id=p_unit_id
      AND e.branch_id=p_branch_id
      AND e.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
      AND e.quantity<0
      AND (p_source_sale_item_id IS NULL OR e.source_sale_item_id=p_source_sale_item_id)
    ORDER BY e.created_at DESC,e.id DESC
    FOR UPDATE
  LOOP
    v_tracked := true;
    EXIT WHEN v_remaining<=0.000001;
    v_available := GREATEST((-v_row.quantity)-v_row.already_reversed,0);
    IF v_available<=0 THEN CONTINUE; END IF;
    v_take := LEAST(v_remaining,v_available);

    v_res := public._restore_inventory_unit_entry_source(
      v_row.id,
      v_take,
      p_entry_type,
      p_reversal_reference_type,
      p_reversal_reference_id,
      p_reference_number,
      p_created_by,
      0
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_res;
    END IF;

    v_actual := COALESCE((v_res->>'restored_quantity')::numeric,0);
    v_restored := v_restored+v_actual;
    v_units := v_units+COALESCE((v_res->>'unit_quantity_restored')::numeric,0);
    v_auto := v_auto+COALESCE((v_res->>'auto_production_quantity_reversed')::numeric,0);
    v_remaining := GREATEST(v_remaining-v_actual,0);
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'tracked_source',v_tracked,
    'restored_quantity',v_restored,
    'unrestored_quantity',v_remaining,
    'unit_quantity_restored',v_units,
    'auto_production_quantity_reversed',v_auto
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._reverse_auto_sale_production(uuid,numeric,text,text,uuid,text,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._restore_inventory_unit_entry_source(uuid,numeric,text,text,uuid,text,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._restore_inventory_unit_consumption_source(text,uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public._reverse_auto_sale_production(uuid,numeric,text,text,uuid,text,uuid,integer)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._restore_inventory_unit_entry_source(uuid,numeric,text,text,uuid,text,uuid,integer)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._restore_inventory_unit_consumption_source(text,uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,uuid)
  TO service_role,postgres;

-- Make kitchen settlement return the exact originating order-item id.
DO $patch_kitchen_settlement_source$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := E'    \'total_cost\', v_total_cost,\n    \'errors\', \'[]\'::jsonb\n  );';
  v_new text := E'    \'total_cost\', v_total_cost,\n    \'errors\', \'[]\'::jsonb,\n    \'source_order_item_id\', v_queue.order_item_id\n  );';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid::regprocedure::text='_consume_kitchen_sale_settlement(uuid,uuid,jsonb,uuid,text)';

  IF v_oid IS NULL THEN RAISE EXCEPTION 'KITCHEN_SETTLEMENT_FUNCTION_MISSING'; END IF;
  v_def := pg_get_functiondef(v_oid);

  IF position('source_order_item_id' in v_def)=0 THEN
    IF position(v_old in v_def)=0 THEN
      RAISE EXCEPTION 'KITCHEN_SETTLEMENT_SOURCE_MARKER_MISSING';
    END IF;
    v_def := replace(v_def,v_old,v_new);
    EXECUTE v_def;
  END IF;
END;
$patch_kitchen_settlement_source$;

-- Persist exact source ownership after every sale-item deduction.
DO $patch_sale_source_snapshots$
DECLARE
  v_oid oid;
  v_def text;
  v_marker text := E'      v_cogs_total := v_cogs_total + COALESCE((v_res->>\'total_cost\')::numeric, 0);';
  v_replacement text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='_process_sale_core'
  LIMIT 1;

  IF v_oid IS NULL THEN RAISE EXCEPTION 'PROCESS_SALE_CORE_MISSING'; END IF;
  v_def := pg_get_functiondef(v_oid);

  IF position('source_order_item_id = NULLIF(v_res->>''source_order_item_id''' in v_def)=0 THEN
    IF position(v_marker in v_def)=0 THEN
      RAISE EXCEPTION 'PROCESS_SALE_SOURCE_MARKER_MISSING';
    END IF;

    v_replacement :=
      E'      IF NULLIF(v_res->>\'source_order_item_id\',\'\') IS NOT NULL THEN\n'
      || E'        UPDATE public.sale_items\n'
      || E'        SET source_order_item_id = NULLIF(v_res->>\'source_order_item_id\',\'\')::uuid\n'
      || E'        WHERE id=v_sale_item_id;\n'
      || E'      ELSE\n'
      || E'        UPDATE public.inventory_unit_entries\n'
      || E'        SET source_sale_item_id=v_sale_item_id\n'
      || E'        WHERE reference_type=\'sale\'\n'
      || E'          AND reference_id=v_sale_id\n'
      || E'          AND source_sale_item_id IS NULL;\n'
      || E'      END IF;\n\n'
      || v_marker;

    v_def := replace(v_def,v_marker,v_replacement);
    EXECUTE v_def;
  END IF;
END;
$patch_sale_source_snapshots$;

-- Kitchen void: unit effects now reverse the exact consumed source.
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
          -- Legacy event without batch-source history: retain prior behavior.
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

REVOKE ALL ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)
  TO service_role,postgres;

-- Refund: reverse unit inventory through the exact source when new provenance
-- exists. Existing legacy sales keep the previous unit-restock behavior.
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
  v_raws_restored numeric(14,6):=0;
  v_products_restored numeric(14,6):=0;
  v_auto_reversed numeric(14,6):=0;
  v_remaining numeric(14,6);
  v_source_restored numeric(14,6);
  v_event record;
  v_exact_direct boolean;
BEGIN
  SELECT quantity,source_order_item_id
  INTO v_item_qty,v_source_order_item_id
  FROM public.sale_items
  WHERE id=p_sale_item_id AND sale_id=p_sale_id AND product_id=p_product_id;

  IF v_item_qty IS NULL OR v_item_qty<=0 OR p_refund_qty IS NULL OR p_refund_qty<=0 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_REFUND_ITEM');
  END IF;

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
            -- Pre-migration sale: preserve prior behavior.
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

REVOKE ALL ON FUNCTION public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)
  TO service_role,postgres;

COMMENT ON FUNCTION public._restore_inventory_unit_consumption_source(text,uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,uuid) IS
'Restores exact inventory-unit source. Existing stock returns as the same unit batch; AUTO_SALE_PRODUCTION is recursively reversed back through raw/component inputs. Reversal rows make partial void/refund idempotent.';

NOTIFY pgrst, 'reload schema';
