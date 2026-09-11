create or replace function public.create_stock_count(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_count_type text,
  p_notes text default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count_id uuid;
  v_number text;
  v_item jsonb;
  v_product_id uuid;
  v_raw_material_id uuid;
  v_system_qty numeric(14,4);
  v_unit_cost numeric(12,4);
  v_user_branch uuid;
  v_rows integer := 0;
begin
  begin
    if not is_pos_admin() and not can_permission('inventory.count.create') then
      return jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    end if;
    if p_branch_id is null or p_warehouse_id is null then
      return jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_WAREHOUSE');
    end if;
    if p_count_type not in ('full', 'partial', 'cycle') then
      return jsonb_build_object('success', false, 'error', 'INVALID_COUNT_TYPE');
    end if;
    if not exists (select 1 from public.warehouses where id=p_warehouse_id and branch_id=p_branch_id) then
      return jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_IN_BRANCH');
    end if;
    if not is_pos_admin() then
      select branch_id into v_user_branch from public.users where id=auth.uid();
      if v_user_branch is not null and v_user_branch <> p_branch_id then
        return jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      end if;
    end if;

    v_number := (public.next_document_number('stock_count')->>'number')::text;
    insert into public.stock_counts(count_number,branch_id,warehouse_id,status,count_type,notes,created_by)
    values(v_number,p_branch_id,p_warehouse_id,'draft',p_count_type,p_notes,auth.uid())
    returning id into v_count_id;

    if p_items is not null and jsonb_array_length(p_items)>0 then
      for v_item in select * from jsonb_array_elements(p_items)
      loop
        v_product_id := nullif(v_item->>'product_id','')::uuid;
        v_raw_material_id := nullif(v_item->>'raw_material_id','')::uuid;
        if num_nonnulls(v_product_id,v_raw_material_id) <> 1 then
          raise exception 'INVALID_ITEM_KIND';
        end if;

        if v_raw_material_id is not null then
          if not exists(select 1 from public.raw_materials where id=v_raw_material_id and branch_id=p_branch_id and is_active=true) then
            raise exception 'RAW_MATERIAL_NOT_IN_BRANCH';
          end if;
          select coalesce(quantity,0),coalesce(avg_cost,0)
          into v_system_qty,v_unit_cost
          from public.raw_material_inventory
          where raw_material_id=v_raw_material_id and branch_id=p_branch_id;
          v_system_qty:=coalesce(v_system_qty,0);
          v_unit_cost:=coalesce(v_unit_cost,0);
          insert into public.stock_count_items(stock_count_id,product_id,raw_material_id,system_quantity,counted_quantity,unit_cost,reason)
          values(v_count_id,null,v_raw_material_id,v_system_qty,coalesce(nullif(v_item->>'counted_quantity','')::numeric,v_system_qty),v_unit_cost,nullif(v_item->>'reason',''));
        else
          if not exists(select 1 from public.products where id=v_product_id and branch_id=p_branch_id) then
            raise exception 'PRODUCT_NOT_IN_BRANCH';
          end if;
          select coalesce(i.quantity,0),coalesce(p.cost_price,0)
          into v_system_qty,v_unit_cost
          from public.products p left join public.inventory i on i.product_id=p.id and i.warehouse_id=p_warehouse_id
          where p.id=v_product_id;
          select coalesce(round(sum(quantity*unit_cost)/nullif(sum(quantity),0),2),0)
          into v_unit_cost from public.inventory_batches
          where product_id=v_product_id and warehouse_id=p_warehouse_id and quantity>0;
          v_unit_cost:=coalesce(v_unit_cost,0);
          insert into public.stock_count_items(stock_count_id,product_id,raw_material_id,system_quantity,counted_quantity,unit_cost,reason)
          values(v_count_id,v_product_id,null,coalesce(v_system_qty,0),coalesce(nullif(v_item->>'counted_quantity','')::numeric,v_system_qty),v_unit_cost,nullif(v_item->>'reason',''));
        end if;
        v_rows:=v_rows+1;
      end loop;
    end if;
    return jsonb_build_object('success',true,'stock_count_id',v_count_id,'count_number',v_number,'items_added',v_rows);
  exception when others then
    return jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',sqlerrm);
  end;
end;
$$;
