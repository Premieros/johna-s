
-- STAGED / REVIEW ONLY. NEVER APPLY TO PRODUCTION AUTOMATICALLY.
-- Test only in rollback-only local CI. Requires independent production approval.
-- Transactional print-handoff candidate: authoritative kitchen delta -> durable
-- cloud print job in the SAME transaction; no Windows or client API change.
-- Existing kitchen identity: kitchen:<station>:<sorted send_id:current_quantity>.
-- Error in queue insertion aborts the send transaction instead of recording
-- "sent" without a printable job. No implicit reprint of historic orders.
CREATE OR REPLACE FUNCTION private._enqueue_kitchen_sent_delta(
  p_branch_id uuid, p_order_id uuid, p_actor_id uuid, p_send jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $atomic_print$
DECLARE
  v_station text;
  v_group jsonb;
  v_order public.orders%ROWTYPE;
  v_key text;
  v_text text;
  v_item_text text;
  v_template_items jsonb;
  v_meta jsonb;
  v_ticket jsonb;
  v_count integer := 0;
  v_stamp text;
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_MISSING_CONTEXT';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id;
  IF NOT FOUND OR v_order.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_ORDER_BRANCH_MISMATCH';
  END IF;
  IF COALESCE((p_send->>'success')::boolean,false) IS NOT TRUE
     OR COALESCE((p_send->>'items_sent_count')::integer,0) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_send->'sent') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_send->'sent') = 0 THEN
    RAISE EXCEPTION 'KITCHEN_PRINT_MISSING_SENT_DELTA';
  END IF;
  v_stamp := to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD HH24:MI');

  FOR v_station, v_group IN
    SELECT btrim(item->>'station_code') AS station,
           jsonb_agg(item ORDER BY ord) AS group_items
    FROM jsonb_array_elements(p_send->'sent') WITH ORDINALITY AS i(item,ord)
    WHERE NULLIF(btrim(COALESCE(item->>'station_code','')),'') IS NOT NULL
    GROUP BY btrim(item->>'station_code')
  LOOP
    -- The number before ':' must match the browser Number(current_quantity)
    -- formatting, not raw NUMERIC(14,4) scale.
    SELECT string_agg(
      NULLIF(item->>'send_id','') || ':' ||
      (((item->>'current_quantity')::numeric)::double precision)::text,
      ',' ORDER BY
      NULLIF(item->>'send_id','') || ':' ||
      (((item->>'current_quantity')::numeric)::double precision)::text
    )
    INTO v_key
    FROM jsonb_array_elements(v_group) item;
    IF v_key IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_group) item
      WHERE NULLIF(item->>'send_id','') IS NULL
         OR NULLIF(item->>'current_quantity','') IS NULL
         OR NULLIF(item->>'quantity','') IS NULL
    ) THEN
      RAISE EXCEPTION 'KITCHEN_PRINT_DELTA_IDENTITY_MISSING';
    END IF;
    v_key := 'kitchen:' || v_station || ':' || v_key;

    SELECT COALESCE(string_agg(
      ((item->>'quantity')::numeric::double precision)::text ||
      ' × ' || COALESCE(NULLIF(item->>'product_name',''),'—') ||
      COALESCE(
        (SELECT ' • ' || string_agg(COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en'), ' • ')
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(item->'modifiers')='array'
             THEN item->'modifiers' ELSE '[]'::jsonb END
         ) m
         WHERE COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en') IS NOT NULL),
        ''
      ) ||
      CASE WHEN NULLIF(btrim(COALESCE(item->>'notes','')),'') IS NOT NULL
        THEN ' • ' || btrim(item->>'notes') ELSE '' END,
      E'\n' ORDER BY ord),''), COALESCE(jsonb_agg(
      jsonb_build_object(
        'qty', ((item->>'quantity')::numeric::double precision)::text,
        'name', COALESCE(NULLIF(item->>'product_name',''),'—'),
        'notes', NULLIF(btrim(COALESCE(item->>'notes','')),''),
        'modifiers', COALESCE((
          SELECT jsonb_agg(COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en'))
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(item->'modifiers')='array'
              THEN item->'modifiers' ELSE '[]'::jsonb END
          ) m
          WHERE COALESCE(NULLIF(m->>'option_name',''),m->>'option_name_en') IS NOT NULL
        ),'[]'::jsonb)
      ) ORDER BY ord
    ),'[]'::jsonb)
    INTO v_item_text, v_template_items
    FROM jsonb_array_elements(v_group) WITH ORDINALITY AS i(item,ord);

    v_text := concat_ws(E'\n',
      'تذكرة المطبخ','المحطة',v_station,repeat('-',32),
      'الطلب: ' || COALESCE(NULLIF(p_send->>'order_number',''),p_order_id::text),
      CASE WHEN NULLIF(p_send->>'table_name','') IS NOT NULL
        THEN 'الطاولة: ' || (p_send->>'table_name') END,
      CASE WHEN NULLIF(p_send->>'order_type','') IS NOT NULL
        THEN 'النوع: ' || (p_send->>'order_type') END,
      'الوقت: ' || to_char(timezone('Africa/Cairo',now()),'HH24:MI'),
      CASE WHEN NULLIF(p_send->>'guest_count','') IS NOT NULL
        THEN 'الأفراد: ' || (p_send->>'guest_count') END,
      repeat('-',32),'الأصناف',v_item_text,repeat('-',32));

    v_meta := jsonb_build_array(
      jsonb_build_object('label','رقم الطلب','value',
        COALESCE(NULLIF(p_send->>'order_number',''),p_order_id::text),'emphasis',true),
      jsonb_build_object('label','التاريخ','value',v_stamp),
      jsonb_build_object('label','النوع','value',COALESCE(p_send->>'order_type','—'))
    );
    IF NULLIF(p_send->>'table_name','') IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_array(
        jsonb_build_object('label','الطاولة','value',p_send->>'table_name','emphasis',true)
      );
    END IF;
    IF NULLIF(p_send->>'guest_count','') IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_array(
        jsonb_build_object('label','عدد الأفراد','value',p_send->>'guest_count')
      );
    END IF;

    v_ticket := jsonb_build_object(
      'order_id',p_order_id,'text',v_text,'paperWidthMm',80,'copies',1,
      'template',jsonb_build_object(
        'version',1,'kind','kitchen','isAr',true,'paperWidthMm',80,
        'storeName','JOHNA''S','storeSubtitle','RESTAURANT',
        'title','تذكرة المطبخ','subtitle','نسخة المطبخ',
        'station',v_station,'meta',v_meta,'itemsHeading','الأصناف',
        'items',v_template_items,
        'footerLines',jsonb_build_array('نهاية الطلب')
      )
    );
    INSERT INTO public.cloud_print_jobs (
      branch_id,requested_by,kind,station_code,payload,idempotency_key
    ) VALUES (p_branch_id,p_actor_id,'kitchen',v_station,v_ticket,v_key)
    ON CONFLICT (branch_id,idempotency_key) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$atomic_print$;

-- The original SECURITY DEFINER wrapper, with the only added call immediately
-- after the canonical core. No core/FIFO/stock, guards, grants, or ACL changes.

CREATE OR REPLACE FUNCTION public.send_to_kitchen(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_is_service_role boolean := COALESCE(current_setting('role',true),'')='service_role';
  v_was_served boolean := false;
  v_result jsonb;
BEGIN
  IF v_is_service_role THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
    END IF;
  ELSE
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('pos.send_kitchen') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED',
        'permission','pos.send_kitchen'
      );
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id=p_order_id;

    IF v_order.id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_order.branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;
    IF v_order.status NOT IN ('open','held') THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
    END IF;

    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);
    END IF;
  END IF;

  v_was_served := v_order.kitchen_status = 'served';

  IF v_was_served THEN
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kns_served_before (
      order_item_id uuid PRIMARY KEY,
      sent_quantity numeric(14,4) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kns_served_before;

    INSERT INTO pg_temp.kns_served_before(order_item_id, sent_quantity)
    SELECT oi.id, COALESCE(oks.sent_quantity, 0)
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends oks ON oks.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND COALESCE(oks.sent_quantity, 0) > 0;
  END IF;

  v_result := public._send_to_kitchen_core_20260914(p_order_id,p_sent_by);

  -- The kitchen print intent is inserted in this same order/inventory transaction.
  -- The browser's existing per-station idempotency key resolves to this job;
  -- it cannot create a second physical print task.
  IF v_uid IS NOT NULL
     AND COALESCE((v_result->>'success')::boolean, false)
     AND COALESCE((v_result->>'items_sent_count')::integer, 0) > 0 THEN
    PERFORM private._enqueue_kitchen_sent_delta(
      v_order.branch_id, p_order_id, v_uid, v_result
    );
  END IF;

  IF v_was_served
     AND COALESCE((v_result->>'success')::boolean, false)
     AND COALESCE((v_result->>'items_sent_count')::integer, 0) > 0 THEN
    INSERT INTO public.order_kitchen_served_quantities(
      order_id,
      order_item_id,
      served_quantity,
      served_at
    )
    SELECT p_order_id, b.order_item_id, b.sent_quantity, now()
    FROM pg_temp.kns_served_before b
    ON CONFLICT (order_id, order_item_id) DO UPDATE
    SET served_quantity = EXCLUDED.served_quantity,
        served_at = EXCLUDED.served_at;

    UPDATE public.orders
    SET kitchen_status = 'sent',
        kitchen_sent_at = now(),
        updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN v_result || jsonb_build_object('branch_id',v_order.branch_id);
END;
$function$

