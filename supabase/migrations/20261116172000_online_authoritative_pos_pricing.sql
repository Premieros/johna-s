-- Apply branch online price only in authoritative existing POS pricing.
-- Retain all existing trigger early exits, modifier snapshot, discount approval,
-- taxes, stock, kitchen and accounting paths. Guard source drift fail-closed.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

DO $patch$
DECLARE
  v_sig regprocedure;
  v_def text;
  v_from text;
  v_to text;
  v_count int;
  v_names text[] := ARRAY[
    'public._reprice_order_item()',
    'public._process_sale_core(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)',
    'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)',
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'
  ];
  v_name text;
  v_step int;
BEGIN
  FOR v_step IN 1..4 LOOP
    v_name := v_names[v_step];
    v_sig := to_regprocedure(v_name);
    IF v_sig IS NULL OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_sig) THEN
      RAISE EXCEPTION 'ONLINE_PRICING_FUNCTION_DRIFT: %',v_name;
    END IF;
    SELECT pg_get_functiondef(v_sig) INTO v_def;

    IF v_step=1 THEN
      v_from := 'NEW.unit_price:=ROUND(GREATEST(COALESCE(v_base_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0),2);';
      v_to := 'NEW.unit_price:=public._online_order_price(v_branch_id,(SELECT o.order_type FROM public.orders o WHERE o.id=NEW.order_id),GREATEST(COALESCE(v_base_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0));';
    ELSIF v_step=2 THEN
      v_from := 'v_unit_price := GREATEST(v_unit_price+COALESCE((v_mod->>''price_delta'')::numeric,0),0);';
      v_to := 'v_unit_price := public._online_order_price(p_branch_id,p_order_type,GREATEST(v_unit_price+COALESCE((v_mod->>''price_delta'')::numeric,0),0));';
    ELSIF v_step=3 THEN
      v_from := 'v_price := GREATEST(COALESCE(v_price,0) + COALESCE((v_mod->>''price_delta'')::numeric,0), 0);';
      v_to := 'v_price := public._online_order_price(p_branch_id,p_order_type,GREATEST(COALESCE(v_price,0) + COALESCE((v_mod->>''price_delta'')::numeric,0), 0));';
    ELSE
      v_from := 'v_price := GREATEST(COALESCE(v_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0);';
      v_to := 'v_price := public._online_order_price(p_branch_id,p_order_type,GREATEST(COALESCE(v_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0));';
    END IF;

    v_count:=(length(v_def)-length(replace(v_def,v_from,'')))/length(v_from);
    IF v_count<>1 OR position('public._online_order_price(' in v_def)>0 THEN
      RAISE EXCEPTION 'ONLINE_PRICING_ANCHOR_DRIFT: % count %',v_name,v_count;
    END IF;
    v_def := replace(v_def,v_from,v_to);
    IF v_step=2 THEN
      v_from := 'v_unit_price := GREATEST(COALESCE(v_unit_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0);';
      v_to := 'v_unit_price := public._online_order_price(p_branch_id,p_order_type,GREATEST(COALESCE(v_unit_price,0)+COALESCE((v_mod->>''price_delta'')::numeric,0),0));';
      v_count:=(length(v_def)-length(replace(v_def,v_from,'')))/length(v_from);
      IF v_count<>1 THEN RAISE EXCEPTION 'ONLINE_PRICING_SALE_ITEM_DRIFT'; END IF;
      v_def:=replace(v_def,v_from,v_to);

      -- The caller must not request a different type for an already staged
      -- order, which would change the markup while settling sent inventory.
      v_from := '    IF p_order_id IS NOT NULL THEN';
      v_to := $guard$
    IF p_order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id=p_order_id AND o.branch_id=p_branch_id
        AND o.order_type=p_order_type
    ) THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_TYPE_MISMATCH');
    END IF;
    IF p_order_id IS NOT NULL THEN$guard$;
      v_count:=(length(v_def)-length(replace(v_def,v_from,'')))/length(v_from);
      IF v_count<>1 THEN RAISE EXCEPTION 'ONLINE_ORDER_TYPE_GUARD_DRIFT'; END IF;
      v_def:=replace(v_def,v_from,v_to);
    END IF;
    EXECUTE v_def;
  END LOOP;
END;
$patch$;
COMMIT;
