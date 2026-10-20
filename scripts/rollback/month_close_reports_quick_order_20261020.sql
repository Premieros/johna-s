-- Review-only rollback for #524. Restore the corresponding frontend first.
-- Reverses exact authorization deltas; preserves all operational data.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $restore$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 v_def:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure);
 v_old:=$body$    IF pg_trigger_depth()>1
       AND public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL
       AND OLD.cashier_id=auth.uid() AND OLD.status='open'
       AND OLD.created_at>=transaction_timestamp()
       AND public.user_may_access_branch(OLD.branch_id)
       AND (to_jsonb(NEW)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[]) THEN
      RETURN NEW;
    END IF;
    v_print_only_mutation :=$body$;
 v_new:='    v_print_only_mutation :=';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'REPORT_QUICK_ROLLBACK_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='IF NOT public.can_permission(''pos.order.create'') AND NOT public.can_permission(''pos.order.edit'') AND NOT (public.can_permission(''pos.order.quick_create'') AND (public.can_permission(''pos.discount'') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type=''takeaway'' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status=''open'' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') AND NOT public.can_permission(''pos.order.edit'') THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'REPORT_QUICK_ROLLBACK_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='IF NOT public.can_permission(''pos.order.create'') AND NOT (public.can_permission(''pos.order.quick_create'') AND COALESCE(NEW.order_type=''takeaway'' AND NEW.table_id IS NULL AND NEW.status=''open'' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission(''pos.discount'')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'REPORT_QUICK_ROLLBACK_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
 v_def:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure);
 v_old:='IF NOT public.can_permission(''pos.order.create'') AND NOT (public.can_permission(''pos.order.quick_create'') AND COALESCE(p_order_type=''takeaway'' AND p_table_id IS NULL AND (public.can_permission(''pos.discount'') OR (COALESCE(p_discount_amount,0)=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi WHERE COALESCE((qi->>''discount_amount'')::numeric,0)<>0 OR COALESCE((qi->>''bonus_quantity'')::numeric,0)<>0))),false)) THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'REPORT_QUICK_ROLLBACK_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END $restore$;
DROP FUNCTION public.get_consumption_purchase_report(uuid,date,date,text,text,boolean,integer,integer);
NOTIFY pgrst,'reload schema';
COMMIT;
