-- Stabilization: keep negative raw-material auto-production private to the POS
-- sale path. A caller-controlled note must never relax manual production.

CREATE OR REPLACE FUNCTION public._produce_inventory_unit_internal(
  p_unit_id uuid,
  p_quantity numeric,
  p_warehouse_id uuid,
  p_branch_id uuid,
  p_notes text,
  p_allow_negative_raw boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_production_id uuid; v_total_cost numeric:=0; v_recipe record; v_component record; v_rm_qty numeric;
  v_batch_number text; v_unit_cost numeric:=0; v_unit_name text; v_res jsonb; v_need numeric;
  v_available numeric; v_batch record; v_take numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active=true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND';
  END IF;

  SELECT name INTO v_unit_name
  FROM public.inventory_units
  WHERE id=p_unit_id AND unit_type='manufactured' AND is_active=true
    AND (branch_id=p_branch_id OR branch_id IS NULL);
  IF v_unit_name IS NULL THEN
    RAISE EXCEPTION 'Unit % is not a manufactured active inventory unit in branch %',p_unit_id,p_branch_id;
  END IF;
  IF p_quantity<=0 THEN RAISE EXCEPTION 'Production quantity must be positive'; END IF;

  FOR v_component IN
    SELECT iuru.component_unit_id,iuru.quantity,iuru.wastage_percent
    FROM public.inventory_unit_recipe_units iuru
    WHERE iuru.unit_id=p_unit_id
  LOOP
    v_need:=p_quantity*v_component.quantity*(1+v_component.wastage_percent/100.0);
    SELECT COALESCE(SUM(iub.quantity),0) INTO v_available
    FROM public.inventory_unit_batches iub
    WHERE iub.unit_id=v_component.component_unit_id
      AND iub.branch_id=p_branch_id
      AND iub.warehouse_id=p_warehouse_id
      AND iub.quantity>0;
    IF v_available<v_need THEN
      RAISE EXCEPTION 'INSUFFICIENT_COMPONENT_UNIT_STOCK unit=% required=% available=%',v_component.component_unit_id,v_need,v_available;
    END IF;
  END LOOP;

  v_production_id:=gen_random_uuid();
  v_batch_number:='PRD-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS');

  FOR v_recipe IN
    SELECT iur.raw_material_id,iur.quantity,iur.wastage_percent
    FROM public.inventory_unit_recipes iur
    WHERE iur.unit_id=p_unit_id
  LOOP
    v_rm_qty:=p_quantity*v_recipe.quantity*(1+v_recipe.wastage_percent/100.0);
    v_res:=public._raw_remove_fifo(
      v_recipe.raw_material_id,
      p_branch_id,
      p_warehouse_id,
      v_rm_qty,
      'production',
      'production',
      v_production_id,
      v_batch_number,
      auth.uid(),
      p_allow_negative_raw
    );
    IF COALESCE((v_res->>'shortage')::numeric,0)>0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_RAW_MATERIAL_STOCK raw_material=% required=% shortage=%',v_recipe.raw_material_id,v_rm_qty,v_res->>'shortage';
    END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
  END LOOP;

  FOR v_component IN
    SELECT iuru.component_unit_id,iuru.quantity,iuru.wastage_percent
    FROM public.inventory_unit_recipe_units iuru
    WHERE iuru.unit_id=p_unit_id
    ORDER BY iuru.component_unit_id
  LOOP
    v_need:=p_quantity*v_component.quantity*(1+v_component.wastage_percent/100.0);
    FOR v_batch IN
      SELECT id,quantity,unit_cost,batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id=v_component.component_unit_id
        AND branch_id=p_branch_id
        AND warehouse_id=p_warehouse_id
        AND quantity>0
      ORDER BY created_at,id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need<=0;
      v_take:=LEAST(v_need,v_batch.quantity);
      UPDATE public.inventory_unit_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
      INSERT INTO public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,reference_id,reference_number,batch_number,created_by)
      VALUES(v_component.component_unit_id,p_branch_id,p_warehouse_id,-v_take,v_batch.unit_cost,'production_consumption','production',v_production_id,v_batch_number,v_batch.batch_number,auth.uid());
      v_total_cost:=v_total_cost+(v_take*COALESCE(v_batch.unit_cost,0));
      v_need:=v_need-v_take;
    END LOOP;
  END LOOP;

  v_unit_cost:=CASE WHEN p_quantity>0 THEN v_total_cost/p_quantity ELSE 0 END;
  INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date)
  VALUES(p_unit_id,p_branch_id,p_warehouse_id,v_batch_number,p_quantity,v_unit_cost,CURRENT_DATE);
  INSERT INTO public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,reference_id,batch_number,created_by)
  VALUES(p_unit_id,p_branch_id,p_warehouse_id,p_quantity,v_unit_cost,'production','production',v_production_id,v_batch_number,auth.uid());
  INSERT INTO public.inventory_unit_productions(id,unit_id,branch_id,warehouse_id,quantity,status,total_cost,started_at,completed_at,notes,created_by)
  VALUES(v_production_id,p_unit_id,p_branch_id,p_warehouse_id,p_quantity,'completed',v_total_cost,now(),now(),p_notes,auth.uid());
  UPDATE public.inventory_units SET cost_price=round(v_unit_cost,2),updated_at=now() WHERE id=p_unit_id;
  UPDATE public.products
  SET cost_price=round(v_unit_cost,2),updated_at=now()
  WHERE branch_id=p_branch_id
    AND product_type='manufactured'
    AND regexp_replace(lower(btrim(name)),'[ .]+$','','g')=regexp_replace(lower(btrim(v_unit_name)),'[ .]+$','','g');
  RETURN v_production_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._produce_inventory_unit_internal(uuid,numeric,uuid,uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._produce_inventory_unit_internal(uuid,numeric,uuid,uuid,text,boolean)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.produce_inventory_unit(
  p_unit_id uuid,
  p_quantity numeric,
  p_warehouse_id uuid,
  p_branch_id uuid DEFAULT get_branch_id(),
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.is_active=true) THEN
      RAISE EXCEPTION 'USER_INACTIVE';
    END IF;
    IF NOT public.can_permission('production.manage') THEN RAISE EXCEPTION 'PRODUCTION_NOT_ALLOWED'; END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active=true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND';
  END IF;

  RETURN public._produce_inventory_unit_internal(
    p_unit_id,p_quantity,p_warehouse_id,p_branch_id,p_notes,false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.produce_inventory_unit(uuid,numeric,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produce_inventory_unit(uuid,numeric,uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._ensure_inventory_unit_stock(
  p_unit_id uuid,
  p_required_qty numeric,
  p_warehouse_id uuid,
  p_branch_id uuid,
  p_depth integer DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_available numeric;
  v_shortage numeric;
  v_type text;
  v_child record;
BEGIN
  IF p_required_qty <= 0 THEN RETURN; END IF;
  IF p_depth > 16 THEN RAISE EXCEPTION 'UNIT_RECIPE_CYCLE_OR_TOO_DEEP unit=%', p_unit_id; END IF;

  SELECT unit_type INTO v_type
  FROM public.inventory_units
  WHERE id=p_unit_id AND branch_id=p_branch_id AND is_active=true;
  IF v_type IS NULL THEN RAISE EXCEPTION 'INVENTORY_UNIT_NOT_AVAILABLE unit=%',p_unit_id; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_available
  FROM public.inventory_unit_batches
  WHERE unit_id=p_unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0;

  v_shortage:=GREATEST(p_required_qty-v_available,0);
  IF v_shortage<=0 THEN RETURN; END IF;
  IF v_type<>'manufactured' THEN
    RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK unit=% required=% available=%',p_unit_id,p_required_qty,v_available;
  END IF;

  FOR v_child IN
    SELECT component_unit_id,quantity,COALESCE(wastage_percent,0) AS wastage_percent
    FROM public.inventory_unit_recipe_units
    WHERE unit_id=p_unit_id
    ORDER BY component_unit_id
  LOOP
    PERFORM public._ensure_inventory_unit_stock(
      v_child.component_unit_id,
      v_shortage*v_child.quantity*(1+v_child.wastage_percent/100.0),
      p_warehouse_id,p_branch_id,p_depth+1
    );
  END LOOP;

  PERFORM public._produce_inventory_unit_internal(
    p_unit_id,v_shortage,p_warehouse_id,p_branch_id,'AUTO_SALE_PRODUCTION',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_inventory_unit_stock(uuid,numeric,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_inventory_unit_stock(uuid,numeric,uuid,uuid,integer)
  TO service_role, postgres;

-- The public availability signal must classify manufactured-unit raw shortage
-- exactly like direct-recipe raw shortage. Unknown configuration and every
-- non-raw shortage remain blocking.
CREATE OR REPLACE FUNCTION public.get_pos_product_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_cap integer DEFAULT 100000
) RETURNS TABLE(product_id uuid,available_quantity numeric,is_available boolean,raw_shortage_only boolean,availability_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product record; v_low integer; v_high integer; v_mid integer; v_check jsonb;
  v_high_ok boolean; v_error text; v_source_unknown boolean;
BEGIN
  IF p_cap IS NULL OR p_cap<1 THEN p_cap:=1; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active=true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH' USING ERRCODE='22023';
  END IF;

  FOR v_product IN
    SELECT p.id FROM public.products p
    WHERE p.branch_id=p_branch_id AND p.is_active=true ORDER BY p.id
  LOOP
    v_low:=0; v_high:=1; v_high_ok:=false; v_source_unknown:=false; v_error:=NULL;
    LOOP
      v_check:=public.check_product_availability(v_product.id,p_branch_id,p_warehouse_id,v_high);
      v_high_ok:=COALESCE((v_check->>'success')::boolean,false);
      IF NOT v_high_ok THEN
        v_error:=COALESCE(v_check->>'error','UNKNOWN_AVAILABILITY_SOURCE');
        v_source_unknown:=v_error NOT IN ('INSUFFICIENT_PRODUCT_STOCK','INSUFFICIENT_UNIT_STOCK','INSUFFICIENT_RAW_MATERIAL_STOCK');
        EXIT;
      END IF;
      v_low:=v_high;
      EXIT WHEN v_high>=p_cap;
      v_high:=LEAST(v_high*2,p_cap);
    END LOOP;

    IF v_source_unknown THEN
      product_id:=v_product.id; available_quantity:=0; is_available:=false;
      raw_shortage_only:=false; availability_error:=v_error; RETURN NEXT; CONTINUE;
    END IF;

    IF v_low<p_cap AND NOT v_high_ok THEN
      WHILE v_high-v_low>1 LOOP
        v_mid:=(v_low+v_high)/2;
        v_check:=public.check_product_availability(v_product.id,p_branch_id,p_warehouse_id,v_mid);
        IF COALESCE((v_check->>'success')::boolean,false) THEN
          v_low:=v_mid;
        ELSE
          v_error:=COALESCE(v_check->>'error','UNKNOWN_AVAILABILITY_SOURCE');
          IF v_error NOT IN ('INSUFFICIENT_PRODUCT_STOCK','INSUFFICIENT_UNIT_STOCK','INSUFFICIENT_RAW_MATERIAL_STOCK') THEN
            v_source_unknown:=true;
          END IF;
          v_high:=v_mid;
        END IF;
      END LOOP;
    END IF;

    IF v_source_unknown THEN
      product_id:=v_product.id; available_quantity:=0; is_available:=false;
      raw_shortage_only:=false; availability_error:=v_error; RETURN NEXT; CONTINUE;
    END IF;

    product_id:=v_product.id;
    available_quantity:=v_low;
    is_available:=v_low>0;
    raw_shortage_only:=(NOT v_high_ok) AND COALESCE(v_error,'')='INSUFFICIENT_RAW_MATERIAL_STOCK';
    availability_error:=NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_availability(uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_availability(uuid,uuid,integer) TO authenticated, service_role;

