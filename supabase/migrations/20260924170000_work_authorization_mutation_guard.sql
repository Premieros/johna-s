-- Work Authorization mutation-time enforcement.
-- This is intentionally separate from the entry gate:
-- - no polling
-- - no extra frontend RPC before every action
-- - one server-side authorization check per user+branch+transaction
-- - service/background calls without an authenticated user are not blocked
-- - printing/KDS/work-authorization tables are not guarded here
-- - shift lifecycle remains independent from work authorization

-- Private transaction-scoped bootstrap marker for create_organization_branch.
-- Authenticated callers cannot read or write this table directly. The SECURITY
-- DEFINER branch-creation RPC inserts and removes the marker in the same
-- transaction, and the mutation guard uses it only for that exact user+branch.
CREATE TABLE IF NOT EXISTS public.work_authorization_branch_bootstrap (
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, branch_id)
);

ALTER TABLE public.work_authorization_branch_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_authorization_branch_bootstrap FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_user_work_authorized_cached(
  p_branch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := COALESCE(current_setting('role', true), '');
  v_cache_key text;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN;
  END IF;

  -- Service/background work must keep running independently from the employee gate.
  IF v_user_id IS NULL OR v_role = 'service_role' THEN
    RETURN;
  END IF;

  v_cache_key := v_user_id::text || ':' || p_branch_id::text;

  -- One authoritative lookup per branch inside the current transaction.
  IF current_setting('app.work_authorization_guard_key', true) = v_cache_key THEN
    RETURN;
  END IF;

  PERFORM public.assert_user_work_authorized(p_branch_id);
  PERFORM set_config('app.work_authorization_guard_key', v_cache_key, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_user_work_authorized_cached(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_user_work_authorized_cached(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_user_work_authorized_cached(uuid) FROM authenticated;

COMMENT ON FUNCTION public.assert_user_work_authorized_cached(uuid)
IS 'Mutation-time work authorization assertion cached locally for the current transaction; never a polling/network check.';

CREATE OR REPLACE FUNCTION public.enforce_work_authorization_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := COALESCE(current_setting('role', true), '');
  v_old_branch_id uuid;
  v_new_branch_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Narrow branch-bootstrap exception. The marker is private, uncommitted
  -- outside this transaction, and keyed to the authenticated caller + branch.
  -- This cannot be created through the Data API by authenticated users.
  IF TG_OP <> 'DELETE'
     AND EXISTS (
       SELECT 1
       FROM public.work_authorization_branch_bootstrap wab
       WHERE wab.user_id = v_user_id
         AND wab.branch_id = NULLIF(to_jsonb(NEW)->>'branch_id', '')::uuid
     ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_branch_id := NULLIF(to_jsonb(OLD)->>'branch_id', '')::uuid;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_branch_id := NULLIF(to_jsonb(NEW)->>'branch_id', '')::uuid;
  END IF;

  IF v_old_branch_id IS NOT NULL THEN
    PERFORM public.assert_user_work_authorized_cached(v_old_branch_id);
  END IF;

  IF v_new_branch_id IS NOT NULL
     AND v_new_branch_id IS DISTINCT FROM v_old_branch_id THEN
    PERFORM public.assert_user_work_authorized_cached(v_new_branch_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_work_authorization_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_work_authorization_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_work_authorization_mutation() FROM authenticated;

COMMENT ON FUNCTION public.enforce_work_authorization_mutation()
IS 'Row mutation guard for branch-scoped operational headers/state. Printing, KDS and shift lifecycle are intentionally outside this trigger set.';

DO $guard$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'orders',
    'sales',
    'sale_payments',
    'purchases',
    'purchase_requests',
    'purchase_receipts',
    'rfqs',
    'supplier_quotations',
    'warehouse_transfers',
    'stock_counts',
    'expenses',
    'customer_payments',
    'supplier_payments',
    'treasury_transactions',
    'bank_reconciliations',
    'employee_receivable_entries',
    'inventory',
    'inventory_batches',
    'raw_material_inventory',
    'raw_material_batches',
    'stock_transactions',
    'waste_entries',
    'journal_entries',
    'products',
    'categories',
    'customers',
    'suppliers',
    'raw_materials',
    'warehouses',
    'inventory_units',
    'chart_of_accounts',
    'dining_areas',
    'dining_tables',
    'product_modifier_groups',
    'product_modifier_group_products',
    'product_modifier_options',
    'kitchen_stations',
    'user_kitchen_station_assignments',
    'recipes'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'WORK_AUTHORIZATION_GUARD_TABLE_MISSING:%', v_table;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_work_authorization_mutation_guard ON public.%I',
      v_table
    );

    EXECUTE format(
      'CREATE TRIGGER trg_work_authorization_mutation_guard
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.enforce_work_authorization_mutation()',
      v_table
    );
  END LOOP;
END
$guard$;

-- Deliberate exclusions:
--   cloud_print_jobs / cloud_print_wake_state  -> printing remains independent.
--   order_kitchen_* / kitchen_*               -> KDS/print transport remains independent.
--   shifts / daily_closes / business_day_state -> authorization stays shift-independent.
--   work_authorization_* / approval_*          -> approvers can operate the authorization center.


-- Child table without branch_id: derive authorization scope from the parent product.
CREATE OR REPLACE FUNCTION public.enforce_work_authorization_product_component_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := COALESCE(current_setting('role', true), '');
  v_old_product_id uuid;
  v_new_product_id uuid;
  v_branch_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_product_id := OLD.product_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_product_id := NEW.product_id;
  END IF;

  IF v_old_product_id IS NOT NULL THEN
    SELECT p.branch_id INTO v_branch_id
    FROM public.products p
    WHERE p.id = v_old_product_id;
    IF v_branch_id IS NOT NULL THEN
      PERFORM public.assert_user_work_authorized_cached(v_branch_id);
    END IF;
  END IF;

  IF v_new_product_id IS NOT NULL
     AND v_new_product_id IS DISTINCT FROM v_old_product_id THEN
    SELECT p.branch_id INTO v_branch_id
    FROM public.products p
    WHERE p.id = v_new_product_id;
    IF v_branch_id IS NOT NULL THEN
      PERFORM public.assert_user_work_authorized_cached(v_branch_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_work_authorization_product_component_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_work_authorization_product_component_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_work_authorization_product_component_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_work_authorization_product_component_guard ON public.product_components;
CREATE TRIGGER trg_work_authorization_product_component_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.product_components
FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_authorization_product_component_mutation();

COMMENT ON FUNCTION public.enforce_work_authorization_product_component_mutation()
IS 'Work authorization guard for product_components, deriving branch scope from the parent product.';


-- Branch bootstrap ordering:
-- Grant the creator access to the newly-created branch before inserting guarded
-- branch-scoped setup rows (such as the main warehouse). This preserves the
-- direct-write guard without introducing a generic bypass for internal RPCs.
CREATE OR REPLACE FUNCTION public.create_organization_branch(
  p_organization_id uuid,
  p_name text,
  p_name_en text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_global_tax numeric(5,2);
  v_global_tax_enabled boolean;
  v_global_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF NOT public.can_permission('branches.manage')
       OR NOT public.user_can_access_organization(p_organization_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  IF btrim(COALESCE(p_name, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_BRANCH_NAME');
  END IF;

  INSERT INTO public.branches (name, name_en, address, phone, is_active, organization_id)
  VALUES (p_name, p_name_en, p_address, p_phone, true, p_organization_id)
  RETURNING id INTO v_branch_id;

  -- The creator must enter branch scope before any guarded setup rows are written.
  INSERT INTO public.user_branch_access (user_id, branch_id)
  VALUES (auth.uid(), v_branch_id)
  ON CONFLICT (user_id, branch_id) DO NOTHING;

  -- The new branch cannot have an approval row before bootstrap completes.
  -- Create a private marker for only this caller+branch and remove it before
  -- returning. Any exception rolls the marker back with the whole transaction.
  INSERT INTO public.work_authorization_branch_bootstrap (user_id, branch_id)
  VALUES (auth.uid(), v_branch_id);

  INSERT INTO public.warehouses (name, branch_id, is_active)
  VALUES (p_name || ' - Main', v_branch_id, true)
  RETURNING id INTO v_warehouse_id;

  SELECT COALESCE(tax_rate, 15), COALESCE(tax_enabled, true), COALESCE(currency, 'EGP')
  INTO v_global_tax, v_global_tax_enabled, v_global_currency
  FROM public.settings
  ORDER BY id
  LIMIT 1;

  INSERT INTO public.branch_settings (branch_id, tax_rate, tax_enabled, currency, low_stock_threshold)
  VALUES (v_branch_id, v_global_tax, v_global_tax_enabled, v_global_currency, 10);

  INSERT INTO public.branch_subscriptions (branch_id, status, trial_starts_at, trial_ends_at)
  VALUES (v_branch_id, 'trial', now(), now() + interval '14 days');

  DELETE FROM public.work_authorization_branch_bootstrap
  WHERE user_id = auth.uid()
    AND branch_id = v_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', v_branch_id,
    'warehouse_id', v_warehouse_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'BRANCH_CREATE_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_branch(uuid,text,text,text,text) TO authenticated, service_role;
