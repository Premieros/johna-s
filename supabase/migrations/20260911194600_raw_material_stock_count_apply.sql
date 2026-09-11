create or replace function public.apply_stock_count(p_stock_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count public.stock_counts%rowtype;
  v_item public.stock_count_items%rowtype;
  v_current numeric(14,4);
  v_variance numeric(14,4);
  v_applied integer := 0;
  v_res jsonb;
  v_shortage numeric(14,4);
begin
  begin
    select * into v_count from public.stock_counts where id=p_stock_count_id for update;
    if v_count.id is null then return jsonb_build_object('success',false,'error','COUNT_NOT_FOUND'); end if;
    if v_count.status <> 'approved' then return jsonb_build_object('success',false,'error','COUNT_NOT_APPROVED','status',v_count.status); end if;
    if not public.can_permission('inventory.count.approve') then
      return jsonb_build_object('success',false,'error','NOT_ALLOWED');
    end if;
    if not public.user_may_access_branch(v_count.branch_id) then
      return jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    end if;

    for v_item in select * from public.stock_count_items where stock_count_id=p_stock_count_id order by id for update
    loop
      if v_item.raw_material_id is not null then
        select coalesce(quantity,0) into v_current
        from public.raw_material_inventory
        where raw_material_id=v_item.raw_material_id and branch_id=v_count.branch_id;
        v_current:=coalesce(v_current,0);
        v_variance:=v_item.counted_quantity-v_current;
        if v_variance>0 then
          v_res:=public._raw_add(v_item.raw_material_id,v_count.branch_id,v_variance,v_item.unit_cost,null,null,null,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
          if not coalesce((v_res->>'success')::boolean,false) then
            return jsonb_build_object('success',false,'error','RAW_ADJUST_FAILED','raw_material_id',v_item.raw_material_id,'detail',v_res->>'error');
          end if;
        elsif v_variance<0 then
          v_res:=public._raw_remove_fifo(v_item.raw_material_id,v_count.branch_id,-v_variance,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
          v_shortage:=coalesce((v_res->>'shortage')::numeric,0);
          if v_shortage>0 then
            return jsonb_build_object('success',false,'error','STOCK_COUNT_SHORTAGE','raw_material_id',v_item.raw_material_id,'shortage',v_shortage);
          end if;
        end if;
      else
        select coalesce(quantity,0) into v_current from public.inventory
        where product_id=v_item.product_id and warehouse_id=v_count.warehouse_id;
        v_current:=coalesce(v_current,0);
        v_variance:=v_item.counted_quantity-v_current;
        if v_variance>0 then
          v_res:=public._product_inv_add(v_item.product_id,v_count.warehouse_id,v_count.branch_id,v_variance,v_item.unit_cost,null,null,null,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
          if not coalesce((v_res->>'success')::boolean,false) then
            return jsonb_build_object('success',false,'error','ADJUST_FAILED','product_id',v_item.product_id,'detail',v_res->>'error');
          end if;
        elsif v_variance<0 then
          v_res:=public._product_inv_remove_fifo(v_item.product_id,v_count.warehouse_id,v_count.branch_id,-v_variance,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
          v_shortage:=coalesce((v_res->>'shortage')::numeric,0);
          if v_shortage>0 then
            return jsonb_build_object('success',false,'error','STOCK_COUNT_SHORTAGE','product_id',v_item.product_id,'shortage',v_shortage);
          end if;
        end if;
      end if;
      v_applied:=v_applied+1;
    end loop;

    update public.stock_counts set status='applied',applied_at=now() where id=p_stock_count_id;
    return jsonb_build_object('success',true,'items_applied',v_applied);
  exception when others then
    return jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',sqlerrm);
  end;
end;
$$;
