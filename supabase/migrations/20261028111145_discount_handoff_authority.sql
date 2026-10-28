-- Permission-based discount handoff; no role-name decisions or new definer functions.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE TABLE private.pos_order_discount_authority (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 branch_id uuid NOT NULL,discount_amount numeric NOT NULL CHECK(discount_amount>0),discount_type text NOT NULL,
 authorized_by uuid NOT NULL,authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.pos_order_discount_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pos_order_discount_authority FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.pos_order_discount_authority TO service_role;
CREATE FUNCTION private.get_order_discount_authority(p_order_id uuid,p_branch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $authority$
 SELECT to_jsonb(a) FROM private.pos_order_discount_authority a
 JOIN public.orders o ON o.id=a.order_id
 WHERE a.order_id=p_order_id AND a.branch_id=p_branch_id AND o.branch_id=p_branch_id
 AND o.status IN ('open','held') AND a.discount_amount=o.discount_amount
 AND a.discount_type=COALESCE(o.discount_type,'amount');
$authority$;
REVOKE ALL ON FUNCTION private.get_order_discount_authority(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.get_order_discount_authority(uuid,uuid) TO service_role;
DO $patch_enforce_pos_permission_mutation$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enforce_pos_permission_mutation' AND p.pronargs=0;
 v_old:=$old$  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN$old$;
 v_new:=$new$  -- DISCOUNT_HANDOFF_CAPTURE: only a server-verified discount capability
  -- may create proof. Any later unauthorized budget change makes it mismatch.
  IF TG_TABLE_NAME='orders' AND TG_OP IN ('INSERT','UPDATE')
     AND public.can_permission('pos.discount') THEN
    IF TG_OP='INSERT' THEN
      IF COALESCE(NEW.discount_amount,0)>0 THEN
        INSERT INTO private.pos_order_discount_authority(order_id,branch_id,discount_amount,discount_type,authorized_by)
        VALUES(NEW.id,NEW.branch_id,NEW.discount_amount,COALESCE(NEW.discount_type,'amount'),auth.uid())
        ON CONFLICT(order_id) DO UPDATE SET discount_amount=EXCLUDED.discount_amount,discount_type=EXCLUDED.discount_type,authorized_by=EXCLUDED.authorized_by,authorized_at=clock_timestamp();
      END IF;
    ELSIF COALESCE(NEW.discount_amount,0)>0 AND (
      NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.discount_type IS DISTINCT FROM OLD.discount_type
      OR (to_jsonb(NEW)-ARRAY['subtotal','discount_amount','discount_type','tax_amount','total','updated_at'])
        =(to_jsonb(OLD)-ARRAY['subtotal','discount_amount','discount_type','tax_amount','total','updated_at'])
    ) THEN
      INSERT INTO private.pos_order_discount_authority(order_id,branch_id,discount_amount,discount_type,authorized_by)
      VALUES(NEW.id,NEW.branch_id,NEW.discount_amount,COALESCE(NEW.discount_type,'amount'),auth.uid())
      ON CONFLICT(order_id) DO UPDATE SET discount_amount=EXCLUDED.discount_amount,discount_type=EXCLUDED.discount_type,authorized_by=EXCLUDED.authorized_by,authorized_at=clock_timestamp();
    END IF;
  END IF;

  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'enforce_pos_permission_mutation source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_enforce_pos_permission_mutation$;
DO $patch_process_sale$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_sale' AND p.pronargs=20;
 v_old:=$old$IF v_order_owner IS DISTINCT FROM auth.uid() THEN$old$;
 v_new:=$new$IF p_order_id IS NOT NULL THEN -- Scope payment bookkeeping for both own and other operators orders.$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  v_req_id uuid;$old$;
 v_new:=$new$  v_req_id uuid;
  v_discount_handoff jsonb;
  v_previous_discount_handoff text;
  v_handoff_preview jsonb;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  IF v_header_discount > 0 AND NOT public.can_permission('pos.discount') THEN$old$;
 v_new:=$new$  -- DISCOUNT_HANDOFF_CHECK: the order row is already locked; do not
  -- grant discount permission to the collecting cashier.
  IF p_order_id IS NOT NULL AND v_header_discount>0 AND NOT public.can_permission('pos.discount') THEN
    v_discount_handoff:=private.get_order_discount_authority(p_order_id,p_branch_id);
  END IF;

  IF v_header_discount > 0 AND NOT public.can_permission('pos.discount') AND v_discount_handoff IS NULL THEN$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  v_result := public._process_sale_core($old$;
 v_new:=$new$    -- DISCOUNT_HANDOFF_CONTEXT: scoped to this exact invoice; restored below.
    v_previous_discount_handoff:=COALESCE(current_setting('app.pos_discount_handoff',true),'');
    PERFORM set_config('app.pos_discount_handoff',CASE WHEN v_discount_handoff IS NOT NULL THEN
      jsonb_build_object('order_id',p_order_id,'branch_id',p_branch_id,'invoice_number',p_invoice_number,
        'discount_amount',v_header_discount,'subtotal',v_server_subtotal,'authority',v_discount_handoff)::text
      ELSE '' END,true);
  v_result := public._process_sale_core($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN$old$;
 v_new:=$new$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);
$old$;
 v_new:=$new$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);

    IF COALESCE((v_result->>'success')::boolean,false) AND v_discount_handoff IS NOT NULL THEN
      INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
      VALUES(auth.uid(),'ORDER_DISCOUNT_INHERITED','orders',p_order_id,
        jsonb_build_object('invoice_number',p_invoice_number,'sale_id',v_result->>'sale_id','discount_amount',v_header_discount,
          'authorized_by',v_discount_handoff->>'authorized_by'),p_branch_id);
    END IF;
$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_process_sale$;
DO $patch_process_sale_split$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_sale_split' AND p.pronargs=19;
 v_old:=$old$IF v_order_owner IS DISTINCT FROM auth.uid() THEN$old$;
 v_new:=$new$IF p_order_id IS NOT NULL THEN -- Scope payment bookkeeping for both own and other operators orders.$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$  v_req_id uuid;$old$;
 v_new:=$new$  v_req_id uuid;
  v_discount_handoff jsonb;
  v_previous_discount_handoff text;
  v_handoff_preview jsonb;$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$    IF COALESCE(p_discount_amount,0)>0 AND NOT public.can_permission('pos.discount') THEN$old$;
 v_new:=$new$    -- DISCOUNT_HANDOFF_CHECK: a split client amount must equal the
    -- authoritative pending discount, never an invented discount.
    IF p_order_id IS NOT NULL AND v_header_discount>0 AND NOT public.can_permission('pos.discount') THEN
      v_handoff_preview:=public._build_order_settlement_preview(p_order_id);
      IF COALESCE((v_handoff_preview->>'success')::boolean,false)
         AND v_header_discount=COALESCE((v_handoff_preview->>'discount_amount')::numeric,-1)
         AND v_server_subtotal=COALESCE((v_handoff_preview->>'subtotal')::numeric,-1) THEN
        v_discount_handoff:=private.get_order_discount_authority(p_order_id,p_branch_id);
      END IF;
    END IF;

    IF COALESCE(p_discount_amount,0)>0 AND NOT public.can_permission('pos.discount') AND v_discount_handoff IS NULL THEN$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$    v_core := public._process_sale_core($old$;
 v_new:=$new$    -- DISCOUNT_HANDOFF_CONTEXT: scoped to this exact invoice; restored below.
    v_previous_discount_handoff:=COALESCE(current_setting('app.pos_discount_handoff',true),'');
    PERFORM set_config('app.pos_discount_handoff',CASE WHEN v_discount_handoff IS NOT NULL THEN
      jsonb_build_object('order_id',p_order_id,'branch_id',p_branch_id,'invoice_number',p_invoice_number,
        'discount_amount',v_header_discount,'subtotal',v_server_subtotal,'authority',v_discount_handoff)::text
      ELSE '' END,true);
    v_core := public._process_sale_core($new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
    IF p_order_id IS NOT NULL THEN
      PERFORM set_config('app.kitchen_inventory_settlement','off',true);$old$;
 v_new:=$new$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);

    IF p_order_id IS NOT NULL THEN
      PERFORM set_config('app.kitchen_inventory_settlement','off',true);$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:=$old$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);
$old$;
 v_new:=$new$
    PERFORM set_config('app.pos_discount_handoff',v_previous_discount_handoff,true);

    IF COALESCE((v_core->>'success')::boolean,false) AND v_discount_handoff IS NOT NULL THEN
      INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
      VALUES(auth.uid(),'ORDER_DISCOUNT_INHERITED','orders',p_order_id,
        jsonb_build_object('invoice_number',p_invoice_number,'sale_id',v_core->>'sale_id','discount_amount',v_header_discount,
          'authorized_by',v_discount_handoff->>'authorized_by'),p_branch_id);
    END IF;
$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'process_sale_split source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_process_sale_split$;
DO $patch_guard_sale_discount$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='guard_sale_discount' AND p.pronargs=0;
 v_old:=$old$BEGIN
  IF NEW.discount_amount$old$;
 v_new:=$new$DECLARE
  v_handoff jsonb;
  v_authority jsonb;
BEGIN
  -- DISCOUNT_HANDOFF_SALE_GUARD: inherited proof cannot authorize another invoice.
  IF current_user='postgres' AND NEW.discount_amount>0
     AND NULLIF(current_setting('app.pos_discount_handoff',true),'') IS NOT NULL THEN
    v_handoff:=current_setting('app.pos_discount_handoff',true)::jsonb;
    IF v_handoff->>'invoice_number'=NEW.invoice_number
       AND (v_handoff->>'branch_id')::uuid=NEW.branch_id
       AND (v_handoff->>'discount_amount')::numeric=NEW.discount_amount
       AND (v_handoff->>'subtotal')::numeric=NEW.subtotal THEN
      v_authority:=private.get_order_discount_authority((v_handoff->>'order_id')::uuid,NEW.branch_id);
      IF v_authority IS NOT NULL AND v_authority=v_handoff->'authority' THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF NEW.discount_amount$new$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'guard_sale_discount source drift'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 EXECUTE v_def;
END;
$patch_guard_sale_discount$;
COMMIT;
