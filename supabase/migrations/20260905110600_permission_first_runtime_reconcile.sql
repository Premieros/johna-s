-- Final Permission-First runtime reconciliation.
-- Role values are display labels only. Super Admin is the only implicit bypass.

DO $$
DECLARE r record; d text; n text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.prokind='f'
  LOOP
    d:=r.def; n:=d;

    n:=replace(n,'''pos.pay''','''pos.payment.take''');
    n:=replace(n,'''pos.sell''','''pos.order.create''');
    n:=replace(n,'''pos.split_order''','''pos.order.split''');
    n:=replace(n,'''pos.transfer_order''','''pos.order.transfer''');
    n:=replace(n,'''inventory.transfers.approve''','''inventory.transfer.approve''');
    n:=replace(n,'''inventory.transfers''','''inventory.transfer.create''');
    n:=replace(n,'''products.manage''','''products.modifiers.manage''');

    IF r.proname IN ('create_stock_count','add_stock_count_item','update_stock_count_item','remove_stock_count_item','submit_stock_count') THEN
      n:=replace(n,'''inventory.manage''','''inventory.count.create''');
    ELSIF r.proname IN ('approve_stock_count','reject_stock_count','apply_stock_count') THEN
      n:=replace(n,'''inventory.manage''','''inventory.count.approve''');
    ELSIF r.proname IN ('add_inventory_batch','adjust_stock','adjust_raw_stock') THEN
      n:=replace(n,'''inventory.manage''','''inventory.adjust''');
    ELSIF r.proname IN ('decide_operational_approval','get_operational_approval_queue','enforce_approval_policy_transition') THEN
      n:=replace(n,'''inventory.manage''','''approvals.review''');
    END IF;

    -- Remove owner from implicit role gates while preserving owner as a label.
    n:=replace(n,'NOT IN (''super_admin'', ''owner'')','<> ''super_admin''');
    n:=replace(n,'NOT IN (''super_admin'',''owner'')','<> ''super_admin''');
    n:=replace(n,'IN (''super_admin'', ''owner'')','= ''super_admin''');
    n:=replace(n,'IN (''super_admin'',''owner'')','= ''super_admin''');

    IF r.proname IN ('adjust_stock','adjust_raw_stock') THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''inventory.adjust'') THEN','gi');
    ELSIF r.proname IN ('add_statement_line','match_bank_line','complete_bank_reconciliation','create_bank_reconciliation') THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''accounting.reconciliation.manage'') THEN','gi');
      n:=regexp_replace(n,'IF[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''accounting.reconciliation.manage'') THEN','gi');
    ELSIF r.proname='_treasury_guard' THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''accounting.treasury.transfer'') THEN','gi');
    ELSIF r.proname='post_manual_journal' THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''accounting.journal.post'') THEN','gi');
    ELSIF r.proname='pay_supplier' THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''procurement.payment.create'') THEN','gi');
    ELSIF r.proname='receive_payment' THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''sales.payment.receive'') THEN','gi');
    ELSIF r.proname IN ('process_purchase','process_purchase_return') THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''purchases.manage'') THEN','gi');
    ELSIF r.proname='process_expense' THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+NOT[[:space:]]+(public\.)?can_permission\(''expenses.manage''\)[[:space:]]+AND[[:space:]]+get_user_role\(\)[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*\)[[:space:]]+THEN','IF NOT public.can_permission(''expenses.manage'') THEN','gi');
    END IF;

    IF r.proname IN ('authorize_open_drawer','change_sale_payment_method','force_close_shift') THEN
      n:=regexp_replace(n,'IF[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+AND[[:space:]]+v_role[[:space:]]*<>[[:space:]]*''branch_manager''[[:space:]]+THEN','IF NOT public.can_permission(''approvals.override'') THEN','gi');
    END IF;

    IF r.proname='_process_sale_core' THEN
      n:=regexp_replace(n,'IF[[:space:]]+v_role[[:space:]]*=[[:space:]]*''cashier''[[:space:]]+AND[[:space:]]+NOT[[:space:]]+(public\.)?is_pos_admin\(\)[[:space:]]+THEN','IF public.can_permission(''pos.payment.take'') AND NOT public.is_pos_admin() THEN','gi');
    END IF;

    IF r.proname IN ('get_kitchen_queue','get_my_kitchen_stations') THEN
      n:=regexp_replace(n,'v_role[[:space:]]+IN[[:space:]]*\([^)]*(super_admin|owner|branch_manager)[^)]*\)','public.can_permission(''settings.manage'')','gi');
    END IF;

    IF r.proname IN ('get_product_modifiers_admin','save_product_modifiers') THEN
      n:=replace(n,'''products.manage''','''products.modifiers.manage''');
      n:=regexp_replace(n,'v_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([^)]*(super_admin|owner|branch_manager)[^)]*\)','NOT public.can_permission(''products.modifiers.manage'')','gi');
    END IF;

    IF n IS DISTINCT FROM d THEN EXECUTE n; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_to_branch(p_user_id uuid,p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('users.branches.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
 IF NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN RETURN jsonb_build_object('success',false,'error','USER_NOT_FOUND'); END IF;
 INSERT INTO public.user_branch_access(user_id,branch_id) VALUES(p_user_id,p_branch_id) ON CONFLICT(user_id,branch_id) DO NOTHING;
 PERFORM public.log_audit_action(p_branch_id,'assign_branch','user_branch_access',NULL::uuid,jsonb_build_object('user_id',p_user_id,'branch_id',p_branch_id));
 RETURN jsonb_build_object('success',true);
END;$$;

CREATE OR REPLACE FUNCTION public.remove_user_from_branch(p_user_id uuid,p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('users.branches.manage') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED'); END IF;
 IF NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
 IF (SELECT count(*) FROM public.user_branch_access WHERE user_id=p_user_id)<=1 THEN RETURN jsonb_build_object('success',false,'error','LAST_BRANCH'); END IF;
 DELETE FROM public.user_branch_access WHERE user_id=p_user_id AND branch_id=p_branch_id;
 PERFORM public.log_audit_action(p_branch_id,'remove_branch','user_branch_access',NULL::uuid,jsonb_build_object('user_id',p_user_id,'branch_id',p_branch_id));
 RETURN jsonb_build_object('success',true);
END;$$;

CREATE OR REPLACE FUNCTION public.guard_role_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Direct database/service maintenance has no end-user JWT. RLS still governs
 -- authenticated application writes; this exception only keeps migrations and
 -- CI fixture seeding operable.
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF public.is_pos_admin() THEN RETURN NEW; END IF;
 IF NOT public.can_permission('roles.permissions.manage') THEN RAISE EXCEPTION 'PERMISSION_DENIED:roles.permissions.manage'; END IF;
 IF NEW.branch_id IS NULL OR NEW.scope='global' OR NOT public.user_may_access_branch(NEW.branch_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED: role outside caller branch scope'; END IF;
 RETURN NEW;
END;$$;

DROP POLICY IF EXISTS auth_write_roles ON public.roles;
DROP POLICY IF EXISTS auth_write_roles_upd ON public.roles;
DROP POLICY IF EXISTS auth_write_roles_del ON public.roles;
CREATE POLICY auth_write_roles ON public.roles FOR INSERT TO authenticated WITH CHECK(public.is_pos_admin() OR (public.can_permission('roles.permissions.manage') AND scope='branch' AND public.user_may_access_branch(branch_id)));
CREATE POLICY auth_write_roles_upd ON public.roles FOR UPDATE TO authenticated USING(public.is_pos_admin() OR (public.can_permission('roles.permissions.manage') AND scope='branch' AND public.user_may_access_branch(branch_id))) WITH CHECK(public.is_pos_admin() OR (public.can_permission('roles.permissions.manage') AND scope='branch' AND public.user_may_access_branch(branch_id)));
CREATE POLICY auth_write_roles_del ON public.roles FOR DELETE TO authenticated USING(public.is_pos_admin() OR (public.can_permission('roles.permissions.manage') AND scope='branch' AND public.user_may_access_branch(branch_id)));

DROP POLICY IF EXISTS organization_members_insert ON public.organization_members;
CREATE POLICY organization_members_insert ON public.organization_members FOR INSERT TO authenticated WITH CHECK(public.is_pos_admin() OR (public.can_permission('users.branches.manage') AND EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organization_members.organization_id AND m.user_id=auth.uid() AND m.is_active=true)));

DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations FOR UPDATE TO authenticated USING(public.is_pos_admin() OR (public.can_permission('settings.manage') AND EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organizations.id AND m.user_id=auth.uid() AND m.is_active=true))) WITH CHECK(public.is_pos_admin() OR (public.can_permission('settings.manage') AND EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organizations.id AND m.user_id=auth.uid() AND m.is_active=true)));

DROP POLICY IF EXISTS auth_org_admin_manage_user_branch_access ON public.user_branch_access;
DROP POLICY IF EXISTS auth_permission_manage_user_branch_access ON public.user_branch_access;
CREATE POLICY auth_permission_manage_user_branch_access ON public.user_branch_access FOR ALL TO authenticated USING(public.is_pos_admin() OR (public.can_permission('users.branches.manage') AND public.user_may_access_branch(branch_id))) WITH CHECK(public.is_pos_admin() OR (public.can_permission('users.branches.manage') AND public.user_may_access_branch(branch_id)));

DROP POLICY IF EXISTS user_kitchen_station_select ON public.user_kitchen_station_assignments;
CREATE POLICY user_kitchen_station_select ON public.user_kitchen_station_assignments FOR SELECT TO authenticated USING(user_id=auth.uid() OR (public.can_permission('settings.manage') AND public.user_may_access_branch(branch_id)));

DROP FUNCTION IF EXISTS public.is_branch_manager();

DO $$
DECLARE v_count integer; v_objects text; v_policies text;
BEGIN
 IF to_regprocedure('public.is_branch_manager()') IS NOT NULL THEN RAISE EXCEPTION 'PERMISSION_FIRST_DRIFT: is_branch_manager still exists'; END IF;

 SELECT count(*) INTO v_count FROM public.roles r CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.permissions,'[]'::jsonb)) x(permission)
 WHERE x.permission=ANY(ARRAY['pos.sell','pos.pay','pos.split_order','pos.transfer_order','products.manage','inventory.manage','inventory.transfers','inventory.transfers.approve','catalog.view','procurement.view','accounting.view','admin.view']);
 IF v_count<>0 THEN RAISE EXCEPTION 'PERMISSION_FIRST_DRIFT: legacy role permissions remain (%)',v_count; END IF;

 SELECT string_agg(p.oid::regprocedure::text,', ' ORDER BY p.oid::regprocedure::text) INTO v_objects
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.prokind='f' AND p.proname NOT IN('is_pos_admin','guard_user_role_changes') AND (
  position('''pos.sell''' in pg_get_functiondef(p.oid))>0 OR position('''pos.pay''' in pg_get_functiondef(p.oid))>0 OR
  position('''pos.split_order''' in pg_get_functiondef(p.oid))>0 OR position('''pos.transfer_order''' in pg_get_functiondef(p.oid))>0 OR
  position('''products.manage''' in pg_get_functiondef(p.oid))>0 OR position('''inventory.manage''' in pg_get_functiondef(p.oid))>0 OR
  position('''inventory.transfers''' in pg_get_functiondef(p.oid))>0 OR position('''inventory.transfers.approve''' in pg_get_functiondef(p.oid))>0 OR
  pg_get_functiondef(p.oid) ~ 'get_user_role\(\)[[:space:]]*(=|<>)[[:space:]]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ 'get_user_role\(\)[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\([^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ 'v_role[[:space:]]*(=|<>)[[:space:]]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ 'v_role[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\([^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ '(u\.role|users\.role)[[:space:]]*(=|<>)[[:space:]]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ '(u\.role|users\.role)[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\([^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  pg_get_functiondef(p.oid) ~ 'membership_role[[:space:]]*(=|<>)[[:space:]]*''owner''' OR
  pg_get_functiondef(p.oid) ~ 'membership_role[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\([^)]*''owner'''
 );
 IF v_objects IS NOT NULL THEN RAISE EXCEPTION 'PERMISSION_FIRST_DRIFT: runtime authorization remains: %',v_objects; END IF;

 SELECT string_agg(tablename||':'||policyname,', ' ORDER BY tablename,policyname) INTO v_policies FROM pg_policies WHERE schemaname='public' AND (
  COALESCE(qual,'') ~ 'is_branch_manager\(' OR COALESCE(with_check,'') ~ 'is_branch_manager\(' OR
  COALESCE(qual,'') ~ 'membership_role[^)]*''owner''' OR COALESCE(with_check,'') ~ 'membership_role[^)]*''owner''' OR
  COALESCE(qual,'') ~ '(users\.)?role[^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR COALESCE(with_check,'') ~ '(users\.)?role[^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)''' OR
  COALESCE(qual,'') ~ '''(products\.manage|inventory\.manage|pos\.sell|pos\.pay)''' OR COALESCE(with_check,'') ~ '''(products\.manage|inventory\.manage|pos\.sell|pos\.pay)'''
 );
 IF v_policies IS NOT NULL THEN RAISE EXCEPTION 'PERMISSION_FIRST_DRIFT: RLS authorization remains: %',v_policies; END IF;
END;$$;
