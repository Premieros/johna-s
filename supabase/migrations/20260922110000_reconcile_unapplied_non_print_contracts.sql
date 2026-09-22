-- Production migration reconciliation — 2026-09-22
-- Forward-only repair for canonical migrations whose final non-print effects are
-- absent from Production. Printing is intentionally frozen and excluded.
-- No cloud_print_jobs, Print Agent, printer routing, receipt payload, or print
-- station mutation is allowed in this migration.

-- === Product image Permission-First policies ===
-- Canonicalize product image mutation authorization.
-- Historical migrations used products.manage; the active model uses products.edit.
-- The storage schema is absent from lightweight CI Postgres, so this no-ops there.

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema unavailable; skipping product image policy canonicalization';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS product_images_insert_manage ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS product_images_update_manage ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS product_images_delete_manage ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS product_images_insert_edit ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS product_images_update_edit ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS product_images_delete_edit ON storage.objects';

  EXECUTE $policy$
    CREATE POLICY product_images_insert_edit
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'product-images'
      AND public.can_permission('products.edit')
      AND public.user_may_access_branch(((storage.foldername(name))[1])::uuid)
    )
  $policy$;

  EXECUTE $policy$
    CREATE POLICY product_images_update_edit
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'product-images'
      AND public.can_permission('products.edit')
      AND public.user_may_access_branch(((storage.foldername(name))[1])::uuid)
    )
    WITH CHECK (
      bucket_id = 'product-images'
      AND public.can_permission('products.edit')
      AND public.user_may_access_branch(((storage.foldername(name))[1])::uuid)
    )
  $policy$;

  EXECUTE $policy$
    CREATE POLICY product_images_delete_edit
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'product-images'
      AND public.can_permission('products.edit')
      AND public.user_may_access_branch(((storage.foldername(name))[1])::uuid)
    )
  $policy$;
END
$$;

-- Remove deprecated permission names from persisted role templates so future
-- assignments cannot silently revive the legacy model. Super Admin bypass is
-- implicit and does not depend on this array.
UPDATE public.roles r
SET permissions = COALESCE((
  SELECT jsonb_agg(p.value ORDER BY p.ordinality)
  FROM jsonb_array_elements(COALESCE(r.permissions, '[]'::jsonb)) WITH ORDINALITY AS p(value, ordinality)
  WHERE p.value #>> '{}' NOT IN (
    'pos.sell',
    'pos.pay',
    'pos.transfer_order',
    'pos.split_order',
    'products.manage',
    'inventory.manage',
    'inventory.transfers',
    'inventory.transfers.approve',
    'catalog.view',
    'procurement.view',
    'accounting.view',
    'admin.view'
  )
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(COALESCE(r.permissions, '[]'::jsonb)) AS p(permission)
  WHERE p.permission IN (
    'pos.sell',
    'pos.pay',
    'pos.transfer_order',
    'pos.split_order',
    'products.manage',
    'inventory.manage',
    'inventory.transfers',
    'inventory.transfers.approve',
    'catalog.view',
    'procurement.view',
    'accounting.view',
    'admin.view'
  )
);

-- === Purchase request permission alignment ===
-- Stage 1 stabilization: align Purchase Request creation with the canonical
-- Permission-First capability exposed by the application permission model.
--
-- Scope is deliberately narrow: this migration changes only the create RPC.
-- Submit/cancel/approve/reject transitions remain untouched until their
-- independent contracts are reviewed in a later approved stage.

DO $$
DECLARE
  v_oid regprocedure := to_regprocedure('public.create_purchase_request(uuid,uuid,text,date,text,jsonb)');
  v_def text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_REQUEST_PERMISSION_ALIGNMENT: create_purchase_request/6 missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  -- Idempotent when a reconciled schema is re-verified.
  IF position('can_permission(''procurement.request.create'')' IN v_def) > 0
     AND position('can_permission(''purchases.manage'')' IN v_def) = 0 THEN
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    'can_permission(''purchases.manage'')',
    'can_permission(''procurement.request.create'')'
  );
  v_new := replace(
    v_new,
    'Purchase requests require the purchases.manage permission.',
    'Purchase requests require the procurement.request.create permission.'
  );

  IF v_new IS NOT DISTINCT FROM v_def
     OR position('can_permission(''procurement.request.create'')' IN v_new) = 0
     OR position('can_permission(''purchases.manage'')' IN v_new) > 0 THEN
    RAISE EXCEPTION 'PURCHASE_REQUEST_PERMISSION_ALIGNMENT: expected legacy gate not found or replacement incomplete';
  END IF;

  EXECUTE v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_request(uuid,uuid,text,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_request(uuid,uuid,text,date,text,jsonb) TO authenticated, service_role;

-- === Raw-material stock-count create ===
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
    if not is_pos_admin() and not public.user_may_access_branch(p_branch_id) then
      return jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
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
          from public.raw_material_warehouse_inventory
          where raw_material_id=v_raw_material_id
            and branch_id=p_branch_id
            and warehouse_id=p_warehouse_id;
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

-- === Raw-material stock-count apply ===
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
        from public.raw_material_warehouse_inventory
        where raw_material_id=v_item.raw_material_id
          and branch_id=v_count.branch_id
          and warehouse_id=v_count.warehouse_id;
        v_current:=coalesce(v_current,0);
        v_variance:=v_item.counted_quantity-v_current;
        if v_variance>0 then
          v_res:=public._raw_add(v_item.raw_material_id,v_count.branch_id,v_count.warehouse_id,v_variance,v_item.unit_cost,null,null,null,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
          if not coalesce((v_res->>'success')::boolean,false) then
            return jsonb_build_object('success',false,'error','RAW_ADJUST_FAILED','raw_material_id',v_item.raw_material_id,'detail',v_res->>'error');
          end if;
        elsif v_variance<0 then
          v_res:=public._raw_remove_fifo(v_item.raw_material_id,v_count.branch_id,v_count.warehouse_id,-v_variance,'adjustment','stock_count',v_count.id,v_count.count_number,auth.uid());
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

-- === Purchase receive warehouse preflight ===
-- Purchases phase: keep receive_purchase_order failure paths atomic.
--
-- The legacy receive function created purchase_receipts / purchase_receipt_items
-- before discovering that an order had no usable warehouse. Returning a json
-- error does not roll back earlier statements in the function, so a failed
-- receive could leave an orphan GRN. Validate the canonical PO warehouse before
-- allocating a receipt number or writing any receipt/inventory rows.

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'receive_purchase_order'
    AND pg_get_function_identity_arguments(p.oid) = 'p_purchase_id uuid, p_receipt_items jsonb';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'receive_purchase_order target not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  v_old := $old$    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;
$old$;

  v_new := $new$    -- Preflight the canonical PO warehouse before any GRN write.  The
    -- inventory helpers already require branch-local active warehouses; doing
    -- this here keeps JSON failure responses side-effect free.
    IF v_purchase.warehouse_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Select a warehouse before receiving this purchase order.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = v_purchase.warehouse_id
        AND w.branch_id = v_purchase.branch_id
        AND w.is_active
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_BRANCH_MISMATCH',
        'warehouse_id', v_purchase.warehouse_id,
        'branch_id', v_purchase.branch_id
      );
    END IF;

    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'receive_purchase_order receipt-number marker changed unexpectedly';
    END IF;
    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  END IF;
END
$patch$;

NOTIFY pgrst, 'reload schema';

-- === Atomic whole-order table transfer ===
-- Atomic full-order table transfer.
-- Keeps transfer permission/branch/ownership checks on the server and updates
-- order + source/target table states inside one PostgreSQL transaction.

CREATE OR REPLACE FUNCTION public.transfer_order_to_table(
  p_order_id uuid,
  p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_source public.dining_tables%ROWTYPE;
  v_target public.dining_tables%ROWTYPE;
  v_source_still_occupied boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'pos.order.transfer'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.status NOT IN ('open', 'held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED');
  END IF;

  IF v_order.order_type <> 'dine_in' OR v_order.table_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_DINE_IN');
  END IF;

  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_order.cashier_id IS DISTINCT FROM v_uid
     AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
  END IF;

  IF p_target_table_id = v_order.table_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_TABLE');
  END IF;

  -- Lock source first, then target, to keep the state transition deterministic.
  SELECT * INTO v_source
  FROM public.dining_tables
  WHERE id = v_order.table_id
    AND branch_id = v_order.branch_id
  FOR UPDATE;

  IF v_source.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_TABLE_NOT_FOUND');
  END IF;

  SELECT * INTO v_target
  FROM public.dining_tables
  WHERE id = p_target_table_id
    AND branch_id = v_order.branch_id
    AND is_active = true
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_TABLE_NOT_FOUND');
  END IF;

  -- Full-order transfer is not merge. A target with another live order must be rejected.
  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_target_table_id
      AND o.branch_id = v_order.branch_id
      AND o.status IN ('open', 'held')
      AND o.id <> p_order_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_TABLE_OCCUPIED');
  END IF;

  UPDATE public.orders
  SET table_id = p_target_table_id,
      updated_at = now()
  WHERE id = p_order_id;

  UPDATE public.dining_tables
  SET status = 'occupied',
      updated_at = now()
  WHERE id = p_target_table_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_source.id
      AND o.branch_id = v_order.branch_id
      AND o.status IN ('open', 'held')
      AND o.id <> p_order_id
  ) INTO v_source_still_occupied;

  UPDATE public.dining_tables
  SET status = CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
      updated_at = now()
  WHERE id = v_source.id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    'ORDER_TABLE_TRANSFERRED',
    'order',
    p_order_id,
    jsonb_build_object(
      'source_table_id', v_source.id,
      'target_table_id', p_target_table_id,
      'source_status_after', CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
      'target_status_after', 'occupied'
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'source_table_id', v_source.id,
    'target_table_id', p_target_table_id,
    'source_table_status', CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
    'target_table_status', 'occupied'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_to_table(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_order_to_table(uuid, uuid) TO authenticated;

-- === User create/manage action alignment ===
-- Align the public.users mutation trigger with the granular user-action contract.
-- INSERT requires users.create; UPDATE remains under users.manage.
-- Super Admin is still the only implicit bypass.

CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bypass boolean;
  v_register boolean;
  v_unowned text;
  v_target_branch uuid;
BEGIN
  v_bypass := COALESCE(current_setting('app.login_guard_bypass', true), '') = 'on';
  v_register := COALESCE(current_setting('app.register_branch', true), '') = 'on';

  IF v_register THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = NEW.role AND is_active = true) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  -- Unknown/anonymous caller: preserve the narrow self-profile bootstrap/lockout paths.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.id = auth.uid() AND NEW.role = 'cashier' AND NEW.branch_id IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    RETURN NEW;
  END IF;

  IF public.is_pos_admin() THEN
    RETURN NEW;
  END IF;

  -- Non-admin users may edit their own profile fields, but never their own
  -- role, branch, status, or system-managed lock state.
  IF TG_OP = 'UPDATE' AND NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: users cannot change their own role/branch/status';
    END IF;

    IF NOT v_bypass AND (
      NEW.is_locked IS DISTINCT FROM OLD.is_locked
      OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
      OR NEW.lock_until IS DISTINCT FROM OLD.lock_until
    ) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: users cannot modify their own lock state';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.can_permission('users.create') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:users.create';
    END IF;
  ELSIF NOT public.can_permission('users.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:users.manage';
  END IF;

  IF NEW.role = 'super_admin' OR (TG_OP = 'UPDATE' AND OLD.role = 'super_admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only Super Admin can manage Super Admin accounts';
  END IF;

  v_target_branch := NEW.branch_id;
  IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN
    RAISE EXCEPTION 'TARGET_OUT_OF_SCOPE';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.branch_id IS NOT NULL
     AND NOT public.user_may_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'TARGET_OUT_OF_SCOPE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.role = NEW.role
      AND r.is_active = true
      AND (r.scope = 'global' OR r.branch_id = NEW.branch_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: role is not assignable in target branch';
  END IF;

  SELECT p.permission INTO v_unowned
  FROM public.roles r
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.permissions, '[]'::jsonb)) p(permission)
  WHERE r.role = NEW.role
    AND NOT public.can_permission(p.permission)
  ORDER BY p.permission
  LIMIT 1;

  IF v_unowned IS NOT NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: cannot assign role containing permission %', v_unowned;
  END IF;

  RETURN NEW;
END;
$function$;

-- === KDS keep paid orders until served (read-only queue visibility) ===
-- Keep kitchen work visible independently from payment settlement.
-- A paid order may become orders.status='completed' before the kitchen marks it served.
-- KDS must therefore be driven by kitchen_status + sent quantities, not by payment status.
-- Also resolve the fallback `main` station inside the requested branch only.

CREATE OR REPLACE FUNCTION public.get_kitchen_queue(
  p_station text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT get_branch_id()
)
RETURNS TABLE(
  order_id uuid,
  order_number text,
  table_number integer,
  station text,
  kitchen_status text,
  guest_count integer,
  notes text,
  created_at timestamptz,
  items jsonb,
  elapsed_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_has_assignments boolean;
  v_main_station_id uuid;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF p_branch_id IS NULL
     OR (NOT v_is_service_role AND NOT public.user_may_access_branch(p_branch_id))
     OR (NOT v_is_service_role AND NOT public.can_permission('pos.kds_view')) THEN
    RETURN;
  END IF;

  SELECT role
    INTO v_role
  FROM public.users
  WHERE id = auth.uid()
    AND is_active = true;

  -- `main` is branch-owned. Never pick another branch's same-code station.
  SELECT ks.id
    INTO v_main_station_id
  FROM public.kitchen_stations ks
  WHERE ks.branch_id = p_branch_id
    AND lower(btrim(ks.code)) = 'main'
    AND ks.is_active = true
  ORDER BY ks.sort_order, ks.id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_kitchen_station_assignments a
    WHERE a.user_id = auth.uid()
      AND a.branch_id = p_branch_id
  ) INTO v_has_assignments;

  RETURN QUERY
  WITH sent_items AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, MIN(oks.sent_at) OVER (PARTITION BY o.id), o.created_at) AS queue_at,
      oi.id AS item_id,
      oks.sent_quantity AS quantity,
      oi.notes AS item_notes,
      oi.modifiers_snapshot,
      p.name AS product_name,
      COALESCE(ks.id, v_main_station_id) AS station_id,
      COALESCE(ks.code, 'main') AS station_code
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.categories c
      ON c.id = p.category_id
     AND c.branch_id = o.branch_id
    LEFT JOIN public.kitchen_stations ks
      ON ks.id = c.kitchen_station_id
     AND ks.branch_id = o.branch_id
     AND ks.is_active = true
    WHERE o.branch_id = p_branch_id
      -- Payment completion must not remove unfinished kitchen work from KDS.
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND COALESCE(oks.sent_quantity, 0) > 0
  ),
  legacy_empty_orders AS (
    SELECT
      o.id AS oid,
      o.order_number AS onumber,
      o.kitchen_status AS kstatus,
      o.guest_count AS guests,
      o.notes AS onotes,
      COALESCE(o.kitchen_sent_at, o.created_at) AS queue_at,
      NULL::uuid AS item_id,
      NULL::numeric AS quantity,
      NULL::text AS item_notes,
      NULL::jsonb AS modifiers_snapshot,
      NULL::text AS product_name,
      COALESCE(
        legacy_station.id,
        CASE WHEN NULLIF(o.station, '') IS NULL THEN v_main_station_id ELSE NULL END
      ) AS station_id,
      COALESCE(NULLIF(o.station, ''), legacy_station.code, 'main') AS station_code
    FROM public.orders o
    LEFT JOIN public.kitchen_stations legacy_station
      ON legacy_station.branch_id = o.branch_id
     AND lower(btrim(legacy_station.code)) = lower(btrim(COALESCE(NULLIF(o.station, ''), 'main')))
     AND legacy_station.is_active = true
    WHERE o.branch_id = p_branch_id
      AND o.status IN ('open', 'held', 'completed')
      AND o.kitchen_status IN ('sent', 'cooking', 'ready')
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_kitchen_sends oks WHERE oks.order_id = o.id
      )
  ),
  queue_items AS (
    SELECT * FROM sent_items
    UNION ALL
    SELECT * FROM legacy_empty_orders
  ),
  allowed_items AS (
    SELECT qi.*
    FROM queue_items qi
    WHERE (p_station IS NULL OR qi.station_code = p_station)
      AND (
        v_is_service_role
        OR public.can_permission('settings.manage')
        OR NOT v_has_assignments
        OR EXISTS (
          SELECT 1
          FROM public.user_kitchen_station_assignments a
          WHERE a.user_id = auth.uid()
            AND a.branch_id = p_branch_id
            AND a.station_id = qi.station_id
        )
      )
  )
  SELECT
    ai.oid,
    ai.onumber,
    NULL::integer,
    ai.station_code,
    ai.kstatus,
    ai.guests,
    ai.onotes,
    MIN(ai.queue_at),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', ai.item_id,
          'product_name', ai.product_name,
          'quantity', ai.quantity,
          'notes', ai.item_notes,
          'modifiers', COALESCE(ai.modifiers_snapshot, '[]'::jsonb)
        )
        ORDER BY ai.item_id
      ) FILTER (WHERE ai.item_id IS NOT NULL),
      '[]'::jsonb
    ),
    GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ai.queue_at)))::integer, 0)
  FROM allowed_items ai
  GROUP BY ai.oid, ai.onumber, ai.station_code, ai.kstatus, ai.guests, ai.onotes
  ORDER BY MIN(ai.queue_at), ai.onumber, ai.station_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_kitchen_queue(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kitchen_queue(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- === Cross-operator void idempotent send-snapshot sync ===
-- Cross-operator partial sent-item Void hardening.
--
-- cancel_sent_order_item_exact already aligns order_kitchen_sends.sent_quantity
-- before inserting order_kitchen_voids. The AFTER INSERT sync trigger must not
-- issue a second UPDATE when the send snapshot is already correct, because that
-- no-op mutation still traverses ownership guards and can raise
-- ORDER_OPERATOR_REQUIRED for another operator's order.
--
-- Keep the trigger for legacy/audit insert paths, but only mutate when the
-- stored send quantity actually differs from the authoritative order-item qty.

CREATE OR REPLACE FUNCTION public.sync_kitchen_sent_quantity_after_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_current_quantity numeric(14,4);
  v_target_quantity numeric(14,4);
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    SELECT oi.quantity
    INTO v_current_quantity
    FROM public.order_items oi
    WHERE oi.id = NEW.order_item_id;

    v_target_quantity := GREATEST(COALESCE(v_current_quantity, 0), 0);

    UPDATE public.order_kitchen_sends
    SET sent_quantity = v_target_quantity,
        sent_at = now(),
        sent_by = COALESCE(NEW.voided_by, sent_by)
    WHERE order_item_id = NEW.order_item_id
      AND sent_quantity IS DISTINCT FROM v_target_quantity;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  TO service_role, postgres;

COMMENT ON FUNCTION public.sync_kitchen_sent_quantity_after_void() IS
  'Idempotently aligns the kitchen send snapshot after a sent-item void and skips no-op updates so controlled cross-operator partial voids do not trip ownership guards.';

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Production reconciliation patches that preserve newer live definitions.
-- Printing / Print Agent / cloud_print_jobs / printer routing are excluded.
-- ---------------------------------------------------------------------------

-- create_purchase_request: the canonical permission migration only replaced the
-- action permission. Also reconcile the branch guard to the active multi-branch
-- contract without changing the rest of the function.
DO $reconcile_purchase_request_branch$
DECLARE
  v_oid regprocedure := to_regprocedure('public.create_purchase_request(uuid,uuid,text,date,text,jsonb)');
  v_def text;
  v_old text := $old$
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
$old$;
  v_new text := $new$
    IF NOT is_pos_admin() AND NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_CREATE_PURCHASE_REQUEST_MISSING';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF position('public.user_may_access_branch(p_branch_id)' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_CREATE_PURCHASE_REQUEST_BRANCH_PATTERN_CHANGED';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$reconcile_purchase_request_branch$;

-- receive_purchase_order: preserve the current financial/inventory body and
-- replace only the legacy primary-branch equality check.
DO $reconcile_receive_purchase_branch$
DECLARE
  v_oid regprocedure := to_regprocedure('public.receive_purchase_order(uuid,jsonb)');
  v_def text;
  v_old text := $old$
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> v_purchase.branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
$old$;
  v_new text := $new$
    IF NOT is_pos_admin() AND NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_RECEIVE_PURCHASE_MISSING';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF position('public.user_may_access_branch(v_purchase.branch_id)' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_RECEIVE_PURCHASE_BRANCH_PATTERN_CHANGED';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$reconcile_receive_purchase_branch$;

-- create_order: retain later table-shell occupancy behavior, but install the
-- missing Permission-First / operator-assignment contract.
DO $reconcile_create_order$
DECLARE
  v_oid regprocedure := to_regprocedure('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)');
  v_def text;
  v_old_decl text := $old$
  v_quantity numeric(14,4);
$old$;
  v_new_decl text := $new$
  v_quantity numeric(14,4);
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_cashier uuid;
$new$;
  v_old_guard text := $old$
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> p_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$;
  v_new_guard text := $new$
    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
      END IF;
      IF NOT public.can_permission('pos.order.create') THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.create');
      END IF;
      IF NOT public.user_may_access_branch(p_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF p_cashier_id IS NOT NULL AND p_cashier_id IS DISTINCT FROM v_uid THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN',
          'detail', 'Authenticated POS users cannot create an order in another operator''s name.'
        );
      END IF;
      v_effective_cashier := v_uid;
    ELSE
      v_effective_cashier := p_cashier_id;
    END IF;
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_CREATE_ORDER_MISSING';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF position('pos.order.create' IN v_def) > 0
     AND position('ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position('v_effective_cashier uuid;' IN v_def) = 0 THEN
    IF position(v_old_decl IN v_def) = 0 THEN
      RAISE EXCEPTION 'RECONCILE_CREATE_ORDER_DECL_PATTERN_CHANGED';
    END IF;
    v_def := replace(v_def, v_old_decl, v_new_decl);
  END IF;

  IF position(v_old_guard IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_CREATE_ORDER_GUARD_PATTERN_CHANGED';
  END IF;
  v_def := replace(v_def, v_old_guard, v_new_guard);

  IF position('COALESCE(p_cashier_id, auth.uid())' IN v_def) > 0 THEN
    v_def := replace(v_def, 'COALESCE(p_cashier_id, auth.uid())', 'v_effective_cashier');
  ELSIF position('v_effective_cashier' IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_CREATE_ORDER_CASHIER_PATTERN_CHANGED';
  END IF;

  EXECUTE v_def;
END
$reconcile_create_order$;

-- update_order: preserve the later note-identity fix and table reconciliation,
-- while adding the missing edit permission, ownership guard, row lock, and
-- protection against reducing/deleting already-sent quantity.
DO $reconcile_update_order$
DECLARE
  v_oid regprocedure := to_regprocedure('public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)');
  v_def text;
  v_old_decl text := $old$
  v_matched_id uuid;
$old$;
  v_new_decl text := $new$
  v_matched_id uuid;
  v_owner_id uuid;
  v_sent_quantity numeric(14,4);
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
$new$;
  v_old_select text := $old$
    SELECT branch_id, table_id, status INTO v_branch_id, v_old_table, v_old_status
    FROM public.orders WHERE id = p_order_id;
$old$;
  v_new_select text := $new$
    SELECT branch_id, table_id, status, cashier_id
    INTO v_branch_id, v_old_table, v_old_status, v_owner_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
$new$;
  v_old_guard text := $old$
    SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
    IF NOT is_pos_admin() AND COALESCE(v_user_branch, '00000000-0000-0000-0000-000000000000'::uuid) <> v_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$;
  v_new_guard text := $new$
    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
      END IF;
      IF NOT public.can_permission('pos.order.edit') THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.edit');
      END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT public.can_manage_other_pos_orders() THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
      END IF;
    END IF;
$new$;
  v_match_old text := $old$
      IF v_matched_id IS NOT NULL THEN
        UPDATE public.order_items SET
$old$;
  v_match_new text := $new$
      IF v_matched_id IS NOT NULL THEN
        SELECT COALESCE(s.sent_quantity, 0)
        INTO v_sent_quantity
        FROM public.order_items oi
        LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
        WHERE oi.id = v_matched_id;

        IF v_quantity + 0.000001 < COALESCE(v_sent_quantity, 0) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
            'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity',
            'order_item_id', v_matched_id,
            'sent_quantity', v_sent_quantity
          );
        END IF;

        UPDATE public.order_items SET
$new$;
  v_delete_old text := $old$
    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
$old$;
  v_delete_new text := $new$
    IF EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND COALESCE(s.sent_quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id
        )
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
        'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity'
      );
    END IF;

    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_MISSING';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF position('pos.order.edit' IN v_def) > 0
     AND position('ORDER_OPERATOR_REQUIRED' IN v_def) > 0
     AND position('SENT_ITEM_CHANGE_REQUIRES_VOID' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position('v_owner_id uuid;' IN v_def) = 0 THEN
    IF position(v_old_decl IN v_def) = 0 THEN
      RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_DECL_PATTERN_CHANGED';
    END IF;
    v_def := replace(v_def, v_old_decl, v_new_decl);
  END IF;

  IF position(v_old_select IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_SELECT_PATTERN_CHANGED';
  END IF;
  v_def := replace(v_def, v_old_select, v_new_select);

  IF position(v_old_guard IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_GUARD_PATTERN_CHANGED';
  END IF;
  v_def := replace(v_def, v_old_guard, v_new_guard);

  IF position(v_match_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_MATCH_PATTERN_CHANGED';
  END IF;
  v_def := replace(v_def, v_match_old, v_match_new);

  IF position(v_delete_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILE_UPDATE_ORDER_DELETE_PATTERN_CHANGED';
  END IF;
  v_def := replace(v_def, v_delete_old, v_delete_new);

  EXECUTE v_def;
END
$reconcile_update_order$;

NOTIFY pgrst, 'reload schema';

