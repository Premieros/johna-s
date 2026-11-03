-- Explicit capability grant for the existing branch-manager permission template.
-- Authorization remains capability-based through can_permission(), never a role-name check.
-- Safe cancellation is limited to APPROVED counts with no stock or accounting postings.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

UPDATE public.roles
SET permissions = CASE
      WHEN COALESCE(permissions, '[]'::jsonb) ? 'inventory.count.create'
        THEN COALESCE(permissions, '[]'::jsonb)
      ELSE COALESCE(permissions, '[]'::jsonb) || '["inventory.count.create"]'::jsonb
    END,
    updated_at = now()
WHERE role = 'branch_manager'
  AND is_active = true
  AND COALESCE(permissions, '[]'::jsonb) ? 'inventory.view';

-- This is an explicit capability marker, not a role-name authorization bypass.
UPDATE public.roles
SET permissions = CASE
      WHEN COALESCE(permissions, '[]'::jsonb) ? 'platform.admin'
        THEN COALESCE(permissions, '[]'::jsonb)
      ELSE COALESCE(permissions, '[]'::jsonb) || '["platform.admin"]'::jsonb
    END,
    updated_at = now()
WHERE role = 'super_admin'
  AND is_active = true;

CREATE OR REPLACE FUNCTION public.is_pos_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active = true
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  );
$function$;

-- Keep the historical RLS helper name for compatibility, but authorize by
-- the internal capability rather than comparing users.role to a role label.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active = true
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.reject_stock_count(
  p_stock_count_id uuid,
  p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_cancel_approved boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT *
  INTO v_count
  FROM public.stock_counts
  WHERE id = p_stock_count_id
  FOR UPDATE;

  IF v_count.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_count.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_count.status = 'approved' THEN
    v_cancel_approved := true;

    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'CANCELLATION_REASON_REQUIRED');
    END IF;

    -- Refuse cancellation if any authoritative stock/accounting posting exists.
    IF v_count.applied_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.inventory_ledger
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory_unit_entries
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.stock_transactions
        WHERE reference_id = v_count.id
      )
      OR EXISTS (
        SELECT 1 FROM public.journal_entries
        WHERE reference_id = v_count.id
      )
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_HAS_POSTED_EFFECTS');
    END IF;

  ELSIF v_count.status = 'submitted' THEN
    IF NOT public.can_permission('inventory.count.reject') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'status', v_count.status
    );
  END IF;

  UPDATE public.stock_counts
  SET status = 'rejected',
      rejection_reason = CASE
        WHEN v_cancel_approved THEN btrim(p_reason)
        ELSE p_reason
      END,
      -- Preserve the original approval audit when cancelling an approved count.
      -- Keep legacy submitted-rejection metadata behavior unchanged.
      approved_by = CASE
        WHEN v_cancel_approved THEN approved_by
        ELSE auth.uid()
      END,
      approved_at = CASE
        WHEN v_cancel_approved THEN approved_at
        ELSE now()
      END
  WHERE id = v_count.id;

  RETURN jsonb_build_object(
    'success', true,
    'stock_count_id', v_count.id,
    'approved_unapplied_cancelled', v_cancel_approved
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'TRANSACTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_stock_count(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_count(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.reject_stock_count(uuid, text)
  IS 'Reject submitted counts using inventory.count.reject; cancel approved counts only for inventory.count.apply holders when no stock/accounting posting exists.';

-- Replace direct role-name authorization checks with the platform.admin capability.
CREATE OR REPLACE FUNCTION public._process_sale_core(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_user_branch uuid;
  v_role text;
  v_shift_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_unit_price numeric(12,2);
  v_discount_amount numeric(14,2);
  v_bonus_quantity numeric(14,4);
  v_item_total numeric(14,2);
  v_warehouse_ids uuid[];
  v_available numeric(14,4);
  v_res jsonb;
  v_mod jsonb;
  v_short numeric(14,4);
  v_cogs_total numeric(14,2) := 0;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2) := 0;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_ar numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_dr numeric(14,2) := 0;
  v_cr numeric(14,2) := 0;
  v_diff numeric(14,2);
  v_balance_account text;
  v_order_table uuid;
  v_effective_operator uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Subscription gate: only super_admin may sell on an expired / non-active
    -- subscription. Owners manage plans from the console but do not bypass.
    IF NOT public.is_super_admin() AND public.subscription_expired(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUBSCRIPTION_EXPIRED',
        'subscription', public.subscription_status(p_branch_id));
    END IF;

    SELECT role, branch_id INTO v_role, v_user_branch FROM public.users WHERE id = auth.uid();

    -- Branch isolation (mirror of RLS on sales)
    IF NOT is_pos_admin() THEN
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    -- Origin table must belong to the sale branch
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    -- Shift enforcement for register operators
    IF public.can_permission('pos.payment.take') AND NOT public.can_permission('shifts.manage') AND NOT public.is_pos_admin() THEN
      IF p_shift_id IS NULL THEN
        SELECT id INTO v_shift_id
        FROM shifts
        WHERE branch_id = p_branch_id AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM shifts
          WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'open'
        ) THEN
          RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
            'detail', 'Open a shift before selling. The sale was not created.');
        END IF;
        v_shift_id := p_shift_id;
      END IF;

      IF v_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT',
          'detail', 'Open a shift before selling. The sale was not created.');
      END IF;
    END IF;

    -- ===== VALIDATE the linked order BEFORE any writes =====
    -- FOUND (not the table value) is what matters: a held takeaway/delivery
    -- order legitimately has table_id = NULL and must still be payable. Any
    -- RETURN here is safe because nothing has been written yet.
    IF p_order_id IS NOT NULL THEN
      SELECT table_id INTO v_order_table
      FROM public.orders
      WHERE id = p_order_id AND branch_id = p_branch_id AND status IN ('open', 'held');

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND',
          'detail', 'The order must exist, belong to this branch, and be open or held. No sale was created.');
      END IF;
    END IF;

    -- Stock deduction scope: all active warehouses of the branch
    SELECT array_agg(id) INTO v_warehouse_ids
    FROM warehouses WHERE branch_id = p_branch_id AND is_active = true;

    -- ===== VALIDATION PHASE: check every item BEFORE writing anything =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND', 'product_id', v_product_id);
      END IF;

      -- Branch ownership: the product must belong to the sale branch
      IF NOT EXISTS (
        SELECT 1 FROM products WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH',
          'product_id', v_product_id, 'branch_id', p_branch_id);
      END IF;


      -- Accumulate the authoritative subtotal (catalog price, clamped discount)
      SELECT COALESCE(sale_price, 0) INTO v_unit_price FROM products WHERE id = v_product_id;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_unit_price := GREATEST(v_unit_price+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_subtotal := v_subtotal + ROUND(v_quantity * v_unit_price - v_discount_amount, 2);
    END LOOP;

    -- ===== SERVER-SIDE HEADER TOTALS (computed from authoritative prices) =====
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
    SELECT t.tax_enabled, t.tax_rate INTO v_tax_enabled, v_tax_rate
    FROM public._effective_branch_tax(p_branch_id) t;
    IF v_tax_enabled THEN
      v_tax := ROUND((v_subtotal - v_discount) * v_tax_rate / 100, 2);
    END IF;
    v_total := ROUND(v_subtotal - v_discount + v_tax, 2);
    v_paid := ROUND(LEAST(GREATEST(COALESCE(p_paid_amount, 0), 0), v_total), 2);
    v_ar := ROUND(GREATEST(v_total - v_paid, 0), 2);

    -- ===== WRITE PHASE 1: sale header (authoritative totals) =====
    v_effective_operator := COALESCE(p_salesperson_id, auth.uid());
    INSERT INTO sales (invoice_number, branch_id, warehouse_id, customer_id, cashier_id, salesperson_id,
      subtotal, discount_amount, discount_type, tax_amount, bonus_amount, total, paid_amount, payment_method, status, order_type, table_id, guest_count)
    VALUES (p_invoice_number, p_branch_id, p_warehouse_id, p_customer_id, v_effective_operator, v_effective_operator,
      v_subtotal, v_discount, p_discount_type, v_tax, COALESCE(p_bonus_amount, 0),
      v_total, v_paid, p_payment_method, p_status, COALESCE(p_order_type, 'takeaway'), p_table_id, p_guest_count)
    RETURNING id INTO v_sale_id;

    -- ===== WRITE PHASE 2: items + FIFO stock deduction + ledger =====
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_discount_amount := GREATEST(COALESCE((v_item->>'discount_amount')::numeric, 0), 0);

      SELECT sale_price INTO v_unit_price FROM products WHERE id = v_product_id;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_unit_price := GREATEST(COALESCE(v_unit_price,0)+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      IF v_discount_amount > v_quantity * v_unit_price THEN
        v_discount_amount := v_quantity * v_unit_price;
      END IF;
      v_bonus_quantity := COALESCE((v_item->>'bonus_quantity')::numeric, 0);
      v_item_total := ROUND(v_quantity * v_unit_price - v_discount_amount, 2);

      INSERT INTO sale_items (sale_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total, modifier_option_ids, modifiers_snapshot)
      VALUES (v_sale_id, v_product_id, COALESCE(v_item->>'unit_name', 'piece'),
        v_quantity, v_unit_price, v_discount_amount, v_bonus_quantity, v_item_total,
        ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb))),
        COALESCE(v_mod->'snapshot','[]'::jsonb)) RETURNING id INTO v_sale_item_id;

      v_res := public.deduct_sale_inventory_with_modifiers(
        p_branch_id,
        p_warehouse_id,
        jsonb_build_array(v_item),
        v_sale_id,
        p_invoice_number
      );
      IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'UNIT_SALE_DEDUCTION_FAILED: %', COALESCE(v_res->>'detail', v_res->>'error', 'unknown');
      END IF;
      INSERT INTO public.sale_item_inventory_effects(sale_item_id,sale_id,branch_id,warehouse_id,target_type,target_id,quantity)
      SELECT v_sale_item_id,v_sale_id,p_branch_id,p_warehouse_id,'inventory_unit',(e->>'unit_id')::uuid,(e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'units_deducted','[]'::jsonb)) e WHERE COALESCE((e->>'quantity')::numeric,0)>0
      ON CONFLICT (sale_item_id,target_type,target_id) DO UPDATE SET quantity=public.sale_item_inventory_effects.quantity+EXCLUDED.quantity;
      INSERT INTO public.sale_item_inventory_effects(sale_item_id,sale_id,branch_id,warehouse_id,target_type,target_id,quantity)
      SELECT v_sale_item_id,v_sale_id,p_branch_id,p_warehouse_id,'raw_material',(e->>'raw_material_id')::uuid,(e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'raw_materials_deducted','[]'::jsonb)) e WHERE COALESCE((e->>'quantity')::numeric,0)>0
      ON CONFLICT (sale_item_id,target_type,target_id) DO UPDATE SET quantity=public.sale_item_inventory_effects.quantity+EXCLUDED.quantity;
      INSERT INTO public.sale_item_inventory_effects(sale_item_id,sale_id,branch_id,warehouse_id,target_type,target_id,quantity)
      SELECT v_sale_item_id,v_sale_id,p_branch_id,p_warehouse_id,'product',(e->>'product_id')::uuid,(e->>'quantity')::numeric
      FROM jsonb_array_elements(COALESCE(v_res->'ready_products_deducted','[]'::jsonb)) e WHERE COALESCE((e->>'quantity')::numeric,0)>0
      ON CONFLICT (sale_item_id,target_type,target_id) DO UPDATE SET quantity=public.sale_item_inventory_effects.quantity+EXCLUDED.quantity;
      IF NULLIF(v_res->>'source_order_item_id','') IS NOT NULL THEN
        UPDATE public.sale_items
        SET source_order_item_id = NULLIF(v_res->>'source_order_item_id','')::uuid
        WHERE id=v_sale_item_id;
      ELSE
        UPDATE public.inventory_unit_entries
        SET source_sale_item_id=v_sale_item_id
        WHERE reference_type='sale'
          AND reference_id=v_sale_id
          AND source_sale_item_id IS NULL;
      END IF;

      v_cogs_total := v_cogs_total + COALESCE((v_res->>'total_cost')::numeric, 0);
    END LOOP;

    -- ===== WRITE PHASE 2b: settle the linked order + free tables atomically =====
    -- H4: only free a table when NO other open/held order still references it.
    -- H3: a direct dine-in sale (no linked order) frees its origin table here,
    --     inside the sale transaction, instead of client-side afterwards.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = p_order_id;
      -- NULL table (held takeaway/delivery) has no table to free.
      IF v_order_table IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE table_id = v_order_table AND status IN ('open', 'held') AND id <> p_order_id
      ) THEN
        UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
        WHERE id = v_order_table;
      END IF;
    ELSIF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    -- ===== WRITE PHASE 3: log the sale into the active shift =====
    IF v_shift_id IS NOT NULL THEN
      INSERT INTO shift_operations (shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by)
      VALUES (v_shift_id, 'sale', v_paid, p_payment_method, 'sale', v_sale_id, auth.uid());
    END IF;

    -- ===== WRITE PHASE 4: post the sales + COGS journal entry =====
    IF v_paid > 0 THEN
      v_balance_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
      v_lines := v_lines || jsonb_build_object('account_key', v_balance_account,
        'debit', v_paid, 'credit', 0, 'note', p_invoice_number);
      v_dr := v_dr + v_paid;
    END IF;
    IF v_ar > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'ar',
        'debit', v_ar, 'credit', 0, 'customer_id', p_customer_id, 'note', p_invoice_number);
      v_dr := v_dr + v_ar;
    END IF;
    IF v_discount > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', v_discount, 'credit', 0);
      v_dr := v_dr + v_discount;
    END IF;
    IF v_subtotal > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', 0, 'credit', v_subtotal);
      v_cr := v_cr + v_subtotal;
    END IF;
    IF v_tax > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', 0, 'credit', v_tax);
      v_cr := v_cr + v_tax;
    END IF;
    IF v_cogs_total > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', v_cogs_total, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', 0, 'credit', v_cogs_total);
      v_dr := v_dr + v_cogs_total;
      v_cr := v_cr + v_cogs_total;
    END IF;

    -- Balance any rounding/frontend discrepancy on the discount account so a
    -- posted entry is always balanced (normally the difference is zero).
    v_diff := round(v_dr - v_cr, 2);
    IF v_diff <> 0 THEN
      IF v_diff > 0 THEN
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
      ELSE
        v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
      END IF;
    END IF;

    PERFORM public._post_journal_entry(p_branch_id, 'sale', v_sale_id, p_invoice_number,
      'فاتورة مبيعات ' || p_invoice_number, v_lines);

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'invoice_number', p_invoice_number,
      'cogs', v_cogs_total);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'detail', SQLERRM);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$


CREATE OR REPLACE FUNCTION public.create_user(p_email text, p_password text, p_full_name text DEFAULT NULL::text, p_role text DEFAULT 'cashier'::text, p_branch_id uuid DEFAULT NULL::uuid, p_is_active boolean DEFAULT true, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_role text;
  v_hash text;
  v_email text;
  v_username text;
  v_pgc_schema text;
  v_u_cols text;
  v_u_vals text;
  v_i_cols text;
  v_i_vals text;
  v_creation_check jsonb;
BEGIN
  IF current_setting('app.register_branch', true) = 'on' THEN
    NULL;
  ELSIF public.is_pos_admin() THEN
    NULL;
  ELSE
    IF auth.uid() IS NULL OR NOT public.can_permission('users.create') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    v_creation_check := public.can_create_new_user();
    IF NOT COALESCE((v_creation_check->>'allowed')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_creation_check->>'error', 'USER_CREATION_DISABLED'));
    END IF;

    IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.role = p_role AND r.is_active
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'detail', 'Only Super Admin can create Super Admin accounts');
    END IF;
  END IF;

  v_email := lower(btrim(p_email));
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_REQUIRED');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
     OR EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMAIL_TAKEN');
  END IF;

  v_username := regexp_replace(
    regexp_replace(
      lower(btrim(coalesce(NULLIF(p_username, ''), split_part(v_email, '@', 1)))),
      '[^a-z0-9._-]', '_', 'g'
    ),
    '^[._-]+', '', 'g'
  );

  IF v_username = '' THEN
    v_username := 'user' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE role = p_role AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ROLE');
  END IF;
  v_role := p_role;

  SELECT extnamespace::regnamespace::text
  INTO v_pgc_schema
  FROM pg_extension
  WHERE extname = 'pgcrypto';

  IF v_pgc_schema IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'pgcrypto extension is not enabled');
  END IF;

  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))', v_pgc_schema, v_pgc_schema)
  INTO v_hash
  USING p_password, 'bf', 10;

  v_user_id := gen_random_uuid();

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_u_cols, v_u_vals
  FROM (
    SELECT cols.ordinal_position AS ord,
           quote_ident(cols.column_name) AS col,
           CASE cols.column_name
             WHEN 'instance_id' THEN '''00000000-0000-0000-0000-000000000000'''
             WHEN 'id' THEN quote_literal(v_user_id)
             WHEN 'aud' THEN '''authenticated'''
             WHEN 'role' THEN '''authenticated'''
             WHEN 'email' THEN quote_literal(v_email)
             WHEN 'encrypted_password' THEN quote_literal(v_hash)
             WHEN 'email_confirmed_at' THEN 'now()'
             WHEN 'confirmation_token' THEN ''''''
             WHEN 'recovery_token' THEN ''''''
             WHEN 'email_change' THEN ''''''
             WHEN 'email_change_token_new' THEN ''''''
             WHEN 'email_change_token_current' THEN ''''''
             WHEN 'raw_app_meta_data' THEN format('jsonb_build_object(''provider'',''email'',''providers'',array[''email'']::text[],''email'',%L)', v_email)
             WHEN 'raw_user_meta_data' THEN format('jsonb_build_object(''full_name'',%L,''email'',%L,''email_verified'',true)', p_full_name, v_email)
             WHEN 'created_at' THEN 'now()'
             WHEN 'updated_at' THEN 'now()'
             WHEN 'is_anonymous' THEN 'false'
             WHEN 'is_sso_user' THEN 'false'
           END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth'
      AND cols.table_name = 'users'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN (
        'instance_id','id','aud','role','email','encrypted_password','email_confirmed_at',
        'confirmation_token','recovery_token','email_change','email_change_token_new',
        'email_change_token_current','raw_app_meta_data','raw_user_meta_data','created_at',
        'updated_at','is_anonymous','is_sso_user'
      )
  ) c;

  IF v_u_cols IS NULL OR v_u_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.users');
  END IF;

  EXECUTE 'INSERT INTO auth.users (' || v_u_cols || ') VALUES (' || v_u_vals || ')';

  SELECT string_agg(c.col, ', ' ORDER BY c.ord), string_agg(c.val, ', ' ORDER BY c.ord)
  INTO v_i_cols, v_i_vals
  FROM (
    SELECT cols.ordinal_position AS ord,
           quote_ident(cols.column_name) AS col,
           CASE cols.column_name
             WHEN 'id' THEN 'gen_random_uuid()'
             WHEN 'provider_id' THEN quote_literal(v_user_id::text)
             WHEN 'user_id' THEN quote_literal(v_user_id)
             WHEN 'identity_data' THEN format('jsonb_build_object(''sub'',%L,''email'',%L)', v_user_id::text, v_email)
             WHEN 'provider' THEN '''email'''
             WHEN 'last_sign_in_at' THEN 'now()'
             WHEN 'created_at' THEN 'now()'
             WHEN 'updated_at' THEN 'now()'
             WHEN 'email' THEN quote_literal(v_email)
           END AS val
    FROM information_schema.columns cols
    WHERE cols.table_schema = 'auth'
      AND cols.table_name = 'identities'
      AND cols.is_generated = 'NEVER'
      AND cols.column_name IN ('id','provider_id','user_id','identity_data','provider','last_sign_in_at','created_at','updated_at','email')
  ) c;

  IF v_i_cols IS NULL OR v_i_vals IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', 'no insertable columns found for auth.identities');
  END IF;

  EXECUTE 'INSERT INTO auth.identities (' || v_i_cols || ') VALUES (' || v_i_vals || ')';

  INSERT INTO public.users (id,email,username,full_name,role,branch_id,is_active)
  VALUES (v_user_id,v_email,v_username,p_full_name,v_role,p_branch_id,p_is_active);

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$


CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_role text;
  v_target_branch uuid;
  v_fk record;
  v_has_dependency boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT role, branch_id INTO v_target_role, v_target_branch FROM public.users WHERE id = p_user_id;
  IF v_target_role IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED'); END IF;
    IF EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED'); END IF;
    IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE'); END IF;
    IF EXISTS (SELECT 1 FROM public.user_branch_access uba WHERE uba.user_id=p_user_id AND NOT public.user_may_access_branch(uba.branch_id)) THEN RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE'); END IF;
  END IF;
  FOR v_fk IN
    SELECT con.oid, con.conname, con.conrelid::regclass AS child_table, att.attname AS child_column, con.confdeltype
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
    WHERE con.contype='f' AND con.confrelid='public.users'::regclass AND array_length(con.conkey,1)=1
      AND con.confdeltype <> 'n'
      AND con.conname NOT IN ('user_branch_access_user_id_fkey','organization_members_user_id_fkey','user_kitchen_station_assignments_user_id_fkey')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',v_fk.child_table,v_fk.child_column) INTO v_has_dependency USING p_user_id;
    IF v_has_dependency THEN RETURN jsonb_build_object('success',false,'error','USER_HAS_DEPENDENCIES','dependency',v_fk.child_table::text,'action','DISABLE_USER_INSTEAD'); END IF;
  END LOOP;
  DELETE FROM public.users WHERE id=p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='sessions') THEN DELETE FROM auth.sessions WHERE user_id=p_user_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='identities') THEN DELETE FROM auth.identities WHERE user_id=p_user_id; END IF;
  DELETE FROM auth.users WHERE id=p_user_id;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='LAST_ADMIN' THEN RETURN jsonb_build_object('success',false,'error','LAST_ADMIN'); END IF;
  RETURN jsonb_build_object('success',false,'error','DELETE_BLOCKED');
END;
$function$


CREATE OR REPLACE FUNCTION public.guard_user_role_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = NEW.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) OR (
    TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.role = OLD.role AND r.is_active
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    )
  ) THEN
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
$function$


CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.is_super_admin();
$function$

CREATE OR REPLACE FUNCTION public.login_as_user(p_target_user_id uuid, p_reason text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_device text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_log_id uuid;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = auth.uid();
  IF v_admin.id IS NULL OR NOT v_admin.is_active OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT v_target.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_INACTIVE');
  END IF;
  IF v_target.id = v_admin.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_SELF');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = v_target.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_IMPERSONATE_ADMIN');
  END IF;

  INSERT INTO public.login_as_log (
    admin_user_id, admin_email, admin_branch_id, target_user_id, target_branch_id,
    reason, ip, device
  ) VALUES (
    v_admin.id, v_admin.email, v_admin.branch_id, v_target.id, v_target.branch_id,
    p_reason, p_ip, p_device
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'target', jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'username', v_target.username,
      'full_name', v_target.full_name,
      'role', v_target.role,
      'branch_id', v_target.branch_id,
      'phone', v_target.phone,
      'is_active', v_target.is_active,
      'is_locked', v_target.is_locked
    )
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_is_admin boolean := false;
  v_new_is_admin boolean := false;
  v_other_active_admins integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = OLD.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) INTO v_old_is_admin;

  IF TG_OP = 'DELETE' THEN
    IF v_old_is_admin AND OLD.is_active THEN
      SELECT count(*) INTO v_other_active_admins
      FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active
      WHERE u.is_active
        AND u.id <> OLD.id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin';
      IF v_other_active_admins = 0 THEN
        RAISE EXCEPTION 'LAST_ADMIN';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.role = NEW.role AND r.is_active
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
  ) INTO v_new_is_admin;

  IF v_old_is_admin AND OLD.is_active
     AND (NOT v_new_is_admin OR NOT NEW.is_active) THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active
    WHERE u.is_active
      AND u.id <> OLD.id
      AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin';
    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'LAST_ADMIN';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.requires_work_authorization(p_user_id uuid, p_branch_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_super boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_active = true
      AND EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.role = u.role AND r.is_active
          AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
      )
  ) INTO v_is_super;

  IF v_is_super THEN
    RETURN false;
  END IF;

  IF p_user_id = auth.uid()
     AND public.can_permission('work.authorization.bypass') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.work_authorization_policies p
    WHERE p.user_id = p_user_id
      AND p.branch_id = p_branch_id
      AND p.requires_authorization = true
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.set_user_branch_access(p_user_id uuid, p_branch_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_role text;
  v_target_primary uuid;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF array_length(p_branch_ids, 1) IS NULL OR array_length(p_branch_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'AT_LEAST_ONE_BRANCH');
  END IF;

  SELECT role, branch_id
  INTO v_target_role, v_target_primary
  FROM public.users
  WHERE id = p_user_id;

  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.can_permission('users.branches.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED',
        'detail', 'Only Super Admin can change Super Admin branch access');
    END IF;

    IF v_target_primary IS NOT NULL AND NOT public.user_may_access_branch(v_target_primary) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.user_branch_access uba
      WHERE uba.user_id = p_user_id
        AND NOT public.user_may_access_branch(uba.branch_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
    END IF;

    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED', 'branch_id', v_branch_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.user_branch_access WHERE user_id = p_user_id;
  INSERT INTO public.user_branch_access(user_id, branch_id)
  SELECT p_user_id, branch_id
  FROM unnest(p_branch_ids) AS branch_id
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  PERFORM public.log_audit_action(
    v_target_primary,
    'set_branch_access',
    'user_branch_access',
    p_user_id,
    jsonb_build_object('user_id', p_user_id, 'branch_ids', p_branch_ids)
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'branch_ids', p_branch_ids);
END;
$function$


CREATE OR REPLACE FUNCTION public.update_user_password(p_user_id uuid, p_new_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_hash text; v_pgc_schema text; v_target_role text; v_target_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
  SELECT role,branch_id INTO v_target_role,v_target_branch FROM public.users WHERE id=p_user_id;
  IF v_target_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','NOT_FOUND'); END IF;
  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('users.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
    IF EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role = u.role AND r.is_active = true
      WHERE u.id = p_user_id
        AND COALESCE(r.permissions, '[]'::jsonb) ? 'platform.admin'
    ) THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
    IF v_target_branch IS NULL OR NOT public.user_may_access_branch(v_target_branch) THEN RETURN jsonb_build_object('success',false,'error','TARGET_OUT_OF_SCOPE'); END IF;
  END IF;
  IF p_new_password IS NULL OR char_length(p_new_password)<4 THEN RETURN jsonb_build_object('success',false,'error','WEAK_PASSWORD'); END IF;
  IF char_length(p_new_password)=4 AND p_new_password !~ '^[0-9]{4}$' THEN RETURN jsonb_build_object('success',false,'error','WEAK_PASSWORD'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RETURN jsonb_build_object('success',false,'error','NOT_FOUND'); END IF;
  SELECT extnamespace::regnamespace::text INTO v_pgc_schema FROM pg_extension WHERE extname='pgcrypto';
  IF v_pgc_schema IS NULL THEN RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail','pgcrypto extension is not enabled'); END IF;
  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt($2, $3))',v_pgc_schema,v_pgc_schema) INTO v_hash USING p_new_password,'bf',10;
  UPDATE auth.users SET encrypted_password=v_hash,updated_at=now() WHERE id=p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='sessions') THEN DELETE FROM auth.sessions WHERE user_id=p_user_id; END IF;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail',SQLERRM);
END;
$function$


COMMIT;
