-- Add independently enforceable real application modules.
-- The role permission gate already calls _permission_feature_key, so this
-- migration only extends the canonical mapping and the Super Admin allowlist.
-- No organizations, branches, tax rates, accounting rows or module overrides
-- are changed. Existing default behavior is preserved.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

DO $validate$
BEGIN
  IF to_regclass('public.organization_feature_overrides') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.features WHERE key='costing' AND is_active)
    OR NOT EXISTS (SELECT 1 FROM public.features WHERE key='advanced_reports' AND is_active)
    THEN RAISE EXCEPTION 'ORGANIZATION_MODULE_PHASE2_DEPENDENCIES_MISSING';
  END IF;
END;
$validate$;

CREATE OR REPLACE FUNCTION public._permission_feature_key(p_permission text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO public,pg_temp
AS $fn$
 SELECT CASE
  WHEN p_permission LIKE 'pos.kds_%' THEN 'kds'
  WHEN p_permission='pos.order.delivery' THEN 'delivery'
  WHEN p_permission LIKE 'pos.%' THEN 'pos'
  WHEN p_permission LIKE 'floor_plan.%' THEN 'tables'
  WHEN p_permission LIKE 'inventory.count.%' THEN 'stock_counts'
  WHEN p_permission LIKE 'inventory.transfer.%' THEN 'transfers'
  WHEN p_permission LIKE 'inventory.%' THEN 'inventory'
  WHEN p_permission LIKE 'raw_materials.%' OR p_permission LIKE 'components.%' THEN 'inventory'
  WHEN p_permission LIKE 'warehouses.%' THEN 'warehouse_management'
  WHEN p_permission LIKE 'recipes.%' THEN 'recipes'
  WHEN p_permission LIKE 'production.%' THEN 'manufacturing'
  WHEN p_permission LIKE 'waste.%' THEN 'waste_management'
  WHEN p_permission LIKE 'purchases.%' OR p_permission LIKE 'procurement.%' THEN 'purchases'
  WHEN p_permission LIKE 'customers.%' THEN 'customers'
  WHEN p_permission LIKE 'suppliers.%' THEN 'suppliers'
  WHEN p_permission='reports.costing' THEN 'costing'
  WHEN p_permission='reports.financial' THEN 'advanced_reports'
  WHEN p_permission LIKE 'reports.%' THEN 'reports'
  WHEN p_permission LIKE 'accounts.%' OR p_permission LIKE 'accounting.%'
    OR p_permission LIKE 'expenses.%' THEN 'accounting'
  WHEN p_permission LIKE 'shifts.%' THEN 'shift_management'
  WHEN p_permission LIKE 'audit.%' THEN 'audit_logs'
  WHEN p_permission LIKE 'roles.%' THEN 'advanced_permissions'
  WHEN p_permission LIKE 'branches.%' THEN 'branch_management'
  WHEN p_permission LIKE 'users.%' THEN 'employees'
  WHEN p_permission LIKE 'sales.%' OR p_permission LIKE 'refunds.%' THEN 'pos'
  ELSE NULL END;
$fn$;

REVOKE ALL ON FUNCTION public._permission_feature_key(text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_set_organization_module(
  p_organization_id uuid,p_feature_key text,p_enabled boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp
AS $fn$
DECLARE v_feature_id uuid; v_system boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_enabled IS NULL OR p_organization_id IS NULL OR NOT EXISTS
    (SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_ORGANIZATION');
  END IF;
  SELECT id,is_system INTO v_feature_id,v_system
  FROM public.features WHERE key=p_feature_key AND is_active=true;
  IF v_feature_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FEATURE_NOT_FOUND');
  END IF;
  -- This list names modules backed by actual permission gates. Other keys
  -- remain uneditable until their API and DB operations are secured.
  IF p_feature_key NOT IN (
    'kds','delivery','pos','tables','stock_counts','transfers','inventory',
    'warehouse_management','recipes','manufacturing','waste_management',
    'purchases','customers','suppliers','reports','accounting',
    'shift_management','audit_logs','advanced_permissions',
    'branch_management','employees','costing','advanced_reports'
  ) THEN
    RETURN jsonb_build_object('success',false,'error','MODULE_ENFORCEMENT_NOT_READY');
  END IF;
  IF v_system AND NOT p_enabled THEN
    RETURN jsonb_build_object('success',false,'error','SYSTEM_MODULE_LOCKED');
  END IF;
  INSERT INTO public.organization_feature_overrides
    (organization_id,feature_id,enabled,updated_by,updated_at)
  VALUES (p_organization_id,v_feature_id,p_enabled,auth.uid(),now())
  ON CONFLICT (organization_id,feature_id) DO UPDATE
  SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  PERFORM public.log_audit_action(NULL::uuid,'set_organization_module',
    'organizations',p_organization_id,
    jsonb_build_object('feature_key',p_feature_key,'enabled',p_enabled));
  RETURN jsonb_build_object('success',true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_set_organization_module(uuid,text,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_set_organization_module(uuid,text,boolean)
 TO authenticated;
COMMIT;
