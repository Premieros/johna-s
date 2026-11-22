-- Avoid per-row reevaluation of auth.uid() in row security policies.
-- Keep every original branch, role and permission predicate exactly as-is.
-- Policies are sourced from production definitions on 2026-11-22.
-- Do NOT rewrite organization_members policies: their self-reference can trigger
-- recursive RLS evaluation after wrapping auth.uid(), as caught by CI.
-- Intentionally do not change app.register_branch or financial restrictive policies.

ALTER POLICY "branch_overrides_select" ON public."branch_feature_overrides" USING (is_super_admin() OR (EXISTS ( SELECT 1
   FROM organization_members om
  WHERE ((om.organization_id = branch_feature_overrides.tenant_id) AND (om.user_id = (select auth.uid())) AND (om.is_active = true)))) OR (branch_id = get_branch_id()));

ALTER POLICY "cloud_print_jobs_select" ON public."cloud_print_jobs" USING (user_may_access_branch(branch_id) AND ((requested_by = (select auth.uid())) OR can_permission('settings.manage'::text)));

ALTER POLICY "auth_insert_order_items" ON public."order_items" WITH CHECK (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND user_may_access_branch(o.branch_id) AND ((o.cashier_id = (select auth.uid())) OR can_manage_other_pos_orders()))));

ALTER POLICY "auth_update_order_items" ON public."order_items" USING (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND user_may_access_branch(o.branch_id) AND ((o.cashier_id = (select auth.uid())) OR can_manage_other_pos_orders())))) WITH CHECK (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND user_may_access_branch(o.branch_id) AND ((o.cashier_id = (select auth.uid())) OR can_manage_other_pos_orders()))));




ALTER POLICY "organizations_select" ON public."organizations" USING (is_pos_admin() OR (EXISTS ( SELECT 1
   FROM organization_members om
  WHERE ((om.organization_id = organizations.id) AND (om.user_id = (select auth.uid())) AND om.is_active))));

ALTER POLICY "organizations_update" ON public."organizations" USING (is_pos_admin() OR (can_permission('settings.manage'::text) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = (select auth.uid())) AND (m.is_active = true)))))) WITH CHECK (is_pos_admin() OR (can_permission('settings.manage'::text) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = (select auth.uid())) AND (m.is_active = true))))));

ALTER POLICY "subscription_events_select" ON public."subscription_events" USING (is_super_admin() OR (EXISTS ( SELECT 1
   FROM organization_members om
  WHERE ((om.organization_id = subscription_events.tenant_id) AND (om.user_id = (select auth.uid())) AND (om.is_active = true)))));

ALTER POLICY "subscription_payments_branch_read" ON public."subscription_payments" USING (is_super_admin() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND u.is_active AND (u.branch_id = subscription_payments.branch_id)))));

ALTER POLICY "subscriptions_select" ON public."subscriptions" USING (is_super_admin() OR (EXISTS ( SELECT 1
   FROM organization_members om
  WHERE ((om.organization_id = subscriptions.tenant_id) AND (om.user_id = (select auth.uid())) AND (om.is_active = true)))) OR (EXISTS ( SELECT 1
   FROM branches b
  WHERE ((b.organization_id = subscriptions.tenant_id) AND (b.id = get_branch_id())))));

ALTER POLICY "user_kitchen_station_select" ON public."user_kitchen_station_assignments" USING ((user_id = (select auth.uid())) OR (can_permission('settings.manage'::text) AND user_may_access_branch(branch_id)));

ALTER POLICY "work_authorization_events_select" ON public."work_authorization_events" USING ((user_id = (select auth.uid())) OR (can_permission('work.authorization.approve'::text) AND user_may_access_branch(branch_id)));

ALTER POLICY "work_authorization_policies_select" ON public."work_authorization_policies" USING ((user_id = (select auth.uid())) OR (can_permission('work.authorization.manage'::text) AND user_may_access_branch(branch_id)));

ALTER POLICY "work_authorizations_select" ON public."work_authorizations" USING ((user_id = (select auth.uid())) OR (can_permission('work.authorization.approve'::text) AND user_may_access_branch(branch_id)));
