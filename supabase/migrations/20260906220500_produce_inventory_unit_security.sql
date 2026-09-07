-- P0-B: protect produce_inventory_unit before any inventory/cost mutation.
-- The production/FIFO/costing body below is preserved; only security/integrity guards
-- and the SECURITY DEFINER search_path are hardened.
-- service_role keeps its documented backend execution contract; application callers
-- remain Permission-First and branch-scoped.

CREATE OR REPLACE FUNCTION public.produce_inventory_unit(
  p_unit_id uuid,
  p_quantity numeric,
  p_warehouse_id uuid,
  p_branch_id uuid DEFAULT public.get_branch_id(),
  p_notes text DEFAULT NULL::text
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
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  -- service_role is the explicit trusted backend contract restored by
  -- 20260901225000_grant_produce_inventory_unit_service_role.sql.
  -- Every application caller must pass the canonical Permission-First guards.
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_active = true
    ) THEN
      RAISE EXCEPTION 'USER_INACTIVE';
    END IF;

    IF NOT public.can_permission('production.manage') THEN
      RAISE EXCEPTION 'PRODUCTION_NOT_ALLOWED';
    END IF;

    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
    END IF;
  END IF;

  -- Integrity is enforced for both trusted backend and application callers.
  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND';
  END IF;

  SELECT name INTO v_unit_name FROM public.inventory_units WHERE id=p_unit_id AND unit_type='manufactured' AND is_active=true AND (branch_id=p_branch_id OR branch_id IS NULL);
  IF v_unit_name IS NULL THEN RAISE EXCEPTION 'Unit % is not a manufactured active inventory unit in branch %',p_unit_id,p_branch_id; END IF;
  IF p_quantity<=0 THEN RAISE EXCEPTION 'Production quantity must be positive'; END IF;
  FOR v_component IN SELECT iuru.component_unit_id,iuru.quantity,iuru.wastage_percent FROM public.inventory_unit_recipe_units iuru WHERE iuru.unit_id=p_unit_id LOOP
    v_need:=p_quantity*v_component.quantity*(1+v_component.wastage_percent/100.0);
    SELECT COALESCE(SUM(iub.quantity),0) INTO v_available FROM public.inventory_unit_batches iub WHERE iub.unit_id=v_component.component_unit_id AND iub.branch_id=p_branch_id AND iub.warehouse_id=p_warehouse_id AND iub.quantity>0;
    IF v_available<v_need THEN RAISE EXCEPTION 'INSUFFICIENT_COMPONENT_UNIT_STOCK unit=% required=% available=%',v_component.component_unit_id,v_need,v_available; END IF;
  END LOOP;
  v_production_id:=gen_random_uuid();
  v_batch_number:='PRD-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS');
  FOR v_recipe IN SELECT iur.raw_material_id,iur.quantity,iur.wastage_percent FROM public.inventory_unit_recipes iur WHERE iur.unit_id=p_unit_id LOOP
    v_rm_qty:=p_quantity*v_recipe.quantity*(1+v_recipe.wastage_percent/100.0);
    v_res:=public._raw_remove_fifo(v_recipe.raw_material_id,p_branch_id,v_rm_qty,'production','production',v_production_id,v_batch_number,auth.uid());
    IF COALESCE((v_res->>'shortage')::numeric,0)>0 THEN RAISE EXCEPTION 'INSUFFICIENT_RAW_MATERIAL_STOCK raw_material=% required=% shortage=%',v_recipe.raw_material_id,v_rm_qty,v_res->>'shortage'; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
  END LOOP;
  FOR v_component IN SELECT iuru.component_unit_id,iuru.quantity,iuru.wastage_percent FROM public.inventory_unit_recipe_units iuru WHERE iuru.unit_id=p_unit_id ORDER BY iuru.component_unit_id LOOP
    v_need:=p_quantity*v_component.quantity*(1+v_component.wastage_percent/100.0);
    FOR v_batch IN SELECT id,quantity,unit_cost,batch_number FROM public.inventory_unit_batches WHERE unit_id=v_component.component_unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0 ORDER BY created_at,id FOR UPDATE LOOP
      EXIT WHEN v_need<=0; v_take:=LEAST(v_need,v_batch.quantity);
      UPDATE public.inventory_unit_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
      INSERT INTO public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,reference_id,reference_number,batch_number,created_by)
      VALUES(v_component.component_unit_id,p_branch_id,p_warehouse_id,-v_take,v_batch.unit_cost,'production_consumption','production',v_production_id,v_batch_number,v_batch.batch_number,auth.uid());
      v_total_cost:=v_total_cost+(v_take*COALESCE(v_batch.unit_cost,0)); v_need:=v_need-v_take;
    END LOOP;
  END LOOP;
  v_unit_cost:=CASE WHEN p_quantity>0 THEN v_total_cost/p_quantity ELSE 0 END;
  INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date) VALUES(p_unit_id,p_branch_id,p_warehouse_id,v_batch_number,p_quantity,v_unit_cost,CURRENT_DATE);
  INSERT INTO public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,reference_id,batch_number,created_by) VALUES(p_unit_id,p_branch_id,p_warehouse_id,p_quantity,v_unit_cost,'production','production',v_production_id,v_batch_number,auth.uid());
  INSERT INTO public.inventory_unit_productions(id,unit_id,branch_id,warehouse_id,quantity,status,total_cost,started_at,completed_at,notes,created_by) VALUES(v_production_id,p_unit_id,p_branch_id,p_warehouse_id,p_quantity,'completed',v_total_cost,now(),now(),p_notes,auth.uid());
  UPDATE public.inventory_units SET cost_price=round(v_unit_cost,2),updated_at=now() WHERE id=p_unit_id;
  UPDATE public.products SET cost_price=round(v_unit_cost,2),updated_at=now() WHERE branch_id=p_branch_id AND product_type='manufactured' AND regexp_replace(lower(btrim(name)),'[ .]+$','','g')=regexp_replace(lower(btrim(v_unit_name)),'[ .]+$','','g');
  RETURN v_production_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.produce_inventory_unit(uuid,numeric,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produce_inventory_unit(uuid,numeric,uuid,uuid,text) TO authenticated, service_role;
