-- Production patch: historical kitchen valuations may differ from
-- ledger totals by <= 0.005 because legacy ledger total_cost was rounded.
-- Clamp only that sub-cent drift; larger negative results remain hard errors.
BEGIN;

CREATE OR REPLACE FUNCTION public._fifo_adjust_kitchen_effect_delta(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_event public.order_kitchen_inventory_events%ROWTYPE;
  v_effect_id uuid;
  v_effect_total numeric(18,6);
  v_effect_new numeric(18,6);
  v_effect_delta numeric(18,6);
  v_event_new numeric(18,6);
  v_event_delta numeric(18,6);
  v_sale_delta numeric(18,6):=0;
  v_res jsonb;
BEGIN
  IF p_event_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  SELECT * INTO v_event
  FROM public.order_kitchen_inventory_events
  WHERE id=p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_KITCHEN_EVENT_NOT_FOUND');
  END IF;

  SELECT id,total_cost
  INTO v_effect_id,v_effect_total
  FROM public.order_kitchen_inventory_effects
  WHERE event_id=p_event_id
    AND target_type=p_target_type
    AND target_id=p_target_id
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_effect_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_KITCHEN_EFFECT_NOT_FOUND',
      'event_id',p_event_id,
      'target_type',p_target_type,
      'target_id',p_target_id
    );
  END IF;

  v_effect_new:=COALESCE(v_effect_total,0)+p_delta;
  IF v_effect_new < -0.000001 THEN
    IF abs(v_effect_new)<=0.005 THEN
      v_effect_new:=0;
    ELSE
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EFFECT_COST_NEGATIVE',
        'event_id',p_event_id,
        'target_type',p_target_type,
        'target_id',p_target_id,
        'current_cost',v_effect_total,
        'requested_delta',p_delta
      );
    END IF;
  END IF;
  v_effect_delta:=v_effect_new-COALESCE(v_effect_total,0);

  v_event_new:=COALESCE(v_event.total_cost,0)+p_delta;
  IF v_event_new < -0.000001 THEN
    IF abs(v_event_new)<=0.005 THEN
      v_event_new:=0;
    ELSE
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_COST_NEGATIVE',
        'event_id',p_event_id,
        'current_cost',v_event.total_cost,
        'requested_delta',p_delta
      );
    END IF;
  END IF;
  v_event_delta:=v_event_new-COALESCE(v_event.total_cost,0);

  UPDATE public.order_kitchen_inventory_effects
  SET total_cost=v_effect_new
  WHERE id=v_effect_id;

  UPDATE public.order_kitchen_inventory_events
  SET total_cost=v_event_new
  WHERE id=p_event_id;

  IF v_event.settled_sale_id IS NOT NULL
     AND COALESCE(v_event.sent_quantity,0)>0 THEN
    v_sale_delta:=v_event_delta
      * GREATEST(v_event.sent_quantity-COALESCE(v_event.voided_quantity,0),0)
      / v_event.sent_quantity;

    IF v_sale_delta<>0 THEN
      v_res:=public._fifo_adjust_sale_cogs_delta(
        v_event.settled_sale_id,
        v_sale_delta
      );
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'requested_delta',p_delta,
    'effect_delta',v_effect_delta,
    'event_delta',v_event_delta,
    'sale_delta',v_sale_delta
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._fifo_adjust_kitchen_effect_delta(uuid,text,uuid,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_kitchen_effect_delta(uuid,text,uuid,numeric)
  TO service_role,postgres;

COMMIT;
