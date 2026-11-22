-- Make authorized branches equivalent while preserving existing permissions, restrictive financial history policies and document segregation.
-- Backports the verified production RLS/function corrections.
-- Do not widen manufactured-recipe/component policies here: their secondary-branch
-- costing path already requires reports.costing and an explicit branch grant.
-- This protects cashiers from reading manufacturing recipes just because they can use a branch.
ALTER POLICY "daily_closes_select" ON public."daily_closes" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "daily_closes_write" ON public."daily_closes" WITH CHECK ((is_pos_admin() OR (can_permission('shifts.day_close'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "auth_select_inventory" ON public."inventory" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "auth_delete_purchase_items" ON public."purchase_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_items.purchase_id) AND ((p.branch_id IS NULL) OR (p.branch_id = get_branch_id()) OR (can_permission('purchases.manage'::text) AND user_may_access_branch(p.branch_id))))))));

ALTER POLICY "auth_insert_purchase_items" ON public."purchase_items" WITH CHECK ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_items.purchase_id) AND ((p.branch_id IS NULL) OR (p.branch_id = get_branch_id()) OR (can_permission('purchases.manage'::text) AND user_may_access_branch(p.branch_id))))))));

ALTER POLICY "auth_select_purchase_items" ON public."purchase_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_items.purchase_id) AND ((p.branch_id IS NULL) OR (p.branch_id = get_branch_id()) OR (can_permission('purchases.view'::text) AND user_may_access_branch(p.branch_id))))))));

ALTER POLICY "auth_update_purchase_items" ON public."purchase_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_items.purchase_id) AND ((p.branch_id IS NULL) OR (p.branch_id = get_branch_id()) OR (can_permission('purchases.manage'::text) AND user_may_access_branch(p.branch_id)))))))) WITH CHECK ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_items.purchase_id) AND ((p.branch_id IS NULL) OR (p.branch_id = get_branch_id()) OR (can_permission('purchases.manage'::text) AND user_may_access_branch(p.branch_id))))))));

ALTER POLICY "purchase_receipt_items_select" ON public."purchase_receipt_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchase_receipts r
  WHERE ((r.id = purchase_receipt_items.receipt_id) AND user_may_access_branch(r.branch_id))))));

ALTER POLICY "purchase_receipt_items_write" ON public."purchase_receipt_items" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM purchase_receipts r
  WHERE ((r.id = purchase_receipt_items.receipt_id) AND user_may_access_branch(r.branch_id))))))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM purchase_receipts r
  WHERE ((r.id = purchase_receipt_items.receipt_id) AND user_may_access_branch(r.branch_id)))))));

ALTER POLICY "purchase_receipts_select" ON public."purchase_receipts" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "purchase_receipts_write" ON public."purchase_receipts" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id)))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "purchase_request_items_select" ON public."purchase_request_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM purchase_requests r
  WHERE ((r.id = purchase_request_items.request_id) AND user_may_access_branch(r.branch_id))))));

ALTER POLICY "purchase_request_items_write" ON public."purchase_request_items" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requests r
  WHERE ((r.id = purchase_request_items.request_id) AND user_may_access_branch(r.branch_id))))))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requests r
  WHERE ((r.id = purchase_request_items.request_id) AND user_may_access_branch(r.branch_id)))))));

ALTER POLICY "purchase_requests_delete" ON public."purchase_requests" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "purchase_requests_insert" ON public."purchase_requests" WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "purchase_requests_select" ON public."purchase_requests" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "purchase_requests_update" ON public."purchase_requests" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id)))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "auth_all_raw_material_movements" ON public."raw_material_movements" USING ((is_pos_admin() OR user_may_access_branch(branch_id))) WITH CHECK ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "rfq_items_select" ON public."rfq_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = rfq_items.rfq_id) AND user_may_access_branch(r.branch_id))))));

ALTER POLICY "rfq_items_write" ON public."rfq_items" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = rfq_items.rfq_id) AND user_may_access_branch(r.branch_id))))))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = rfq_items.rfq_id) AND user_may_access_branch(r.branch_id)))))));

ALTER POLICY "rfqs_select" ON public."rfqs" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "rfqs_write" ON public."rfqs" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id)))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));

ALTER POLICY "supplier_quotation_items_select" ON public."supplier_quotation_items" USING ((is_pos_admin() OR (EXISTS ( SELECT 1
   FROM supplier_quotations q
  WHERE ((q.id = supplier_quotation_items.quotation_id) AND user_may_access_branch(q.branch_id))))));

ALTER POLICY "supplier_quotation_items_write" ON public."supplier_quotation_items" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM supplier_quotations q
  WHERE ((q.id = supplier_quotation_items.quotation_id) AND user_may_access_branch(q.branch_id))))))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND (EXISTS ( SELECT 1
   FROM supplier_quotations q
  WHERE ((q.id = supplier_quotation_items.quotation_id) AND user_may_access_branch(q.branch_id)))))));

ALTER POLICY "supplier_quotations_select" ON public."supplier_quotations" USING ((is_pos_admin() OR user_may_access_branch(branch_id)));

ALTER POLICY "supplier_quotations_write" ON public."supplier_quotations" USING ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id)))) WITH CHECK ((is_pos_admin() OR (can_permission('purchases.manage'::text) AND user_may_access_branch(branch_id))));
-- The purchase-return branch check has multiple historical source forms.
-- Preserve its complete function definition and reject any unexpected variant.
DO $guard$
DECLARE
  definition text;
  old_start integer;
  old_end integer;
  old_comparison integer;
  replacement text := $new$
    IF v_purchase.branch_id IS NOT NULL
       AND NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='process_purchase_return'
    AND pg_get_function_identity_arguments(p.oid)='p_purchase_id uuid, p_items jsonb, p_reason text';
  IF strpos(definition, 'user_may_access_branch(v_purchase.branch_id)')>0 THEN
    RETURN; -- already multi-branch authorized
  END IF;
  old_comparison := strpos(definition, 'v_user_branch <> v_purchase.branch_id');
  IF old_comparison=0 THEN
    RAISE EXCEPTION 'purchase return branch guard is unknown; refusing to change permissions';
  END IF;
  old_start := strpos(definition, 'SELECT branch_id INTO v_user_branch');
  IF old_start=0 OR old_start>old_comparison THEN
    RAISE EXCEPTION 'purchase return branch read guard is unknown';
  END IF;
  old_end := strpos(substring(definition FROM old_comparison), 'END IF;')+old_comparison+length('END IF;')-1;
  IF old_end<=old_comparison THEN
    RAISE EXCEPTION 'purchase return guard terminator not found';
  END IF;
  EXECUTE substring(definition FROM 1 FOR old_start-1) || replacement || substring(definition FROM old_end+1);
END
$guard$;
