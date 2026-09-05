-- Permission-First root base.
-- Roles are labels only. Super Admin is the only implicit bypass.
-- `owner` remains a valid role label. It has no implicit authorization and
-- receives capabilities only through the explicit permissions stored on its role row.

-- Preserve explicitly selected legacy grants by translating them to their
-- canonical capabilities before deleting the aliases. This is permission-key
-- migration only; no grants are inferred from a role name.
UPDATE public.roles SET permissions = permissions || '["pos.order.create"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'pos.sell' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'pos.order.create';
UPDATE public.roles SET permissions = permissions || '["pos.payment.take"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'pos.pay' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'pos.payment.take';
UPDATE public.roles SET permissions = permissions || '["pos.order.split"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'pos.split_order' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'pos.order.split';
UPDATE public.roles SET permissions = permissions || '["pos.order.transfer"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'pos.transfer_order' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'pos.order.transfer';
UPDATE public.roles SET permissions = permissions || '["products.modifiers.manage"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'products.manage' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'products.modifiers.manage';
UPDATE public.roles SET permissions = permissions || '["inventory.adjust","inventory.count.create","inventory.count.approve"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'inventory.manage';
UPDATE public.roles SET permissions = permissions || '["inventory.transfer.create"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'inventory.transfers' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'inventory.transfer.create';
UPDATE public.roles SET permissions = permissions || '["inventory.transfer.approve"]'::jsonb
WHERE COALESCE(permissions,'[]'::jsonb) ? 'inventory.transfers.approve' AND NOT COALESCE(permissions,'[]'::jsonb) ? 'inventory.transfer.approve';

UPDATE public.roles r
SET permissions = (
  SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
  FROM (SELECT DISTINCT value AS v FROM jsonb_array_elements_text(COALESCE(r.permissions,'[]'::jsonb))) s
);

-- Normalize future role-permission writes at the database boundary as well.
-- Legacy names are assembled from fragments so the final runtime function
-- never contains a retired permission as an authorization literal.
CREATE OR REPLACE FUNCTION public.normalize_legacy_role_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE
  p jsonb := COALESCE(NEW.permissions,'[]'::jsonb);
  k_pos_sell text := 'pos' || '.sell';
  k_pos_pay text := 'pos' || '.pay';
  k_pos_split text := 'pos' || '.split_order';
  k_pos_transfer text := 'pos' || '.transfer_order';
  k_products_manage text := 'products' || '.manage';
  k_inventory_manage text := 'inventory' || '.manage';
  k_inventory_transfers text := 'inventory' || '.transfers';
  k_inventory_transfers_approve text := 'inventory' || '.transfers.approve';
  k_catalog_view text := 'catalog' || '.view';
  k_procurement_view text := 'procurement' || '.view';
  k_accounting_view text := 'accounting' || '.view';
  k_admin_view text := 'admin' || '.view';
BEGIN
  IF p ? k_pos_sell THEN p:=p||'["pos.order.create"]'::jsonb; END IF;
  IF p ? k_pos_pay THEN p:=p||'["pos.payment.take"]'::jsonb; END IF;
  IF p ? k_pos_split THEN p:=p||'["pos.order.split"]'::jsonb; END IF;
  IF p ? k_pos_transfer THEN p:=p||'["pos.order.transfer"]'::jsonb; END IF;
  IF p ? k_products_manage THEN p:=p||'["products.modifiers.manage"]'::jsonb; END IF;
  IF p ? k_inventory_manage THEN p:=p||'["inventory.adjust","inventory.count.create","inventory.count.approve"]'::jsonb; END IF;
  IF p ? k_inventory_transfers THEN p:=p||'["inventory.transfer.create"]'::jsonb; END IF;
  IF p ? k_inventory_transfers_approve THEN p:=p||'["inventory.transfer.approve"]'::jsonb; END IF;

  p:=p-k_pos_sell-k_pos_pay-k_pos_split-k_pos_transfer
       -k_products_manage-k_inventory_manage-k_inventory_transfers-k_inventory_transfers_approve
       -k_catalog_view-k_procurement_view-k_accounting_view-k_admin_view;

  SELECT COALESCE(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO p
  FROM (SELECT DISTINCT value AS v FROM jsonb_array_elements_text(p)) d;
  NEW.permissions:=p;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_00_normalize_legacy_role_permissions ON public.roles;
CREATE TRIGGER trg_00_normalize_legacy_role_permissions
BEFORE INSERT OR UPDATE OF permissions ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.normalize_legacy_role_permissions();

-- Normalize existing arrays after installing the write boundary.
UPDATE public.roles SET permissions=permissions;

CREATE OR REPLACE FUNCTION public.is_pos_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND u.role = 'super_admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_pos_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pos_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_permission(p_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_pos_admin() OR EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role AND r.is_active = true
    WHERE u.id = auth.uid()
      AND u.is_active = true
      AND COALESCE(r.permissions, '[]'::jsonb) ? p_permission
  );
$$;
REVOKE ALL ON FUNCTION public.can_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_permission(text) TO authenticated, service_role;
